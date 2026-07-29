"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, RefreshCw, X, Sparkles } from "lucide-react";
import UserLayout from "@/components/user-layout";
import XpProgressBar from "@/components/xp-progress-bar";
import SkillTree from "@/components/skill-tree";
import StudyPanel from "@/components/study-panel";
import { knowledgeApi, onboardingApi, profileApi } from "@/lib/api";
import ReviewTodayCard from "@/components/review-today-card";
import { useChatAssistantStore } from "@/stores/chat-assistant";
import type { KnowledgeNode, RecommendedNode, ProfileStats, GraphRelation, RadarData, KnowledgeBase } from "@/types";
import { CATEGORY_COLORS } from "@/components/skill-node";

const CATEGORY_NAMES: Record<string, string> = {
  dsa: "益智游戏数据",
  os: "实时动作并发",
  network: "联机对战服务",
  database: "数据与工程",
  programming: "终端游戏与工具",
  organization: "街机游戏设计",
};

export default function DashboardPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nickname, setNickname] = useState("");

  // 数据 States
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [relations, setRelations] = useState<GraphRelation[]>([]);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [radar, setRadar] = useState<RadarData | null>(null);
  const [recommends, setRecommends] = useState<RecommendedNode[]>([]);
  
  // 知识库分类切换
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [activeKbId, setActiveKbId] = useState<string>("");

  // 节点焦点聚焦
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);

  const openAssistant = useChatAssistantStore((state) => state.openAssistant);

  // 根据当前时段生成动态问候语
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

  // 引导状态：0 未完成（重定向向导）/ 1 已跳过（显示补做入口）/ 2 已诊断
  const [onboardingState, setOnboardingState] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("cognilink_token");
      if (!token) {
        router.push("/login");
        return;
      }
      setNickname(localStorage.getItem("cognilink_user_nickname") || "学生");
      onboardingApi
        .getStatus()
        .then((res: { onboarding_completed: number }) => {
          setOnboardingState(res.onboarding_completed);
          if (res.onboarding_completed === 0) {
            router.replace("/onboarding");
          }
        })
        .catch((e) => console.error("Failed to load onboarding status:", e));
    }
  }, [router]);

  const fetchDashboardData = useCallback(async (isRefresh = false, kbId = activeKbId) => {
    try {
      if (!isRefresh) setLoading(true);
      const [graphData, statsData, radarData, recommendsData] = await Promise.all([
        knowledgeApi.getGraph(kbId || undefined),
        profileApi.getStats(),
        profileApi.getRadar(),
        knowledgeApi.recommendLearningPath(),
      ]);

      setNodes(graphData.nodes || []);
      setRelations(graphData.relations || []);
      setStats(statsData);
      setRadar(radarData);
      setRecommends(recommendsData || []);
      
      if (selectedNode) {
        const freshNode = (graphData.nodes || []).find((n: KnowledgeNode) => n.id === selectedNode.id);
        if (freshNode) setSelectedNode(freshNode);
      }
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedNode, activeKbId]);

  useEffect(() => {
    if (mounted) {
      fetchDashboardData(false, activeKbId);
      knowledgeApi.listKnowledgeBases()
        .then((res) => {
          setKnowledgeBases(res || []);
        })
        .catch((err) => console.error("Failed to list knowledge bases:", err));
    }
  }, [mounted, activeKbId, fetchDashboardData]);

  const handleNodeSelect = (node: KnowledgeNode) => {
    router.push(`/practice?nodeId=${node.id}`);
  };

  const handleRecommendSelect = (nodeId: string) => {
    const nodeObj = nodes.find((n) => n.id === nodeId);
    if (nodeObj) {
      setSelectedNode(nodeObj);
    }
  };

  const handleRecomputePageRank = async () => {
    try {
      setLoading(true);
      await knowledgeApi.computePageRank();
      await fetchDashboardData(true);
    } catch (error) {
      console.error("Failed to compute PageRank weights:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <UserLayout activePath="/dashboard">
      {/* 外层容器：羊皮纸米黄背景，细方格格纹 */}
      <div className="flex-1 overflow-hidden bg-[#fdfaf2] dark:bg-[#181611] flex flex-col relative bg-[linear-gradient(rgba(139,90,43,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(139,90,43,0.02)_1px,transparent_1px)] bg-[size:24px_24px]">

        {/* 顶部固定区：Header 标题栏 + XP 进度条 */}
        <div className="shrink-0 px-6 pt-5 pb-4 flex flex-col gap-4 border-b-2 border-black bg-white/70 dark:bg-zinc-950/70 backdrop-blur-sm relative z-10">
          
          {/* 头部标题与重算权重按钮 */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-black dark:text-zinc-100 flex items-center gap-2.5">
                <Sparkles className="h-6 w-6 text-amber-500" />
                {greeting}，{nickname}
              </h1>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mt-1.5 ml-8.5">
                欢迎回到 Python 经典游戏实训大本营 — 点亮蜂巢，解锁技能
              </p>
            </div>
            
            <div className="flex items-center gap-3 font-sans">
              {/* 知识库分类选择框 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-600 font-bold">当前学习:</span>
                <select
                  value={activeKbId}
                  onChange={(e) => setActiveKbId(e.target.value)}
                  className="px-3 py-1.5 bg-white dark:bg-zinc-800 border-2 border-black rounded-2xl text-xs font-black text-black dark:text-zinc-300 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] outline-none cursor-pointer min-w-[200px]"
                >
                  <option value="">🐍 Python 经典游戏实训大本营</option>
                  {knowledgeBases.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      📚 {kb.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleRecomputePageRank}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-800 hover:bg-amber-50 border-2 border-black rounded-2xl text-xs font-black text-black dark:text-zinc-300 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                disabled={loading}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                重算学习曲线
              </button>
            </div>
          </div>

          {/* XP 进度条 */}
          {stats && <XpProgressBar stats={stats} nickname={nickname} />}
        </div>

        {/* 下方主体：左右双栏，各自独立滚动 */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
            <p className="text-xs font-bold text-zinc-400">正在构建自适应技能树和雷达画像...</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">

            {/* 左侧：蜂巢技能树 */}
            <div className="flex-1 overflow-auto p-4 md:p-6 min-h-[500px] lg:min-h-0 relative">
              <SkillTree
                nodes={nodes}
                relations={relations}
                onNodeSelect={handleNodeSelect}
              />

              {/* 悬浮聚焦知识节点 Drawer/Card */}
              {selectedNode && (
                <div className="absolute bottom-4 left-4 z-20 w-80 bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-3 animate-in slide-in-from-bottom-4 duration-300 font-sans">
                  <div className="flex items-start justify-between">
                    <div>
                      <span
                        className="text-[9px] font-black px-2 py-0.5 rounded-full border border-black"
                        style={{
                          backgroundColor: `${CATEGORY_COLORS[selectedNode.category] || "#6366f1"}25`,
                          color: CATEGORY_COLORS[selectedNode.category] || "#6366f1",
                        }}
                      >
                        {CATEGORY_NAMES[selectedNode.category] || "其它领域"}
                      </span>
                      <h4 className="font-black text-sm text-black dark:text-zinc-100 mt-2">
                        {selectedNode.name}
                      </h4>
                    </div>
                    <button
                      onClick={() => setSelectedNode(null)}
                      className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400 cursor-pointer"
                    >
                      <X className="h-4.5 w-4.5" />
                    </button>
                  </div>
                  <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    {selectedNode.description}
                  </p>
                  <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 dark:text-zinc-500 border-t-2 border-dashed border-black/10 pt-2.5">
                    <span>熟练度: {Math.round(selectedNode.proficiency)}%</span>
                    <span>学习时间: {(selectedNode.study_duration / 60).toFixed(1)} 小时</span>
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => openAssistant(selectedNode.id, selectedNode.name)}
                      className="flex-1 py-2 bg-amber-100 hover:bg-amber-200 border-2 border-black rounded-2xl text-xs font-black text-black transition-all text-center cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                    >
                      💬 向导师提问
                    </button>
                    <Link
                      href={`/practice?nodeId=${selectedNode.id}`}
                      className="flex-1 py-2 bg-indigo-500 hover:bg-indigo-400 border-2 border-black text-white rounded-2xl text-xs font-black transition-all text-center cursor-pointer block shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                    >
                      🧪 前往练习
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* 右侧：今日复习 + 诊断补做 + 今日推荐 + Quiz + 雷达图 */}
            <div className="lg:w-80 shrink-0 overflow-y-auto p-4 md:px-4 md:py-4 border-t lg:border-t-0 lg:border-l-2 lg:border-black border-dashed border-black/10 flex flex-col gap-5">
              {onboardingState === 1 && (
                <Link
                  href="/onboarding"
                  className="block bg-amber-100 dark:bg-amber-700/40 border-2 border-black rounded-3xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                >
                  <h3 className="text-xs font-black text-black dark:text-white mb-1 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    完成学习力诊断
                  </h3>
                  <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    10 道题初始化你的知识画像，让推荐和出题更懂你。
                  </p>
                </Link>
              )}
              <ReviewTodayCard />
              <StudyPanel
                recommendedNodes={recommends}
                radarData={radar}
                onSelectNode={handleRecommendSelect}
                onQuizPassed={() => fetchDashboardData(true)}
                selectedNodeId={selectedNode?.id}
              />
            </div>

          </div>
        )}

      </div>
    </UserLayout>
  );
}
