"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Sparkles,
  RefreshCw,
  Loader2,
  Info,
} from "lucide-react";
import { knowledgeApi } from "@/lib/api";
import UserLayout from "@/components/user-layout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface GraphNode {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  pagerank_weight: number;
  is_lighted: boolean;
  proficiency: number;
  study_duration: number;
}

interface GraphRelation {
  source: string;
  target: string;
  relation_type: string;
}

interface GraphData {
  nodes: GraphNode[];
  relations: GraphRelation[];
  stats: {
    total_nodes: number;
    lighted_nodes: number;
    categories: Record<string, { total: number; lighted: number }>;
  };
}

interface RecommendedNode {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  pagerank: number;
  proficiency: number;
  reason: string;
}

// 优化后的高辨识度卡通点亮配色
const CATEGORY_COLORS: Record<string, string> = {
  programming: "#84cc16",   // 亮绿色
  dsa: "#f43f5e",           // 玫瑰红
  organization: "#0ea5e9",  // 蔚蓝色
  os: "#f97316",            // 活力橙
  network: "#a855f7",       // 浆果紫
  database: "#10b981",      // 薄荷绿
  Other: "#6366f1",
};

const CATEGORY_NAMES: Record<string, string> = {
  programming: "终端与工具",
  dsa: "算法与结构",
  organization: "街机硬件设计",
  os: "并发与操作系统",
  network: "联机对战服务",
  database: "数据与工程",
  Other: "其他探索",
};

