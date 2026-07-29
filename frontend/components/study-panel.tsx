"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Sparkles, ArrowRight, Loader2, RefreshCw, CheckCircle, XCircle, Award, HelpCircle } from "lucide-react";
import { labApi } from "@/lib/api";
import { useSettingsStore, SUPPORTED_MODELS } from "@/stores/settings";
import type { RecommendedNode } from "@/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface RadarData {
  indicators: { name: string; max: number }[];
  values: {
    direction: string;
    coverage: number;
    proficiency: number;
    lighted: number;
    total: number;
  }[];
}

// Quiz 题目项
interface QuizQuestion {
  id?: string;
  text?: string;
  question?: string;
  options?: string[];
  answer?: number;
  explanation?: string;
}

// Quiz 数据
interface QuizData {
  id?: string;
  node_id?: string;
  node_name?: string;
  test_cases?: { questions?: QuizQuestion[] };
  questions?: QuizQuestion[];
}

// Quiz 评测结果
interface QuizEvalResult {
  score: number;
  feedback?: string;
}

interface StudyPanelProps {
  recommendedNodes: RecommendedNode[];
  radarData: RadarData | null;
  onSelectNode: (nodeId: string) => void;
  onQuizPassed?: () => void; // Quiz 回答正确后的回调，用于刷新技能树
  selectedNodeId?: string; // 当前选中的知识节点 ID，Quick Quiz 为该节点出题
}

// 高级卡通糖果色映射
const CATEGORY_COLORS: Record<string, string> = {
  programming: "#84cc16",   // 柠檬绿
  dsa: "#f43f5e",           // 玫瑰红
  organization: "#0ea5e9",  // 蔚蓝色
  os: "#f97316",            // 活力橙
  network: "#a855f7",       // 浆果紫
  database: "#10b981",      // 薄荷绿
};

const CATEGORY_NAMES: Record<string, string> = {
  programming: "终端与工具",
  dsa: "算法与结构",
  organization: "硬件设计",
  os: "并发与系统",
  network: "联机对战",
  database: "数据与工程",
  Other: "其他探索",
};

