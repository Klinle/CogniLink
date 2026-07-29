/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Check, 
  X, 
  Sparkles, 
  Star, 
  Brain, 
  ArrowUp, 
  ArrowDown, 
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Trophy,
  Award,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatAssistantStore } from "@/stores/chat-assistant";
import { useSettingsStore } from "@/stores/settings";
import { collectionApi } from "@/lib/api";

interface LabData {
  id: string;
  title: string;
  description?: string;
  starter_code?: string;
  test_cases?: any;
  difficulty?: string;
  lab_type?: string;
  detailed_explanation?: string;
  node_id?: string;
}

const getSafeTestCases = (card: LabData | undefined) => {
  if (!card) return {};
  if (typeof card.test_cases === "string") {
    try {
      return JSON.parse(card.test_cases);
    } catch (e) {
      console.error("Failed to parse test_cases:", e);
      return {};
    }
  }
  return card.test_cases || {};
};

interface ExerciseRendererProps {
  labs: LabData[] | LabData; // 接收整套题目列表或单道题目
  activeLabId?: string; // 初始定位的题目 ID
  onSubmit: (result: { score: number; passed: boolean; answers: any }) => Promise<void>;
  isSubmitting?: boolean;
  isCollected?: boolean; // 外部传入的收藏状态（组件内部仍以 currentCollected 为准）
  onToggleCollect?: (targetLab?: any) => Promise<void>;
}

