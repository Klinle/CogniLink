from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func
from models.database import DocumentChunk, Document, KnowledgeNode
from services.embedding_service import embedding_service
import uuid

class RAGService:
    async def search_similar(
        self,
        query: str,
        api_key: str,
        session: AsyncSession,
        limit: int = 5,
        provider: str = "openai",
        base_url: str = None,
        document_ids: Optional[List[str]] = None,
        use_local: bool = False,
        user_id: str = None,
        domain: Optional[str] = None,
    ) -> List[DocumentChunk]:
        """向量密集检索：使用 pgvector 余弦相似度搜索。

        Args:
            document_ids: 可选的文档 UUID 列表，限定检索范围。
            use_local: 若为 True，使用本地 Ollama BGE-M3 生成查询向量。
            user_id: 若提供，仅检索用户私有文档 + 共享文档。
            domain: 若提供（如 'os'/'network' 等），仅检索关联到该领域知识节点的 chunk，
                    或未关联任何节点的 chunk（保底召回）。
        """
        query_embedding = await embedding_service.get_single_embedding(
            query, api_key, provider, base_url, use_local
        )

        stmt = select(DocumentChunk)
        if document_ids:
            stmt = stmt.where(DocumentChunk.document_id.in_(document_ids))
        stmt = stmt.join(Document, DocumentChunk.document_id == Document.id).where(
            Document.is_active == 1
        )
        if user_id:
            stmt = stmt.where(
                or_(
                    Document.owner_id == uuid.UUID(user_id),
                    Document.visibility == "shared",
                )
            )
        # 领域过滤：只检索该领域关联 chunk，或未关联节点的 chunk（保底）
        if domain:
            domain_node_ids = select(KnowledgeNode.id).where(
                KnowledgeNode.category == domain
            )
            stmt = stmt.where(
                or_(
                    DocumentChunk.node_id.in_(domain_node_ids),
                    DocumentChunk.node_id.is_(None),
                )
            )
        stmt = stmt.order_by(
            DocumentChunk.embedding.cosine_distance(query_embedding)
        ).limit(limit)

        result = await session.execute(stmt)
        return result.scalars().all()

    async def _bm25_search(
        self,
        query: str,
        session: AsyncSession,
        limit: int,
        document_ids: Optional[List[str]] = None,
        user_id: str = None,
        domain: Optional[str] = None,
    ) -> List[DocumentChunk]:
        """BM25 稀疏检索：利用 PostgreSQL 全文检索 (to_tsvector + plainto_tsquery + ts_rank)。

        失败时回退为空列表，仅依赖向量检索。
        """
        try:
            tsvector = func.to_tsvector('simple', DocumentChunk.content)
            tsquery = func.plainto_tsquery('simple', query)
            rank = func.ts_rank(tsvector, tsquery)

            stmt = select(DocumentChunk).where(tsvector.op('@@')(tsquery))

            if document_ids:
                stmt = stmt.where(DocumentChunk.document_id.in_(document_ids))

            stmt = stmt.join(Document, DocumentChunk.document_id == Document.id).where(
                Document.is_active == 1
            )

            if user_id:
                stmt = stmt.where(
                    or_(
                        Document.owner_id == uuid.UUID(user_id),
                        Document.visibility == "shared",
                    )
                )

            # 领域过滤：只检索该领域关联 chunk，或未关联节点的 chunk（保底）
            if domain:
                domain_node_ids = select(KnowledgeNode.id).where(
                    KnowledgeNode.category == domain
                )
                stmt = stmt.where(
                    or_(
                        DocumentChunk.node_id.in_(domain_node_ids),
                        DocumentChunk.node_id.is_(None),
                    )
                )

            stmt = stmt.order_by(rank.desc()).limit(limit)

            result = await session.execute(stmt)
            return result.scalars().all()
        except Exception as e:
            print(f"[BM25 Search] Error: {e}, falling back to vector-only")
            return []

    async def hybrid_search(
        self,
        query: str,
        api_key: str,
        session: AsyncSession,
        limit: int = 5,
        provider: str = "openai",
        base_url: str = None,
        document_ids: Optional[List[str]] = None,
        use_local: bool = False,
        user_id: str = None,
        domain: Optional[str] = None,
    ) -> List[DocumentChunk]:
        """混合检索：BM25 稀疏检索 + 向量密集检索 + RRF 融合。

        通过 Reciprocal Rank Fusion (RRF) 合并关键词匹配和语义匹配结果，提升召回质量。
        domain 参数可限定检索到特定知识领域，避免跨领域噪声。
        """
        RRF_K = 60
        retrieval_k = max(limit * 3, 15)

        # 1. BM25 稀疏检索
        sparse_chunks = await self._bm25_search(
            query, session, retrieval_k, document_ids, user_id, domain
        )

        # 2. 向量密集检索
        dense_chunks = await self.search_similar(
            query, api_key, session, retrieval_k, provider, base_url,
            document_ids, use_local, user_id, domain
        )

        # 3. RRF fusion
        sparse_ranks = {chunk.id: rank + 1 for rank, chunk in enumerate(sparse_chunks)}
        dense_ranks = {chunk.id: rank + 1 for rank, chunk in enumerate(dense_chunks)}

        all_ids = set(sparse_ranks.keys()) | set(dense_ranks.keys())

        rrf_scores = {}
        for chunk_id in all_ids:
            score = 0.0
            if chunk_id in sparse_ranks:
                score += 1.0 / (RRF_K + sparse_ranks[chunk_id])
            if chunk_id in dense_ranks:
                score += 1.0 / (RRF_K + dense_ranks[chunk_id])
            rrf_scores[chunk_id] = score

        # Build chunk lookup map
        chunk_map = {}
        for chunk in sparse_chunks:
            chunk_map[chunk.id] = chunk
        for chunk in dense_chunks:
            if chunk.id not in chunk_map:
                chunk_map[chunk.id] = chunk

        # Sort by RRF score descending
        sorted_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)

        result = []
        for chunk_id in sorted_ids[:limit]:
            chunk = chunk_map.get(chunk_id)
            if chunk:
                result.append(chunk)

        return result

    async def _format_chunks(
        self, session: AsyncSession, chunks: List[DocumentChunk]
    ) -> str:
        """将 chunk 列表格式化为带 [来源: 文档名, 第X页] 标注的上下文字符串"""
        if not chunks:
            return ""

        # Fetch document titles for source annotations
        doc_ids = {chunk.document_id for chunk in chunks}
        doc_titles = {}
        if doc_ids:
            doc_result = await session.execute(
                select(Document.id, Document.title).where(Document.id.in_(doc_ids))
            )
            doc_titles = {row[0]: row[1] for row in doc_result.all()}

        # Build context with source annotations
        parts = []
        for chunk in chunks:
            title = doc_titles.get(chunk.document_id, "未知文档")
            page_info = f", 第{chunk.page_number}页" if chunk.page_number else ""
            source_tag = f"[来源: {title}{page_info}]"
            parts.append(f"{source_tag}\n{chunk.content}")

        return "\n\n".join(parts)

    async def get_context_for_query(
        self,
        query: str,
        api_key: str,
        session: AsyncSession,
        limit: int = 5,
        provider: str = "openai",
        base_url: str = None,
        document_ids: Optional[List[str]] = None,
        use_local: bool = False,
        user_id: str = None,
        domain: Optional[str] = None,
    ) -> str:
        """获取查询的相关上下文，带来源标注。

        使用混合检索 (BM25 + 向量 + RRF)，返回格式化字符串，
        每个检索到的 chunk 附带 [来源: 文档名, 第X页] 标注。
        domain 参数可限定检索到特定知识领域。
        """
        chunks = await self.hybrid_search(
            query, api_key, session, limit, provider, base_url,
            document_ids, use_local, user_id, domain
        )
        return await self._format_chunks(session, chunks)

    async def get_context_for_queries(
        self,
        queries: List[str],
        api_key: str,
        session: AsyncSession,
        limit_per_query: int = 4,
        max_chunks: int = 8,
        provider: str = "openai",
        base_url: str = None,
        document_ids: Optional[List[str]] = None,
        use_local: bool = True,
        user_id: str = None,
        domain: Optional[str] = None,
    ) -> str:
        """多子查询并行混合检索 + 去重合并（RAG 流水线『多通道并行检索』的知识库通道）。

        AsyncSession 不支持并发复用，因此每个子查询使用独立会话并行执行，
        结果按子查询顺序去重合并后统一格式化。
        """
        import asyncio
        from core.database import async_session_maker

        cleaned = [q.strip() for q in (queries or []) if q and q.strip()][:3]
        if not cleaned:
            return ""

        async def _search_one(q: str) -> List[DocumentChunk]:
            async with async_session_maker() as sub_session:
                return await self.hybrid_search(
                    q, api_key, sub_session, limit_per_query, provider,
                    base_url, document_ids, use_local, user_id, domain
                )

        results = await asyncio.gather(
            *[_search_one(q) for q in cleaned], return_exceptions=True
        )

        seen = set()
        merged: List[DocumentChunk] = []
        for res in results:
            if isinstance(res, BaseException):
                print(f"[RAG] Sub-query retrieval failed: {type(res).__name__}: {res}")
                continue
            for chunk in res:
                if chunk.id not in seen:
                    seen.add(chunk.id)
                    merged.append(chunk)

        return await self._format_chunks(session, merged[:max_chunks])

rag_service = RAGService()
