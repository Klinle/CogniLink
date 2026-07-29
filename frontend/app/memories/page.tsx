"use client";

import { useState, useCallback, useEffect } from "react";
import { useSettingsStore, SUPPORTED_MODELS } from "@/stores/settings";
import {
  Brain,
  Plus,
  Trash2,
  Search,
  Loader2,
  Settings,
  X,
  Check,
  AlertCircle,
  Clock,
  Shield,
  Filter,
} from "lucide-react";
import UserLayout from "@/components/user-layout";
import { API_BASE_URL, getAuthHeaders } from "@/lib/api";
import { useRouter } from "next/navigation";

interface Memory {
  id: string;
  content: string;
  category: string;
  importance: number;
  source: string;
  created_at: string;
  access_count: number;
}

interface MemorySettings {
  auto_extract: boolean;
  whitelist_topics: string[];
  blacklist_topics: string[];
  min_importance: number;
}

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

const categories = [
  {
    value: "fact",
    label: "事实",
    note: "bg-sky-100 dark:bg-sky-900/40",
  },
  {
    value: "preference",
    label: "偏好",
    note: "bg-amber-100 dark:bg-amber-900/40",
  },
  {
    value: "goal",
    label: "目标",
    note: "bg-green-100 dark:bg-green-900/40",
  },
  {
    value: "important",
    label: "重要",
    note: "bg-rose-100 dark:bg-rose-900/40",
  },
];

const inputClass =
  "w-full border-2 border-black rounded-xl bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-bold text-black dark:text-white placeholder:text-zinc-400 placeholder:font-semibold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-none transition-all";

const primaryBtn =
  "inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-black bg-amber-300 dark:bg-amber-600 text-black dark:text-white font-black text-sm shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-40";

const secondaryBtn =
  "inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-black bg-white dark:bg-zinc-800 text-black dark:text-white font-black text-sm shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-40";

const chipClass =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border-2 border-black text-[11px] font-bold shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]";

