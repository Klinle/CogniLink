"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  Database,
  Loader2,
  Network,
  Puzzle,
  Server,
  Sparkles,
  Terminal,
  Upload,
} from "lucide-react";
import { onboardingApi } from "@/lib/api";

const DOMAINS = [
  { key: "programming", name: "编程开发基础", desc: "变量、控制流、函数与异常捕获", icon: Terminal },
  { key: "dsa", name: "数据结构与高级特性", desc: "列表推导、生成器、装饰器与内存管理", icon: Puzzle },
  { key: "organization", name: "面向对象与系统架构", desc: "类与继承、多态 MRO、魔术方法", icon: Brain },
  { key: "os", name: "并发编程与操作系统", desc: "GIL、多线程多进程、asyncio 协程", icon: Server },
  { key: "network", name: "网络编程与联机服务", desc: "Socket、HTTP、FastAPI 与序列化", icon: Network },
  { key: "database", name: "数据工程与持久化", desc: "SQLite、ORM、pytest 与 Pandas", icon: Database },
] as const;

interface DiagnosticQuestion {
  id: string;
  title: string;
  test_cases: { questions?: { id?: string; text?: string; options?: string[]; answer?: number; explanation?: string }[] };
  node_id: string;
  node_name: string;
}

interface DiagnoseNodeSummary {
  node_id: string;
  node_name: string;
  total: number;
  correct: number;
  proficiency: number;
  is_lighted: boolean;
}