export default function StudyPanel({
  recommendedNodes,
  radarData,
  onSelectNode,
  onQuizPassed,
  selectedNodeId,
}: StudyPanelProps) {
  const [mounted, setMounted] = useState(false);
  
  // Quiz 状态
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [evalResult, setEvalResult] = useState<QuizEvalResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const { model, baseUrls, getEffectiveApiKey } = useSettingsStore();
  const apiKey = getEffectiveApiKey();

  useEffect(() => {
    setMounted(true);
  }, []);

  // 懒加载加载第一个 Quiz，选中节点变化时重新出题
  useEffect(() => {
    if (mounted) {
      loadQuiz();
    }
  }, [mounted, selectedNodeId]);

  const loadQuiz = async () => {
    setIsLoadingQuiz(true);
    setSelectedAnswer(null);
    setEvalResult(null);
    try {
      const activeModel = SUPPORTED_MODELS.find((m) => m.id === model);
      const res = await labApi.generateLab({
        exercise_type: "quiz",
        api_key: apiKey,
        model: model,
        base_url: activeModel?.provider ? baseUrls[activeModel.provider] : undefined,
        node_id: selectedNodeId,
      });
      setQuiz(res);
    } catch (err) {
      console.error("Failed to generate targeted quiz:", err);
    } finally {
      setIsLoadingQuiz(false);
    }
  };

  const handleAnswerClick = async (ansIndex: number) => {
    if (isEvaluating || evalResult || !quiz) return;
    setSelectedAnswer(ansIndex);
    setIsEvaluating(true);
    try {
      const activeModel = SUPPORTED_MODELS.find((m) => m.id === model);
      const questionItem: QuizQuestion = (quiz.test_cases?.questions?.[0] || quiz.questions?.[0] || quiz) as QuizQuestion;
      
      const res = await labApi.evaluateDynamic({
        exercise: quiz as Record<string, unknown>,
        answers: { [questionItem.id || "0"]: ansIndex },
        node_id: quiz.node_id,
        api_key: apiKey,
        model: model,
        base_url: activeModel?.provider ? baseUrls[activeModel.provider] : undefined,
      });
      setEvalResult(res);
      
      if (res.score >= 60 && onQuizPassed) {
        onQuizPassed();
      }
    } catch (err) {
      console.error("Failed to evaluate quiz answer:", err);
    } finally {
      setIsEvaluating(false);
    }
  };

  // 绘制迷你版雷达图的配置 (Neo-brutalism 卡通小指示木牌)
  const radarOption = radarData
    ? {
        backgroundColor: "transparent",
        tooltip: {
          trigger: "item",
          backgroundColor: "rgba(253, 250, 242, 0.95)",
          borderWidth: 2,
          borderColor: "#000000",
          textStyle: { color: "#000000", fontSize: 10, fontWeight: "bold" },
          extraCssText: "box-shadow: 2px 2px 0px 0px rgba(0,0,0,1); border-radius: 8px;",
        },
        radar: {
          indicator: radarData.indicators.map((ind) => ({
            name: CATEGORY_NAMES[ind.name] || ind.name,
            max: ind.max,
          })),
          shape: "polygon",
          radius: "55%",
          axisName: {
            color: "#000000",
            fontSize: 8,
            fontWeight: "bold",
            backgroundColor: "#fdfaf2",
            borderColor: "#000000",
            borderWidth: 1.5,
            borderRadius: 6,
            padding: [2, 4],
            shadowBlur: 0,
            shadowOffsetX: 1.5,
            shadowOffsetY: 1.5,
            shadowColor: "#000000",
          },
          splitArea: {
            areaStyle: {
              color: [
                "rgba(139, 90, 43, 0.01)",
                "rgba(139, 90, 43, 0.03)",
                "rgba(139, 90, 43, 0.05)",
                "rgba(139, 90, 43, 0.07)",
                "rgba(139, 90, 43, 0.1)",
              ],
            },
          },
          axisLine: { lineStyle: { color: "rgba(0, 0, 0, 0.15)", width: 1.5 } },
          splitLine: { lineStyle: { color: "rgba(0, 0, 0, 0.08)", width: 1 } },
        },
        series: [
          {
            name: "能力画像",
            type: "radar",
            data: [
              {
                value: radarData.values.map((v) => v.coverage),
                name: "知识覆盖率 (%)",
                symbol: "none",
                itemStyle: { color: "#3b82f6" },
                areaStyle: { color: "rgba(59, 130, 246, 0.2)" },
                lineStyle: { width: 1.5, color: "#3b82f6" },
              },
              {
                value: radarData.values.map((v) => v.proficiency),
                name: "平均熟练度 (%)",
                symbol: "none",
                itemStyle: { color: "#10b981" },
                areaStyle: { color: "rgba(16, 185, 129, 0.15)" },
                lineStyle: { width: 1.5, color: "#10b981" },
              },
            ],
          },
        ],
      }
    : null;

  const question: QuizQuestion = (quiz?.test_cases?.questions?.[0] || quiz?.questions?.[0] || quiz) as QuizQuestion;

  return (
    <div className="flex flex-col gap-5 min-w-0 font-sans">
      {/* 模块一：今日推荐学习路径 */}
      <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all">
        <h3 className="text-xs font-black text-black dark:text-white mb-3 flex items-center gap-1.5">
          <Sparkles className="h-4.5 w-4.5 text-amber-500" />
          今日自适应推荐路径
        </h3>

        {recommendedNodes.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-xs font-bold text-zinc-400">太棒了！当前领域均已掌握</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {recommendedNodes.slice(0, 3).map((node) => {
              const borderCol = CATEGORY_COLORS[node.category] || "#6366f1";
              return (
                <div
                  key={node.id}
                  onClick={() => onSelectNode(node.id)}
                  className="group p-3 bg-zinc-50 dark:bg-zinc-800/40 hover:bg-amber-50/30 border-2 border-black rounded-2xl transition-all cursor-pointer flex justify-between items-start gap-2.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full border border-black shrink-0" style={{ backgroundColor: borderCol }} />
                      <span className="font-extrabold text-xs text-black dark:text-zinc-200 truncate block">
                        {node.name}
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-zinc-500 dark:text-zinc-500 mt-1.5 line-clamp-2 leading-relaxed">
                      {node.reason || node.description}
                    </p>
                  </div>
                  <button className="text-zinc-400 group-hover:text-black transition-colors p-0.5 mt-0.5">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 模块二：快速 Quiz 挑战 */}
      <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col min-h-[220px] transition-all">
        <div className="flex items-center justify-between mb-3 border-b-2 border-dashed border-black/10 pb-2">
          <h3 className="text-xs font-black text-black dark:text-white flex items-center gap-1.5">
            <HelpCircle className="h-4.5 w-4.5 text-purple-500" />
            快速 Quiz 实战
          </h3>
          {quiz && (
            <button
              onClick={loadQuiz}
              className="p-1 text-zinc-400 hover:text-black transition-colors hover:rotate-180 duration-500 rounded-lg cursor-pointer"
              title="刷新题目"
              disabled={isLoadingQuiz || isEvaluating}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {isLoadingQuiz ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2">
            <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
            <p className="text-[10px] font-bold text-zinc-400">正在生成关卡问题...</p>
          </div>
        ) : !quiz ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2">
            <p className="text-xs font-bold text-zinc-400">无法生成题目</p>
            <button
              onClick={loadQuiz}
              className="text-xs font-bold text-amber-600 underline cursor-pointer"
            >
              重试加载
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-between">
            <div>
              {/* 关联的知识节点 */}
              {quiz.node_name && (
                <span className="text-[9px] bg-purple-100/50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 font-black px-2 py-0.5 rounded-full border-2 border-black w-fit block mb-2 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                  突破口: {quiz.node_name}
                </span>
              )}
              {/* 问题题干 */}
              <p className="text-xs font-black text-black dark:text-zinc-200 leading-normal mb-3">
                {question?.text || "请回答以下问题"}
              </p>

              {/* 选项 */}
              <div className="space-y-2">
                {(question?.options || []).map((optionText: string, oIdx: number) => {
                  const isSelected = selectedAnswer === oIdx;
                  const isCorrect = (evalResult?.score ?? 0) >= 60;
                  
                  let optionStyle = "border-2 border-black bg-white dark:bg-zinc-900 text-black dark:text-zinc-300 hover:bg-amber-50/20 cursor-pointer shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]";
                  if (isSelected) {
                    if (isEvaluating) {
                      optionStyle = "border-2 border-black bg-amber-100/50 text-black animate-pulse shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]";
                    } else if (evalResult) {
                      optionStyle = isCorrect
                        ? "border-2 border-black bg-green-200 text-black font-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                        : "border-2 border-black bg-rose-200 text-black font-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]";
                    } else {
                      optionStyle = "border-2 border-black bg-amber-100 text-black font-black shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]";
                    }
                  } else if (evalResult && oIdx === question.answer) {
                    // 显示正确答案
                    optionStyle = "border-2 border-black bg-green-200 text-black font-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]";
                  }

                  return (
                    <button
                      key={oIdx}
                      disabled={isEvaluating || evalResult !== null}
                      onClick={() => handleAnswerClick(oIdx)}
                      className={`w-full text-left p-2.5 rounded-2xl text-[11px] leading-tight border-2 transition-all flex items-start gap-2 ${optionStyle}`}
                    >
                      <span className="font-extrabold opacity-60 uppercase">{String.fromCharCode(65 + oIdx)}.</span>
                      <span className="font-bold">{optionText}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 评测结果与解析 */}
            {evalResult && (
              <div className="mt-3.5 pt-3.5 border-t-2 border-dashed border-black/10 animate-in fade-in duration-200 flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  {(evalResult?.score ?? 0) >= 60 ? (
                    <div className="flex items-center gap-1 text-green-600 dark:text-green-400 text-[11px] font-black">
                      <CheckCircle className="h-4.5 w-4.5" />
                      回答正确！已激活相应星系
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-rose-600 dark:text-rose-400 text-[11px] font-black">
                      <XCircle className="h-4.5 w-4.5" />
                      回答错误，再接再厉！
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 leading-relaxed bg-[#fcfaf2] p-2.5 rounded-2xl border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  <span className="font-black text-black block mb-1">💡 树灵解析：</span>
                  {evalResult.feedback || "回答本题需要掌握对应的计算机核心基础原理。"}
                </p>
                <button
                  onClick={loadQuiz}
                  className="w-full mt-2 py-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl text-xs font-black transition-colors cursor-pointer text-center border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                >
                  挑战下一题
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 模块三：能力雷达图 */}
      <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col h-[220px] transition-all">
        <h3 className="text-xs font-black text-black dark:text-white mb-2 flex items-center gap-1.5 shrink-0">
          <Award className="h-4.5 w-4.5 text-sky-500" />
          熟练度雷达图
        </h3>
        <div className="flex-1 min-h-0 relative">
          {mounted && radarOption ? (
            <ReactECharts option={radarOption} style={{ height: "100%", width: "100%" }} />
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-400 font-bold text-xs">雷达图渲染中...</div>
          )}
        </div>
      </div>
    </div>
  );
}
