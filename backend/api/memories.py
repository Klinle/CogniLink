from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from core.database import get_session
from core.dependencies import get_current_user
from models.database import Memory, MemorySetting, User
from models.schemas import MemoryCreate, MemoryUpdate, MemoryResponse
from services.memory_service import memory_service
from services.embedding_service import embedding_service

router = APIRouter(prefix="/api/memories", tags=["memories"])


class MemorySettingsRequest(BaseModel):
    auto_extract: bool = True
    whitelist_topics: List[str] = []
    blacklist_topics: List[str] = []
    min_importance: int = 5


def _parse_user_uuid(user_id: str):
    import uuid as _uuid
    return _uuid.UUID(str(user_id))


async def get_memory_settings_from_db(session: AsyncSession, user_id: str) -> dict:
    """Get memory settings from database (per-user)"""
    user_uuid = _parse_user_uuid(user_id)
    result = await session.execute(
        select(MemorySetting).where(MemorySetting.user_id == user_uuid)
    )
    settings = {s.key: s.value for s in result.scalars().all()}

    return {
        "auto_extract": settings.get("auto_extract", "true").lower() == "true",
        "whitelist_topics": settings.get("whitelist_topics", "").split(",") if settings.get("whitelist_topics") else [],
        "blacklist_topics": settings.get("blacklist_topics", "").split(",") if settings.get("blacklist_topics") else [],
        "min_importance": int(settings.get("min_importance", "5"))
    }


async def save_memory_settings_to_db(session: AsyncSession, settings: dict, user_id: str):
    """Save memory settings to database (per-user)"""
    user_uuid = _parse_user_uuid(user_id)
    settings_map = {
        "auto_extract": str(settings.get("auto_extract", True)).lower(),
        "whitelist_topics": ",".join(settings.get("whitelist_topics", [])),
        "blacklist_topics": ",".join(settings.get("blacklist_topics", [])),
        "min_importance": str(settings.get("min_importance", 5))
    }

    for key, value in settings_map.items():
        result = await session.execute(
            select(MemorySetting).where(
                MemorySetting.user_id == user_uuid,
                MemorySetting.key == key,
            )
        )
        setting = result.scalar_one_or_none()

        if setting:
            setting.value = value
            setting.updated_at = datetime.utcnow()
        else:
            setting = MemorySetting(user_id=user_uuid, key=key, value=value)
            session.add(setting)

    await session.commit()

@router.post("/")
async def create_memory(
    data: MemoryCreate,
    api_key: str = "",
    provider: str = "openai",
    base_url: str = "",
    use_local_embedding: bool = False,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Create a new memory manually"""
    if not use_local_embedding and not api_key:
        raise HTTPException(400, "API key required for embedding generation")

    memory = await memory_service.create_memory(
        content=data.content,
        api_key=api_key,
        session=session,
        category=data.category,
        importance=data.importance,
        source="manual",
        provider=provider,
        base_url=base_url if base_url else None,
        use_local=use_local_embedding,
        user_id=str(current_user.id),
    )
    
    return {
        "id": str(memory.id),
        "content": memory.content,
        "category": memory.category,
        "importance": memory.importance,
        "created_at": memory.created_at.isoformat()
    }

@router.get("/")
async def list_memories(
    category: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """List all memories"""
    memories = await memory_service.list_memories(session, category, user_id=str(current_user.id))
    
    return [
        {
            "id": str(m.id),
            "content": m.content,
            "category": m.category,
            "importance": m.importance,
            "source": m.source,
            "created_at": m.created_at.isoformat(),
            "access_count": m.access_count
        }
        for m in memories
    ]

@router.get("/search")
async def search_memories(
    query: str,
    api_key: str = "",
    provider: str = "openai",
    base_url: str = "",
    use_local_embedding: bool = False,
    limit: int = 5,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Search memories by semantic similarity"""
    if not use_local_embedding and not api_key:
        raise HTTPException(400, "API key required")

    memories = await memory_service.search_relevant_memories(
        query, api_key, session, limit, provider, base_url if base_url else None,
        use_local=use_local_embedding, user_id=str(current_user.id)
    )

    return [
        {
            "id": str(m.id),
            "content": m.content,
            "category": m.category,
            "importance": m.importance
        }
        for m in memories
    ]

@router.put("/{memory_id}")
async def update_memory(
    memory_id: str,
    data: MemoryUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Update a memory"""
    memory = await memory_service.update_memory(
        memory_id, session, content=data.content, importance=data.importance,
        user_id=str(current_user.id)
    )
    
    if not memory:
        raise HTTPException(404, "Memory not found")
    
    return {
        "id": str(memory.id),
        "content": memory.content,
        "category": memory.category,
        "importance": memory.importance
    }

@router.delete("/{memory_id}")
async def delete_memory(
    memory_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Delete a memory"""
    success = await memory_service.delete_memory(memory_id, session, user_id=str(current_user.id))
    
    if not success:
        raise HTTPException(404, "Memory not found")
    
    return {"message": "Memory deleted"}

@router.post("/extract")
async def extract_memories(
    conversation_text: str,
    api_key: str = "",
    use_local_embedding: bool = False,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Extract memories from conversation text"""
    if not api_key:
        raise HTTPException(400, "API key required for LLM extraction")

    memories = await memory_service.extract_memories_from_conversation(
        conversation_text, api_key, session, use_local=use_local_embedding,
        user_id=str(current_user.id)
    )

    return [
        {
            "id": str(m.id),
            "content": m.content,
            "category": m.category,
            "importance": m.importance
        }
        for m in memories
    ]


@router.get("/settings")
async def get_memory_settings(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get memory extraction settings"""
    settings = await get_memory_settings_from_db(session, str(current_user.id))
    return settings


@router.post("/settings")
async def update_memory_settings(
    request: MemorySettingsRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Update memory extraction settings"""
    settings = {
        "auto_extract": request.auto_extract,
        "whitelist_topics": request.whitelist_topics,
        "blacklist_topics": request.blacklist_topics,
        "min_importance": request.min_importance
    }
    await save_memory_settings_to_db(session, settings, str(current_user.id))
    return {"success": True, "settings": settings}


@router.get("/settings/check-topic")
async def check_topic_allowed(
    topic: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Check if a topic is allowed based on whitelist/blacklist"""
    settings = await get_memory_settings_from_db(session, str(current_user.id))

    # Check blacklist first
    for blacklisted in settings["blacklist_topics"]:
        if blacklisted.lower() in topic.lower():
            return {"allowed": False, "reason": f"Topic matches blacklist: {blacklisted}"}

    # If whitelist exists, topic must match at least one
    if settings["whitelist_topics"]:
        for whitelisted in settings["whitelist_topics"]:
            if whitelisted.lower() in topic.lower():
                return {"allowed": True}
        return {"allowed": False, "reason": "Topic does not match any whitelist entry"}

    return {"allowed": True}
