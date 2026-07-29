import type { Lab, LabFilterParams, KnowledgeNode, NodeContextPreview, GenerateBatchResult } from "@/types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const getAuthHeaders = (): Record<string, string> => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("cognilink_token");
    if (token) {
      return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      };
    }
  }
  return {
    "Content-Type": "application/json"
  };
};

/**
 * Returns only the Authorization header (without Content-Type).
 * Use this for FormData uploads where the browser must set Content-Type
 * with the correct multipart boundary automatically.
 */
export const getAuthHeaderOnly = (): Record<string, string> => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("cognilink_token");
    if (token) {
      return { "Authorization": `Bearer ${token}` };
    }
  }
  return {};
};

export interface ChatRequest {
  message: string;
  conversationId?: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  useRag?: boolean;
  useMemory?: boolean;
  useTools?: boolean;
  useLocalEmbedding?: boolean;
  agentId?: string;
}

export const chatApi = {
  sendMessage: async (
    data: ChatRequest,
  ): Promise<ReadableStream<Uint8Array>> => {
    const response = await fetch(`${API_BASE_URL}/api/chat/rag`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        message: data.message,
        conversationId: data.conversationId,
        apiKey: data.apiKey,
        model: data.model,
        baseUrl: data.baseUrl,
        use_rag: data.useRag ?? false,
        use_memory: data.useMemory ?? false,
        use_tools: data.useTools ?? false,
        use_local_embedding: true, // 固定使用本地 BGE-M3
        agentId: data.agentId,
      }),
    });

    if (!response.body) {
      throw new Error("No response body");
    }

    return response.body;
  },
};

