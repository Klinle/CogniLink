from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any
from datetime import datetime
from uuid import UUID


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = None
    conversationId: Optional[str] = None
    apiKey: str
    model: str = "deepseek-v4-flash"
    baseUrl: Optional[str] = None
    agentId: Optional[str] = None


class DocumentResponse(BaseModel):
    id: str
    title: str
    file_type: str
    status: str
    created_at: datetime
    chunks_count: Optional[int] = None


class DocumentListResponse(BaseModel):
    documents: List[DocumentResponse]


class SearchResult(BaseModel):
    id: str
    content: str
    document_id: str
    chunk_index: int


class RAGChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = None
    use_rag: bool = True
    use_memory: bool = True
    use_tools: bool = False
    use_local_embedding: bool = False
    conversationId: Optional[str] = None
    apiKey: str
    model: str = "deepseek-v4-flash"
    baseUrl: Optional[str] = None
    agentId: Optional[str] = None


# Memory schemas
class MemoryCreate(BaseModel):
    content: str
    category: str = "fact"  # preference, fact, goal, important
    importance: int = 5  # 1-10


class MemoryUpdate(BaseModel):
    content: Optional[str] = None
    importance: Optional[int] = None


class MemoryResponse(BaseModel):
    id: str
    content: str
    category: str
    importance: int
    source: str
    created_at: datetime
    access_count: int


# Lab schemas
class LabSubmitRequest(BaseModel):
    code: str
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None
    answers: Optional[dict] = None  # For quiz-type labs


class LabResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    starter_code: Optional[str] = None
    test_cases: Optional[dict] = None
    difficulty: Optional[str] = None
    lab_type: Optional[str] = None
    node_id: Optional[str] = None


class SubmissionResponse(BaseModel):
    id: str
    submitted_code: str
    status: str
    score: int
    evaluation_result: Optional[dict] = None
    ai_feedback: Optional[str] = None
    created_at: datetime


# 动态练习生成与即时评测 schemas
class GenerateExerciseRequest(BaseModel):
    """AI 动态生成针对性练习请求"""
    node_id: Optional[str] = None  # 不传则自动取推荐薄弱节点
    subject: Optional[str] = None  # 科目选择（如 计算机网络 / 操作系统）
    exercise_type: str = "quiz"  # quiz / code
    difficulty: Optional[str] = "medium"  # easy / medium / hard
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


class EvaluateDynamicRequest(BaseModel):
    """动态生成练习的即时评测请求（不创建 submission 记录）"""
    exercise: dict  # 练习内容（title/description/starter_code/test_cases/lab_type）
    code: str = ""  # 代码模式：用户代码
    answers: Optional[dict] = None  # 选择题模式：用户答案
    node_id: Optional[str] = None  # 联动点亮的知识节点
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


class CollectionExerciseCreate(BaseModel):
    node_id: Optional[str] = None
    title: str
    exercise_type: str
    content: Any
    answer: Any
    explanation: Optional[str] = None


class CollectionExerciseResponse(BaseModel):
    # 启用 ORM 模式，允许从 SQLAlchemy 模型对象直接序列化
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    node_id: Optional[UUID] = None
    title: str
    exercise_type: str
    content: Any
    answer: Any
    explanation: Optional[str] = None
    created_at: datetime


class ReviewAnswerRequest(BaseModel):
    """复习作答：correct 为客观判定结果；quality 显式传入时（闪卡自评 5/3/1）优先"""
    correct: bool
    quality: Optional[int] = None


class ReviewItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    source_type: str
    lab_id: Optional[UUID] = None
    node_id: Optional[UUID] = None
    title: str
    exercise_type: str
    content: Any
    answer: Any = None
    explanation: Optional[str] = None
    wrong_count: int
    success_streak: int
    interval_days: int
    state: str
    due_at: Optional[datetime] = None
    last_reviewed_at: Optional[datetime] = None
    created_at: datetime


class OnboardingCompleteRequest(BaseModel):
    """跳过引导（skipped=True 时 onboarding_completed 置 1，诊断完成由 diagnose 置 2）"""
    skipped: bool = True


class DiagnoseResultItem(BaseModel):
    lab_id: str
    correct: bool


class OnboardingDiagnoseRequest(BaseModel):
    """诊断答卷：客观题由前端 exercise-renderer 判分后仅上报对错"""
    domain: str
    results: List[DiagnoseResultItem]

