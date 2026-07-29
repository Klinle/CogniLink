"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, RotateCcw } from "lucide-react";
import { reviewApi } from "@/lib/api";
import type { ReviewTodayResponse } from "@/types";

/** dashboard 右栏「今日待复习」卡片（T2 间隔重复入口） */
export default function ReviewTodayCard() {
  const [data, setData] = useState<ReviewTodayResponse | null>(null);

  useEffect(() => {
    reviewApi
      .getToday()
      .then(setData)
      .catch((e) => console.error("Failed to load review summary:", e));
  }, []);

  const due = data?.items?.length ?? 0;
  const hasBacklog = (data?.total_due ?? 0) > 0 || (data?.next_due_at ?? null) !== null;

  return (
    <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all">
      <h3 className="text-xs font-black text-black dark:text-white mb-3 flex items-center gap-1.5">
        <RotateCcw className="h-4 w-4 text-amber-500" />
        今日待复习
      </h3>
      {data === null ? (
        <p className="text-xs font-semibold text-zinc-400">加载中...</p>
      ) : due > 0 ? (
        <Link
          href="/review"
          className="flex items-center justify-between gap-2 rounded-2xl border-2 border-black bg-amber-100 dark:bg-amber-700/50 px-3 py-2.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
        >
          <span className="text-sm font-black text-black dark:text-amber-50">
            {due} 道错题等待巩固
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-black dark:text-amber-50" />
        </Link>
      ) : (
        <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          {hasBacklog
            ? "今日复习已清，下一批将按遗忘曲线到期"
            : "暂无错题，答错的练习会自动进入复习队列"}
        </p>
      )}
    </div>
  );
}