export const labApi = {
  listLabs: async (params?: { lab_type?: string; node_id?: string; difficulty?: string }) => {
    const query = new URLSearchParams();
    if (params?.lab_type) query.append("lab_type", params.lab_type);
    if (params?.node_id) query.append("node_id", params.node_id);
    if (params?.difficulty) query.append("difficulty", params.difficulty);
    const response = await fetch(`${API_BASE_URL}/api/labs?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取实验列表失败");
    return response.json();
  },
  getLab: async (labId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/labs/${labId}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取实验详情失败");
    return response.json();
  },
  submitLab: async (labId: string, code: string, apiKey?: string, model?: string, baseUrl?: string, answers?: Record<string, number>) => {
    const response = await fetch(`${API_BASE_URL}/api/labs/${labId}/submit`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        code,
        api_key: apiKey,
        model,
        base_url: baseUrl,
        answers,
      }),
    });
    if (!response.ok) throw new Error("提交评测失败");
    return response.json();
  },
  getSubmissions: async (labId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/labs/${labId}/submissions`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取提交历史失败");
    return response.json();
  },
  generateLab: async (params: {
    exercise_type: string;
    difficulty?: string;
    node_id?: string;
    subject?: string;
    api_key?: string;
    model?: string;
    base_url?: string;
  }) => {
    // AI 动态生成针对性练习（不传 node_id 时后端自动取薄弱节点）
    const response = await fetch(`${API_BASE_URL}/api/labs/generate`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error("生成针对性练习失败");
    return response.json();
  },
  evaluateDynamic: async (params: {
    exercise: Record<string, unknown>;
    code?: string;
    answers?: Record<string, unknown>;
    node_id?: string;
    api_key?: string;
    model?: string;
    base_url?: string;
  }) => {
    // 动态生成练习的即时评测（不创建 submission 记录，但联动知识图谱）
    const response = await fetch(`${API_BASE_URL}/api/labs/evaluate-dynamic`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error("即时评测失败");
    return response.json();
  },
};

export const adminApi = {
  getStats: async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/stats`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取统计数据失败");
    return response.json();
  },
  getAiEvaluation: async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/stats/ai-evaluation`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取 AI 运营诊断失败");
    return response.json();
  },
  listUsers: async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取用户列表失败");
    return response.json();
  },
  updateUser: async (userId: string, data: { role?: string; nickname?: string }) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("更新用户失败");
    return response.json();
  },
  listStudents: async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/students`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取学员列表失败");
    return response.json();
  },
  getStudentProfile: async (studentId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/students/${studentId}/profile`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取学员画像失败");
    return response.json();
  },
  listDocuments: async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/documents`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取文档列表失败");
    return response.json();
  },
  updateDocument: async (docId: string, data: { visibility?: string; is_active?: number }) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/documents/${docId}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("更新文档失败");
    return response.json();
  },
  // 文档上传（管理员专用，固定使用本地嵌入模型）
  uploadDocument: async (file: File, knowledgeBaseId?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (knowledgeBaseId) formData.append("knowledge_base_id", knowledgeBaseId);
    const params = new URLSearchParams();
    params.append("use_local_embedding", "true");
    const response = await fetch(
      `${API_BASE_URL}/api/documents/upload?${params.toString()}`,
      { method: "POST", headers: getAuthHeaderOnly(), body: formData }
    );
    if (!response.ok) {
      let errMsg = "上传失败";
      try {
        const errData = await response.json();
        errMsg = errData.detail || errData.message || errMsg;
      } catch {
        // ignore
      }
      throw new Error(errMsg);
    }
    return response.json();
  },
  // 重新处理文档（使用本地嵌入模型重新分块+向量化+知识提取）
  reprocessDocument: async (docId: string) => {
    const params = new URLSearchParams();
    params.append("use_local_embedding", "true");
    const response = await fetch(
      `${API_BASE_URL}/api/documents/${docId}/reprocess?${params.toString()}`,
      { method: "POST", headers: getAuthHeaders() }
    );
    if (!response.ok) throw new Error("重新处理失败");
    return response.json();
  },
  // 删除文档
  deleteDocument: async (docId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/documents/${docId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("删除文档失败");
    return response.json();
  },
  // 批量删除文档
  batchDeleteDocuments: async (documentIds: string[]) => {
    const response = await fetch(`${API_BASE_URL}/api/documents/batch-delete`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ document_ids: documentIds }),
    });
    if (!response.ok) throw new Error("批量删除失败");
    return response.json();
  },
  // 获取文档处理状态（含进度）
  getDocumentStatus: async (docId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/documents/${docId}/status`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取文档状态失败");
    return response.json();
  },
  // 获取文档内容（分页加载）
  getDocumentContent: async (docId: string, startPage: number, endPage: number) => {
    const params = new URLSearchParams();
    params.append("start_page", String(startPage));
    params.append("end_page", String(endPage));
    const response = await fetch(
      `${API_BASE_URL}/api/documents/${docId}/content?${params.toString()}`,
      { headers: getAuthHeaders() }
    );
    if (!response.ok) throw new Error("获取文档内容失败");
    return response.json();
  },
  // 获取 PDF 预览信息（总页数、文件大小）
  getDocumentPreviewInfo: async (docId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/documents/${docId}/preview-info`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取预览信息失败");
    return response.json();
  },
  // 文档文件 URL（用于 iframe 预览或下载）
  getDocumentFileUrl: (docId: string) =>
    `${API_BASE_URL}/api/documents/${docId}/file`,
  listLabs: async (params?: LabFilterParams) => {
    const query = new URLSearchParams();
    if (params?.lab_type) query.append("lab_type", params.lab_type);
    if (params?.difficulty) query.append("difficulty", params.difficulty);
    if (params?.node_id) query.append("node_id", params.node_id);
    if (params?.search) query.append("search", params.search);
    const qs = query.toString();
    const url = qs
      ? `${API_BASE_URL}/api/admin/labs?${qs}`
      : `${API_BASE_URL}/api/admin/labs`;
    const response = await fetch(url, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取题库列表失败");
    return response.json() as Promise<Lab[]>;
  },
  createLab: async (data: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/labs`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("创建题目失败");
    return response.json();
  },
  updateLab: async (labId: string, data: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/labs/${labId}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("更新题目失败");
    return response.json();
  },
  deleteLab: async (labId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/labs/${labId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("删除题目失败");
    return response.json();
  },
  batchDeleteLabs: async (labIds: string[]) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/labs/batch-delete`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ ids: labIds }),
    });
    if (!response.ok) throw new Error("批量删除题目失败");
    return response.json();
  },
  generateBatchLabs: async (params: {
    node_id: string;
    exercise_type: string;
    difficulty?: string;
    count?: number;
    api_key?: string;
    model?: string;
    base_url?: string;
  }) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/labs/generate-batch`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error("AI 批量生成题目失败");
    return response.json() as Promise<GenerateBatchResult>;
  },
  batchSaveLabs: async (data: { labs: Record<string, unknown>[] }) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/labs/batch-save`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("批量导入题库失败");
    return response.json();
  },
  listKnowledgeNodes: async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/knowledge-nodes`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取知识节点列表失败");
    return response.json() as Promise<KnowledgeNode[]>;
  },
  getNodeContext: async (nodeId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/knowledge-nodes/${nodeId}/context`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取知识上下文预览失败");
    return response.json() as Promise<NodeContextPreview>;
  },
  listAgents: async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/agents`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取 Agent 列表失败");
    return response.json();
  },
  createAgent: async (data: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/agents`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("创建 Agent 失败");
    return response.json();
  },
  updateAgent: async (agentId: string, data: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/agents/${agentId}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("更新 Agent 失败");
    return response.json();
  },
};

export const profileApi = {
  getStats: async () => {
    const response = await fetch(`${API_BASE_URL}/api/profile/stats`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取学习统计失败");
    return response.json();
  },
  getRadar: async () => {
    const response = await fetch(`${API_BASE_URL}/api/profile/radar`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取能力雷达图失败");
    return response.json();
  },
};

export const knowledgeApi = {
  getGraph: async (knowledgeBaseId?: string) => {
    const url = knowledgeBaseId 
      ? `${API_BASE_URL}/api/knowledge/graph?knowledge_base_id=${knowledgeBaseId}`
      : `${API_BASE_URL}/api/knowledge/graph`;
    const response = await fetch(url, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取知识图谱失败");
    return response.json();
  },
  listKnowledgeBases: async () => {
    const response = await fetch(`${API_BASE_URL}/api/documents/kb`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取知识库分类列表失败");
    return response.json();
  },
  createKnowledgeBase: async (name: string, description: string = "") => {
    const response = await fetch(`${API_BASE_URL}/api/documents/kb`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!response.ok) throw new Error("创建分类知识库失败");
    return response.json();
  },
  getNodeLabs: async (nodeId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/knowledge/nodes/${nodeId}/labs`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取节点实验失败");
    return response.json();
  },
  computePageRank: async () => {
    const response = await fetch(`${API_BASE_URL}/api/knowledge/pagerank`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("计算 PageRank 失败");
    return response.json();
  },
  recommendLearningPath: async () => {
    const response = await fetch(`${API_BASE_URL}/api/knowledge/recommend`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取学习路径推荐失败");
    return response.json();
  },
};

export const authApi = {
  login: async (username: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "登录失败");
    }
    return response.json();
  },
  register: async (username: string, password: string, nickname?: string) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, nickname })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "注册失败");
    }
    return response.json();
  },
  getMe: async () => {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      throw new Error("未登录或 Token 失效");
    }
    return response.json();
  }
};

