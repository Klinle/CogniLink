"use client";

import React, { useState, useCallback, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Brain,
  Loader2,
  Send,
  ChevronRight,
  Sparkles,
  Star,
  Grid3X3,
  FolderHeart,
  Check,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore, SUPPORTED_MODELS } from "@/stores/settings";
import { labApi, collectionApi } from "@/lib/api";
import type { Lab, Submission, CollectionExercise } from "@/types";
import UserLayout from "@/components/user-layout";
import ExerciseRenderer from "@/components/exercise-renderer";
import { cn } from "@/lib/utils";

type ExerciseMode = "system" | "dynamic" | "collection";
type TabMode = "code" | "quiz" | "match" | "arrange" | "fill";

// 单选题结构（与 study-panel 保持一致）
interface QuizQuestion {
  id?: string;
  text?: string;
  question?: string;
  options?: string[];
  answer?: number;
  explanation?: string;
}

// 评测结果类型
interface EvalResult {
  status: string;
  score: number;
  feedback?: string;
  evaluation_result?: {
    issues?: string[];
    suggestions?: string[];
  };
}

function PracticeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nodeId = searchParams.get("nodeId");

  const { apiKeys, openaiApiKey, model, baseUrls } = useSettingsStore();

  const [exerciseMode, setExerciseMode] = useState<ExerciseMode>("system");
  const [tabMode, setTabMode] = useState<TabMode>("code");
  const [labs, setLabs] = useState<Lab[]>([]);
  const [collections, setCollections] = useState<CollectionExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLab, setSelectedLab] = useState<Lab | null>(null);
  
  // 代码实操题专属状态
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  // AI 针对性出题专属状态
  const [dynamicType, setDynamicType] = useState<string>("quiz");
  const [dynamicDifficulty, setDynamicDifficulty] = useState<string>("medium");
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<string>("all");

  // 收藏状态
  const [isCollected, setIsCollected] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("cognilink_token");
      if (!token) {
        router.push("/login");
      }
    }
  }, [router]);

  const currentModel = SUPPORTED_MODELS.find((m) => m.id === model);
  const provider = currentModel?.provider || "openai";
  const apiKey = apiKeys[provider] || (provider === "openai" ? openaiApiKey : "") || "";

  // 1. 获取系统内置题库
  const fetchLabs = useCallback(async (mode: TabMode, filterNodeId?: string | null) => {
    setLoading(true);
    try {
      const data = await labApi.listLabs({ 
        lab_type: mode,
        node_id: filterNodeId || undefined
      });
      setLabs(data);
      if (data.length > 0) {
        const lab = await labApi.getLab(data[0].id);
        setSelectedLab(fullfillLabType(lab));
        setCode(lab.starter_code || "");
        setEvalResult(null);
        try {
          const subs = await labApi.getSubmissions(data[0].id);
          setSubmissions(subs);
        } catch {
          setSubmissions([]);
        }
      } else {
        setSelectedLab(null);
        setCode("");
        setSubmissions([]);
      }
    } catch (error) {
      console.error("Failed to fetch labs:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 2. 获取用户收藏的题目
  const fetchCollections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await collectionApi.listCollections();
      setCollections(data);
      if (data.length > 0) {
        const col = data[0];
        const mappedLab = {
          id: col.id,
          title: col.title,
          description: "",
          starter_code: "",
          test_cases: col.content,
          difficulty: "medium",
          lab_type: col.exercise_type,
          detailed_explanation: col.explanation,
          node_id: col.node_id
        };
        setSelectedLab(mappedLab);
        setIsCollected(true);
      } else {
        setSelectedLab(null);
      }
    } catch (error) {
      console.error("Failed to fetch collections:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 根据当前模式与过滤加载数据
  useEffect(() => {
    if (exerciseMode === "system") {
      fetchLabs(tabMode, nodeId);
    } else if (exerciseMode === "collection") {
      fetchCollections();
    } else {
      setSelectedLab(null);
      setEvalResult(null);
      setCode("");
    }
  }, [exerciseMode, tabMode, nodeId, fetchLabs, fetchCollections]);

  // 兼容老数据结构
  const fullfillLabType = (lab: Lab | null): Lab | null => {
    if (!lab) return null;
    return {
      ...lab,
      lab_type: lab.lab_type || "code"
    };
  };

  // 检查当前选中题目是否已收藏
  useEffect(() => {
    if (selectedLab && exerciseMode !== "collection") {
      collectionApi.checkIsCollected(selectedLab.title)
        .then((res) => setIsCollected(res.is_collected))
        .catch(() => setIsCollected(false));
    }
  }, [selectedLab, exerciseMode]);

  // 切换选中题目
  const handleSelectLab = async (lab: Lab) => {
    try {
      setLoading(true);
      const fullLab = await labApi.getLab(lab.id);
      setSelectedLab(fullfillLabType(fullLab));
      setCode(fullLab.starter_code || "");
      setEvalResult(null);
      try {
        const subs = await labApi.getSubmissions(lab.id);
        setSubmissions(subs);
      } catch {
        setSubmissions([]);
      }
    } catch (e) {
      console.error("Failed to load full lab:", e);
    } finally {
      setLoading(false);
    }
  };

  // 切换选中收藏题目
  const handleSelectCollection = (col: CollectionExercise) => {
    const mappedLab = {
      id: col.id,
      title: col.title,
      description: "",
      starter_code: "",
      test_cases: col.content,
      difficulty: "medium",
      lab_type: col.exercise_type,
      detailed_explanation: col.explanation,
      node_id: col.node_id
    };
    setSelectedLab(mappedLab);
    setIsCollected(true);
  };

  // 收藏与取消收藏切换
  const handleToggleCollect = async (lab: Lab | null) => {
    if (!lab) return;
    try {
      if (isCollected) {
        await collectionApi.uncollectExercise(lab.title);
        setIsCollected(false);
        if (exerciseMode === "collection") {
          fetchCollections();
        }
      } else {
        await collectionApi.collectExercise({
          title: lab.title,
          exercise_type: lab.lab_type || "code",
          content: lab.test_cases || {},
          answer: lab.answer || lab.test_cases?.pairs || lab.test_cases?.correct_order || lab.test_cases?.blanks || {},
          explanation: lab.detailed_explanation || "无解析",
          node_id: lab.node_id || undefined,
        });
        setIsCollected(true);
      }
    } catch (e) {
      console.error("Failed to toggle collect state:", e);
    }
  };

  // 生成 AI 自适应出题
  const handleGenerateExercise = async () => {
    setDynamicLoading(true);
    setEvalResult(null);
    try {
      const activeModel = SUPPORTED_MODELS.find((m) => m.id === model);
      const res = await labApi.generateLab({
        exercise_type: dynamicType,
        difficulty: dynamicDifficulty,
        subject: selectedSubject === "all" ? undefined : selectedSubject,
        node_id: nodeId || undefined,
        api_key: apiKey,
        model: model,
        base_url: activeModel?.provider ? baseUrls[activeModel.provider] : undefined,
      });

      const mappedLab = {
        id: res.id || "dynamic-lab",
        title: res.title || "AI 针对性测试题",
        description: res.description || "AI 自动生成题目，请按照提示解题。",
        starter_code: res.starter_code || "",
        test_cases: res.test_cases || {},
        difficulty: dynamicDifficulty,
        lab_type: dynamicType,
        detailed_explanation: res.detailed_explanation || "暂无解析说明",
        node_id: res.node_id || undefined
      };

      setSelectedLab(mappedLab);
      setCode(mappedLab.starter_code || "");
    } catch (e) {
      console.error("Failed to generate dynamic exercise:", e);
      alert("AI 生成题目失败，请检查设置中的 LLM API Key 及网络状况。");
    } finally {
      setDynamicLoading(false);
    }
  };

  // 提交代码题评测
  const handleSubmitCode = async () => {
    if (!selectedLab) return;
    setSubmitting(true);
    setEvalResult(null);
    try {
      const activeModel = SUPPORTED_MODELS.find((m) => m.id === model);
      const res = await labApi.submitLab(
        selectedLab.id,
        code,
        apiKey,
        model,
        activeModel?.provider ? baseUrls[activeModel.provider] : undefined,
      );
      setEvalResult(res);
      
      try {
        const subs = await labApi.getSubmissions(selectedLab.id);
        setSubmissions(subs);
      } catch {}
    } catch (error) {
      console.error("Failed to submit code:", error);
      setEvalResult({
        status: "error",
        score: 0,
        feedback: "网络评测超时或 LLM 接口运行异常，请稍后重试。"
      });
    } finally {
      setSubmitting(false);
    }
  };

  // 提交概念题（选择/排序/连线/填空）评测
  const handleRendererSubmit = async (answers: Record<string, unknown>) => {
    if (!selectedLab) return;
    setSubmitting(true);
    setEvalResult(null);
    try {
      const activeModel = SUPPORTED_MODELS.find((m) => m.id === model);
      const res = await labApi.evaluateDynamic({
        exercise: selectedLab as unknown as Record<string, unknown>,
        answers,
        node_id: selectedLab.node_id,
        api_key: apiKey,
        model: model,
        base_url: activeModel?.provider ? baseUrls[activeModel.provider] : undefined,
      });

      setEvalResult(res);

      if (res.score >= 60 && selectedLab.node_id) {
        await reportDynamicKnowledgeLighted(selectedLab, answers);
      }
    } catch (e) {
      console.error("Failed to evaluate concept exercise:", e);
      setEvalResult({
        status: "error",
        score: 0,
        feedback: "智能评测接口运行超时，请稍后重试。"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const reportDynamicKnowledgeLighted = async (lab: Lab, answers: Record<string, unknown>) => {
    if (lab.lab_type === "quiz") {
      try {
        const labData = lab as unknown as {
          test_cases?: { questions?: QuizQuestion[] };
          questions?: QuizQuestion[];
        };
        const questionItem = (labData.test_cases?.questions?.[0] || labData.questions?.[0] || lab) as QuizQuestion;
        const singleAnswer = { [questionItem.id || "0"]: answers[questionItem.id || "0"] };
        const activeModel = SUPPORTED_MODELS.find((m) => m.id === model);

        await labApi.submitLab(
          lab.id,
          "",
          apiKey,
          model,
          activeModel?.provider ? baseUrls[activeModel.provider] : undefined,
          singleAnswer as Record<string, number>,
        );
      } catch (e) {
        console.error("Failed to submit dynamic progress:", e);
      }
    }
  };

  return (
    <UserLayout activePath="/practice">
      {/* 羊皮纸米黄背景，细方格格纹 */}
      <div className="flex-1 overflow-y-auto bg-[#fdfaf2] dark:bg-[#181611] flex flex-col bg-[linear-gradient(rgba(139,90,43,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(139,90,43,0.02)_1px,transparent_1px)] bg-[size:24px_24px]">
        
        {/* Header with Modes */}
        <div className="p-8 pb-4 shrink-0 border-b-2 border-black bg-white/70 dark:bg-zinc-950/70 backdrop-blur-sm relative z-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-black dark:text-white">在线练习</h1>
              <p className="text-sm font-semibold text-zinc-550 dark:text-zinc-400 mt-1">
                点击内置题库或呼叫 AI 自动出题，在实战解题中积累经验点亮星盘。
              </p>
            </div>
            
            {/* Mode Switcher */}
            <div className="flex items-center gap-1.5 p-1 bg-zinc-100 dark:bg-zinc-800 border-2 border-black rounded-2xl max-w-sm">
              <button
                onClick={() => setExerciseMode("system")}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all border-2 ${
                  exerciseMode === "system"
                    ? "bg-amber-100 dark:bg-zinc-700 border-black text-black dark:text-amber-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    : "border-transparent text-zinc-550 dark:text-zinc-400 hover:text-black"
                }`}
              >
                <Grid3X3 className="h-3.5 w-3.5" />
                内置题库
              </button>
              <button
                onClick={() => setExerciseMode("dynamic")}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all border-2 ${
                  exerciseMode === "dynamic"
                    ? "bg-amber-100 dark:bg-zinc-700 border-black text-black dark:text-amber-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    : "border-transparent text-zinc-550 dark:text-zinc-400 hover:text-black"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI 针对出题
              </button>
              <button
                onClick={() => setExerciseMode("collection")}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all border-2 ${
                  exerciseMode === "collection"
                    ? "bg-amber-100 dark:bg-zinc-700 border-black text-black dark:text-amber-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    : "border-transparent text-zinc-550 dark:text-zinc-400 hover:text-black"
                }`}
              >
                <FolderHeart className="h-3.5 w-3.5" />
                收藏夹
              </button>
            </div>
          </div>
        </div>

        {/* Workspace */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 p-8 gap-6">

          {/* Left Panel */}
          <div className="w-full md:w-72 shrink-0 bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 overflow-y-auto flex flex-col gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            
            {exerciseMode === "system" && (
              <>
                {/* 题型细分选择 */}
                <div className="flex items-center gap-1.5 border-b-2 border-dashed border-black/10 pb-3 mb-1 overflow-x-auto">
                  {["code", "quiz", "match", "arrange", "fill"].map((type) => (
                    <button
                      key={type}
                      onClick={() => setTabMode(type as TabMode)}
                      className={`px-2.5 py-1.5 rounded-xl text-[10px] font-black capitalize transition-all border-2 ${
                        tabMode === type
                          ? "bg-amber-100 border-black text-black shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]"
                          : "bg-zinc-100 dark:bg-zinc-800 border-transparent text-zinc-500 hover:bg-zinc-150"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                <h3 className="text-xs font-black text-black dark:text-white px-1">
                  当前题型题库
                </h3>
                
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
                  </div>
                ) : labs.length === 0 ? (
                  <p className="text-xs font-bold text-zinc-400 text-center py-8">该类别暂无内置题目</p>
                ) : (
                  <div className="space-y-2 flex-1 overflow-y-auto pr-1">
                    {labs.map((lab) => (
                      <button
                        key={lab.id}
                        onClick={() => handleSelectLab(lab)}
                        className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-2xl text-left text-xs transition-all border-2 ${
                          selectedLab?.id === lab.id
                            ? "bg-amber-50/60 border-black text-black font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] animate-in fade-in duration-200"
                            : "bg-transparent border-transparent text-zinc-550 dark:text-zinc-400 hover:bg-zinc-100/50"
                        }`}
                      >
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{lab.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {exerciseMode === "collection" && (
              <>
                <h3 className="text-xs font-black text-black dark:text-white border-b-2 border-dashed border-black/10 pb-2 px-1">
                  我的收藏题库
                </h3>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
                  </div>
                ) : collections.length === 0 ? (
                  <p className="text-xs font-bold text-zinc-400 text-center py-8">收藏夹暂无题目</p>
                ) : (
                  <div className="space-y-2 flex-1 overflow-y-auto pr-1">
                    {collections.map((col) => (
                      <button
                        key={col.id}
                        onClick={() => handleSelectCollection(col)}
                        className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-2xl text-left text-xs transition-all border-2 ${
                          selectedLab?.id === col.id
                            ? "bg-amber-50/60 border-black text-black font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                            : "bg-transparent border-transparent text-zinc-550 dark:text-zinc-400 hover:bg-zinc-100/50"
                        }`}
                      >
                        <Star className="h-3.5 w-3.5 shrink-0 text-amber-500 fill-current" />
                        <span className="truncate">{col.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {exerciseMode === "dynamic" && (
              <div className="space-y-4 font-sans">
                <h3 className="text-xs font-black text-black dark:text-white border-b-2 border-dashed border-black/10 pb-2 px-1 flex items-center gap-1.5">
                  <Sparkles className="h-4.5 w-4.5 text-purple-500 animate-pulse" />
                  AI 自适应出题
                </h3>

                {/* 题型选择 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-zinc-500">选择练习题型</label>
                  <select
                    value={dynamicType}
                    onChange={(e) => setDynamicType(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-800 border-2 border-black rounded-2xl shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] outline-none"
                  >
                    <option value="quiz">概念选择题 (Quiz)</option>
                    <option value="match">概念生活类比连线题 (Match)</option>
                    <option value="arrange">流程逻辑排序题 (Arrange)</option>
                    <option value="fill">概念关键字填空题 (Fill)</option>
                    <option value="code">代码实操编程题 (Code)</option>
                  </select>
                </div>

                {/* 科目选择 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-zinc-500">选择出题科目</label>
                  <select
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-800 border-2 border-black rounded-2xl shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] outline-none"
                  >
                    <option value="all">智能推荐 (全部)</option>
                    <option value="programming">终端游戏与工具</option>
                    <option value="dsa">益智游戏数据</option>
                    <option value="organization">街机游戏设计</option>
                    <option value="os">实时动作并发</option>
                    <option value="network">联机对战服务</option>
                    <option value="database">数据与工程</option>
                  </select>
                </div>

                {/* 难度选择 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-zinc-500">选择题目难度</label>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 border-2 border-black rounded-xl">
                    {["easy", "medium", "hard"].map((diff) => (
                      <button
                        key={diff}
                        onClick={() => setDynamicDifficulty(diff)}
                        className={`py-1.5 rounded-lg text-[9px] font-black capitalize transition-all ${
                          dynamicDifficulty === diff
                            ? "bg-white dark:bg-zinc-700 text-black dark:text-white border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                            : "text-zinc-500 hover:text-black"
                        }`}
                      >
                        {diff}
                      </button>
                    ))}
                  </div>
                </div>

                {nodeId && (
                  <div className="bg-[#fcfaf2] dark:bg-zinc-800/40 p-3 rounded-2xl border-2 border-black text-[10px] font-bold text-zinc-650 dark:text-zinc-400 leading-normal shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    已选定聚焦知识节点，AI 将针对性围绕该节点及其依赖链出题。
                  </div>
                )}

                {/* 生成出题大按钮 */}
                <button
                  onClick={handleGenerateExercise}
                  disabled={dynamicLoading}
                  className="w-full py-3 bg-indigo-500 hover:bg-indigo-400 border-2 border-black text-white rounded-2xl text-xs font-black transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {dynamicLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Agent 动态出题中...
                    </>
                  ) : (
                    <>
                      <Brain className="h-3.5 w-3.5" />
                      呼叫 AI Agent 出题
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Right Panel */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {dynamicLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-400">
                <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
                <span className="text-xs font-bold">AI Agent 正在根据您的学情以及知识库内容进行趣味出题...</span>
              </div>
            ) : !selectedLab ? (
              <div className="flex items-center justify-center h-full text-zinc-400 font-bold text-xs bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                {exerciseMode === "dynamic" ? "请选择左侧的题型难度并呼叫 AI Agent 智能出题！" : "请从左侧选择题目开始"}
              </div>
            ) : selectedLab.lab_type === "code" ? (
              /* Code Mode Editor */
              <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-6 flex flex-col gap-4 h-full shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] font-sans">
                
                {/* Lab Info */}
                <div className="flex items-start justify-between gap-4 border-b-2 border-dashed border-black/10 pb-4">
                  <div>
                    <h2 className="text-base font-black text-black dark:text-white">{selectedLab.title}</h2>
                    {selectedLab.description && (
                      <p className="text-xs font-bold text-zinc-550 dark:text-zinc-400 mt-2 leading-relaxed">{selectedLab.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-amber-100 border-2 border-black text-black uppercase tracking-wider shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                        {selectedLab.difficulty || "medium"}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-indigo-50 border-2 border-black text-indigo-650 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                        Code Challenge
                      </span>
                    </div>
                  </div>

                  {handleToggleCollect && (
                    <button
                      onClick={() => handleToggleCollect(selectedLab)}
                      className={cn(
                        "p-2.5 rounded-2xl border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] cursor-pointer",
                        isCollected
                          ? "bg-amber-300 text-black"
                          : "bg-white dark:bg-zinc-800 text-zinc-400 hover:bg-zinc-50"
                      )}
                    >
                      <Star className={cn("h-4.5 w-4.5", isCollected && "fill-current")} />
                    </button>
                  )}
                </div>

                {/* Code Editor */}
                <div className="flex-1 min-h-[350px] bg-[#1e1e1e] border-2 border-black rounded-2xl flex flex-col overflow-hidden shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  {/* IDE Window Header */}
                  <div className="bg-[#252526] border-b-2 border-black px-4 py-2.5 flex items-center justify-between select-none">
                    {/* Left Window Control Dots */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] border border-black/20" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-black/20" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] border border-black/20" />
                    </div>
                    
                    {/* Middle File Tab */}
                    <div className="flex items-center gap-2 bg-[#1e1e1e] border-t-2 border-x-2 border-black px-4 py-1.5 text-[10px] text-slate-350 rounded-t-lg -mb-[11px] z-10 font-mono font-bold">
                      <span className="text-lime-500 font-bold font-mono">Py</span>
                      <span>solution.py</span>
                    </div>

                    {/* Right IDE Status */}
                    <div className="text-[9px] text-slate-500 font-mono font-medium">
                      UTF-8 | LF | Python 3.11
                    </div>
                  </div>

                  {/* Editor Content Area */}
                  <div className="flex-1 flex overflow-hidden relative">
                    {/* Left Line Numbers Rail */}
                    <div className="w-10 bg-[#1e1e1e] text-[#858585] text-right pr-2 py-4 font-mono text-xs select-none border-r border-[#2d2d2d] leading-6">
                      {(() => {
                        const lineCount = Math.max((code || "").split("\n").length, 12);
                        return Array.from({ length: lineCount }).map((_, i) => (
                          <div key={i} className="h-6">
                            {i + 1}
                          </div>
                        ));
                      })()}
                    </div>

                    {/* Right Code Input Area */}
                    <textarea
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="flex-1 p-4 font-mono text-xs bg-[#1e1e1e] text-[#f8f8f2] focus:outline-none resize-none leading-6 placeholder:text-slate-650 caret-indigo-400 antialiased"
                      placeholder="def solution():\n    # 在此编写 Python 代码..."
                      spellCheck={false}
                      style={{
                        lineHeight: "24px",
                      }}
                    />
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold text-zinc-400">
                    {apiKey ? "🔑 LLM API Key 已配置" : "⚠️ 请在设置中配置 API Key"}
                  </div>
                  <Button
                    onClick={handleSubmitCode}
                    disabled={submitting || !code}
                    className="text-xs bg-indigo-500 hover:bg-indigo-400 border-2 border-black text-white rounded-2xl px-6 h-10 font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        AI 自动测试中...
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5 mr-1.5" />
                        提交评测
                      </>
                    )}
                  </Button>
                </div>

                {/* Evaluation Result */}
                {evalResult && (
                  <div className="bg-white dark:bg-zinc-800 rounded-2xl border-2 border-black p-4 space-y-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full border-2 border-black flex items-center justify-center font-black text-xs text-white ${
                        evalResult.status === "passed" ? "bg-green-500 text-black" :
                        evalResult.status === "partial" ? "bg-amber-450 text-black" :
                        evalResult.status === "failed" ? "bg-rose-500 text-white" : "bg-zinc-500 text-white"
                      }`}>
                        {evalResult.score}
                      </div>
                      <div>
                        <h4 className="font-black text-xs text-black dark:text-white">
                          评测结果: {evalResult.status === "passed" ? "全部通过" : evalResult.status === "partial" ? "部分通过" : evalResult.status === "failed" ? "未通过" : "执行错误"}
                        </h4>
                        <p className="text-[10px] font-bold text-zinc-550 dark:text-zinc-400 mt-1">{evalResult.feedback}</p>
                      </div>
                    </div>
                    {(evalResult.evaluation_result?.issues?.length ?? 0) > 0 && (
                      <div className="space-y-1 border-t-2 border-dashed border-black/10 pt-2.5">
                        <p className="text-[10px] font-black text-rose-600">发现的问题:</p>
                        {evalResult.evaluation_result?.issues?.map((issue: string, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-[10px] font-bold text-zinc-500">
                            <X className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
                            <span>{issue}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(evalResult.evaluation_result?.suggestions?.length ?? 0) > 0 && (
                      <div className="space-y-1 border-t-2 border-dashed border-black/10 pt-2.5">
                        <p className="text-[10px] font-black text-green-600">优化建议:</p>
                        {evalResult.evaluation_result?.suggestions?.map((sug: string, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-[10px] font-bold text-zinc-500">
                            <Check className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                            <span>{sug}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Submission History */}
                {submissions.length > 0 && (
                  <div className="bg-white dark:bg-zinc-800 rounded-2xl border-2 border-black p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <h4 className="text-[10px] font-black text-black dark:text-white mb-2">历史评测记录</h4>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto font-mono">
                      {submissions.slice(0, 5).map((sub) => (
                        <div key={sub.id} className="flex items-center justify-between text-[10px] font-bold px-2.5 py-1.5 rounded-xl border border-black/10 bg-zinc-50 dark:bg-zinc-900/50">
                          <span className="text-zinc-400">{new Date(sub.created_at).toLocaleString()}</span>
                          <span className={`font-black ${sub.status === "passed" ? "text-green-600" : sub.status === "failed" ? "text-rose-500" : "text-zinc-500"}`}>
                            {sub.score}分 · {sub.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Other Interactive Question Types */
              (() => {
                const displayLabs = labs.map((l: Lab) => (selectedLab && l.id === selectedLab.id) ? selectedLab : l);
                return (
                  <ExerciseRenderer
                    labs={exerciseMode === "system" ? displayLabs : selectedLab ? [selectedLab] : []}
                    activeLabId={selectedLab?.id}
                    onSubmit={handleRendererSubmit}
                    isCollected={isCollected}
                    onToggleCollect={handleToggleCollect}
                  />
                );
              })()
            )}
          </div>
        </div>
      </div>
    </UserLayout>
  );
}

export default function PracticePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfaf2] gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
          <span className="text-xs font-bold text-zinc-400">构建练习环境中...</span>
        </div>
      }
    >
      <PracticeContent />
    </Suspense>
  );
}
