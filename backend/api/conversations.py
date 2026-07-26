"""
对话管理 API - 实现无限轮对话
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func
from typing import List, Optional
from pydantic import BaseModel

from core.database import get_session
from core.dependencies import get_current_user
from services.conversation_service import conversation_service
from models.database import Conversation, Message, User

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


class ConversationCreate(BaseModel):
    title: Optional[str] = None
    model: str = "deepseek-v4-flash"


class ConversationUpdate(BaseModel):
    title: str


class MessageCreate(BaseModel):
    role: str
    content: str


class ConversationResponse(BaseModel):
    id: str
    title: str
    model: str
    created_at: str
    updated_at: str
    message_count: int
    total_tokens: int

    class Config:
        from_attributes = True


@router.post("", response_model=ConversationResponse)
async def create_conversation(
    request: ConversationCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """创建新对话"""
    conversation = await conversation_service.create_conversation(
        session=session,
        title=request.title,
        model=request.model,
        user_id=str(current_user.id),
    )
    return ConversationResponse(
        id=str(conversation.id),
        title=conversation.title or "新对话",
        model=conversation.model,
        created_at=conversation.created_at.isoformat(),
        updated_at=conversation.updated_at.isoformat(),
        message_count=conversation.message_count or 0,
        total_tokens=conversation.total_tokens or 0
    )


@router.get("")
async def list_conversations(
    limit: int = 20,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """获取对话列表"""
    conversations = await conversation_service.list_conversations(
        session=session,
        limit=limit,
        offset=offset,
        user_id=str(current_user.id),
    )
    return [
        {
            "id": str(c.id),
            "title": c.title or "新对话",
            "model": c.model,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            "message_count": c.message_count or 0,
            "total_tokens": c.total_tokens or 0
        }
        for c in conversations
    ]


@router.get("/search")
async def search_conversations(
    q: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """搜索对话（标题和内容）

    注意：必须注册在 /{conversation_id} 之前，否则会被路径参数路由遮蔽。
    """
    if not q or len(q) < 2:
        raise HTTPException(status_code=400, detail="搜索关键词至少需要2个字符")

    import uuid as _uuid
    user_uuid = _uuid.UUID(str(current_user.id))

    # 搜索对话标题
    title_query = select(Conversation).where(
        Conversation.is_active == 1,
        Conversation.user_id == user_uuid,
        Conversation.title.ilike(f"%{q}%")
    )

    # 搜索消息内容，关联到对话
    message_query = select(Conversation).join(
        Message, Message.conversation_id == Conversation.id
    ).where(
        Conversation.is_active == 1,
        Conversation.user_id == user_uuid,
        Message.content.ilike(f"%{q}%")
    ).distinct()

    # 执行查询
    title_result = await session.execute(title_query)
    message_result = await session.execute(message_query)

    # 合并结果（去重）
    conversations = list(set(title_result.scalars().all()) | set(message_result.scalars().all()))

    # 按更新时间排序
    conversations.sort(key=lambda c: c.updated_at or c.created_at, reverse=True)

    return [
        {
            "id": str(c.id),
            "title": c.title or "新对话",
            "model": c.model,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            "message_count": c.message_count or 0,
            "total_tokens": c.total_tokens or 0
        }
        for c in conversations
    ]


@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """获取对话详情及消息"""
    conversation = await conversation_service.get_conversation(session, conversation_id, user_id=str(current_user.id))
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")

    messages = await conversation_service.get_conversation_messages(session, conversation_id)

    return {
        "id": str(conversation.id),
        "title": conversation.title or "新对话",
        "model": conversation.model,
        "created_at": conversation.created_at.isoformat() if conversation.created_at else None,
        "updated_at": conversation.updated_at.isoformat() if conversation.updated_at else None,
        "message_count": conversation.message_count or 0,
        "total_tokens": conversation.total_tokens or 0,
        "summary": conversation.summary,
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "tokens": m.tokens or 0,
                "is_summarized": bool(m.is_summarized),
                "created_at": m.created_at.isoformat() if m.created_at else None
            }
            for m in messages
        ]
    }


@router.put("/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    request: ConversationUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """更新对话标题"""
    success = await conversation_service.update_conversation_title(
        session=session,
        conversation_id=conversation_id,
        title=request.title,
        user_id=str(current_user.id),
    )
    if not success:
        raise HTTPException(status_code=404, detail="对话不存在")
    return {"success": True}


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """删除对话"""
    success = await conversation_service.delete_conversation(session, conversation_id, user_id=str(current_user.id))
    if not success:
        raise HTTPException(status_code=404, detail="对话不存在")
    return {"success": True}


@router.post("/{conversation_id}/messages")
async def add_message(
    conversation_id: str,
    request: MessageCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """添加消息到对话"""
    conversation = await conversation_service.get_conversation(session, conversation_id, user_id=str(current_user.id))
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")

    message = await conversation_service.add_message(
        session=session,
        conversation_id=conversation_id,
        role=request.role,
        content=request.content
    )

    return {
        "id": str(message.id),
        "role": message.role,
        "content": message.content,
        "tokens": message.tokens or 0,
        "created_at": message.created_at.isoformat() if message.created_at else None
    }
