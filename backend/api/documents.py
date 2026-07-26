from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_
from typing import List
import os
import asyncio
from datetime import datetime, timedelta

from core.database import get_session, async_session_maker
from core.dependencies import get_current_user
from models.database import Document, DocumentChunk, User, KnowledgeBase
from models.schemas import DocumentResponse, DocumentListResponse
from services.document_service import document_service
from services.embedding_service import embedding_service
from services.rag_service import rag_service
from services.document_processor import document_processor
from services.knowledge_extraction_service import knowledge_extraction_service

router = APIRouter(prefix="/api/documents", tags=["documents"])

PDF_PAGES_PER_REQUEST = 20
PDF_PARSE_TIMEOUT_SECONDS = 20
PROCESSING_TIMEOUT_MINUTES = 30


def _ensure_document_access(doc: Document, user: User) -> None:
    """读取访问控制：所有者、共享文档或管理员，其余一律 403。

    与 list_documents 的可见性规则保持一致：非管理员看不到被禁用（is_active=0）的共享文档。
    """
    if user.role == "admin":
        return
    if doc.owner_id == user.id:
        return
    if doc.visibility == "shared" and (doc.is_active is None or doc.is_active == 1):
        return
    raise HTTPException(403, "无权访问该文档")


async def _reconcile_stuck_processing_documents() -> None:
    cutoff = datetime.utcnow() - timedelta(minutes=PROCESSING_TIMEOUT_MINUTES)
    async with async_session_maker() as session:
        result = await session.execute(
            select(Document).where(
                Document.status == "processing", Document.created_at < cutoff
            )
        )
        stale_docs = result.scalars().all()
        if not stale_docs:
            return

        for doc in stale_docs:
            doc.status = "failed"

        await session.commit()


