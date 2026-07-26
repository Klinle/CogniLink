from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
import uuid

from models.database import Memory
from services.embedding_service import embedding_service
from core.config import settings

class MemoryService:
    async def create_memory(
        self,
        content: str,
        api_key: str,
        session: AsyncSession,
        category: str = "fact",
        importance: int = 5,
        source: str = "",
        provider: str = "openai",
        base_url: str = None,
        use_local: bool = False,
        user_id: str = None,
    ) -> Memory:
        """Create a new memory with embedding"""
        embedding = await embedding_service.get_single_embedding(content, api_key, provider, base_url, use_local)

        memory = Memory(
            content=content,
            category=category,
            importance=importance,
            source=source,
            embedding=embedding,
            user_id=uuid.UUID(user_id) if user_id else None,
        )
        session.add(memory)
        await session.commit()
        await session.refresh(memory)
        return memory
    
    async def extract_memories_from_conversation(
        self,
        conversation_text: str,
        api_key: str,
        session: AsyncSession,
        provider: str = "openai",
        base_url: str = None,
        use_local: bool = False,
        user_id: str = None,
    ) -> List[Memory]:
        """Extract important information from conversation"""
        from openai import AsyncOpenAI
        from sqlalchemy import select
        import json

        # Check memory settings (per-user; without user_id fall back to defaults)
        if user_id:
            from api.memories import get_memory_settings_from_db
            memory_settings = await get_memory_settings_from_db(session, user_id)
        else:
            memory_settings = {
                "auto_extract": True,
                "whitelist_topics": [],
                "blacklist_topics": [],
                "min_importance": 5,
            }

        # If auto-extract is disabled, skip extraction
        if not memory_settings.get("auto_extract", True):
            print("[Memory] Auto-extract is disabled, skipping extraction")
            return []

        # Use DeepSeek default config when no explicit base_url/key provided
        effective_api_key = api_key or settings.DEEPSEEK_API_KEY
        effective_base_url = base_url or settings.DEEPSEEK_BASE_URL

        client = AsyncOpenAI(api_key=effective_api_key, base_url=effective_base_url)

        system_prompt = """Extract important facts/preferences from conversation.
Return JSON array: [{"content": "...", "category": "preference|fact|goal", "importance": 1-10}]"""

        try:
            response = await client.chat.completions.create(
                model=settings.DEEPSEEK_MODEL,
                temperature=0.3,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Conversation:\n{conversation_text}"}
                ]
            )
            content = response.choices[0].message.content.strip()
            if content.startswith("```json"):
                content = content[7:-3].strip()

            memories_data = json.loads(content)
            if not isinstance(memories_data, list):
                return []

            created_memories = []
            min_importance = memory_settings.get("min_importance", 5)
            whitelist = memory_settings.get("whitelist_topics", [])
            blacklist = memory_settings.get("blacklist_topics", [])

            for mem_data in memories_data:
                importance = mem_data.get("importance", 5)
                memory_content = mem_data.get("content", "")

                # Check minimum importance threshold
                if importance < min_importance:
                    print(f"[Memory] Skipping low importance memory: {memory_content[:50]}...")
                    continue

                # Check blacklist
                is_blacklisted = any(b.lower() in memory_content.lower() for b in blacklist if b)
                if is_blacklisted:
                    print(f"[Memory] Skipping blacklisted topic: {memory_content[:50]}...")
                    continue

                # Check whitelist (if defined)
                if whitelist and any(w for w in whitelist if w):
                    is_whitelisted = any(w.lower() in memory_content.lower() for w in whitelist if w)
                    if not is_whitelisted:
                        print(f"[Memory] Skipping non-whitelisted topic: {memory_content[:50]}...")
                        continue

                memory = await self.create_memory(
                    content=memory_content,
                    api_key=api_key,
                    session=session,
                    category=mem_data.get("category", "fact"),
                    importance=importance,
                    source="extracted from conversation",
                    provider=provider,
                    base_url=base_url,
                    use_local=use_local,
                    user_id=user_id,
                )
                created_memories.append(memory)

            return created_memories
        except Exception as e:
            print(f"Error extracting memories: {e}")
            return []
    
    async def search_relevant_memories(
        self,
        query: str,
        api_key: str,
        session: AsyncSession,
        limit: int = 5,
        provider: str = "openai",
        base_url: str = None,
        use_local: bool = False,
        user_id: str = None,
    ) -> List[Memory]:
        """Search for relevant memories (filtered by user_id)"""
        query_embedding = await embedding_service.get_single_embedding(query, api_key, provider, base_url, use_local)

        stmt = select(Memory)
        if user_id:
            stmt = stmt.where(Memory.user_id == uuid.UUID(user_id))
        stmt = stmt.order_by(Memory.embedding.cosine_distance(query_embedding)).limit(limit)

        result = await session.execute(stmt)
        return result.scalars().all()

    async def get_memory_context(
        self,
        query: str,
        api_key: str,
        session: AsyncSession,
        limit: int = 5,
        provider: str = "openai",
        base_url: str = None,
        use_local: bool = False,
        user_id: str = None,
    ) -> str:
        """Get memory context for LLM prompt"""
        memories = await self.search_relevant_memories(query, api_key, session, limit, provider, base_url, use_local, user_id)
        if not memories:
            return ""

        context_parts = [f"- {m.content}" for m in memories]
        return "Relevant information:\n" + "\n".join(context_parts)
    
    async def list_memories(
        self,
        session: AsyncSession,
        category: Optional[str] = None,
        limit: int = 50,
        user_id: str = None,
    ) -> List[Memory]:
        """List all memories with optional category filter (filtered by user_id)"""
        query = select(Memory)

        if user_id:
            query = query.where(Memory.user_id == uuid.UUID(user_id))

        if category:
            query = query.where(Memory.category == category)

        query = query.order_by(Memory.importance.desc(), Memory.created_at.desc()).limit(limit)

        result = await session.execute(query)
        return result.scalars().all()
    
    async def update_memory(
        self,
        memory_id: str,
        session: AsyncSession,
        content: Optional[str] = None,
        importance: Optional[int] = None,
        user_id: str = None,
    ) -> Optional[Memory]:
        """Update a memory (filtered by user_id)"""
        from uuid import UUID

        stmt = select(Memory).where(Memory.id == UUID(memory_id))
        if user_id:
            stmt = stmt.where(Memory.user_id == uuid.UUID(user_id))
        result = await session.execute(stmt)
        memory = result.scalar_one_or_none()

        if not memory:
            return None
        
        if content is not None:
            memory.content = content
        if importance is not None:
            memory.importance = importance
        
        memory.updated_at = datetime.utcnow()
        await session.commit()
        await session.refresh(memory)
        return memory
    
    async def delete_memory(self, memory_id: str, session: AsyncSession, user_id: str = None) -> bool:
        """Delete a memory (filtered by user_id)"""
        from uuid import UUID

        stmt = select(Memory).where(Memory.id == UUID(memory_id))
        if user_id:
            stmt = stmt.where(Memory.user_id == uuid.UUID(user_id))
        result = await session.execute(stmt)
        memory = result.scalar_one_or_none()

        if not memory:
            return False

        await session.delete(memory)
        await session.commit()
        return True

memory_service = MemoryService()
