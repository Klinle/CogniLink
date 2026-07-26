from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, Float, JSON, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector
from datetime import datetime
import uuid

Base = declarative_base()

# BGE-M3 嵌入维度；定维后 pgvector 才能建 HNSW 索引（与 embedding_service.EMBEDDING_DIM 一致）
EMBEDDING_DIM = 1024

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), default="student")  # student, teacher, admin
    nickname = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan")
    memories = relationship("Memory", back_populates="user", cascade="all, delete-orphan")
    knowledge_states = relationship("UserKnowledgeState", back_populates="user", cascade="all, delete-orphan")
    submissions = relationship("UserLabSubmission", back_populates="user", cascade="all, delete-orphan")


class Agent(Base):
    __tablename__ = "agents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)  # 角色全名，如 "幽默大师 (HumorBot)"
    character_name = Column(String(50), nullable=True)  # 像素角色名，如 "小柴" / "小鹰" / "小铁"
    role_type = Column(String(50), default="humor_mentor")  # humor_mentor, academic_mentor, coach_mentor
    system_prompt = Column(Text, nullable=False)
    description = Column(String(255), nullable=True)
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)

    conversations = relationship("Conversation", back_populates="agent")


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    documents = relationship("Document", back_populates="knowledge_base", cascade="all, delete-orphan")
    nodes = relationship("KnowledgeNode", back_populates="knowledge_base", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(255))
    file_type = Column(String(50))
    file_path = Column(String(500))
    status = Column(String(20), default="processing")
    created_at = Column(DateTime, default=datetime.utcnow)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # 文档所有者
    visibility = Column(String(20), default="private")  # private, shared
    is_active = Column(Integer, default=1)  # 1: 启用（用户可见，参与检索）, 0: 禁用（仅管理员可见）
    knowledge_base_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id", ondelete="SET NULL"), nullable=True)

    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")
    knowledge_base = relationship("KnowledgeBase", back_populates="documents")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"))
    content = Column(Text)
    chunk_index = Column(Integer)
    embedding = Column(Vector(EMBEDDING_DIM))
    element_type = Column(String(50), nullable=True)    # 元素类型: Title/NarrativeText/Table/ListItem
    page_number = Column(Integer, nullable=True)         # 页码
    chunk_metadata = Column(JSON, nullable=True)         # 扩展元信息 (JSON)
    node_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_nodes.id", ondelete="SET NULL"), nullable=True)  # 关联知识节点

    document = relationship("Document", back_populates="chunks")


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255))
    model = Column(String(100), default="deepseek-v4-flash")  # 使用的模型
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    message_count = Column(Integer, default=0)  # 消息数量统计
    total_tokens = Column(Integer, default=0)  # 累计 token 数
    is_active = Column(Integer, default=1)  # 软删除标记
    summary = Column(Text, nullable=True)  # 对话摘要（压缩后的历史）
    summary_tokens = Column(Integer, default=0)  # 摘要 token 数

    user = relationship("User", back_populates="conversations")
    agent = relationship("Agent", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at")


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"))
    role = Column(String(20))
    content = Column(Text)
    tokens = Column(Integer, default=0)  # 该消息的 token 数
    is_summarized = Column(Integer, default=0)  # 是否已被摘要压缩
    created_at = Column(DateTime, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="messages")


class Memory(Base):
    __tablename__ = "memories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    content = Column(Text, nullable=False)
    category = Column(String(50), default="fact")
    importance = Column(Integer, default=5)
    source = Column(String(255))
    embedding = Column(Vector(EMBEDDING_DIM))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    access_count = Column(Integer, default=0)
    last_accessed = Column(DateTime)

    user = relationship("User", back_populates="memories")


class MemorySetting(Base):
    __tablename__ = "memory_settings"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_memory_settings_user_key"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)  # 按用户隔离；NULL 为历史遗留全局行
    key = Column(String(100), nullable=False)
    value = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class KnowledgeNode(Base):
    __tablename__ = "knowledge_nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(100), nullable=False)  # 取消全局唯一，防止不同电子书提取同名节点发生冲突
    name = Column(String(100), nullable=False)
    category = Column(String(100))  # programming, dsa, organization, os, network, database
    description = Column(Text, nullable=True)
    pagerank_weight = Column(Float, default=1.0)
    source = Column(String(30), default="extraction")  # learning_path（学习路线种子节点）| extraction（文档自动提取）
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    knowledge_base_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id", ondelete="SET NULL"), nullable=True)

    user_states = relationship("UserKnowledgeState", back_populates="node", cascade="all, delete-orphan")
    labs = relationship("Lab", back_populates="node")
    document = relationship("Document")
    knowledge_base = relationship("KnowledgeBase", back_populates="nodes")


class KnowledgeRelation(Base):
    __tablename__ = "knowledge_relations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_nodes.id", ondelete="CASCADE"), nullable=False)
    target_node_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_nodes.id", ondelete="CASCADE"), nullable=False)
    relation_type = Column(String(50), default="requires")  # requires, extends


class UserKnowledgeState(Base):
    __tablename__ = "user_knowledge_states"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    node_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_nodes.id", ondelete="CASCADE"), nullable=False)
    proficiency = Column(Float, default=0.0)  # 熟练度
    pagerank_score = Column(Float, default=0.0)  # 经过 PageRank 拓扑拟合后的分数
    is_lighted = Column(Integer, default=0)  # 点亮状态 (0: 未点亮, 1: 已点亮)
    study_duration = Column(Integer, default=0)  # 累计学习时间（秒）
    last_studied_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="knowledge_states")
    node = relationship("KnowledgeNode", back_populates="user_states")


class Lab(Base):
    __tablename__ = "labs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    starter_code = Column(Text, nullable=True)
    test_cases = Column(JSON, nullable=True)
    node_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_nodes.id"), nullable=True)
    difficulty = Column(String(20), default="medium")  # easy, medium, hard
    lab_type = Column(String(20), default="code")  # code, quiz
    detailed_explanation = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    node = relationship("KnowledgeNode", back_populates="labs")
    submissions = relationship("UserLabSubmission", back_populates="lab", cascade="all, delete-orphan")


class UserLabSubmission(Base):
    __tablename__ = "user_lab_submissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id", ondelete="CASCADE"), nullable=False)
    submitted_code = Column(Text, nullable=False)
    status = Column(String(50), default="pending")  # pending, running, passed, failed, error
    evaluation_result = Column(JSON, nullable=True)
    ai_feedback = Column(Text, nullable=True)
    score = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="submissions")
    lab = relationship("Lab", back_populates="submissions")


class UserCollectionExercise(Base):
    __tablename__ = "user_collection_exercises"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    node_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_nodes.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255), nullable=False)
    exercise_type = Column(String(50), nullable=False)  # code, quiz, match, fill, arrange, judge
    content = Column(JSON, nullable=False)
    answer = Column(JSON, nullable=False)
    explanation = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    node = relationship("KnowledgeNode")