const DRAFT_KEY = "cognilink_onboarding_draft";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface Draft {
  step: number;
  domain: string;
  answers: Record<string, number>;
  ts: number;
}

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft: Draft = JSON.parse(raw);
    if (Date.now() - draft.ts > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export default function OnboardingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(1);
  const [domain, setDomain] = useState("");
  const [questions, setQuestions] = useState<DiagnosticQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ nodes: DiagnoseNodeSummary[]; lighted_names: string[] } | null>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("cognilink_token")) {
      router.push("/login");
      return;
    }
    const draft = loadDraft();
    if (draft) {
      setStep(draft.step);
      setDomain(draft.domain);
      setAnswers(draft.answers || {});
    }
  }, [router]);

  const saveDraft = useCallback((next: Partial<Draft>) => {
    try {
      const current = loadDraft() || { step: 1, domain: "", answers: {}, ts: Date.now() };
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ ...current, ...next, ts: Date.now() }),
      );
    } catch {}
  }, []);

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
  };

  useEffect(() => {
    if (step === 3 && domain && questions.length === 0) {
      setLoadingQuestions(true);
      onboardingApi
        .getQuestions(domain)
        .then((qs: DiagnosticQuestion[]) => setQuestions(qs || []))
        .catch((e) => console.error("Failed to load diagnostic questions:", e))
        .finally(() => setLoadingQuestions(false));
    }
  }, [step, domain, questions.length]);

  const handleSkip = async () => {
    try {
      await onboardingApi.complete(true);
    } catch (e) {
      console.error("Failed to mark onboarding skipped:", e);
    }
    clearDraft();
    router.replace("/dashboard");
  };

  const handleSubmitDiagnosis = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const results = questions.map((q) => {
        const inner = q.test_cases?.questions?.[0];
        const chosen = answers[q.id];
        return { lab_id: q.id, correct: chosen !== undefined && chosen === inner?.answer };
      });
      const res = await onboardingApi.diagnose(domain, results);
      setResult(res);
      clearDraft();
    } catch (e) {
      console.error("Failed to submit diagnosis:", e);
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) return <div className="min-h-screen bg-background" />;

  const currentQuestion = questions[questionIndex];
  const innerQuestion = currentQuestion?.test_cases?.questions?.[0];
  const answeredCount = questions.filter((q) => answers[q.id] !== undefined).length;

  return (
    <div className="min-h-screen bg-[#fdfaf2] dark:bg-[#181611] bg-[linear-gradient(rgba(139,90,43,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(139,90,43,0.02)_1px,transparent_1px)] bg-[size:24px_24px] flex flex-col">
      <header className="shrink-0 border-b-2 border-black bg-white/70 dark:bg-zinc-950/70 backdrop-blur-sm px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-amber-500" />
          <span className="font-black text-lg text-black dark:text-white">学习力诊断</span>
        </div>
        {!result && (
          <button
            onClick={handleSkip}
            className="text-sm font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline underline-offset-2"
          >
            跳过，稍后再说
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 md:p-8">
          {!result && (
            <div className="flex items-center gap-2 mb-6">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`h-2 flex-1 rounded-full border-2 border-black ${
                    s <= step ? "bg-amber-400" : "bg-white dark:bg-zinc-800"
                  }`}
                />
              ))}
            </div>
          )}

          {result ? (
            <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-center mb-5">
                <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-2" />
                <h2 className="text-2xl font-black text-black dark:text-white">诊断完成！</h2>
                <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mt-1">
                  你的学习画像已初始化
                  {result.lighted_names.length > 0
                    ? `，${result.lighted_names.length} 个知识点直接点亮`
                    : "，从薄弱点开始逐个点亮吧"}
                </p>
              </div>
              <ul className="space-y-2 mb-6">
                {result.nodes.map((n) => (
                  <li
                    key={n.node_id}
                    className="flex items-center justify-between gap-3 border-2 border-black/10 rounded-xl px-3 py-2 text-sm"
                  >
                    <span className="font-bold text-black dark:text-white truncate">
                      {n.node_name}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-black px-2 py-0.5 rounded-full border-2 border-black ${
                        n.is_lighted
                          ? "bg-amber-200 dark:bg-amber-600 text-black dark:text-white"
                          : "bg-white dark:bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {n.is_lighted ? "已点亮" : `答对 ${n.correct}/${n.total}`}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => router.replace("/dashboard")}
                className="w-full px-4 py-3 rounded-xl border-2 border-black bg-amber-300 dark:bg-amber-600 text-black dark:text-white font-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
              >
                进入我的学习舱
              </button>
            </div>
          ) : step === 1 ? (
            <div>
              <h1 className="text-2xl font-black text-black dark:text-white mb-1">
                选择你的主攻领域
              </h1>
              <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-5">
                只影响本次诊断的出题方向，之后可以随时跨领域学习。
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                {DOMAINS.map((d) => {
                  const Icon = d.icon;
                  const selected = domain === d.key;
                  return (
                    <button
                      key={d.key}
                      onClick={() => {
                        setDomain(d.key);
                        saveDraft({ domain: d.key });
                      }}
                      className={`text-left p-4 rounded-2xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none ${
                        selected
                          ? "bg-amber-200 dark:bg-amber-600"
                          : "bg-white dark:bg-zinc-900"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="h-5 w-5 text-black dark:text-white" />
                        <span className="font-black text-sm text-black dark:text-white">
                          {d.name}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                        {d.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  if (!domain) return;
                  setStep(2);
                  saveDraft({ step: 2 });
                }}
                disabled={!domain}
                className="w-full px-4 py-3 rounded-xl border-2 border-black bg-amber-300 dark:bg-amber-600 text-black dark:text-white font-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-40 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
              >
                下一步
              </button>
            </div>
          ) : step === 2 ? (
            <div>
              <h1 className="text-2xl font-black text-black dark:text-white mb-1">
                准备学习资料
              </h1>
              <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-5">
                你的文档只存本机部署的数据库，嵌入可完全本地生成——数据不出你的电脑。
              </p>
              <div className="space-y-3 mb-6">
                <div className="p-4 rounded-2xl border-2 border-black bg-amber-200 dark:bg-amber-600 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className="h-5 w-5 text-black dark:text-white" />
                    <span className="font-black text-sm text-black dark:text-white">
                      先用内置知识库（推荐）
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-100">
                    内置 41 个知识节点覆盖六大领域，配套练习开箱即用。
                  </p>
                </div>
                <div className="p-4 rounded-2xl border-2 border-black bg-white dark:bg-zinc-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center gap-2 mb-1">
                    <Upload className="h-5 w-5 text-black dark:text-white" />
                    <span className="font-black text-sm text-black dark:text-white">
                      稍后上传我的教材
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    完成诊断后，在管理端知识库页面上传 PDF/Markdown 教材，AI 回答将标注来源页码。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setStep(1);
                    saveDraft({ step: 1 });
                  }}
                  className="px-4 py-3 rounded-xl border-2 border-black bg-white dark:bg-zinc-900 text-black dark:text-white font-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setStep(3);
                    saveDraft({ step: 3 });
                  }}
                  className="flex-1 px-4 py-3 rounded-xl border-2 border-black bg-amber-300 dark:bg-amber-600 text-black dark:text-white font-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                >
                  开始 10 题诊断
                </button>
              </div>
            </div>
          ) : (
            <div>
              {loadingQuestions ? (
                <div className="flex flex-col items-center justify-center py-24 gap-2 text-sm font-bold text-zinc-500">
                  <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
                  正在准备诊断题目...
                </div>
              ) : questions.length === 0 ? (
                <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-8 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <p className="text-sm font-bold text-zinc-500 mb-4">
                    该领域的诊断题库尚未就绪，可先跳过进入学习舱。
                  </p>
                  <button
                    onClick={handleSkip}
                    className="px-4 py-2.5 rounded-xl border-2 border-black bg-amber-200 dark:bg-amber-600 text-black dark:text-white font-black text-sm shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    进入学习舱
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="text-xl font-black text-black dark:text-white">
                      诊断测验 {questionIndex + 1}/{questions.length}
                    </h1>
                    <span className="text-xs font-bold text-zinc-400">
                      已作答 {answeredCount}/{questions.length} · 不计时
                    </span>
                  </div>
                  <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] mb-4">
                    <p className="text-xs font-black text-amber-600 dark:text-amber-400 mb-2">
                      {currentQuestion.node_name}
                    </p>
                    <p className="text-base font-bold text-black dark:text-white mb-4 leading-relaxed">
                      {innerQuestion?.text}
                    </p>
                    <div className="space-y-2">
                      {(innerQuestion?.options || []).map((opt, i) => {
                        const chosen = answers[currentQuestion.id] === i;
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              const next = { ...answers, [currentQuestion.id]: i };
                              setAnswers(next);
                              saveDraft({ answers: next });
                            }}
                            className={`w-full text-left px-4 py-2.5 rounded-xl border-2 border-black text-sm font-bold transition-all ${
                              chosen
                                ? "bg-amber-200 dark:bg-amber-600 text-black dark:text-white shadow-none translate-x-[1px] translate-y-[1px]"
                                : "bg-[#fdfaf2] dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
                            }`}
                          >
                            <span className="mr-2 font-black">{String.fromCharCode(65 + i)}.</span>
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setQuestionIndex((i) => Math.max(0, i - 1))}
                      disabled={questionIndex === 0}
                      className="px-4 py-3 rounded-xl border-2 border-black bg-white dark:bg-zinc-900 text-black dark:text-white font-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-40"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    {questionIndex < questions.length - 1 ? (
                      <button
                        onClick={() => setQuestionIndex((i) => i + 1)}
                        disabled={answers[currentQuestion.id] === undefined}
                        className="flex-1 px-4 py-3 rounded-xl border-2 border-black bg-amber-300 dark:bg-amber-600 text-black dark:text-white font-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                      >
                        下一题
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        onClick={handleSubmitDiagnosis}
                        disabled={answeredCount < questions.length || submitting}
                        className="flex-1 px-4 py-3 rounded-xl border-2 border-black bg-green-300 dark:bg-green-700 text-black dark:text-white font-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                      >
                        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                        提交诊断
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