async def _process_document_async(
    document_id,
    file_path: str,
    file_ext: str,
    api_key: str,
    provider: str,
    base_url: str,
    use_local_embedding: bool,
):
    # Create processing job
    job_id = document_processor.create_job(str(document_id))
    document_processor.start_job(job_id)

    async with async_session_maker() as session:
        doc = await session.get(Document, document_id)
        if doc is None:
            document_processor.fail_job(job_id, "Document not found")
            return

        try:
            # For PDFs, get page count for progress tracking
            total_pages = 0
            if file_ext == ".pdf":
                doc_info = await asyncio.to_thread(document_service.get_pdf_info, file_path)
                total_pages = doc_info.get("total_pages", 0)
                document_processor.update_progress(job_id, 0, total_pages, "开始解析 PDF...")

            # Parse document using unstructured (returns structured elements)
            elements = await document_service.parse_document_structured(file_path, file_ext)

            if not elements:
                doc.status = "failed"
                await session.commit()
                document_processor.fail_job(job_id, "文档未提取到可检索文本，可能是扫描版")
                return

            document_processor.update_progress(job_id, total_pages // 2 if total_pages else 50, total_pages or 100, "正在语义分块...")

            # Semantic chunking based on element types
            chunks = document_service.chunk_text_structured(elements)

            if chunks:
                document_processor.update_progress(job_id, total_pages * 3 // 4 if total_pages else 75, total_pages or 100, f"正在生成 {len(chunks)} 个向量嵌入...")

                # Generate embeddings for chunk contents
                chunk_texts = [c["content"] for c in chunks]
                embeddings = await embedding_service.get_embeddings(
                    chunk_texts,
                    api_key,
                    provider,
                    base_url if base_url else None,
                    use_local_embedding,
                )

                if len(embeddings) != len(chunks):
                    raise RuntimeError("Embedding count does not match chunk count")

                for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                    session.add(
                        DocumentChunk(
                            document_id=doc.id,
                            content=chunk["content"],
                            chunk_index=i,
                            embedding=embedding,
                            element_type=chunk.get("element_type"),
                            page_number=chunk.get("page_number"),
                            chunk_metadata=chunk.get("chunk_metadata"),
                        )
                    )

            doc.status = "completed"
            await session.commit()
            document_processor.complete_job(job_id, len(chunks) if chunks else 0)

            # 知识节点自动提取（异步，不阻塞文档处理完成状态）
            try:
                # 1. 提取通用散乱概念（供 RAG 问答使用）
                await knowledge_extraction_service.extract_nodes_from_document(
                    document_id, session
                )
                # 2. 提炼该书的 12 个专属学习主线节点（供蜂巢技能树通关使用）
                await knowledge_extraction_service.extract_book_nodes(
                    document_id, session
                )
            except Exception as e:
                print(f"[KnowledgeExtraction] Error: {e}")
        except Exception as e:
            await session.rollback()
            doc = await session.get(Document, document_id)
            if doc is not None:
                doc.status = "failed"
                await session.commit()
            document_processor.fail_job(job_id, str(e))


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    api_key: str = "",
    provider: str = "openai",
    base_url: str = "",
    use_local_embedding: bool = False,
    knowledge_base_id: str = Form(None),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Upload and process a document"""
    # Validate file type
    file_ext = os.path.splitext(file.filename)[1].lower()
    allowed_types = [".pdf", ".docx", ".txt", ".md"]

    if file_ext not in allowed_types:
        raise HTTPException(400, f"Unsupported file type. Allowed: {allowed_types}")

    # Only require API key if not using local embedding
    if not use_local_embedding and not api_key:
        raise HTTPException(
            400, f"API key required for {provider} embedding generation"
        )

    try:
        await _reconcile_stuck_processing_documents()

        # Read file content
        content = await file.read()

        # Save document
        file_path, _ = await document_service.save_document(file.filename, content)

        # 检查并转换 knowledge_base_id 为 UUID
        parsed_kb_id = None
        if knowledge_base_id:
            try:
                from uuid import UUID
                parsed_kb_id = UUID(knowledge_base_id)
            except ValueError:
                pass

        # Create document record
        document = Document(
            title=file.filename,
            file_type=file_ext,
            file_path=file_path,
            status="processing",
            owner_id=current_user.id,
            visibility="private",
            knowledge_base_id=parsed_kb_id
        )
        session.add(document)
        await session.commit()

        asyncio.create_task(
            _process_document_async(
                document.id,
                file_path,
                file_ext,
                api_key,
                provider,
                base_url,
                use_local_embedding,
            )
        )

        return {
            "id": str(document.id),
            "title": document.title,
            "status": document.status,
            "chunks_count": 0,
        }
    except Exception as e:
        await session.rollback()
        raise HTTPException(500, f"Error processing document: {str(e)}")


@router.get("/")
async def list_documents(
    scope: str = "all",
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> List[dict]:
    """List documents (filtered by user ownership / visibility)

    scope: 'mine' = only my docs, 'shared' = only shared docs, 'all' = mine + shared
    """
    await _reconcile_stuck_processing_documents()

    from sqlalchemy import or_

    from sqlalchemy.orm import selectinload
    stmt = select(Document).options(selectinload(Document.knowledge_base))
    if scope == "mine":
        stmt = stmt.where(Document.owner_id == current_user.id)
    elif scope == "shared":
        stmt = stmt.where(Document.visibility == "shared")
    else:  # all
        stmt = stmt.where(
            or_(
                Document.owner_id == current_user.id,
                Document.visibility == "shared",
            )
        )
    # 非管理员只能看到启用的文档；管理员可以看到所有文档
    if current_user.role != "admin":
        stmt = stmt.where(Document.is_active == 1)
    stmt = stmt.order_by(Document.created_at.desc())

    result = await session.execute(stmt)
    documents = result.scalars().all()

    return [
        {
            "id": str(doc.id),
            "title": doc.title,
            "file_type": doc.file_type,
            "status": doc.status,
            "created_at": doc.created_at.isoformat(),
            "owner_id": str(doc.owner_id) if doc.owner_id else None,
            "visibility": doc.visibility or "private",
            "is_active": doc.is_active if doc.is_active is not None else 1,
            "is_owner": str(doc.owner_id) == str(current_user.id) if doc.owner_id else False,
        }
        for doc in documents
    ]


from pydantic import BaseModel
class KnowledgeBaseCreateSchema(BaseModel):
    name: str
    description: str = ""


# 注意：/kb 必须注册在 /{document_id} 之前，否则会被路径参数路由遮蔽
@router.get("/kb")
async def list_knowledge_bases(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """获取用户已创建的以及系统内置的分类知识库列表"""
    from sqlalchemy import or_
    stmt = select(KnowledgeBase).where(
        or_(
            KnowledgeBase.owner_id == current_user.id,
            KnowledgeBase.owner_id.is_(None)
        )
    ).order_by(KnowledgeBase.created_at.desc())
    res = await session.execute(stmt)
    kbs = res.scalars().all()
    return [
        {
            "id": str(kb.id),
            "name": kb.name,
            "description": kb.description or "",
            "created_at": kb.created_at.isoformat(),
            "owner_id": str(kb.owner_id) if kb.owner_id else None
        }
        for kb in kbs
    ]


@router.post("/kb")
async def create_knowledge_base(
    req: KnowledgeBaseCreateSchema,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """新建一个分类知识库"""
    import uuid as _uuid
    kb = KnowledgeBase(
        id=_uuid.uuid4(),
        name=req.name,
        description=req.description,
        owner_id=current_user.id
    )
    session.add(kb)
    await session.commit()
    return {
        "id": str(kb.id),
        "name": kb.name,
        "description": kb.description,
        "owner_id": str(kb.owner_id)
    }


@router.get("/{document_id}/content")
async def get_document_content(
    document_id: str,
    start_page: int = 0,
    end_page: int = PDF_PAGES_PER_REQUEST,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get document content (parsed text) with pagination support for PDFs"""
    from uuid import UUID

    try:
        parsed_id = UUID(document_id)
    except ValueError:
        raise HTTPException(400, "Invalid document_id")

    result = await session.execute(select(Document).where(Document.id == parsed_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(404, "Document not found")

    _ensure_document_access(doc, current_user)

    try:
        doc_info = {}
        if doc.file_type == ".pdf":
            doc_info = await asyncio.to_thread(
                document_service.get_pdf_info, doc.file_path
            )

            total_pages = doc_info["total_pages"]
            start = max(0, start_page)
            requested_end = max(start, end_page)
            safe_end = min(
                total_pages, min(requested_end, start + PDF_PAGES_PER_REQUEST)
            )

            if start >= total_pages:
                return {
                    "id": str(doc.id),
                    "title": doc.title,
                    "file_type": doc.file_type,
                    "content": "",
                    "total_pages": total_pages,
                    "file_size_mb": doc_info["file_size_mb"],
                    "start_page": start,
                    "end_page": start,
                    "loaded_pages": 0,
                    "next_start_page": None,
                }

            try:
                text = await asyncio.wait_for(
                    document_service.parse_document(
                        doc.file_path,
                        doc.file_type,
                        start,
                        safe_end,
                    ),
                    timeout=PDF_PARSE_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                raise HTTPException(504, "PDF 解析超时，请缩小页面范围后重试")

            response = {
                "id": str(doc.id),
                "title": doc.title,
                "file_type": doc.file_type,
                "content": text,
                "total_pages": total_pages,
                "file_size_mb": doc_info["file_size_mb"],
                "start_page": start,
                "end_page": safe_end,
                "loaded_pages": max(0, safe_end - start),
                "next_start_page": safe_end if safe_end < total_pages else None,
            }

            return response

        text = await document_service.parse_document(doc.file_path, doc.file_type)

        response = {
            "id": str(doc.id),
            "title": doc.title,
            "file_type": doc.file_type,
            "content": text,
        }

        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error reading document: {str(e)}")


@router.get("/{document_id}/preview-info")
async def get_document_preview_info(
    document_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    from uuid import UUID

    try:
        parsed_id = UUID(document_id)
    except ValueError:
        raise HTTPException(400, "Invalid document_id")

    result = await session.execute(select(Document).where(Document.id == parsed_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(404, "Document not found")

    _ensure_document_access(doc, current_user)

    if not os.path.exists(doc.file_path):
        raise HTTPException(404, "Document file not found")

    response = {
        "id": str(doc.id),
        "title": doc.title,
        "file_type": doc.file_type,
    }

    if doc.file_type == ".pdf":
        doc_info = await asyncio.to_thread(document_service.get_pdf_info, doc.file_path)
        response["total_pages"] = doc_info["total_pages"]
        response["file_size_mb"] = doc_info["file_size_mb"]

    return response


@router.get("/{document_id}/file")
async def get_document_file(
    document_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    from uuid import UUID

    try:
        parsed_id = UUID(document_id)
    except ValueError:
        raise HTTPException(400, "Invalid document_id")

    result = await session.execute(select(Document).where(Document.id == parsed_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(404, "Document not found")

    _ensure_document_access(doc, current_user)

    if not os.path.exists(doc.file_path):
        raise HTTPException(404, "Document file not found")

    media_type = "application/octet-stream"
    if doc.file_type == ".pdf":
        media_type = "application/pdf"
    elif doc.file_type == ".txt":
        media_type = "text/plain; charset=utf-8"
    elif doc.file_type == ".md":
        media_type = "text/markdown; charset=utf-8"

    # Use Content-Disposition: inline so browsers display PDFs in the
    # iframe preview instead of forcing a download.  The frontend download
    # button uses fetch+blob with an <a download> attribute, so it does
    # not rely on the attachment header for the filename.
    return FileResponse(
        path=doc.file_path,
        media_type=media_type,
        headers={"Content-Disposition": "inline"},
    )


@router.get("/{document_id}")
async def get_document(
    document_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get document details"""
    from uuid import UUID

    try:
        parsed_id = UUID(document_id)
    except ValueError:
        raise HTTPException(400, "Invalid document_id")

    result = await session.execute(
        select(Document).where(Document.id == parsed_id)
    )
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(404, "Document not found")

    _ensure_document_access(doc, current_user)

    return {
        "id": str(doc.id),
        "title": doc.title,
        "file_type": doc.file_type,
        "status": doc.status,
        "created_at": doc.created_at.isoformat(),
    }


@router.get("/{document_id}/status")
async def get_document_status(
    document_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get document processing status with progress"""
    from uuid import UUID

    try:
        parsed_id = UUID(document_id)
    except ValueError:
        raise HTTPException(400, "Invalid document_id")

    result = await session.execute(select(Document).where(Document.id == parsed_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(404, "Document not found")

    _ensure_document_access(doc, current_user)

    # Get processing job if exists
    job = document_processor.get_job_by_document(str(doc.id))

    response = {
        "id": str(doc.id),
        "title": doc.title,
        "status": doc.status,
        "file_type": doc.file_type,
    }

    if job:
        response["progress"] = {
            "percent": job.progress,
            "current_page": job.current_page,
            "total_pages": job.total_pages,
            "message": job.message,
        }

    return response


@router.delete("/{document_id}")
async def delete_document(
    document_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Delete a document (only owner or admin can delete)"""
    from uuid import UUID

    result = await session.execute(
        select(Document).where(Document.id == UUID(document_id))
    )
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(404, "Document not found")

    # Check ownership or admin role
    if doc.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(403, "只有文档所有者或管理员可以删除文档")

    # Delete file
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    await session.delete(doc)
    await session.commit()

    return {"message": "Document deleted"}


from pydantic import BaseModel as PydanticBaseModel

class BatchDeleteRequest(PydanticBaseModel):
    document_ids: List[str]


@router.post("/batch-delete")
async def batch_delete_documents(
    body: BatchDeleteRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """批量删除文档（仅管理员可调用）"""
    from uuid import UUID

    if current_user.role != "admin":
        raise HTTPException(403, "仅管理员可执行批量删除")

    if not body.document_ids:
        raise HTTPException(400, "document_ids 不能为空")

    succeeded = 0
    failed_ids = []

    for doc_id_str in body.document_ids:
        try:
            doc_uuid = UUID(doc_id_str)
            result = await session.execute(select(Document).where(Document.id == doc_uuid))
            doc = result.scalar_one_or_none()
            if not doc:
                failed_ids.append(doc_id_str)
                continue

            # 删除磁盘文件
            if doc.file_path and os.path.exists(doc.file_path):
                try:
                    os.remove(doc.file_path)
                except OSError:
                    pass  # 文件删除失败不阻断数据库删除

            # 删除向量分块（级联由 ORM 处理，若未配置级联则手动清理）
            await session.execute(
                delete(DocumentChunk).where(DocumentChunk.document_id == doc_uuid)
            )
            await session.delete(doc)
            succeeded += 1
        except Exception:
            failed_ids.append(doc_id_str)
            continue

    await session.commit()

    return {
        "succeeded": succeeded,
        "failed": len(failed_ids),
        "failed_ids": failed_ids,
    }



@router.post("/{document_id}/reprocess")
async def reprocess_document(
    document_id: str,
    api_key: str = "",
    provider: str = "openai",
    base_url: str = "",
    use_local_embedding: bool = False,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Reprocess a document with new parsing + chunking + embedding.

    Deletes existing chunks and re-runs the full processing pipeline.
    Useful after switching embedding models (e.g. to BGE-M3).
    """
    from uuid import UUID

    try:
        parsed_id = UUID(document_id)
    except ValueError:
        raise HTTPException(400, "Invalid document_id")

    result = await session.execute(select(Document).where(Document.id == parsed_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(404, "Document not found")

    # 重处理属于修改操作：仅文档所有者或管理员可执行
    if doc.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(403, "只有文档所有者或管理员可以重新处理文档")

    if not os.path.exists(doc.file_path):
        raise HTTPException(404, "Document file not found on disk")

    # Only require API key if not using local embedding
    if not use_local_embedding and not api_key:
        raise HTTPException(
            400, f"API key required for {provider} embedding generation"
        )

    # Delete existing chunks
    await session.execute(
        delete(DocumentChunk).where(DocumentChunk.document_id == parsed_id)
    )

    # Reset status
    doc.status = "processing"
    await session.commit()

    # Launch async reprocessing
    asyncio.create_task(
        _process_document_async(
            doc.id,
            doc.file_path,
            doc.file_type,
            api_key,
            provider,
            base_url,
            use_local_embedding,
        )
    )

    return {
        "id": str(doc.id),
        "title": doc.title,
        "status": "processing",
        "message": "Document reprocessing started",
    }


@router.post("/search")
async def search_documents(
    query: str,
    api_key: str = "",
    provider: str = "openai",
    base_url: str = "",
    limit: int = 5,
    use_local_embedding: bool = False,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Search for relevant document chunks (filtered by user access)"""
    if not use_local_embedding and not api_key:
        raise HTTPException(400, "API key required (or enable local embedding)")

    chunks = await rag_service.search_similar(
        query,
        api_key,
        session,
        limit,
        provider,
        base_url if base_url else None,
        use_local=use_local_embedding,
        user_id=str(current_user.id),
    )

    return [
        {
            "id": str(chunk.id),
            "content": chunk.content,
            "document_id": str(chunk.document_id),
            "chunk_index": chunk.chunk_index,
            "element_type": chunk.element_type,
            "page_number": chunk.page_number,
        }
        for chunk in chunks
    ]