export const collectionApi = {
  listCollections: async () => {
    const response = await fetch(`${API_BASE_URL}/api/collections`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取收藏列表失败");
    return response.json();
  },
  collectExercise: async (data: {
    node_id?: string;
    title: string;
    exercise_type: string;
    content: unknown;
    answer: unknown;
    explanation?: string;
  }) => {
    const response = await fetch(`${API_BASE_URL}/api/collections`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("收藏题目失败");
    return response.json();
  },
  deleteCollection: async (collectionId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/collections/${collectionId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("取消收藏失败");
    return response.json();
  },
  checkIsCollected: async (title: string) => {
    const response = await fetch(`${API_BASE_URL}/api/collections/check?title=${encodeURIComponent(title)}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("校验收藏状态失败");
    return response.json();
  },
  uncollectExercise: async (title: string) => {
    const collections: { id: string; title: string }[] = await collectionApi.listCollections();
    const target = collections.find((c) => c.title === title);
    if (!target) return { success: true };
    return collectionApi.deleteCollection(target.id);
  },
};

export const onboardingApi = {
  getStatus: async () => {
    const response = await fetch(`${API_BASE_URL}/api/onboarding/status`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取引导状态失败");
    return response.json();
  },
  complete: async (skipped: boolean) => {
    const response = await fetch(`${API_BASE_URL}/api/onboarding/complete`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ skipped }),
    });
    if (!response.ok) throw new Error("更新引导状态失败");
    return response.json();
  },
  getQuestions: async (domain: string) => {
    const response = await fetch(
      `${API_BASE_URL}/api/onboarding/questions?domain=${encodeURIComponent(domain)}`,
      { headers: getAuthHeaders() },
    );
    if (!response.ok) throw new Error("获取诊断题目失败");
    return response.json();
  },
  diagnose: async (domain: string, results: { lab_id: string; correct: boolean }[]) => {
    const response = await fetch(`${API_BASE_URL}/api/onboarding/diagnose`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ domain, results }),
    });
    if (!response.ok) throw new Error("提交诊断结果失败");
    return response.json();
  },
};

export const reviewApi = {
  getToday: async () => {
    const response = await fetch(`${API_BASE_URL}/api/reviews/today`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取今日复习队列失败");
    return response.json();
  },
  listAll: async (params?: { state?: string; category?: string }) => {
    const search = new URLSearchParams();
    if (params?.state) search.append("state", params.state);
    if (params?.category) search.append("category", params.category);
    const qs = search.toString();
    const response = await fetch(`${API_BASE_URL}/api/reviews${qs ? `?${qs}` : ""}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取错题本失败");
    return response.json();
  },
  answer: async (itemId: string, correct: boolean, quality?: number) => {
    const response = await fetch(`${API_BASE_URL}/api/reviews/${itemId}/answer`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ correct, quality }),
    });
    if (!response.ok) throw new Error("提交复习结果失败");
    return response.json();
  },
  getStats: async () => {
    const response = await fetch(`${API_BASE_URL}/api/reviews/stats`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("获取复习统计失败");
    return response.json();
  },
  remove: async (itemId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/reviews/${itemId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error("移除错题失败");
    return response.json();
  },
};
