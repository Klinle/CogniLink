from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
from models.database import Base
from core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"),
    echo=False,
)

async_session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        # Enable pgvector extension before creating tables that use Vector columns
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)

        # Add new columns to document_chunks if they don't exist (for existing DBs without migrations)
        alter_statements = [
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS element_type VARCHAR(50)",
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS page_number INTEGER",
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chunk_metadata JSON",
            "ALTER TABLE documents ADD COLUMN IF NOT EXISTS owner_id UUID",
            "ALTER TABLE documents ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'private'",
            "ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1",
            "ALTER TABLE labs ADD COLUMN IF NOT EXISTS lab_type VARCHAR(20) DEFAULT 'code'",
            "ALTER TABLE labs ADD COLUMN IF NOT EXISTS detailed_explanation TEXT",
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS node_id UUID",
            "ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL",
            "ALTER TABLE knowledge_nodes ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'extraction'",
            "ALTER TABLE agents ADD COLUMN IF NOT EXISTS character_name VARCHAR(50)",
            # memory_settings 由全局改为按用户隔离
            "ALTER TABLE memory_settings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
            "ALTER TABLE memory_settings DROP CONSTRAINT IF EXISTS memory_settings_key_key",
        ]
        for stmt in alter_statements:
            await conn.execute(text(stmt))

    # 数据层加固：向量定维 + HNSW 索引 + 常规索引。
    # 每条语句独立事务并容错执行——旧库可能存在维度不一致或重复数据，
    # 单条失败（打印告警）不应阻断服务启动。
    hardening_statements = [
        # 向量列定维（BGE-M3 = 1024），是建 HNSW 索引的前提
        "ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024)",
        "ALTER TABLE memories ALTER COLUMN embedding TYPE vector(1024)",
        # 向量近邻索引（余弦距离），避免检索时全表扫描
        "CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops)",
        "CREATE INDEX IF NOT EXISTS idx_memories_embedding_hnsw ON memories USING hnsw (embedding vector_cosine_ops)",
        # 外键与高频过滤列索引
        "CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id)",
        "CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks (document_id)",
        "CREATE INDEX IF NOT EXISTS idx_document_chunks_node_id ON document_chunks (node_id)",
        "CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations (user_id)",
        "CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories (user_id)",
        "CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON documents (owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_user_knowledge_states_user_id ON user_knowledge_states (user_id)",
        "CREATE INDEX IF NOT EXISTS idx_user_lab_submissions_user_id ON user_lab_submissions (user_id)",
        "CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_category ON knowledge_nodes (category)",
        # 业务唯一性约束（若历史数据有重复会失败并告警，需手动清理后生效）
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_knowledge_states_user_node ON user_knowledge_states (user_id, node_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_settings_user_key ON memory_settings (user_id, key)",
    ]
    for stmt in hardening_statements:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as e:
            print(f"[DB Hardening][WARN] Failed: {stmt[:80]}... -> {type(e).__name__}: {e}")

async def get_session():
    async with async_session_maker() as session:
        yield session
