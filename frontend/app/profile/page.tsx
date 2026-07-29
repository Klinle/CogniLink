"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Activity,
  Network,
  Award,
  Zap,
  Clock,
  CheckCircle2,
  Calendar,
  Loader2,
  ChevronDown,
  ChevronUp,
  Check,
  Lock,
} from "lucide-react";
import { profileApi, knowledgeApi } from "@/lib/api";
import type { KnowledgeNode, ProfileStats, RadarData } from "@/types";
import UserLayout from "@/components/user-layout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const CATEGORY_NAMES: Record<string, string> = {
  programming: "终端与工具",
  dsa: "算法与结构",
  organization: "硬件设计",
  os: "并发与系统",
  network: "联机对战",
  database: "数据与工程",
  Other: "其他探索",
};

export default function ProfilePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [radar, setRadar] = useState<RadarData | null>(null);
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 统一的卡通色值配置
  const categoryMapping: Record<string, { label: string, colorClass: string, hexColor: string }> = {
    "programming": { label: "终端游戏与工具", colorClass: "bg-[#84cc16]", hexColor: "#84cc16" },
    "dsa": { label: "益智游戏数据", colorClass: "bg-[#f43f5e]", hexColor: "#f43f5e" },
    "organization": { label: "街机游戏设计", colorClass: "bg-[#0ea5e9]", hexColor: "#0ea5e9" },
    "os": { label: "实时动作并发", colorClass: "bg-[#f97316]", hexColor: "#f97316" },
    "network": { label: "联机对战服务", colorClass: "bg-[#a855f7]", hexColor: "#a855f7" },
    "database": { label: "数据与工程", colorClass: "bg-[#10b981]", hexColor: "#10b981" }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("cognilink_token");
      if (!token) {
        router.push("/login");
      }
    }
  }, [router]);

  const fetchProfileData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsData, radarData, graphData] = await Promise.all([
        profileApi.getStats(),
        profileApi.getRadar(),
        knowledgeApi.getGraph(),
      ]);
      setStats(statsData);
      setRadar(radarData);
      setNodes(graphData.nodes || []);
    } catch (error) {
      console.error("Failed to fetch profile data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Build radar chart option (Neo-brutalism 卡通小指示木牌)
  const radarOption = radar
    ? {
        backgroundColor: "transparent",
        tooltip: {
          trigger: "item",
          backgroundColor: "rgba(253, 250, 242, 0.95)",
          borderWidth: 2,
          borderColor: "#000000",
          textStyle: { color: "#000000", fontSize: 11, fontWeight: "bold" },
          extraCssText: "box-shadow: 2px 2px 0px 0px rgba(0,0,0,1); border-radius: 8px;",
        },
        radar: {
          indicator: radar.indicators.map((ind) => ({
            name: CATEGORY_NAMES[ind.name] || ind.name,
            max: ind.max,
          })),
          shape: "polygon" as const,
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
            name: "能力维度画像",
            type: "radar",
            data: [
              {
                value: radar.values.map((v) => v.coverage),
                name: "知识覆盖率 (%)",
                symbol: "circle",
                symbolSize: 4,
                itemStyle: { color: "#3b82f6" },
                areaStyle: { color: "rgba(59, 130, 246, 0.2)" },
                lineStyle: { width: 1.5, color: "#3b82f6" },
              },
              {
                value: radar.values.map((v) => v.proficiency),
                name: "平均熟练度 (%)",
                symbol: "circle",
                symbolSize: 4,
                itemStyle: { color: "#10b981" },
                areaStyle: { color: "rgba(16, 185, 129, 0.15)" },
                lineStyle: { width: 1.5, color: "#10b981" },
              },
            ],
          },
        ],
      }
    : null;

  return (
    <UserLayout activePath="/profile">
      {/* 羊皮纸米黄背景，细方格格纹 */}
      <div className="flex-1 overflow-y-auto p-8 bg-[#fdfaf2] dark:bg-[#181611] flex flex-col gap-6 bg-[linear-gradient(rgba(139,90,43,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(139,90,43,0.02)_1px,transparent_1px)] bg-[size:24px_24px] font-sans">
        
        <div>
          <h1 className="text-3xl font-black tracking-tight text-black dark:text-white">学习能力画像</h1>
          <p className="text-sm font-semibold text-zinc-500 mt-1.5">评估您在各个游戏开发核心领域的星盘进度与多维度智能分析画像。</p>
        </div>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
            <span className="text-xs font-bold text-zinc-400">正在整理星系数据...</span>
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

              <div className="bg-white dark:bg-zinc-900 border-2 border-black p-5 rounded-3xl flex items-center gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="p-3 bg-amber-100 border-2 border-black text-black rounded-2xl shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] shrink-0">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <span className="text-2xl font-black font-mono text-black dark:text-white">
                    {stats ? `${stats.lighted_nodes} / ${stats.total_nodes}` : "0 / 0"}
                  </span>
                  <p className="text-[10px] font-bold text-zinc-400 mt-1">已激活知识星球</p>
                </div>
              </div>

              <div className="bg-white dark:bg-zinc-900 border-2 border-black p-5 rounded-3xl flex items-center gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="p-3 bg-amber-100 border-2 border-black text-black rounded-2xl shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] shrink-0">
                  <Award className="h-6 w-6" />
                </div>
                <div>
                  <span className="text-2xl font-black font-mono text-black dark:text-white">
                    {stats ? `${stats.pass_rate}%` : "0%"}
                  </span>
                  <p className="text-[10px] font-bold text-zinc-400 mt-1">实验通过率 ({stats?.passed_labs || 0}/{stats?.total_submissions || 0})</p>
                </div>
              </div>

              <div className="bg-white dark:bg-zinc-900 border-2 border-black p-5 rounded-3xl flex items-center gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="p-3 bg-amber-100 border-2 border-black text-black rounded-2xl shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] shrink-0">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <span className="text-2xl font-black font-mono text-black dark:text-white">
                    {stats ? `${stats.study_duration_hours} 小时` : "0 小时"}
                  </span>
                  <p className="text-[10px] font-bold text-zinc-400 mt-1">累计学习时长</p>
                </div>
              </div>

              <div className="bg-white dark:bg-zinc-900 border-2 border-black p-5 rounded-3xl flex items-center gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="p-3 bg-amber-100 border-2 border-black text-black rounded-2xl shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] shrink-0">
                  <Zap className="h-6 w-6" />
                </div>
                <div>
                  <span className="text-2xl font-black font-mono text-black dark:text-white">
                    {stats ? stats.memory_count : 0}
                  </span>
                  <p className="text-[10px] font-bold text-zinc-400 mt-1">智能记忆条目数</p>
                </div>
              </div>

            </div>

            {/* Charts Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

              {/* Ability Radar */}
              <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-5 h-[340px] flex flex-col shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <h3 className="text-xs font-black text-black dark:text-white border-b-2 border-dashed border-black/10 pb-2.5 mb-4 flex items-center gap-2">
                  <Activity className="h-4.5 w-4.5 text-indigo-500" />
                  当前能力维度画像
                </h3>
                <div className="flex-1 min-h-[250px] relative">
                  {mounted && radarOption ? (
                    <ReactECharts option={radarOption} style={{ height: "100%", width: "100%", minHeight: "250px" }} />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-zinc-400 text-xs">雷达图生成中...</div>
                  )}
                </div>
              </div>

              {/* Direction Details */}
              <div className="lg:col-span-3 bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-5 h-[340px] flex flex-col overflow-y-auto shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <h3 className="text-xs font-black text-black dark:text-white border-b-2 border-dashed border-black/10 pb-2.5 mb-4 flex items-center gap-2">
                  <Calendar className="h-4.5 w-4.5 text-purple-500" />
                  六大核心领域进度
                </h3>
                <div className="flex-1 space-y-3">
                  {radar?.values.map((v) => {
                    const matchInfo = categoryMapping[v.direction] || { hexColor: "#6366f1" };
                    return (
                      <div key={v.direction} className="bg-zinc-50 dark:bg-zinc-950/20 rounded-2xl p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                        <div className="flex items-center justify-between mb-2 font-bold">
                          <span className="text-sm font-black text-black dark:text-zinc-200">{CATEGORY_NAMES[v.direction] || v.direction}</span>
                          <span className="text-xs font-mono text-zinc-500">
                            {v.lighted}/{v.total} 节点 · 熟练度 {v.proficiency}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5 font-bold">
                          <div className="flex-1 bg-zinc-200 dark:bg-zinc-800 h-3 rounded-full overflow-hidden border-2 border-black">
                            <div
                              className="h-full border-r border-black transition-all duration-500"
                              style={{ width: `${v.coverage}%`, backgroundColor: matchInfo.hexColor }}
                            />
                          </div>
                          <span className="font-mono text-xs text-black w-8 text-right">{v.coverage}%</span>
                        </div>
                      </div>
                    );
                  })}
                  {(!radar || radar.values.length === 0) && (
                    <div className="flex items-center justify-center h-full text-zinc-400 text-xs">
                      暂无能力维度数据
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Detailed Nodes Section */}
            <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-6 flex flex-col gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="border-b-2 border-dashed border-black/10 pb-3 mb-2">
                <h3 className="text-sm font-black text-black dark:text-white flex items-center gap-2">
                  <Network className="h-4.5 w-4.5 text-amber-500" />
                  六大核心领域细分知识图谱
                </h3>
                <p className="text-xs font-semibold text-zinc-500 mt-1">查看每个具体知识节点的点亮状态与掌握进度详情</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(categoryMapping).map(([catKey, catInfo]) => {
                  const catNodes = nodes.filter((n) => n.category === catKey);
                  const lightedCount = catNodes.filter((n) => n.is_lighted).length;
                  const isExpanded = expandedCategory === catKey;

                  return (
                    <div
                      key={catKey}
                      className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl overflow-hidden transition-all duration-300 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      {/* Category Header */}
                      <button
                        onClick={() => setExpandedCategory(isExpanded ? null : catKey)}
                        className="w-full px-5 py-4 flex items-center justify-between hover:bg-amber-50/10 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-3 h-3 rounded-full border border-black shrink-0" style={{ backgroundColor: catInfo.hexColor }} />
                          <div>
                            <h4 className="text-sm font-black text-black dark:text-zinc-200">
                              {catInfo.label}
                            </h4>
                            <span className="text-[10px] font-bold text-zinc-400 font-mono">
                              已探索 {lightedCount} / {catNodes.length} 星球
                            </span>
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4.5 w-4.5 text-zinc-500" />
                        ) : (
                          <ChevronDown className="h-4.5 w-4.5 text-zinc-500" />
                        )}
                      </button>

                      {/* Category Details */}
                      {isExpanded && (
                        <div className="border-t-2 border-dashed border-black/10 p-4 bg-[#fcfaf2] dark:bg-slate-950/10 space-y-3.5 max-h-80 overflow-y-auto">
                          {catNodes.length === 0 ? (
                            <p className="text-xs font-bold text-zinc-400 text-center py-4">该分类下暂无知识节点</p>
                          ) : (
                            catNodes.map((node) => (
                              <div
                                key={node.id}
                                className={`p-3 rounded-2xl border-2 transition-all ${
                                  node.is_lighted
                                    ? "bg-white dark:bg-slate-900/60 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                    : "bg-transparent border-dashed border-zinc-200 dark:border-slate-800/40 opacity-70"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3 font-sans">
                                  <div className="flex items-start gap-2.5 min-w-0">
                                    <div className="mt-0.5 shrink-0">
                                      {node.is_lighted ? (
                                        <div className="p-0.5 rounded-full bg-green-100 border border-black text-black">
                                          <Check className="h-3 w-3" />
                                        </div>
                                      ) : (
                                        <div className="p-0.5 rounded-full bg-zinc-100 border border-black text-zinc-400">
                                          <Lock className="h-3 w-3" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <h5 className="text-xs font-black text-black dark:text-zinc-200 flex items-center gap-1.5">
                                        {node.name}
                                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border border-black/15 bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                                          {node.code}
                                        </span>
                                      </h5>
                                      <p className="text-[10px] font-bold text-zinc-500 dark:text-zinc-500 mt-1.5 leading-normal line-clamp-2">
                                        {node.description}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0 font-bold">
                                    <span className="text-xs font-black font-mono text-indigo-650 dark:text-indigo-400">
                                      熟练度 {node.proficiency}%
                                    </span>
                                    <span className="text-[9px] text-zinc-400 block mt-1">
                                      时长 {Math.round(node.study_duration / 60)} 分钟
                                    </span>
                                  </div>
                                </div>
                                
                                {/* Inner Proficiency Bar */}
                                {node.is_lighted && (
                                  <div className="mt-3 bg-zinc-200 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden border-2 border-black">
                                    <div
                                      className="h-full transition-all duration-300"
                                      style={{ width: `${node.proficiency}%`, backgroundColor: catInfo.hexColor }}
                                    />
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

            </div>
          </>
        )}

      </div>
    </UserLayout>
  );
}