export default function ExerciseRenderer({
  labs,
  activeLabId,
  onSubmit,
  isSubmitting = false,
  onToggleCollect,
}: ExerciseRendererProps) {
  const { openAssistant, setTriggerMessage } = useChatAssistantStore();
  const { apiKeys, openaiApiKey, model, baseUrls } = useSettingsStore();
  const selectedAgentId: string = "auto"; // 默认自动路由

  // 1. 扁平化题目池
  const [cards, setCards] = useState<LabData[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // 2. 状态管理
  const [status, setStatus] = useState<"answering" | "checked">("answering");
  const [reportCard, setReportCard] = useState<{
    score: number;
    passed: boolean;
    passedCount: number;
    details: any[];
  } | null>(null);

  // 3. 当前卡片的作答状态
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [matches, setMatches] = useState<Record<string, string>>({}); // leftKey -> rightValue
  const [arrangeSteps, setArrangeSteps] = useState<string[]>([]);
  const [originalIndices, setOriginalIndices] = useState<number[]>([]);
  const [fillInputs, setFillInputs] = useState<string[]>([]);

  // 4. 使用 ref 记录所有题目的作答历史，避免切卡片丢失
  const sessionAnswersRef = useRef<Record<string, {
    quizAnswers: Record<string, number>;
    matches: Record<string, string>;
    originalIndices: number[];
    fillInputs: string[];
  }>>({});

  // 5. AI 诊断评语状态
  const [aiDiagnostic, setAiDiagnostic] = useState<string>("");
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  // 6. 当前卡片的真实收藏状态与错题自动收藏设置
  const [currentCollected, setCurrentCollected] = useState(false);
  const [autoCollectWrong, setAutoCollectWrong] = useState(false);
  const [modalCollectedIds, setModalCollectedIds] = useState<Record<string, boolean>>({});

  const activeCard = cards[currentIndex];

  // 动态感应当前卡片的真实收藏高亮状态
  useEffect(() => {
    if (activeCard) {
      collectionApi.checkIsCollected(activeCard.title)
        .then((res) => setCurrentCollected(res.is_collected))
        .catch(() => setCurrentCollected(false));
    }
  }, [activeCard]);

  // 从本地 localStorage 中读取错题自动收藏的配置
  useEffect(() => {
    const saved = localStorage.getItem("practice_auto_collect_wrong");
    if (saved === "true") {
      setAutoCollectWrong(true);
    }
  }, []);

  const handleAutoCollectWrongChange = (checked: boolean) => {
    setAutoCollectWrong(checked);
    localStorage.setItem("practice_auto_collect_wrong", String(checked));
  };

  // 用户点击当前卡片的收藏按钮
  const handleToggleCollectCurrent = async (card: LabData) => {
    if (onToggleCollect) {
      await onToggleCollect(card);
      try {
        const res = await collectionApi.checkIsCollected(card.title);
        setCurrentCollected(res.is_collected);
      } catch (err) {
        console.error("Failed to check collection status:", err);
      }
    }
  };

  const lastFingerprintRef = useRef<string>("");
  const labsFingerprint = (Array.isArray(labs) ? labs.map(l => l?.id).join(",") : labs?.id || "") + `_active_${activeLabId || ""}`;

  // 转换外部传入的 labs 为 cards 数组
  useEffect(() => {
    const list = Array.isArray(labs) ? labs : labs ? [labs] : [];
    setCards(list);
    
    // 仅在题目序列或初始定位实际变化时重置作答进度
    if (lastFingerprintRef.current !== labsFingerprint) {
      lastFingerprintRef.current = labsFingerprint;
      sessionAnswersRef.current = {};
      setStatus("answering");
      setReportCard(null);
      setAiDiagnostic("");
      
      // 定位初始题目
      let startIndex = 0;
      if (activeLabId && list.length > 0) {
        const foundIdx = list.findIndex(item => item.id === activeLabId);
        if (foundIdx !== -1) {
          startIndex = foundIdx;
        }
      }
      setCurrentIndex(startIndex);
      
      // 初始化首个卡片
      if (list[startIndex]) {
        loadCardAnswers(list[startIndex]);
      }
    }
  }, [labs, activeLabId, labsFingerprint]);

  // 从 ref 缓存中载入特定卡片答案，若无则初始化
  const loadCardAnswers = (card: LabData) => {
    const saved = sessionAnswersRef.current[card.id] || {
      quizAnswers: {},
      matches: {},
      originalIndices: [],
      fillInputs: [],
    };

    setQuizAnswers(saved.quizAnswers);
    setMatches(saved.matches);
    setSelectedLeft(null);

    const testCases = getSafeTestCases(card);

    if (card.lab_type === "arrange") {
      const steps = [...(testCases?.steps || [])];
      if (saved.originalIndices && saved.originalIndices.length === steps.length) {
        setOriginalIndices(saved.originalIndices);
        setArrangeSteps(saved.originalIndices.map(i => steps[i]));
      } else {
        setArrangeSteps(steps);
        setOriginalIndices(steps.map((_, i) => i));
      }
    }

    if (card.lab_type === "fill") {
      const blanks = testCases?.blanks || [];
      if (saved.fillInputs && saved.fillInputs.length === blanks.length) {
        setFillInputs(saved.fillInputs);
      } else {
        setFillInputs(Array(blanks.length).fill(""));
      }
    }
  };

  // 保存当前作答到 ref 缓存
  const saveCurrentCardAnswers = () => {
    const curCard = cards[currentIndex];
    if (curCard) {
      sessionAnswersRef.current[curCard.id] = {
        quizAnswers,
        matches,
        originalIndices,
        fillInputs,
      };
    }
  };

  // 切题处理
  const handleNavigate = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= cards.length) return;
    saveCurrentCardAnswers();
    setCurrentIndex(newIndex);
    loadCardAnswers(cards[newIndex]);
  };

  // 连线匹配点击
  const handleMatchClick = (side: "left" | "right", value: string) => {
    if (status === "checked") return;

    if (side === "left") {
      setSelectedLeft(value);
    } else if (side === "right" && selectedLeft) {
      setMatches((prev) => ({
        ...prev,
        [selectedLeft]: value,
      }));
      setSelectedLeft(null);
    }
  };

  // 清除某个连线
  const handleClearMatch = (leftKey: string) => {
    if (status === "checked") return;
    setMatches((prev) => {
      const copy = { ...prev };
      delete copy[leftKey];
      return copy;
    });
  };

  // 排序位置调整
  const handleMoveStep = (index: number, direction: "up" | "down") => {
    if (status === "checked") return;
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === arrangeSteps.length - 1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;

    setArrangeSteps((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });

    setOriginalIndices((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  // 统一提交所有卡片的作答并评测
  const handleCheckAllAnswers = async () => {
    // 1. 先保存当前正在做题卡片的临时数据
    saveCurrentCardAnswers();

    let totalScore = 0;
    let passedCount = 0;
    const detailedResults: any[] = [];

    // 2. 循环计算每张题卡的对错
    cards.forEach((card) => {
      const ans = sessionAnswersRef.current[card.id] || {
        quizAnswers: {},
        matches: {},
        originalIndices: [],
        fillInputs: [],
      };

      const testCases = getSafeTestCases(card);
      let cardScore = 0;
      let cardPassed = false;

      if (card.lab_type === "quiz") {
        const questions = testCases.questions || [];
        let correctCount = 0;
        questions.forEach((q: any) => {
          if (ans.quizAnswers[q.id] === q.answer) {
            correctCount++;
          }
        });
        cardScore = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
        cardPassed = cardScore >= 60;
      } 
      else if (card.lab_type === "match") {
        const pairs = testCases.pairs || {};
        const totalPairs = Object.keys(pairs).length;
        let correctPairs = 0;
        Object.entries(pairs).forEach(([left, right]) => {
          if (ans.matches[left] === right) {
            correctPairs++;
          }
        });
        cardScore = totalPairs > 0 ? Math.round((correctPairs / totalPairs) * 100) : 0;
        cardPassed = cardScore === 100; // 连线必须完全正确
      } 
      else if (card.lab_type === "arrange") {
        const correctOrder = testCases.correct_order || [];
        const userIndices = ans.originalIndices || [];
        const isExactlyCorrect = userIndices.length === correctOrder.length &&
          userIndices.every((val, index) => val === correctOrder[index]);
        cardScore = isExactlyCorrect ? 100 : 0;
        cardPassed = isExactlyCorrect;
      } 
      else if (card.lab_type === "fill") {
        const blanks = testCases.blanks || [];
        let correctBlanks = 0;
        blanks.forEach((correctVal: string, i: number) => {
          const userVal = (ans.fillInputs[i] || "").trim().toLowerCase();
          if (userVal === correctVal.trim().toLowerCase()) {
            correctBlanks++;
          }
        });
        cardScore = blanks.length > 0 ? Math.round((correctBlanks / blanks.length) * 100) : 0;
        cardPassed = cardScore === 100;
      }

      totalScore += cardScore;
      if (cardPassed) {
        passedCount++;
      }

      detailedResults.push({
        id: card.id,
        title: card.title,
        description: card.description,
        lab_type: card.lab_type,
        score: cardScore,
        passed: cardPassed,
        answers: ans,
        test_cases: testCases,
        detailed_explanation: card.detailed_explanation,
        rawCard: card,
      });
    });

    const finalScore = cards.length > 0 ? Math.round(totalScore / cards.length) : 0;
    const finalPassed = finalScore >= 60;

    const report = {
      score: finalScore,
      passed: finalPassed,
      passedCount,
      details: detailedResults,
    };

    // 错题自动静默收藏入库 (使用 Promise.all 等待完成，防止异步时序竞态导致 Modal 中星星状态不更新)
    if (autoCollectWrong) {
      const wrongDetails = detailedResults.filter(d => !d.passed);
      const collectPromises = wrongDetails.map(async (d) => {
        try {
          const check = await collectionApi.checkIsCollected(d.title);
          if (!check.is_collected) {
            await collectionApi.collectExercise({
              node_id: d.rawCard.node_id || undefined,
              title: d.rawCard.title,
              exercise_type: d.rawCard.lab_type,
              // 使用已解析的 test_cases（getSafeTestCases 保证返回对象），避免列表数据缺字段
              content: d.test_cases || {},
              answer: d.rawCard.answer || d.test_cases?.pairs || d.test_cases?.correct_order || d.test_cases?.blanks || {},
              explanation: d.rawCard.detailed_explanation
            });
          }
        } catch (err) {
          console.error("Auto collect wrong question failed:", err);
        }
      });
      await Promise.all(collectPromises);
    }

    setReportCard(report);
    setStatus("checked");
    setAiDiagnostic("");

    // 调用父级提交回调（同步数据点亮节点等）
    await onSubmit({
      score: finalScore,
      passed: finalPassed,
      answers: sessionAnswersRef.current,
    });
  };

  // 生成本地趣味导师学情批注 (在无 API Key 时的备用方案)
  const getLocalDiagnostic = (score: number) => {
    const tutor = selectedAgentId || "auto";

    if (tutor === "humor_mentor") {
      if (score === 100) return "汪汪！满分！不愧是本柴的最佳徒弟，快摸摸本柴的豆豆眉沾沾喜气，今天准能写出无 bug 代码！";
      if (score >= 80) return "汪！优秀！离满分就差那么一丁点儿啦，快给本柴喂一根肉骨头，下一回保准拿满分！";
      if (score >= 60) return "汪，及格啦！虽然通过了，但是底层逻辑还要再夯实一下哦。来，跟本柴一起念：KISS原则大法好！";
      return "汪呜...不及格耶。是不是刚才光顾着看本柴好看的红脸蛋分心了？别气馁，多找本柴聊聊，本柴用苏格拉底大法把你盘明白！";
    }

    if (tutor === "academic_mentor") {
      if (score === 100) return "嚯嚯！完美。你的逻辑推演毫无瑕疵，学士帽穗的荣光今天属于你，继续保持这份学术严谨！";
      if (score >= 80) return "嗯，成绩优异。漏掉的这道题只是一个小小的思维盲区，我已经将底层的核心原理标注在解析里，记得研读。";
      if (score >= 60) return "达到了及格线。但作为一个合格的系统工程师，你的异常防护和边界处理仍需加强，建议复习相关知识节点。";
      return "嚯...这个分数有些令人担忧。你的知识图谱在这个节点存在较为明显的断层。不要急躁，带上错题随时来找我，我们从第一性原理开始重构你的认知。";
    }

    if (tutor === "coach_mentor") {
      if (score === 100) return "哔哔！检测到完美代码回路！你的大脑逻辑核心运转效率已达100%，继续保持满载运行！";
      if (score >= 80) return "哔！优秀表现。发现一处微小的逻辑短路，已通过系统解析向你的内存中载入补丁，请注意同步。";
      if (score >= 60) return "及格，系统勉强运行。编译未报错，但资源占用过高，底层架构需要进一步重构优化，加油。";
      return "警告！系统崩溃！未通过核心功能测试。请立刻清理大脑缓存，启动修复程序，让我来为你重载知识库！";
    }

    // Default or auto
    if (score === 100) return "系统综合评分：100！你的各项知识链路均已成功点亮，完美达成目标！";
    if (score >= 80) return "系统综合评分：优秀。局部的细微链路存在些许噪声干扰，已自动规划优化路由，点击查看解析。";
    if (score >= 60) return "系统综合评分：合格。多项指标踩线通过，建议针对错题做学情分析。";
    return "警告：系统未达标。多处依赖链缺失，请重点攻克错题涉及的关联节点。";
  };

  // 呼叫 AI 成绩单智能诊断
  const handleAskAIDiagnostic = async () => {
    if (!reportCard) return;
    setAiLoading(true);
    setAiDiagnostic("");

    const currentModel = model || "gpt-3.5-turbo";
    const provider = currentModel.includes("gpt") || currentModel.includes("o1") ? "openai" : "anthropic";
    const apiKey = apiKeys[provider] || (provider === "openai" ? openaiApiKey : "") || "";
    const baseUrl = baseUrls[provider] || "";

    const agentDisplayNames: Record<string, string> = {
      auto: "智能路由导师",
      humor_mentor: "小柴导师",
      academic_mentor: "小鹰导师",
      coach_mentor: "小铁导师",
    };

    const targetTutor = agentDisplayNames[selectedAgentId] || "智能路由导师";
    const tutorStyle = selectedAgentId === "humor_mentor"
      ? "幽默、搞笑且喜欢汪汪叫的像素柴犬，说话爱用生活类比"
      : selectedAgentId === "academic_mentor"
      ? "古板但极其专业博学、重视第一性原理和学术规范的猫头鹰老教授"
      : selectedAgentId === "coach_mentor"
      ? "满脑子硬核逻辑、喜欢发出哔哔电波、注重系统性能和边界防御的机器人教练"
      : "冷静客观的系统分析专家";

    const prompt = `你扮演AI导师【${targetTutor}】（人设风格为：${tutorStyle}）。
用户刚刚完成了一套测试，总分是 ${reportCard.score} / 100，答对题目数是 ${reportCard.passedCount} / ${cards.length}。
题目测试结果列表：
${reportCard.details.map((d, i) => `题 ${i+1}: ${d.title} | 状态: ${d.passed ? '正确' : '错误'} | 得分: ${d.score}`).join('\n')}

请针对用户的这套测试表现，结合你的导师人设，给出一段100-150字生动风趣、口语化强、充满鼓励且能切中要害的智能诊断报告。千万不要输出任何 markdown 标题或大段列表，用纯文本口语表达。请使用中文回答。`;

    if (apiKey) {
      try {
        const url = `${baseUrl || (provider === "openai" ? "https://api.openai.com/v1" : "")}/chat/completions`;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        };
        const body = {
          model: currentModel,
          messages: [
            { role: "system", content: `You are ${targetTutor}, a helpful assistant representing a specific tutor persona.` },
            { role: "user", content: prompt }
          ],
          temperature: 0.7
        };

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        
        if (res.ok) {
          const resData = await res.json();
          const reply = resData.choices?.[0]?.message?.content;
          if (reply) {
            setAiDiagnostic(reply);
            setAiLoading(false);
            return;
          }
        }
      } catch (err) {
        console.error("AI Diagnostic fetch failed:", err);
      }
    }

    setTimeout(() => {
      setAiDiagnostic(getLocalDiagnostic(reportCard.score));
      setAiLoading(false);
    }, 600);
  };

  // 成绩单弹窗弹出时，预载入所有错题的收藏状态并缓存
  useEffect(() => {
    if (status === "checked" && reportCard) {
      const initCollectStates = async () => {
        const states: Record<string, boolean> = {};
        const promises = reportCard.details.map(async (d) => {
          try {
            const res = await collectionApi.checkIsCollected(d.title);
            states[d.id] = res.is_collected;
          } catch {
            states[d.id] = false;
          }
        });
        await Promise.all(promises);
        setModalCollectedIds(states);
      };
      initCollectStates();
    }
  }, [status, reportCard]);

  // 成绩单 Modal 内点击收藏
  const handleToggleCollectInModal = async (card: LabData) => {
    if (onToggleCollect) {
      await onToggleCollect(card);
      try {
        const res = await collectionApi.checkIsCollected(card.title);
        setModalCollectedIds((prev) => ({
          ...prev,
          [card.id]: res.is_collected
        }));
        // 如果正好是当前卡片，同步更新主高亮
        if (card.id === activeCard?.id) {
          setCurrentCollected(res.is_collected);
        }
      } catch (err) {
        console.error("Toggle modal collect state failed:", err);
      }
    }
  };

  // AI 导师一对一讲解单个错题
  const handleAskSingleExplanation = (cardResult: any) => {
    let userMessage = `老师！我刚刚在做关于「${cardResult.title}」的练习。`;
    userMessage += `\n题型是：${
      cardResult.lab_type === "quiz" ? "概念选择题" : 
      cardResult.lab_type === "match" ? "概念生活类比连线匹配题" : 
      cardResult.lab_type === "arrange" ? "流程/步骤排序题" : "填空题"
    }。`;
    userMessage += `\n\n【题目描述】：\n${cardResult.description}`;
    
    if (cardResult.lab_type === "quiz") {
      const questions = cardResult.test_cases.questions || [];
      userMessage += `\n\n【具体题目内容】：`;
      questions.forEach((q: any) => {
        const userChoice = q.options[cardResult.answers.quizAnswers[q.id]] || "未作答";
        const correctChoice = q.options[q.answer];
        userMessage += `\n- 题目：${q.text}\n  - 我的回答：${userChoice} （状态：${cardResult.answers.quizAnswers[q.id] === q.answer ? "回答正确" : "回答错误"}）\n  - 正确答案应该是：${correctChoice}`;
      });
    } 
    else if (cardResult.lab_type === "match") {
      userMessage += `\n\n【匹配状态】：`;
      userMessage += `\n- 左侧概念术语：${JSON.stringify(cardResult.test_cases.left)}`;
      userMessage += `\n- 右侧生活类比：${JSON.stringify(cardResult.test_cases.right)}`;
      userMessage += `\n- 正确配对关系：${JSON.stringify(cardResult.test_cases.pairs)}`;
      userMessage += `\n- 我的配对回答：${JSON.stringify(cardResult.answers.matches)}`;
    } 
    else if (cardResult.lab_type === "arrange") {
      userMessage += `\n\n【排序结果】：`;
      userMessage += `\n- 标准步骤：${JSON.stringify(cardResult.test_cases.steps)}`;
      userMessage += `\n- 我的排序索引序列：${JSON.stringify(cardResult.answers.originalIndices)} （标准序列应该是：${JSON.stringify(cardResult.test_cases.correct_order)}）`;
    } 
    else if (cardResult.lab_type === "fill") {
      userMessage += `\n\n【填空详情】：`;
      userMessage += `\n- 题目挖空正文：${cardResult.test_cases.text}`;
      userMessage += `\n- 我的填空：${JSON.stringify(cardResult.answers.fillInputs)} （标准答案应该是：${JSON.stringify(cardResult.test_cases.blanks)}）`;
    }

    if (cardResult.detailed_explanation) {
      userMessage += `\n\n【标准解答】：\n${cardResult.detailed_explanation}`;
    }

    openAssistant(cardResult.rawCard.node_id || undefined, cardResult.title);
    setTriggerMessage(userMessage);
  };

  if (cards.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400 font-bold text-xs py-12">
        暂无题目数据
      </div>
    );
  }



  return (
    <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-6 transition-all duration-300 relative">
      
      {/* 1. 顶部卡片指示器与操作 */}
      <div className="flex items-center justify-between border-b-2 border-black/15 pb-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-black px-2.5 py-0.5 w-fit rounded-lg bg-amber-200 dark:bg-amber-600 text-black dark:text-white border-2 border-black uppercase tracking-wider font-mono shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]">
            {activeCard.lab_type === "quiz" ? "Concept Quiz" : activeCard.lab_type === "match" ? "Interactive Match" : activeCard.lab_type === "arrange" ? "Logical Arrange" : "Concept Fill"}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <h2 className="text-base font-black text-black dark:text-white leading-tight">{activeCard.title}</h2>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-300 font-bold font-mono bg-amber-50 dark:bg-zinc-800 border-2 border-black/20 px-2 py-0.5 rounded-md">
              {currentIndex + 1} / {cards.length}
            </span>
          </div>
        </div>

        {/* 单题收藏 */}
        {onToggleCollect && (
          <button
            onClick={() => handleToggleCollectCurrent(activeCard)}
            className={cn(
              "p-2 rounded-xl border-2 transition-all duration-200",
              currentCollected
                ? "bg-amber-500/10 border-amber-400/30 text-amber-500 hover:bg-amber-500/20"
                : "border-black/20 text-zinc-400 hover:border-black hover:bg-amber-50 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300"
            )}
            title={currentCollected ? "取消收藏" : "收藏本题"}
          >
            <Star className={cn("h-4 w-4", currentCollected && "fill-current")} />
          </button>
        )}
      </div>

      {/* 2. 卡片题目说明 */}
      <div className="bg-amber-50 dark:bg-zinc-800 rounded-2xl p-4 border-2 border-black/15">
        <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{activeCard.description}</p>
      </div>

      {/* 3. 答题交互区域 (卡片内部) */}
      <div className="flex-1 min-h-[180px] py-2">
        {(() => {
          const activeTestCases = getSafeTestCases(activeCard);
          return (
            <>
              {/* 单项选择题 Quiz */}
              {activeCard.lab_type === "quiz" && (
                <div className="space-y-4">
                  {(activeTestCases.questions || []).map((q: any, qIdx: number) => (
                    <div key={q.id} className="space-y-2">
                      <h4 className="text-xs font-black text-black dark:text-white leading-normal">
                        {qIdx + 1}. {q.text}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {q.options.map((opt: string, optIdx: number) => (
                          <button
                            key={optIdx}
                            onClick={() => setQuizAnswers((prev) => ({ ...prev, [q.id]: optIdx }))}
                            className={cn(
                              "w-full text-left px-4 py-3 rounded-2xl text-xs transition-all duration-150 flex items-center gap-2",
                              quizAnswers[q.id] === optIdx
                                ? "border-2 border-black bg-amber-100 dark:bg-amber-700/40 text-black dark:text-white font-black translate-x-[1px] translate-y-[1px] shadow-none"
                                : "border-2 border-black/20 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:border-black hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
                            )}
                          >
                            <span className="font-mono font-black w-5 h-5 rounded border-2 border-black/30 bg-amber-50 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-300">
                              {String.fromCharCode(65 + optIdx)}
                            </span>
                            <span className="flex-1 truncate">{opt}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 连线匹配题 Match */}
              {activeCard.lab_type === "match" && (
                <div className="space-y-3">
                  <p className="text-[10px] text-amber-700 dark:text-amber-300 font-bold bg-amber-100/70 dark:bg-amber-900/30 border-2 border-black/10 p-2 rounded-xl w-fit">
                    提示：先点击左侧的术语，再点击右侧对应的趣味生活类比配对！
                  </p>
                  <div className="grid grid-cols-2 gap-6 relative mt-2">
                    <div className="space-y-2">
                      {(activeTestCases.left || []).map((leftVal: string) => {
                        const matchedRight = matches[leftVal];
                        return (
                          <button
                            key={leftVal}
                            onClick={() => handleMatchClick("left", leftVal)}
                            className={cn(
                              "w-full text-left px-4 py-3.5 rounded-2xl text-xs transition-all duration-200 flex items-center justify-between",
                              selectedLeft === leftVal
                                ? "border-2 border-black bg-amber-100 dark:bg-amber-700/40 text-black dark:text-white font-black translate-x-[1px] translate-y-[1px] shadow-none"
                                : matchedRight
                                ? "border-2 border-green-600 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-bold"
                                : "border-2 border-black/20 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:border-black hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
                            )}
                          >
                            <span className="truncate">{leftVal}</span>
                            {matchedRight && (
                              <span 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleClearMatch(leftVal);
                                }}
                                className="text-[9px] text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 px-2 py-0.5 rounded-md font-black transition-all"
                              >
                                取消
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-2">
                      {(activeTestCases.right || []).map((rightVal: string) => {
                        const matchedLeftKey = Object.keys(matches).find(k => matches[k] === rightVal);
                        return (
                          <button
                            key={rightVal}
                            onClick={() => handleMatchClick("right", rightVal)}
                            className={cn(
                              "w-full text-left px-4 py-3.5 rounded-2xl text-xs transition-all duration-200",
                              matchedLeftKey
                                ? "border-2 border-green-600 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-bold"
                                : selectedLeft
                                ? "border-2 border-amber-400 text-zinc-500 dark:text-zinc-400 hover:border-black hover:bg-amber-50 dark:hover:bg-zinc-800 animate-pulse"
                                : "border-2 border-black/20 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:border-black hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
                            )}
                          >
                            <span className="block truncate">{rightVal}</span>
                            {matchedLeftKey && (
                              <span className="block text-[8px] text-zinc-500 dark:text-zinc-400 mt-1 font-mono font-semibold truncate">
                                已配对: {matchedLeftKey}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* 步骤排序题 Arrange */}
              {activeCard.lab_type === "arrange" && (
                <div className="space-y-3">
                  <p className="text-[10px] text-amber-700 dark:text-amber-300 font-bold bg-amber-100/70 dark:bg-amber-900/30 border-2 border-black/10 p-2 rounded-xl w-fit">
                    提示：请用卡片右侧的上下箭头调整步骤顺序，重组成正确的业务逻辑链！
                  </p>
                  <div className="space-y-2 mt-2">
                    {arrangeSteps.map((step, idx) => (
                      <div
                        key={idx}
                        className="bg-white dark:bg-zinc-800 border-2 border-black/20 rounded-2xl p-3.5 flex items-center justify-between text-xs transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-5 h-5 rounded-full border-2 border-black/30 bg-amber-100 dark:bg-zinc-700 text-[10px] font-black font-mono flex items-center justify-center text-zinc-600 dark:text-zinc-300">
                            {idx + 1}
                          </span>
                          <span className="text-black dark:text-zinc-200 font-bold leading-relaxed">{step}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleMoveStep(idx, "up")}
                            disabled={idx === 0}
                            className="p-1.5 rounded-lg border-2 border-black/20 hover:border-black hover:bg-amber-50 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 disabled:pointer-events-none transition-all"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleMoveStep(idx, "down")}
                            disabled={idx === arrangeSteps.length - 1}
                            className="p-1.5 rounded-lg border-2 border-black/20 hover:border-black hover:bg-amber-50 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 disabled:pointer-events-none transition-all"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 概念填空题 Fill */}
              {activeCard.lab_type === "fill" && (
                <div className="space-y-3">
                  <p className="text-[10px] text-amber-700 dark:text-amber-300 font-bold bg-amber-100/70 dark:bg-amber-900/30 border-2 border-black/10 p-2 rounded-xl w-fit">
                    提示：请在下方文本空缺的输入框中，键入填空项！
                  </p>
                  <div className="bg-amber-50 dark:bg-zinc-800 border-2 border-black/15 rounded-2xl p-5 leading-relaxed text-zinc-700 dark:text-zinc-200 text-xs">
                    {(() => {
                      const text = activeTestCases.text || "";
                      const parts = text.split(/___/);
                      return parts.map((part: string, idx: number) => (
                        <React.Fragment key={idx}>
                          <span>{part}</span>
                          {idx < parts.length - 1 && (
                            <input
                              type="text"
                              value={fillInputs[idx] || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFillInputs((prev) => {
                                  const copy = [...prev];
                                  copy[idx] = val;
                                  return copy;
                                });
                              }}
                              placeholder={`填空 ${idx + 1}`}
                              className="mx-1 px-3 py-1 text-center bg-white dark:bg-zinc-900 border-2 border-black rounded-xl text-xs font-black text-black dark:text-white focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:shadow-none transition-all w-28 inline-block"
                            />
                          )}
                        </React.Fragment>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* 4. 底部翻页控制器与答题卡导航条 */}
      <div className="border-t-2 border-black/15 pt-4 flex flex-col gap-4">
        
        {/* 题号快速导航指示器 */}
        {cards.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {cards.map((card, idx) => {
              const ans = sessionAnswersRef.current[card.id] || {};
              const curAns = idx === currentIndex ? { quizAnswers, matches, originalIndices, fillInputs } : ans;
              
              let isAnswered = false;
              if (card.lab_type === "quiz" && Object.keys(curAns.quizAnswers || {}).length > 0) isAnswered = true;
              if (card.lab_type === "match" && Object.keys(curAns.matches || {}).length > 0) isAnswered = true;
              if (card.lab_type === "arrange") isAnswered = true;
              if (card.lab_type === "fill" && (curAns.fillInputs || []).some(v => v.trim() !== "")) isAnswered = true;

              return (
                <button
                  key={card.id}
                  onClick={() => handleNavigate(idx)}
                  className={cn(
                    "w-7 h-7 rounded-xl text-[10px] font-black transition-all flex items-center justify-center",
                    idx === currentIndex
                      ? "border-2 border-black bg-amber-400 text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      : isAnswered
                      ? "bg-amber-100 dark:bg-amber-700/40 border-2 border-black/30 text-zinc-700 dark:text-zinc-200"
                      : "bg-white dark:bg-zinc-900 border-2 border-black/20 text-zinc-400 hover:border-black"
                  )}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        )}

        {/* 前进/后退/统一提交大按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleNavigate(currentIndex - 1)}
              disabled={currentIndex === 0}
              className="px-4 py-2.5 rounded-xl border-2 border-black bg-white dark:bg-zinc-800 text-black dark:text-white text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all flex items-center gap-1 disabled:opacity-35 disabled:pointer-events-none"
            >
              <ChevronLeft className="h-4 w-4" />
              上一题
            </button>

            <button
              onClick={() => handleNavigate(currentIndex + 1)}
              disabled={currentIndex === cards.length - 1}
              className="px-4 py-2.5 rounded-xl border-2 border-black bg-white dark:bg-zinc-800 text-black dark:text-white text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all flex items-center gap-1 disabled:opacity-35 disabled:pointer-events-none"
            >
              下一题
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoCollectWrong}
                onChange={(e) => handleAutoCollectWrongChange(e.target.checked)}
                className="accent-amber-500 w-3.5 h-3.5"
              />
              错题自动收藏
            </label>

            <button
              onClick={handleCheckAllAnswers}
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl border-2 border-black bg-amber-300 dark:bg-amber-600 text-black dark:text-white font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在评测中...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  提交本篇答卷
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 5. 成绩单诊断 Modal Overlay */}
      {status === "checked" && reportCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200 p-4">
          <div className="w-[min(680px,95vw)] max-h-[85vh] bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-5 overflow-y-auto animate-in zoom-in-95 duration-200">

            {/* Modal Header */}
            <div className="flex items-center justify-between border-b-2 border-black pb-3">
              <h3 className="text-base font-black text-black dark:text-white flex items-center gap-1.5">
                <Trophy className="h-5 w-5 text-amber-500" />
                小考成绩单诊断报告
              </h3>
              <button
                onClick={() => {
                  setReportCard(null);
                  setStatus("answering");
                }}
                className="p-1.5 rounded-xl border-2 border-black bg-white dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900 text-black dark:text-white transition-colors"
                aria-label="关闭成绩单"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Score & Medal Widget */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-amber-50 dark:bg-zinc-800 p-5 rounded-2xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex flex-col items-center justify-center text-center gap-1">
                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-black">综合考核得分</div>
                <div className="text-4xl font-black font-mono text-black dark:text-white mt-1">
                  {reportCard.score} <span className="text-xs text-zinc-400 font-bold">/ 100</span>
                </div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold mt-1">
                  通关率：{reportCard.passedCount} / {cards.length} 题正确
                </div>
              </div>

              {/* Medal Indicator */}
              <div className="flex flex-col items-center justify-center text-center gap-2 border-t-2 md:border-t-0 md:border-l-2 border-black/20 pt-4 md:pt-0">
                <div className="p-3 bg-white dark:bg-zinc-900 rounded-full border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] animate-bounce">
                  {reportCard.score === 100 ? (
                    <Trophy className="h-8 w-8 text-amber-500" />
                  ) : reportCard.score >= 80 ? (
                    <Award className="h-8 w-8 text-amber-600" />
                  ) : reportCard.score >= 60 ? (
                    <Award className="h-8 w-8 text-green-600" />
                  ) : (
                    <Brain className="h-8 w-8 text-zinc-400" />
                  )}
                </div>
                <div>
                  <h4 className="text-xs font-black text-black dark:text-white">
                    {reportCard.score === 100 ? "圆满通关 (Perfect)" :
                     reportCard.score >= 80 ? "优秀学者 (Excellent)" :
                     reportCard.score >= 60 ? "通过勇士 (Passed)" : "再接再励 (Keep Trying)"}
                  </h4>
                  <p className="text-[9px] text-zinc-500 dark:text-zinc-400 font-bold mt-0.5">继续沉淀，攻克盲点</p>
                </div>
              </div>
            </div>

            {/* AI 导师诊断评语区 */}
            <div className="bg-sky-50 dark:bg-sky-900/30 border-2 border-black rounded-2xl p-4 flex flex-col gap-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-black dark:text-sky-100 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  AI 导师智能诊断批注
                </h4>
                {!aiDiagnostic && !aiLoading && (
                  <button
                    onClick={handleAskAIDiagnostic}
                    className="px-3 py-1.5 rounded-lg border-2 border-black bg-amber-300 dark:bg-amber-600 text-black dark:text-white text-[10px] font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                  >
                    一键分析学情
                  </button>
                )}
              </div>

              {aiLoading && (
                <div className="flex items-center gap-2 py-4 justify-center text-xs font-bold text-zinc-500 dark:text-zinc-300">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  <span>导师正在仔细翻阅答卷，分析您的思维盲区...</span>
                </div>
              )}

              {aiDiagnostic && (
                <p className="text-xs text-zinc-700 dark:text-zinc-200 leading-relaxed font-bold">
                  {aiDiagnostic}
                </p>
              )}
            </div>

            {/* 对错看盘导航格子 */}
            <div className="space-y-2">
              <h4 className="text-xs font-black text-zinc-500 dark:text-zinc-400">作答细节评估</h4>
              <div className="flex items-center gap-2 flex-wrap">
                {reportCard.details.map((d, i) => (
                  <a
                    key={d.id}
                    href={`#report-card-item-${d.id}`}
                    className={cn(
                      "w-8 h-8 rounded-xl text-[10px] font-black flex items-center justify-center transition-all border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none",
                      d.passed
                        ? "bg-green-300 dark:bg-green-700 text-black dark:text-white"
                        : "bg-red-300 dark:bg-red-800 text-black dark:text-white"
                    )}
                  >
                    {i + 1}
                  </a>
                ))}
              </div>
            </div>

            {/* 详细答案与解析列表 */}
            <div className="space-y-4 border-t-2 border-black pt-4 max-h-[300px] overflow-y-auto pr-1">
              {reportCard.details.map((d, idx) => (
                <div
                  key={d.id}
                  id={`report-card-item-${d.id}`}
                  className={cn(
                    "border-2 border-black rounded-2xl p-4 space-y-3 scroll-mt-2 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]",
                    d.passed ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "w-5 h-5 rounded-full border-2 border-black text-[9px] font-mono font-black flex items-center justify-center text-black dark:text-white",
                        d.passed ? "bg-green-300 dark:bg-green-700" : "bg-red-300 dark:bg-red-800"
                      )}>
                        {idx + 1}
                      </span>
                      <h4 className="font-black text-xs text-black dark:text-white">{d.title}</h4>
                    </div>

                    {onToggleCollect && (
                      <button
                        onClick={() => handleToggleCollectInModal(d.rawCard)}
                        className={cn(
                          "transition-all duration-200 p-1",
                          modalCollectedIds[d.id]
                            ? "text-amber-500 hover:text-amber-600"
                            : "text-zinc-400 hover:text-amber-500"
                        )}
                        title={modalCollectedIds[d.id] ? "取消收藏此题" : "收藏此题"}
                      >
                        <Star className={cn("h-3.5 w-3.5", modalCollectedIds[d.id] && "fill-current")} />
                      </button>
                    )}
                  </div>

                  <p className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 leading-relaxed">{d.description}</p>

                  {/* 针对不同题型输出答题对错与对照 */}
                  <div className="text-[10px] space-y-1 bg-white dark:bg-zinc-900 p-3 rounded-xl border-2 border-black/20">
                    {d.lab_type === "quiz" && (
                      <div>
                        {d.test_cases.questions.map((q: any) => {
                          const userAnsIdx = d.answers.quizAnswers[q.id];
                          const userAnsText = q.options[userAnsIdx] || "未选择";
                          const correctAnsText = q.options[q.answer];
                          return (
                            <div key={q.id} className="space-y-0.5 border-b border-black/10 pb-1.5 mb-1.5 last:border-0 last:pb-0 last:mb-0">
                              <p className="font-semibold text-zinc-700 dark:text-zinc-200">问: {q.text}</p>
                              <p className={cn("font-medium", userAnsIdx === q.answer ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400")}>
                                我的回答: {userAnsText} ({userAnsIdx === q.answer ? "正确" : "错误"})
                              </p>
                              {userAnsIdx !== q.answer && (
                                <p className="text-zinc-500 dark:text-zinc-400">正确参考答案: {correctAnsText}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {d.lab_type === "match" && (
                      <div className="space-y-1">
                        <p className="font-bold text-zinc-700 dark:text-zinc-200">配对映射表：</p>
                        {Object.entries(d.test_cases.pairs || {}).map(([left, right]) => {
                          const userMatch = d.answers.matches[left];
                          return (
                            <div key={left} className="flex items-center gap-1.5">
                              <span className="text-zinc-500 dark:text-zinc-400 font-semibold">【{left}】 ──</span>
                              <span className={cn("font-semibold", userMatch === right ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400")}>
                                {userMatch || "未连线"} ({userMatch === right ? "正确" : `应为: ${right}`})
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {d.lab_type === "arrange" && (
                      <div className="space-y-1">
                        <p className="font-bold text-zinc-700 dark:text-zinc-200">排序步骤对照：</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[9px] text-zinc-500 dark:text-zinc-400 font-semibold">您的排序：</p>
                            {(d.answers.originalIndices || []).map((stepIdx: number, i: number) => (
                              <p key={i} className="text-red-500 dark:text-red-400 font-medium">
                                {i + 1}. {d.test_cases.steps[stepIdx] || "空"}
                              </p>
                            ))}
                          </div>
                          <div>
                            <p className="text-[9px] text-zinc-500 dark:text-zinc-400 font-semibold">标准顺序：</p>
                            {(d.test_cases.correct_order || []).map((stepIdx: number, i: number) => (
                              <p key={i} className="text-green-600 dark:text-green-400 font-semibold">
                                {i + 1}. {d.test_cases.steps[stepIdx]}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {d.lab_type === "fill" && (
                      <div className="space-y-1">
                        <p className="font-bold text-zinc-700 dark:text-zinc-200">填空词对照：</p>
                        {d.test_cases.blanks.map((correctVal: string, i: number) => {
                          const userVal = (d.answers.fillInputs[i] || "").trim().toLowerCase();
                          const isBlankCorrect = userVal === correctVal.trim().toLowerCase();
                          return (
                            <div key={i} className="flex items-center gap-1">
                              <span className="text-zinc-500 dark:text-zinc-400">填空 {i + 1}: </span>
                              <span className={cn("font-semibold", isBlankCorrect ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400")}>
                                {d.answers.fillInputs[i] || "未填写"} ({isBlankCorrect ? "正确" : `应为: ${correctVal}`})
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 内置原理解析 */}
                  {d.detailed_explanation && (
                    <div className="bg-amber-50 dark:bg-zinc-800 rounded-xl p-3.5 border-2 border-black/15">
                      <h5 className="text-[10px] font-black text-zinc-700 dark:text-zinc-200 flex items-center gap-1 mb-1">
                        <Brain className="h-3.5 w-3.5 text-amber-500" />
                        题目背景与原理解释
                      </h5>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        {d.detailed_explanation}
                      </p>
                    </div>
                  )}

                  {/* 呼叫一对一 AI 讲解 */}
                  <button
                    onClick={() => handleAskSingleExplanation(d)}
                    className="w-full py-2 rounded-xl border-2 border-black bg-amber-100 dark:bg-amber-700/40 hover:bg-amber-200 dark:hover:bg-amber-700/60 text-black dark:text-white text-[10px] font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="h-3 w-3" />
                    呼叫 AI 导师对本题进行趣味小故事讲解
                  </button>
                </div>
              ))}
            </div>

            {/* Modal Bottom Actions */}
            <div className="flex items-center gap-3 border-t-2 border-black/15 pt-3">
              <button
                onClick={() => {
                  setReportCard(null);
                  setStatus("answering");
                }}
                className="flex-1 py-3 rounded-2xl border-2 border-black bg-amber-300 dark:bg-amber-600 text-black dark:text-white font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重新作答挑战
              </button>
              <button
                onClick={() => {
                  setReportCard(null);
                  setStatus("answering");
                }}
                className="px-5 py-3 rounded-2xl border-2 border-black bg-white dark:bg-zinc-800 text-black dark:text-white text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
              >
                留在答题页
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