export default function MemoriesPage() {
  const router = useRouter();

  // 鉴权检查
  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("cognilink_token");
      if (!token) {
        router.push("/login");
      }
    }
  }, [router]);

  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newMemory, setNewMemory] = useState({
    content: "",
    category: "fact",
    importance: 5,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<MemorySettings>({
    auto_extract: true,
    whitelist_topics: [],
    blacklist_topics: [],
    min_importance: 5,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [newWhitelistItem, setNewWhitelistItem] = useState("");
  const [newBlacklistItem, setNewBlacklistItem] = useState("");
  const { apiKeys, openaiApiKey, model, baseUrls } = useSettingsStore();

  // Get current model's provider and API key
  const currentModel = SUPPORTED_MODELS.find((m) => m.id === model);
  const provider = currentModel?.provider || "openai";
  const apiKey =
    apiKeys[provider] || (provider === "openai" ? openaiApiKey : "") || "";
  const baseUrl = baseUrls[provider] || "";

  // Toast helper
  const showToast = useCallback((type: Toast["type"], message: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const fetchMemories = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/memories/`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setMemories(data);
      }
    } catch (error) {
      console.error("Failed to fetch memories:", error);
      showToast("error", "获取记忆列表失败");
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/memories/settings`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error("Failed to fetch memory settings:", error);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
    fetchSettings();
  }, [fetchMemories, fetchSettings]);

  const handleAddMemory = async () => {
    if (!newMemory.content.trim()) {
      showToast("error", "先写点内容，再贴上便签");
      return;
    }
    try {
      const params = new URLSearchParams();
      params.append("api_key", apiKey);
      params.append("provider", provider);
      if (baseUrl) params.append("base_url", baseUrl);
      params.append("use_local_embedding", "true");

      const response = await fetch(
        `${API_BASE_URL}/api/memories/?${params.toString()}`,
        {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify(newMemory),
        },
      );

      if (response.ok) {
        await fetchMemories();
        setNewMemory({ content: "", category: "fact", importance: 5 });
        setShowAddForm(false);
        showToast("success", "便签已贴上墙");
      } else {
        showToast("error", "添加记忆失败，稍后再试");
      }
    } catch (error) {
      console.error("Add memory error:", error);
      showToast("error", "添加记忆失败，稍后再试");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要撕掉这张便签吗？")) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/memories/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        showToast("success", "记忆已删除");
        await fetchMemories();
      } else {
        showToast("error", "删除记忆失败");
      }
    } catch (error) {
      console.error("Delete error:", error);
      showToast("error", "删除记忆失败");
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/memories/settings`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        showToast("success", "设置已保存");
        setShowSettings(false);
      } else {
        showToast("error", "保存设置失败");
      }
    } catch (error) {
      console.error("Save settings error:", error);
      showToast("error", "保存设置失败");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const addWhitelistItem = () => {
    if (!newWhitelistItem.trim()) return;
    if (settings.whitelist_topics.includes(newWhitelistItem.trim())) {
      showToast("error", "该主题已在白名单中");
      return;
    }
    setSettings({
      ...settings,
      whitelist_topics: [...settings.whitelist_topics, newWhitelistItem.trim()],
    });
    setNewWhitelistItem("");
  };

  const removeWhitelistItem = (item: string) => {
    setSettings({
      ...settings,
      whitelist_topics: settings.whitelist_topics.filter((i) => i !== item),
    });
  };

  const addBlacklistItem = () => {
    if (!newBlacklistItem.trim()) return;
    if (settings.blacklist_topics.includes(newBlacklistItem.trim())) {
      showToast("error", "该主题已在黑名单中");
      return;
    }
    setSettings({
      ...settings,
      blacklist_topics: [...settings.blacklist_topics, newBlacklistItem.trim()],
    });
    setNewBlacklistItem("");
  };

  const removeBlacklistItem = (item: string) => {
    setSettings({
      ...settings,
      blacklist_topics: settings.blacklist_topics.filter((i) => i !== item),
    });
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      showToast("info", "输入关键词，再按搜索");
      return;
    }
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("query", searchQuery);
      params.append("api_key", apiKey);
      params.append("provider", provider);
      if (baseUrl) params.append("base_url", baseUrl);
      params.append("use_local_embedding", "true");

      const response = await fetch(
        `${API_BASE_URL}/api/memories/search?${params.toString()}`,
        { headers: getAuthHeaders() },
      );
      if (response.ok) {
        const data = await response.json();
        setMemories(data);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getNoteColor = (category: string) =>
    categories.find((c) => c.value === category)?.note ||
    "bg-white dark:bg-zinc-900";

  const getCategoryLabel = (category: string) =>
    categories.find((c) => c.value === category)?.label || category;

  return (
    <UserLayout activePath="/memories">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-[60] space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-2 px-4 py-3 rounded-2xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-sm text-black dark:text-white ${
              toast.type === "success"
                ? "bg-green-200 dark:bg-green-700"
                : toast.type === "error"
                  ? "bg-red-200 dark:bg-red-800"
                  : "bg-sky-200 dark:bg-sky-800"
            }`}
          >
            {toast.type === "success" && <Check className="h-4 w-4" />}
            {toast.type === "error" && <AlertCircle className="h-4 w-4" />}
            {toast.type === "info" && <Clock className="h-4 w-4" />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-[#fdfaf2] dark:bg-[#181611] bg-[linear-gradient(rgba(139,90,43,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(139,90,43,0.02)_1px,transparent_1px)] bg-[size:24px_24px]">
        <div className="max-w-5xl mx-auto p-4 md:p-8">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-black dark:text-white flex items-center gap-2">
                <Brain className="h-8 w-8 text-amber-500" />
                记忆便签墙
              </h1>
              <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mt-1">
                AI 帮你记下的每一件事都贴在这里，随时翻看、补充或撕掉
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                className={secondaryBtn}
                onClick={() => setShowSettings(true)}
              >
                <Settings className="h-4 w-4" />
                提取设置
              </button>
              <button
                className={primaryBtn}
                onClick={() => setShowAddForm(!showAddForm)}
              >
                <Plus className="h-4 w-4" />
                添加记忆
              </button>
            </div>
          </div>

          {/* Settings Summary */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center gap-2 mb-1">
                <Brain className="h-4 w-4 text-amber-500" />
                <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                  自动提取
                </span>
              </div>
              <p className="text-2xl font-black text-black dark:text-white">
                {settings.auto_extract ? "开启" : "关闭"}
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                  白名单主题
                </span>
              </div>
              <p className="text-2xl font-black text-black dark:text-white">
                {settings.whitelist_topics.length}
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center gap-2 mb-1">
                <Filter className="h-4 w-4 text-red-600 dark:text-red-400" />
                <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                  黑名单主题
                </span>
              </div>
              <p className="text-2xl font-black text-black dark:text-white">
                {settings.blacklist_topics.length}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="flex gap-2 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
              <input
                type="text"
                placeholder="想找哪张便签？输入关键词..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className={`${inputClass} pl-9`}
              />
            </div>
            <button className={secondaryBtn} onClick={handleSearch}>
              <Search className="h-4 w-4" />
              搜索
            </button>
          </div>

          {/* Add Memory Form */}
          {showAddForm && (
            <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] mb-6">
              <h3 className="font-black text-black dark:text-white mb-4">
                写一张新便签
              </h3>
              <div className="space-y-4">
                <textarea
                  placeholder="想让 AI 记住什么？比如你的学习目标、常用工具、易错点..."
                  value={newMemory.content}
                  onChange={(e) =>
                    setNewMemory({ ...newMemory, content: e.target.value })
                  }
                  className={`${inputClass} min-h-[100px] resize-y`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                    类别
                  </span>
                  {categories.map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() =>
                        setNewMemory({ ...newMemory, category: cat.value })
                      }
                      className={`${chipClass} px-3 py-1.5 text-xs text-black dark:text-white transition-all ${
                        newMemory.category === cat.value
                          ? `${cat.note} font-black`
                          : "bg-white dark:bg-zinc-800 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 shrink-0">
                    重要度
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={newMemory.importance}
                    onChange={(e) =>
                      setNewMemory({
                        ...newMemory,
                        importance: parseInt(e.target.value),
                      })
                    }
                    className="flex-1 accent-amber-500"
                  />
                  <span className="w-12 text-center font-black text-black dark:text-white">
                    {newMemory.importance}/10
                  </span>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    className={secondaryBtn}
                    onClick={() => setShowAddForm(false)}
                  >
                    取消
                  </button>
                  <button className={primaryBtn} onClick={handleAddMemory}>
                    <Plus className="h-4 w-4" />
                    贴上墙
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Memories Wall */}
          {isLoading ? (
            <div className="py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-amber-500" />
              <p className="text-sm font-bold text-zinc-500 dark:text-zinc-400 mt-3">
                正在整理便签墙...
              </p>
            </div>
          ) : memories.length === 0 ? (
            <div className="flex justify-center py-12">
              <div className="relative mt-2 w-full max-w-sm border-2 border-dashed border-black/30 dark:border-white/30 rounded-2xl p-8 text-center rotate-[-0.6deg]">
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-14 h-4 bg-black/10 dark:bg-white/10 rotate-[-2deg] rounded-sm" />
                <Brain className="h-8 w-8 mx-auto text-zinc-400 mb-3" />
                <h3 className="font-black text-black dark:text-white mb-1">
                  墙上还空着
                </h3>
                <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  和 AI 聊聊你的学习目标，或点击上方&ldquo;添加记忆&rdquo;手动写下第一张便签
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {memories.map((memory, index) => (
                <div
                  key={memory.id}
                  className={`group relative mt-2 border-2 border-black rounded-2xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:rotate-0 hover:-translate-y-0.5 ${
                    index % 2 === 0 ? "rotate-[-0.6deg]" : "rotate-[0.6deg]"
                  } ${getNoteColor(memory.category)}`}
                >
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-14 h-4 bg-black/10 dark:bg-white/10 rotate-[-2deg] rounded-sm" />
                  <button
                    onClick={() => handleDelete(memory.id)}
                    className="absolute top-2 right-2 p-1.5 rounded-lg border-2 border-black bg-white dark:bg-zinc-800 text-black dark:text-white opacity-0 group-hover:opacity-100 hover:bg-red-200 dark:hover:bg-red-800 transition-all"
                    title="撕掉这张便签"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <p className="text-sm font-bold text-black dark:text-white leading-relaxed break-words pr-8">
                    {memory.content}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3">
                    <span
                      className={`${chipClass} bg-white dark:bg-zinc-800 text-black dark:text-white`}
                    >
                      {getCategoryLabel(memory.category)}
                    </span>
                    <span className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                      重要度 {memory.importance}/10
                    </span>
                    <span className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                      {new Date(memory.created_at).toLocaleDateString()}
                    </span>
                    {memory.access_count > 0 && (
                      <span className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                        被想起 {memory.access_count} 次
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b-2 border-black bg-amber-50 dark:bg-zinc-800">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-black dark:text-white" />
                <h2 className="font-black text-black dark:text-white">
                  记忆提取设置
                </h2>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1.5 rounded-lg border-2 border-black bg-white dark:bg-zinc-900 text-black dark:text-white shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Auto Extract Toggle */}
              <div className="flex items-center justify-between gap-4 border-2 border-black rounded-2xl p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] bg-white dark:bg-zinc-900">
                <div>
                  <p className="font-black text-black dark:text-white">
                    自动提取记忆
                  </p>
                  <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                    开启后，AI 会在对话结束时自动把重要信息写成便签
                  </p>
                </div>
                <button
                  onClick={() =>
                    setSettings({
                      ...settings,
                      auto_extract: !settings.auto_extract,
                    })
                  }
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-black transition-colors ${
                    settings.auto_extract
                      ? "bg-amber-400 dark:bg-amber-500"
                      : "bg-zinc-200 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full border-2 border-black bg-white transition-transform ${
                      settings.auto_extract ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Min Importance */}
              <div className="space-y-2">
                <label className="font-black text-black dark:text-white">
                  最小重要度阈值
                </label>
                <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  只保存重要度不低于此值的记忆（1-10）
                </p>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={settings.min_importance}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        min_importance: parseInt(e.target.value),
                      })
                    }
                    className="flex-1 accent-amber-500"
                  />
                  <span className="w-12 text-center font-black text-black dark:text-white">
                    {settings.min_importance}
                  </span>
                </div>
              </div>

              {/* Whitelist */}
              <div className="space-y-2">
                <label className="font-black text-black dark:text-white">
                  白名单主题
                </label>
                <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  只提取包含这些主题的记忆，留空表示不限制
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newWhitelistItem}
                    onChange={(e) => setNewWhitelistItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addWhitelistItem();
                    }}
                    placeholder="输入主题后回车添加..."
                    className={inputClass}
                  />
                  <button
                    className={`${primaryBtn} shrink-0`}
                    onClick={addWhitelistItem}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {settings.whitelist_topics.map((item) => (
                    <span
                      key={item}
                      className={`${chipClass} bg-green-200 dark:bg-green-700 text-black dark:text-white`}
                    >
                      {item}
                      <button
                        onClick={() => removeWhitelistItem(item)}
                        className="hover:opacity-60"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Blacklist */}
              <div className="space-y-2">
                <label className="font-black text-black dark:text-white">
                  黑名单主题
                </label>
                <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  含这些主题的内容不会被记下来
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newBlacklistItem}
                    onChange={(e) => setNewBlacklistItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addBlacklistItem();
                    }}
                    placeholder="输入主题后回车添加..."
                    className={inputClass}
                  />
                  <button
                    className={`${primaryBtn} shrink-0`}
                    onClick={addBlacklistItem}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {settings.blacklist_topics.map((item) => (
                    <span
                      key={item}
                      className={`${chipClass} bg-red-200 dark:bg-red-800 text-black dark:text-white`}
                    >
                      {item}
                      <button
                        onClick={() => removeBlacklistItem(item)}
                        className="hover:opacity-60"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t-2 border-black bg-amber-50 dark:bg-zinc-800">
              <button
                className={secondaryBtn}
                onClick={() => setShowSettings(false)}
              >
                取消
              </button>
              <button
                className={primaryBtn}
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
              >
                {isSavingSettings ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    保存中...
                  </>
                ) : (
                  "保存设置"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </UserLayout>
  );
}
