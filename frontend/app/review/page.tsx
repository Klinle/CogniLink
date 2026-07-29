"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookMarked,
  CheckCircle2,
  ChevronRight,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";
import UserLayout from "@/components/user-layout";
import ExerciseRenderer from "@/components/exercise-renderer";
import { reviewApi } from "@/lib/api";
import type { ReviewItem, ReviewAnswerResponse, ReviewTodayResponse } from "@/types";

const OBJECTIVE_TYPES = ["quiz", "judge", "match", "arrange", "fill"];

/** ReviewItem -> ExerciseRenderer 的 LabData 形状 */
function toLabData(item: ReviewItem) {
  return {
    id: item.id,
    title: item.title,
    description: "",
    starter_code: "",
    test_cases: item.content,
    difficulty: "medium",
    lab_type: item.exercise_type,
    detailed_explanation: item.explanation || "",
    node_id: item.node_id || undefined,
  };
}

export default function ReviewPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<ReviewTodayResponse | null>(null);
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [feedback, setFeedback] = useState<ReviewAnswerResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [allItems, setAllItems] = useState<ReviewItem[]>([]);
  const [showBook, setShowBook] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined" && !localStorage.getItem("cognilink_token")) {
      router.push("/login");
    }
  }, [router]);

  const fetchToday = useCallback(async () => {
    setLoading(true);
    try {
      const data: ReviewTodayResponse = await reviewApi.getToday();
      setToday(data);
      setQueue(data.items || []);
      setDoneCount(0);
      setCorrectCount(0);
      setFeedback(null);
    } catch (e) {
      console.error("Failed to load review queue:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBook = useCallback(async () => {
    try {
      setAllItems((await reviewApi.listAll()) || []);
    } catch (e) {
      console.error("Failed to load review book:", e);
    }
  }, []);

  useEffect(() => {
    if (mounted) {
      fetchToday();
      fetchBook();
    }
  }, [mounted, fetchToday, fetchBook]);

  const current = queue[0] || null;
  const isObjective = current ? OBJECTIVE_TYPES.includes(current.exercise_type) : false;

  const submitAnswer = async (correct: boolean) => {
    // feedback 已存在说明本条目已计分，渲染器内的"重新作答"仅作本地练习，不重复推进调度
    if (!current || submitting || feedback) return;
    setSubmitting(true);
    try {
      const res: ReviewAnswerResponse = await reviewApi.answer(current.id, correct);
      setFeedback(res);
      setDoneCount((n) => n + 1);
      if (correct) setCorrectCount((n) => n + 1);
    } catch (e) {
      console.error("Failed to submit review answer:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const nextItem = () => {
    setQueue((prev) => prev.slice(1));
    setFeedback(null);
    fetchBook();
  };

  const removeItem = async (itemId: string) => {
    if (!window.confirm("确定将这道题移出错题本吗？")) return;
    try {
      await reviewApi.remove(itemId);
      setAllItems((prev) => prev.filter((i) => i.id !== itemId));
      setQueue((prev) => prev.filter((i) => i.id !== itemId));
    } catch (e) {
      console.error("Failed to remove review item:", e);
    }
  };

  if (!mounted) return <div className="min-h-screen bg-background" />;

  const totalToday = doneCount + queue.length;

  return (
    <UserLayout activePath="/review">
      <div className="flex-1 overflow-y-auto bg-[#fdfaf2] dark:bg-[#181611] bg-[linear-gradient(rgba(139,90,43,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(139,90,43,0.02)_1px,transparent_1px)] bg-[size:24px_24px]">
        <div className="max-w-3xl mx-auto p-4 md:p-8">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-black dark:text-white flex items-center gap-2">
                <RotateCcw className="h-7 w-7 text-amber-500" />
                错题复习
              </h1>
              <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mt-1">
                按遗忘曲线安排的今日复习队列，连续答对三次即可毕业出队。
              </p>
            </div>
            <button
              onClick={() => setShowBook((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 border-black bg-white dark:bg-zinc-800 text-sm font-black text-black dark:text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
            >
              <BookMarked className="h-4 w-4" />
              错题本（{allItems.length}）
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            </div>
          ) : current ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm font-black text-zinc-600 dark:text-zinc-300">
                <span>
                  今日进度 {doneCount + 1}/{totalToday}
                </span>
                <span className="text-xs font-bold text-zinc-400">
                  错过 {current.wrong_count} 次 · 已连对 {current.success_streak} 次
                </span>
              </div>

              {isObjective ? (
                <ExerciseRenderer
                  labs={[toLabData(current)]}
                  onSubmit={async (result) => {
                    await submitAnswer(result.passed);
                  }}
                  isSubmitting={submitting}
                />
              ) : (
                <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <h3 className="font-black text-lg text-black dark:text-white mb-2">
                    {current.title}
                  </h3>
                  <p className="text-xs font-bold text-zinc-400 mb-3">
                    编程题 · 回顾解析后自评掌握程度
                  </p>
                  {current.explanation ? (
                    <div className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 bg-amber-50 dark:bg-zinc-800 border-2 border-black/20 rounded-2xl p-4 mb-4">
                      {current.explanation}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-500 mb-4">
                      （此题无解析快照，可前往练习页重做原题）
                    </p>
                  )}
                  {!feedback && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => submitAnswer(true)}
                        disabled={submitting}
                        className="flex-1 px-4 py-2.5 rounded-xl border-2 border-black bg-green-200 dark:bg-green-700 text-black dark:text-white font-black text-sm shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50"
                      >
                        我已掌握
                      </button>
                      <button
                        onClick={() => submitAnswer(false)}
                        disabled={submitting}
                        className="flex-1 px-4 py-2.5 rounded-xl border-2 border-black bg-red-200 dark:bg-red-800 text-black dark:text-white font-black text-sm shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50"
                      >
                        还需练习
                      </button>
                    </div>
                  )}
                </div>
              )}

              {feedback && (
                <div className="flex items-center justify-between gap-3 bg-white dark:bg-zinc-900 border-2 border-black rounded-2xl px-4 py-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center gap-2 text-sm font-black text-black dark:text-white">
                    {feedback.graduated ? (
                      <Trophy className="h-5 w-5 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                    {feedback.message}
                  </div>
                  <button
                    onClick={nextItem}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-xl border-2 border-black bg-amber-200 dark:bg-amber-600 text-black dark:text-white font-black text-sm shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                  >
                    {queue.length > 1 ? "下一题" : "完成"}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-8 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <Sparkles className="h-10 w-10 text-amber-500 mx-auto mb-3" />
              {doneCount > 0 ? (
                <>
                  <h2 className="text-xl font-black text-black dark:text-white mb-1">
                    今日复习已清！
                  </h2>
                  <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-4">
                    完成 {doneCount} 题，答对 {correctCount} 题
                    {today?.next_due_at ? "，下一批复习已在路上" : ""}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-black text-black dark:text-white mb-1">
                    {allItems.length > 0 ? "今日暂无待复习题目" : "错题本还是空的"}
                  </h2>
                  <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-4">
                    {allItems.length > 0
                      ? "队列中的题目将按遗忘曲线陆续到期"
                      : "去练习页做题，答错的题会自动进入这里"}
                  </p>
                </>
              )}
              <Link
                href="/practice"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-black bg-amber-200 dark:bg-amber-600 text-black dark:text-white font-black text-sm shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
              >
                去练习
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          {showBook && (
            <div className="mt-6 bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <h3 className="font-black text-sm text-black dark:text-white mb-3 flex items-center gap-1.5">
                <BookMarked className="h-4 w-4 text-amber-500" />
                错题本全部条目
              </h3>
              {allItems.length === 0 ? (
                <p className="text-sm text-zinc-500">暂无条目</p>
              ) : (
                <ul className="space-y-2">
                  {allItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 text-sm border-2 border-black/10 rounded-xl px-3 py-2"
                    >
                      <div className="min-w-0">
                        <span className="font-bold text-black dark:text-white truncate block">
                          {item.title}
                        </span>
                        <span className="text-xs text-zinc-400 font-semibold">
                          {item.exercise_type} · 错 {item.wrong_count} 次 · 连对{" "}
                          {item.success_streak} 次 ·{" "}
                          {item.state === "graduated"
                            ? "已毕业"
                            : item.due_at
                              ? `下次 ${new Date(item.due_at).toLocaleDateString()}`
                              : "待复习"}
                        </span>
                      </div>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="shrink-0 p-1.5 rounded-lg border-2 border-black bg-white dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
                        aria-label="移出错题本"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </UserLayout>
  );
}
