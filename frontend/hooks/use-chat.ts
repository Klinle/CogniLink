"use client";

import { useState } from "react";
import { Message, Conversation, ConversationDetail, SourceItem } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { useSettingsStore, SUPPORTED_MODELS } from "@/stores/settings";
import { API_BASE_URL, getAuthHeaders } from "@/lib/api";
import { parseSSEStream } from "@/lib/sse";
import { WorkflowStep } from "@/components/workflow-panel";

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("auto");

  const {
    model,
    setModel,
    setSelectedProvider,
    getEffectiveApiKey,
    baseUrls,
    useRAG,
    useMemory,
    useTools,
  } = useSettingsStore();

  const apiKey = getEffectiveApiKey();
  const currentModel = SUPPORTED_MODELS.find((m) => m.id === model);

  // 加载对话列表
  const fetchConversations = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversations`, {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        setConversations(data);
        setFilteredConversations(data);
        return data;
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    }
  };

  const createNewConversation = async (initialTitle = "新对话") => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversations`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ title: initialTitle, model }),
      });
      if (response.ok) {
        const data = await response.json();
        setCurrentConversationId(data.id);
        setMessages([]);
        await fetchConversations();
        return data.id;
      }
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
    return null;
  };

  const loadConversation = async (conversationId: string) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/conversations/${conversationId}`,
        { headers: getAuthHeaders() }
      );
      if (response.ok) {
        const data: ConversationDetail = await response.json();
        setCurrentConversationId(data.id);
        setMessages(
          data.messages?.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            createdAt: m.created_at,
          })) || []
        );
        const convModel = SUPPORTED_MODELS.find((m) => m.id === data.model);
        if (convModel) {
          setModel(data.model!);
          setSelectedProvider(convModel.provider);
        }
      }
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
  };

  const handleSearchConversations = async (query: string) => {
    if (!query.trim()) {
      setFilteredConversations(conversations);
      return;
    }
    setIsSearching(true);
    try {
      const params = new URLSearchParams();
      params.append("q", query);
      const response = await fetch(
        `${API_BASE_URL}/api/conversations/search?${params.toString()}`,
        { headers: getAuthHeaders() }
      );
      if (response.ok) {
        const data = await response.json();
        setFilteredConversations(data);
      }
    } catch (error) {
      console.error("Failed to search conversations:", error);
      const filtered = conversations.filter((c) =>
        c.title.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredConversations(filtered);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSend = async (text: string, customContextNodeId?: string | null) => {
    const trimmedInput = text.trim();
    if (!trimmedInput || isLoading) return;
    setErrorMessage(null);

    let conversationId = currentConversationId;
    if (!conversationId) {
      conversationId = await createNewConversation(trimmedInput.slice(0, 20) + "...");
      if (!conversationId) return;
    }

    const userMessage: Message = {
      id: uuidv4(),
      role: "user",
      content: trimmedInput,
      createdAt: new Date().toISOString(),
    };

    // 先追加用户消息，然后把输入置空
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const endpoint = "/api/chat/graph";
      const MAX_HISTORY_MESSAGES = 100;
      const historyMessages = messages
        .slice(-MAX_HISTORY_MESSAGES)
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      const requestBody = {
        message: userMessage.content,
        history: historyMessages,
        conversationId,
        apiKey,
        model,
        baseUrl: currentModel?.provider
          ? baseUrls[currentModel.provider]
          : undefined,
        use_rag: useRAG,
        use_memory: useMemory,
        use_tools: useTools,
        use_local_embedding: true,  // 固定使用本地 BGE-M3
        agentId: selectedAgentId !== "auto" ? selectedAgentId : undefined,
        context_node_id: customContextNodeId || undefined
      };

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errMsg = `请求失败 (${response.status})`;
        try {
          const errData = await response.json();
          errMsg = errData.detail || errData.message || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      if (!response.body) throw new Error("No response body");

      const assistantMessage: Message = {
        id: uuidv4(),
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // 统一使用 SSE 解析（/api/chat/graph 返回 SSE 事件流）
      setWorkflowSteps([]);
      let lastUpdateTime = 0;
      let capturedSources: SourceItem[] = [];
      const UPDATE_INTERVAL = 30; // 30ms 节流，纯文本渲染足够快
      await parseSSEStream(response, ({ event, data }) => {
        const d = data as {
          status: string;
          node: string;
          label: string;
          message?: string;
          data?: Record<string, unknown>;
          text?: string;
        };
        if (event === "status") {
          // rag_bot done 事件携带结构化来源，流结束后挂到消息上（T3 溯源跳转）
          if (d.node === "rag_bot" && d.status === "done" && Array.isArray(d.data?.sources)) {
            capturedSources = d.data.sources as SourceItem[];
          }
          setWorkflowSteps((prev) => {
            if (d.status === "running") {
              return [
                ...prev,
                {
                  node: d.node,
                  label: d.label,
                  status: "running" as const,
                  message: d.message,
                },
              ];
            } else {
              const newSteps = [...prev];
              for (let i = newSteps.length - 1; i >= 0; i--) {
                if (newSteps[i].node === d.node) {
                  newSteps[i] = {
                    ...newSteps[i],
                    status: "done" as const,
                    data: d.data,
                  };
                  break;
                }
              }
              return newSteps;
            }
          });
        } else if (event === "content") {
          assistantMessage.content += d.text || "";
          const now = Date.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            lastUpdateTime = now;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessage.id
                  ? { ...msg, content: assistantMessage.content }
                  : msg
              )
            );
          }
        } else if (event === "error") {
          setErrorMessage(d.message || "工作流执行失败");
        }
      });
      // 最终更新确保完整内容渲染，并附加溯源来源
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id
            ? {
                ...msg,
                content: assistantMessage.content,
                sources: capturedSources.length ? capturedSources : undefined,
              }
            : msg
        )
      );
      setWorkflowSteps([]);
    } catch (error) {
      console.error("Chat error:", error);
      const msg = error instanceof Error ? error.message : "发送消息失败";
      setErrorMessage(`${msg}，请检查 API 密钥设置`);
    } finally {
      setIsLoading(false);
      fetchConversations();
    }
  };

  const handleRegenerate = async () => {
    const lastUserIndex = [...messages].reverse().findIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;
    const lastUserMsg = messages[messages.length - 1 - lastUserIndex];

    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant") {
      setMessages((prev) => prev.slice(0, -1));
    }
    await handleSend(lastUserMsg.content);
  };

  const handleCopyMessage = async (content: string, messageId: string, setCopiedId: (id: string | null) => void) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return {
    messages,
    setMessages,
    isLoading,
    errorMessage,
    setErrorMessage,
    workflowSteps,
    conversations,
    filteredConversations,
    setFilteredConversations,
    searchQuery,
    setSearchQuery,
    isSearching,
    currentConversationId,
    setCurrentConversationId,
    selectedAgentId,
    setSelectedAgentId,
    fetchConversations,
    createNewConversation,
    loadConversation,
    handleSearchConversations,
    handleSend,
    handleRegenerate,
    handleCopyMessage,
  };
}
