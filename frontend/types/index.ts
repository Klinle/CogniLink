// RAG 回答的结构化来源（T3 溯源跳转）
export interface SourceItem {
  document_id: string;
  title: string;
  page_number: number | null;
  chunk_id: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sources?: SourceItem[];
}

// 错题复习队列条目（T2）
export interface ReviewItem {
  id: string;
  source_type: string;
  lab_id?: string | null;
  node_id?: string | null;
  title: string;
  exercise_type: string;
  content: Record<string, unknown>;
  answer?: unknown;
  explanation?: string | null;
  wrong_count: number;
  success_streak: number;
  interval_days: number;
  state: string;
  due_at?: string | null;
  last_reviewed_at?: string | null;
  created_at: string;
}

export interface ReviewTodayResponse {
  items: ReviewItem[];
  total_due: number;
  completed_today: number;
  cap: number;
  next_due_at: string | null;
}

export interface ReviewAnswerResponse {
  item_id: string;
  correct: boolean;
  state: string;
  graduated: boolean;
  next_interval_days: number;
  due_at: string | null;
  success_streak: number;
  message: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface Settings {
  openaiApiKey: string;
  model: string;
}

// Lab types
export interface Lab {
  id: string;
  title: string;
  description?: string;
  starter_code?: string;
  test_cases?: Record<string, unknown>;
  answer?: Record<string, unknown>;
  difficulty?: string;
  lab_type?: string;
  node_id?: string;
  node_name?: string;
  node_category?: string;
  created_at?: string;
  has_explanation?: boolean;
  detailed_explanation?: string;
}

// 批量出题参数
export interface BatchGenerateParams {
  node_id: string;
  exercise_type: string;
  difficulty: string;
  count: number;
  api_key?: string;
  model?: string;
  base_url?: string;
}

// AI 生成的题目（编辑态，test_cases 为 JSON 字符串）
export interface GeneratedLab {
  localId: number;
  title: string;
  description: string;
  starter_code: string;
  test_cases: string;
  difficulty: string;
  lab_type: string;
  detailed_explanation: string;
  node_id: string;
}

// 题库筛选参数
export interface LabFilterParams {
  lab_type?: string;
  difficulty?: string;
  node_id?: string;
  search?: string;
}

export interface Submission {
  id: string;
  submitted_code: string;
  status: string;
  score: number;
  evaluation_result?: Record<string, unknown>;
  ai_feedback?: string;
  created_at: string;
}
export interface KnowledgeNode {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  pagerank_weight: number;
  is_lighted: boolean;
  proficiency: number;
  study_duration: number;
  chunk_count: number;
  lab_count: number;
  lab_types: Record<string, number>;
}

// 知识节点上下文预览
export interface NodeContextPreview {
  chunk_count: number;
  total_chars: number;
  preview_chunks: {
    content: string;
    element_type: string | null;
    page_number: number | null;
  }[];
}

// AI 批量生成结果
export interface GenerateBatchResult {
  labs: Record<string, unknown>[];
  context_info?: {
    node_name: string;
    chunk_count: number;
    context_length: number;
  };
}

export interface RecommendedNode {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  pagerank: number;
  proficiency: number;
  reason: string;
}

export interface ProfileStats {
  lighted_nodes: number;
  total_nodes: number;
  pass_rate: number;
  passed_labs: number;
  total_submissions: number;
  study_duration_hours: number;
  memory_count: number;
}

// 知识图谱关系
export interface GraphRelation {
  source: string;
  target: string;
  relation_type: string;
  weight?: number;
}

// 能力雷达图数据
export interface RadarData {
  indicators: { name: string; max: number }[];
  values: {
    direction: string;
    coverage: number;
    proficiency: number;
    lighted: number;
    total: number;
  }[];
}

// 知识库分类
export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
}

// 收藏的题目
export interface CollectionExercise {
  id: string;
  node_id?: string;
  title: string;
  exercise_type: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown>;
  explanation?: string;
  created_at: string;
}

// 对话详情（含消息列表）
export interface ConversationDetail extends Conversation {
  model?: string;
  messages?: Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
  }>;
}