export default function GraphPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<RecommendedNode[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("cognilink_token");
      if (!token) {
        router.push("/login");
      }
    }
  }, [router]);

  const fetchGraphData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await knowledgeApi.getGraph();
      setGraphData(data);
    } catch (error) {
      console.error("Failed to fetch graph data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRecommendations = useCallback(async () => {
    try {
      setRecLoading(true);
      const data = await knowledgeApi.recommendLearningPath();
      setRecommendations(data);
    } catch (error) {
      console.error("Failed to fetch recommendations:", error);
    } finally {
      setRecLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraphData();
    fetchRecommendations();
  }, [fetchGraphData, fetchRecommendations]);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleRefreshWeights = useCallback(async () => {
    try {
      setRefreshing(true);
      await knowledgeApi.computePageRank();
      await fetchGraphData();
      await fetchRecommendations();
    } catch (error) {
      console.error("Failed to refresh weights:", error);
    } finally {
      setRefreshing(false);
    }
  }, [fetchGraphData, fetchRecommendations]);

  // ECharts 点击跳转
  const onChartClick = (params: { dataType: string; data: { nodeId?: string } }) => {
    if (params.dataType === "node" && params.data?.nodeId) {
      router.push(`/practice?nodeId=${params.data.nodeId}`);
    }
  };

  const chartEvents = {
    click: onChartClick,
  };

  const nodes = graphData?.nodes || [];
  const relations = graphData?.relations || [];

  const idToName: Record<string, string> = {};
  nodes.forEach((n) => {
    idToName[n.id] = n.name;
  });

  const maxPagerank = Math.max(...nodes.map((n) => n.pagerank_weight), 0.001);
  
  // 生成 ECharts 节点与线数据
  const processedData = nodes.map((node) => {
    const isLighted = node.is_lighted;
    const color = CATEGORY_COLORS[node.category] || CATEGORY_COLORS.Other;
    const symbolSize = Math.max(
      16,
      Math.min(40, 16 + (node.pagerank_weight / maxPagerank) * 24)
    );
    return {
      nodeId: node.id,
      name: node.name,
      symbolSize,
      category: node.category,
      itemStyle: {
        color: isLighted ? color : "rgba(156, 163, 175, 0.4)", // 未点亮使用半透明淡灰
        shadowBlur: isLighted ? 12 : 0,
        shadowColor: color,
        borderColor: isLighted ? "rgba(0, 0, 0, 0.8)" : "transparent",
        borderWidth: isLighted ? 2 : 0,
      },
      label: {
        show: true,
        color: isLighted ? "#000000" : "#94a3b8",
        fontWeight: "bold",
        fontSize: 10,
      },
    };
  });

  const links = relations
    .map((r) => {
      const sourceName = idToName[r.source];
      const targetName = idToName[r.target];
      if (!sourceName || !targetName) return null;
      return { source: sourceName, target: targetName };
    })
    .filter((l): l is { source: string; target: string } => l !== null);

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      backgroundColor: "rgba(253, 250, 242, 0.95)",
      borderWidth: 2,
      borderColor: "#000000",
      textStyle: { color: "#000000", fontSize: 11, fontWeight: "bold" },
      extraCssText: "box-shadow: 3px 3px 0px 0px rgba(0,0,0,1); border-radius: 12px;",
      formatter: (params: { dataType: string; name: string; data: { source?: string; target?: string } }) => {
        if (params.dataType === "node") {
          const node = nodes.find((n) => n.name === params.name);
          if (node) {
            const catName = CATEGORY_NAMES[node.category] || node.category;
            return `${node.name}<br/>领域: ${catName}<br/>状态: <span style="color:${node.is_lighted ? "#16a34a" : "#dc2626"}">${node.is_lighted ? "● 已点亮" : "○ 未解锁"}</span><br/>熟练度: ${Math.round(node.proficiency * 100)}%<br/><span style="color:#d97706">点击进入练习</span>`;
          }
          return params.name;
        }
        return `连接通道: ${params.data.source} ➔ ${params.data.target}`;
      },
    },
    series: [
      {
        type: "graph",
        layout: "force",
        data: processedData,
        links: links,
        roam: true,
        label: {
          show: true,
          position: "bottom",
          fontSize: 10,
          fontFamily: "sans-serif",
        },
        force: {
          repulsion: 220,
          edgeLength: 70,
          gravity: 0.1,
        },
        lineStyle: {
          color: "rgba(0, 0, 0, 0.15)",
          width: 2,
          curveness: 0.1,
        },
        emphasis: {
          focus: "adjacency",
          lineStyle: {
            width: 3.5,
            color: "#000000",
          },
        },
      },
    ],
  };

  const lightedCount = nodes.filter((n) => n.is_lighted).length;
  const totalCount = nodes.length;
  const lightedPercent = totalCount > 0 ? Math.round((lightedCount / totalCount) * 100) : 0;

  return (
    <UserLayout activePath="/graph">
      <div className="flex-1 overflow-hidden bg-[#fdfaf2] dark:bg-[#181611] flex flex-col font-sans">
        
        {/* Header */}
        <div className="p-8 pb-4 shrink-0">
          <h1 className="text-3xl font-black text-black dark:text-white tracking-tight">
            知识图谱网络
          </h1>
          <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mt-1.5">
            六大知识领域学习路线图，点击节点进入对应练习，通过答题点亮并解锁下一节点。
          </p>
        </div>

        {/* Main Workspace */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 px-8 pb-8 gap-6">

          {/* Graph View Card (Neo-brutalism) */}
          <div className="flex-1 bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-6 relative flex flex-col min-h-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-[linear-gradient(rgba(139,90,43,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(139,90,43,0.02)_1px,transparent_1px)] bg-[size:24px_24px]">
            <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 text-[10px] font-bold text-zinc-700 bg-white border-2 border-black px-2 py-1 rounded-xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <Info className="h-3.5 w-3.5 text-amber-500" />
              <span>提示：点击节点进入练习</span>
            </div>

            <div className="flex-1 min-h-[400px] relative">
              {loading ? (
                <div className="h-full w-full flex flex-col items-center justify-center text-zinc-500 text-xs gap-3">
                  <Loader2 className="h-7 w-7 animate-spin text-amber-600" />
                  <span className="font-bold">加载知识网络中...</span>
                </div>
              ) : mounted && nodes.length > 0 ? (
                <ReactECharts
                  option={option}
                  onEvents={chartEvents}
                  style={{ height: "100%", width: "100%", minHeight: "400px" }}
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-zinc-400 font-bold text-xs">
                  暂无知识图谱数据
                </div>
              )}
            </div>
          </div>

          {/* Neo-brutalism Cartoon Sidebar (Simplified) */}
          <div className="w-full lg:w-80 bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-6 flex flex-col gap-6 shrink-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-y-auto min-h-0 justify-between">
            
            <div className="flex flex-col gap-6">
              {/* Master Progress */}
              <div>
                <h3 className="font-black text-sm text-black dark:text-white">网络点亮进度</h3>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 bg-zinc-200 dark:bg-zinc-800 border-2 border-black h-4 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 to-lime-400 transition-all duration-500 rounded-full"
                      style={{ width: `${lightedPercent}%` }}
                    />
                  </div>
                  <span className="font-mono font-black text-xs text-black dark:text-white">{lightedPercent}%</span>
                </div>
                <p className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 mt-1.5">
                  已点亮 {lightedCount} / {totalCount} 个知识模块
                </p>
              </div>

              {/* Category Stats */}
              {graphData?.stats?.categories && (
                <div className="space-y-2.5 border-t-2 border-dashed border-black/10 pt-4">
                  <h4 className="text-xs font-black text-zinc-500 dark:text-zinc-400 mb-2">分类掌握统计</h4>
                  {Object.entries(graphData.stats.categories).map(([cat, data]) => {
                    const catPercent = data.total > 0 ? Math.round((data.lighted / data.total) * 100) : 0;
                    const color = CATEGORY_COLORS[cat] || CATEGORY_COLORS.Other;
                    const name = CATEGORY_NAMES[cat] || cat;
                    return (
                      <div key={cat} className="flex items-center gap-2 text-xs font-bold">
                        <span className="w-3 h-3 rounded-full border border-black shrink-0" style={{ backgroundColor: color }} />
                        <span className="flex-1 truncate text-zinc-700 dark:text-zinc-300">{name}</span>
                        <span className="font-mono text-zinc-400 dark:text-zinc-500">{data.lighted}/{data.total}</span>
                        <span className="font-mono text-zinc-600 dark:text-zinc-200 w-8 text-right">{catPercent}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Path Recommendations */}
            <div className="space-y-2.5 border-t-2 border-dashed border-black/10 pt-4 mt-auto">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-black text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Sparkles className="h-4.5 w-4.5 text-amber-500" />
                  学习路径推荐
                </h4>
                <button
                  onClick={handleRefreshWeights}
                  disabled={refreshing}
                  className="text-[10px] font-black text-amber-600 hover:text-amber-700 flex items-center gap-1 disabled:opacity-50 border border-black/20 px-1.5 py-0.5 rounded-lg bg-amber-50 dark:bg-zinc-800"
                  title="重新计算 PageRank 权重"
                >
                  <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                  刷新权重
                </button>
              </div>
              {recLoading ? (
                <div className="text-[10px] font-bold text-zinc-400 py-2 flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  计算路径中...
                </div>
              ) : recommendations.length > 0 ? (
                <div className="space-y-2">
                  {recommendations.map((rec, idx) => {
                    const color = CATEGORY_COLORS[rec.category] || CATEGORY_COLORS.Other;
                    return (
                      <button
                        key={idx}
                        onClick={() => router.push(`/practice?nodeId=${rec.id}`)}
                        className="flex items-start gap-2.5 w-full p-2.5 rounded-2xl text-left text-xs bg-white dark:bg-zinc-800 border-2 border-black hover:bg-amber-50/40 dark:hover:bg-zinc-700/40 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        title={rec.description}
                      >
                        <span className="w-2.5 h-2.5 rounded-full border border-black shrink-0 mt-0.8" style={{ backgroundColor: color }} />
                        <div className="flex-1 min-w-0 font-bold">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-black dark:text-white">{rec.name}</span>
                          </div>
                          <span className="text-[9px] font-semibold text-zinc-500 dark:text-zinc-400 block mt-1">{rec.reason}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[10px] font-semibold text-zinc-400 py-2">暂无推荐新芽</div>
              )}
            </div>

          </div>

        </div>

      </div>
    </UserLayout>
  );
}
