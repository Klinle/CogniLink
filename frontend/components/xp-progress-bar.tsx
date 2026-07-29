"use client";

import React from "react";
import { Award, Flame, Zap, CheckCircle2 } from "lucide-react";
import type { ProfileStats } from "@/types";

interface XpProgressBarProps {
  stats: ProfileStats;
  nickname: string;
}

const LEVEL_TITLES = [
  "初入江湖", "代码学徒", "逻辑探索者", "算法冒险家",
  "系统架构师", "全栈勇士", "代码探索者", "技术宗师",
  "计算机大师", "图灵传人"
];

export default function XpProgressBar({ stats, nickname }: XpProgressBarProps) {
  const lighted = stats.lighted_nodes || 0;
  const total = stats.total_nodes || 34;
  
  // 等级计算：每掌握5个节点升一级
  const level = Math.floor(lighted / 5) + 1;
  const clampedLevel = Math.min(Math.max(level, 1), 10);
  const levelTitle = LEVEL_TITLES[clampedLevel - 1];

  // 经验值进度条计算：5个节点一级
  const xpCurrent = lighted % 5;
  const xpMax = 5;
  const xpPercentage = (xpCurrent / xpMax) * 100;

  // 连续学习天数模拟（由总学习时间推算，或设定合理的基准打卡）
  const studyHours = stats.study_duration_hours || 0;
  const streakDays = Math.max(Math.ceil(studyHours * 1.8), 1);

  return (
    <div className="w-full bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between gap-6 flex-wrap md:flex-nowrap">
      {/* 个人身份 & 称号 */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-11 h-11 rounded-2xl bg-amber-300 border-2 border-black text-black flex items-center justify-center font-black text-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          {nickname ? nickname[0].toUpperCase() : "U"}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-black dark:text-zinc-100 text-sm">{nickname}</span>
            <span className="text-[10px] font-black bg-amber-100 dark:bg-zinc-800 text-black dark:text-amber-500 px-2.5 py-0.5 rounded-full border-2 border-black shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]">
              Lv.{level} {levelTitle}
            </span>
          </div>
          <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-500 mt-1 block font-mono">
            {lighted * 100} <span className="text-zinc-400">XP</span>
          </span>
        </div>
      </div>

      {/* 经验值进度条 */}
      <div className="flex-1 min-w-[200px] font-bold">
        <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400 mb-1.5">
          <span className="flex items-center gap-1.5">
            <Zap className="h-4.5 w-4.5 text-amber-500 animate-pulse" />
            经验值 (点亮节点升级)
          </span>
          <span className="font-mono text-zinc-500">{xpCurrent} / {xpMax} Nodes</span>
        </div>
        <div className="w-full h-4 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden border-2 border-black">
          <div
            className="h-full bg-amber-400 border-r-2 border-black rounded-full transition-all duration-500 ease-out"
            style={{ width: `${xpPercentage}%` }}
          />
        </div>
      </div>

      {/* 统计指标 */}
      <div className="flex items-center gap-4 shrink-0">
        {/* 打卡火苗 */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white dark:bg-zinc-800 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          <Flame className="h-5 w-5 text-orange-500 shrink-0 animate-bounce" style={{ animationDuration: "3s" }} />
          <div>
            <span className="text-sm font-black text-black dark:text-white block leading-none">
              🔥 {streakDays}<span className="text-[10px] font-bold ml-0.5">天</span>
            </span>
            <span className="text-[9px] font-bold text-zinc-400 mt-1 block leading-none">
              学习连击
            </span>
          </div>
        </div>

        {/* 知识点点亮进度 */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white dark:bg-zinc-800 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          <div>
            <span className="text-sm font-black text-black dark:text-white block leading-none">
              {lighted}<span className="text-[10px] font-bold text-zinc-400"> / {total}</span>
            </span>
            <span className="text-[9px] font-bold text-zinc-400 mt-1 block leading-none">
              已点亮节点
            </span>
          </div>
        </div>

        {/* 实验通关数 */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white dark:bg-zinc-800 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          <Award className="h-5 w-5 text-sky-500 shrink-0" />
          <div>
            <span className="text-sm font-black text-black dark:text-white block leading-none">
              {stats.passed_labs || 0}
            </span>
            <span className="text-[9px] font-bold text-zinc-400 mt-1 block leading-none">
              已通关实验
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
