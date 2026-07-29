"use client";

import React, { useState, useEffect, useRef } from "react";
import { useChatAssistantStore } from "@/stores/chat-assistant";
import { useSettingsStore } from "@/stores/settings";
import { useChat } from "@/hooks/use-chat";
import {
  Sparkles,
  X,
  Brain,
  BookOpen,
  Wrench,
  ChevronDown,
  ArrowUp,
  MessageSquare,
  Plus,
  Loader2,
  Paperclip,
  Network,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { WorkflowPanel } from "@/components/workflow-panel";
import SourceChips from "@/components/source-chips";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PixelAgentAvatar } from "./pixel-agent-avatar";

// Python 相关快捷提问池 — 每次打开聊天框随机抽取 2 条展示
const ALL_QUICK_PROMPTS: { label: string; message: string }[] = [
  { label: "列表推导式 vs 生成器", message: "Python 的列表推导式和生成器有什么区别？什么时候该用哪个？" },
  { label: "用装饰器写个计时器", message: "用 Python 装饰器实现一个函数计时器，并解释装饰器的原理" },
  { label: "GIL 是什么？", message: "解释 Python 的 GIL（全局解释器锁）是什么，它对多线程有什么影响？" },
  { label: "写个猜数字游戏", message: "用 Python 写一个简单的猜数字游戏，带我理解随机数和循环" },
  { label: "切片操作技巧", message: "Python 的切片操作有哪些高级技巧？给我举几个例子" },
  { label: "实现快速排序", message: "用 Python 实现快速排序，并用生活类比解释它的原理" },
  { label: "with 语句怎么用？", message: "Python 的 with 语句和上下文管理器怎么用？自己怎么实现一个？" },
  { label: "写个命令行计算器", message: "用 Python 写一个命令行计算器，支持加减乘除" },
  { label: "闭包是什么？", message: "用通俗的方式解释 Python 的闭包，并给出一个实际例子" },
  { label: "用 pygame 画贪吃蛇", message: "用 Python 的 pygame 实现一个简单的贪吃蛇游戏框架" },
  { label: "字典和集合的区别", message: "Python 的 dict 和 set 底层是怎么实现的？它们有什么联系？" },
  { label: "多进程 vs 多线程", message: "Python 中多进程和多线程分别适合什么场景？怎么选择？" },
];

export default function FloatingChatAssistant() {
  const {
    isOpen,
    contextNodeId,
    contextNodeName,
    triggerMessage,
    closeAssistant,
    clearContext,
    setTriggerMessage
  } = useChatAssistantStore();

  const {
    useRAG,
    useMemory,
    useTools,
    setUseRAG,
    setUseMemory,
    setUseTools,
  } = useSettingsStore();

  const {
    messages,
    setMessages,
    isLoading,
    errorMessage,
    workflowSteps,
    conversations,
    currentConversationId,
    setCurrentConversationId,
    selectedAgentId,
    setSelectedAgentId,
    fetchConversations,
    createNewConversation,
    loadConversation,
    handleSend,
    handleRegenerate,
  } = useChat();

  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false); // 扩展到屏幕中央
  const [showAgentMenu, setShowAgentMenu] = useState(false); // 导师选择下拉菜单
  const [quickPrompts, setQuickPrompts] = useState<{ label: string; message: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);

  // 拖动悬浮球相关的状态
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isMounted, setIsMounted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0, time: 0 });
  // 用 ref 同步追踪最新位置，规避 mouseup 回调中的闭包陷阱
  const positionRef = useRef({ x: 0, y: 0 });

  // 认证状态：未登录时不渲染助手（解决登录页显示问题）
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // 追踪上一次的 token 值，检测用户切换
  const prevTokenRef = useRef<string | null>(null);

  // 认证检查 + 用户切换检测
  useEffect(() => {
    const checkAuth = () => {
      const token = localStorage.getItem("cognilink_token");
      // token 变化（登出 / 换用户登录）时重置聊天状态
      if (prevTokenRef.current !== token) {
        if (prevTokenRef.current !== null) {
          // 不是首次挂载，说明用户切换了，清空前用户的状态
          setMessages([]);
          setCurrentConversationId(null);
          closeAssistant();
        }
        prevTokenRef.current = token;
      }
      setIsAuthenticated(!!token);
    };
    checkAuth();
    // 跨标签页登出感知
    window.addEventListener("storage", checkAuth);
    // 同标签页内登出（handleLogout dispatch 自定义事件）
    window.addEventListener("cognilink-logout", checkAuth);
    // 同标签页内登录（从 login 页跳回后重新检测）
    window.addEventListener("focus", checkAuth);
    return () => {
      window.removeEventListener("storage", checkAuth);
      window.removeEventListener("cognilink-logout", checkAuth);
      window.removeEventListener("focus", checkAuth);
    };
  }, [setMessages, setCurrentConversationId, closeAssistant]);

  // 初始化加载位置
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMounted(true);
      const savedX = localStorage.getItem("chat_assistant_x");
      const savedY = localStorage.getItem("chat_assistant_y");
      const padding = 24;
      const buttonSize = 56;
      
      let initX = window.innerWidth - buttonSize - padding;
      let initY = window.innerHeight - buttonSize - padding;
      
      if (savedX !== null && savedY !== null) {
        const xVal = Number(savedX);
        const yVal = Number(savedY);
        initX = Math.max(0, Math.min(xVal, window.innerWidth - buttonSize));
        initY = Math.max(0, Math.min(yVal, window.innerHeight - buttonSize));
      }
      setPosition({ x: initX, y: initY });
      positionRef.current = { x: initX, y: initY };
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  // 响应式大小监听
  useEffect(() => {
    if (!isMounted) return;
    
    const handleResize = () => {
      const buttonSize = 56;
      const padding = 24;
      
      setPosition((prev) => {
        const isLeft = (prev.x + buttonSize / 2) < window.innerWidth / 2;
        const newX = isLeft ? padding : window.innerWidth - buttonSize - padding;
        const newY = Math.max(padding, Math.min(prev.y, window.innerHeight - buttonSize - padding));
        positionRef.current = { x: newX, y: newY };
        return { x: newX, y: newY };
      });
    };
    
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMounted]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
      time: 0,
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    const deltaX = e.clientX - dragStart.current.x;
    const deltaY = e.clientY - dragStart.current.y;
    
    let newX = dragStart.current.posX + deltaX;
    let newY = dragStart.current.posY + deltaY;
    
    const buttonSize = 56;
    newX = Math.max(0, Math.min(newX, window.innerWidth - buttonSize));
    newY = Math.max(0, Math.min(newY, window.innerHeight - buttonSize));
    
    positionRef.current = { x: newX, y: newY };
    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = (e: MouseEvent) => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    setIsDragging(false);
    
    const deltaX = e.clientX - dragStart.current.x;
    const deltaY = e.clientY - dragStart.current.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (distance < 6) {
      useChatAssistantStore.getState().openAssistant();
      return;
    }
    
    // 从 ref 读取最新位置，规避闭包陷阱
    snapToEdge(positionRef.current.x, positionRef.current.y);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    const touch = e.touches[0];
    dragStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      posX: position.x,
      posY: position.y,
      time: 0,
    };
    
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
  };

  const handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    const deltaX = touch.clientX - dragStart.current.x;
    const deltaY = touch.clientY - dragStart.current.y;
    
    let newX = dragStart.current.posX + deltaX;
    let newY = dragStart.current.posY + deltaY;
    
    const buttonSize = 56;
    newX = Math.max(0, Math.min(newX, window.innerWidth - buttonSize));
    newY = Math.max(0, Math.min(newY, window.innerHeight - buttonSize));
    
    positionRef.current = { x: newX, y: newY };
    setPosition({ x: newX, y: newY });
  };

  const handleTouchEnd = (e: TouchEvent) => {
    document.removeEventListener("touchmove", handleTouchMove);
    document.removeEventListener("touchend", handleTouchEnd);
    setIsDragging(false);
    
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - dragStart.current.x;
    const deltaY = touch.clientY - dragStart.current.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (distance < 6) {
      useChatAssistantStore.getState().openAssistant();
      return;
    }
    
    // 从 ref 读取最新位置，规避闭包陷阱
    snapToEdge(positionRef.current.x, positionRef.current.y);
  };

  const snapToEdge = (currentX: number, currentY: number) => {
    const buttonSize = 56;
    const padding = 24;
    const centerX = currentX + buttonSize / 2;
    
    const isLeft = centerX < window.innerWidth / 2;
    const targetX = isLeft ? padding : window.innerWidth - buttonSize - padding;
    
    let targetY = currentY;
    targetY = Math.max(padding, Math.min(targetY, window.innerHeight - buttonSize - padding));
    
    setPosition({ x: targetX, y: targetY });
    positionRef.current = { x: targetX, y: targetY };
    localStorage.setItem("chat_assistant_x", String(targetX));
    localStorage.setItem("chat_assistant_y", String(targetY));
  };

  const isLeftAligned = isMounted && (position.x + 28) < window.innerWidth / 2;

  // 初始化获取对话列表 + 每次打开随机刷新快捷提问
  useEffect(() => {
    if (isOpen) {
      fetchConversations();
      // 随机抽取 2 条快捷提问
      const shuffled = [...ALL_QUICK_PROMPTS].sort(() => Math.random() - 0.5);
      setTimeout(() => {
        setQuickPrompts(shuffled.slice(0, 2));
      }, 0);
    }
  }, [isOpen]);

  // 点击外部关闭导师下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setShowAgentMenu(false);
      }
    };
    if (showAgentMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAgentMenu]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, workflowSteps]);

  // 监听并执行答题界面的 AI 联动讲解消息
  useEffect(() => {
    if (isOpen && triggerMessage) {
      handleSend(triggerMessage);
      setTriggerMessage(null);
    }
  }, [isOpen, triggerMessage]);

  // 感知上下文节点并自动注入欢迎消息
  useEffect(() => {
    if (isOpen && contextNodeId && contextNodeName) {
      // 只有在当前消息列表为空或刚打开时，自动注入推荐引导
      if (messages.length === 0) {
        setMessages([
          {
            id: "welcome-context",
            role: "assistant",
            content: `你好！看起来你正在探索【${contextNodeName}】。需要我用生动的生活故事来给你讲讲这个概念，还是带你用代码实操一下呢？`,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    }
  }, [isOpen, contextNodeId, contextNodeName]);

  // 调整输入框高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        120
      )}px`;
    }
  }, [input]);

  const onSend = async (textToSend?: string) => {
    const messageText = textToSend || input;
    if (!messageText.trim() || isLoading) return;
    setInput("");
    
    // 如果是引导消息，先清空临时欢迎语
    if (messages.length === 1 && messages[0].id === "welcome-context") {
      setMessages([]);
    }
    
    await handleSend(messageText, contextNodeId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const startNewChat = async () => {
    await createNewConversation("新会话");
    clearContext();
  };

  // Markdown 渲染配置：统一的样式戏制
  const markdownComponents = {
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-bold text-gray-900 dark:text-zinc-100">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic text-gray-700 dark:text-zinc-300">{children}</em>
    ),
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-base font-bold mt-3 mb-1.5 text-gray-900 dark:text-zinc-100">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="text-sm font-bold mt-2.5 mb-1 text-gray-900 dark:text-zinc-100">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-sm font-semibold mt-2 mb-1 text-gray-800 dark:text-zinc-200">{children}</h3>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc list-inside space-y-0.5 my-1.5 pl-1">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal list-inside space-y-0.5 my-1.5 pl-1">{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li className="text-sm leading-relaxed">{children}</li>
    ),
    code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) =>
      inline ? (
        <code className="bg-slate-100 dark:bg-zinc-700/60 text-indigo-600 dark:text-indigo-400 px-1 py-0.5 rounded text-[0.8em] font-mono">
          {children}
        </code>
      ) : (
        <code className="block bg-slate-50 dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-700/50 text-slate-700 dark:text-zinc-300 p-3 rounded-xl text-xs font-mono overflow-x-auto my-2 leading-relaxed">
          {children}
        </code>
      ),
    pre: ({ children }: { children?: React.ReactNode }) => (
      <div className="my-2">{children}</div>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-4 border-indigo-300 dark:border-indigo-700 pl-3 my-2 text-gray-600 dark:text-zinc-400 italic text-sm">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-gray-200 dark:border-zinc-700 my-2" />,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} target="_blank" rel="noopener noreferrer"
        className="text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-500 transition-colors">
        {children}
      </a>
    ),
  };

  // 渲染流式消息的类比高亮（兼容 Markdown 渲染）
  const renderMessageContent = (content: string) => {
    if (content.includes("💡 类比：")) {
      const parts = content.split("💡 类比：");
      const before = parts[0];
      const rest = parts[1];
      const lineBreakIdx = rest.indexOf("\n\n");
      const analogyText = lineBreakIdx !== -1 ? rest.substring(0, lineBreakIdx) : rest;
      const after = lineBreakIdx !== -1 ? rest.substring(lineBreakIdx) : "";
      
      return (
        <div className="text-sm space-y-2">
          {before && (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents as never}>
              {before}
            </ReactMarkdown>
          )}
          <div className="bg-amber-50/80 dark:bg-amber-950/20 border-l-4 border-amber-500 text-amber-900 dark:text-amber-300 p-3.5 rounded-r-xl my-2 text-xs font-medium shadow-sm">
            <span className="font-bold block mb-1 text-amber-800 dark:text-amber-400">💡 通俗类比：</span>
            {analogyText.trim()}
          </div>
          {after && (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents as never}>
              {after}
            </ReactMarkdown>
          )}
        </div>
      );
    }
    return (
      <div className="text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents as never}>
          {content}
        </ReactMarkdown>
      </div>
    );
  };

  // 未登录时不渲染助手（登录页等无 token 页面）
  // 放在所有 hooks 之后，避免违反 Rules of Hooks
  if (!isAuthenticated) return null;

  if (!isOpen) {
    // 收起形态：可拖动 8-bit 卡通像素人（采用完全透明背景，松开吸附边缘）
    return (
      <button
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={
          isMounted
            ? { left: `${position.x}px`, top: `${position.y}px` }
            : undefined
        }
        className={`fixed w-14 h-14 bg-transparent border-none outline-none flex items-center justify-center hover:scale-110 active:scale-95 z-50 cursor-pointer group select-none touch-none ${
          isMounted ? "" : "bottom-6 right-6"
        } ${isDragging ? "" : "transition-all duration-300"}`}
        title="召唤 AI 导师"
      >
        <PixelAgentAvatar agentId={selectedAgentId} className="w-12 h-12 pointer-events-none" />
      </button>
    );
  }

  // 导师风格映射
  const agentDisplayNames: Record<string, string> = {
    auto: "小脑 (智能路由)",
    humor_mentor: "小蟒 (幽默)",
    academic_mentor: "小鸮 (学术)",
    coach_mentor: "小蟹 (实战)",
  };

  // 导师风格描述 — 根据当前选中的 agent 动态显示
  const agentStyleDesc: Record<string, string> = {
    auto: "智能路由，自动匹配最佳导师风格",
    humor_mentor: "幽默风趣，用段子让你记住知识点",
    academic_mentor: "严谨学术，深入浅出剖析原理本质",
    coach_mentor: "实战教练，手把手带你代码实操通关",
  };

  return (
    <>
      {/* 扩展模式：屏幕中央半透明遮罩 */}
      {isExpanded && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-in fade-in duration-200"
          onClick={() => setIsExpanded(false)}
        />
      )}

      <div
        className={`fixed z-50 flex flex-col overflow-hidden transition-all duration-300 animate-in ${
          isExpanded
            ? "inset-0 m-auto w-[min(700px,95vw)] h-[85vh] rounded-3xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] fade-in zoom-in-95"
            : `${
                isLeftAligned ? "bottom-6 left-6 slide-in-from-left-6" : "bottom-6 right-6 slide-in-from-right-6"
              } w-[400px] h-[600px] rounded-3xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] fade-in`
        } bg-[#fdfaf2] dark:bg-[#181611] border-2 border-black`}
      >
      {/* 头部 */}
      <div className="p-4 bg-white dark:bg-zinc-900 text-black dark:text-white flex items-center justify-between border-b-2 border-black shadow-[0_2px_0_0_rgba(0,0,0,1)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-transparent flex items-center justify-center p-[2px] border border-black/10">
            <PixelAgentAvatar agentId={selectedAgentId} className="w-full h-full" />
          </div>
          <div>
            <h3 className="font-black text-sm leading-none flex items-center gap-1.5">
              CogniLink AI 导师
              {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
            </h3>
            {contextNodeName ? (
              <span className="text-[10px] text-black font-black mt-1.5 block bg-amber-100 border border-black px-2 py-0.5 rounded-full w-fit shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                正在探讨: {contextNodeName}
              </span>
            ) : (
              <span className="text-[10px] font-bold text-zinc-500 mt-1 block">{agentStyleDesc[selectedAgentId] || "随时解答你的计算机知识疑惑"}</span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1 font-bold">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
              showHistory ? "bg-amber-100 border-black text-black" : "border-transparent hover:bg-zinc-200"
            }`}
            title="历史记录"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <button
            onClick={startNewChat}
            className="p-1.5 border border-transparent hover:bg-zinc-200 rounded-lg transition-all cursor-pointer"
            title="新对话"
          >
            <Plus className="h-4 w-4" />
          </button>
          {/* 扩展 / 还原 按钮 */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 border border-transparent hover:bg-zinc-200 rounded-lg transition-all cursor-pointer"
            title={isExpanded ? "还原窗口" : "全屏展开"}
          >
            {isExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={closeAssistant}
            className="p-1.5 border border-transparent hover:bg-zinc-200 rounded-lg transition-all cursor-pointer"
            title="收起"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 侧边历史记录列表 */}
      {showHistory && (
        <div className="absolute top-16 left-0 right-0 bottom-0 bg-white dark:bg-zinc-900 z-10 border-b-2 border-black flex flex-col animate-in fade-in duration-200">
          <div className="p-3 border-b-2 border-dashed border-black/10 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
            <span className="text-xs font-black text-zinc-500">历史对话</span>
            <button
              onClick={() => setShowHistory(false)}
              className="text-xs text-indigo-600 dark:text-indigo-400 font-black cursor-pointer hover:underline"
            >
              返回对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {conversations.length === 0 ? (
              <p className="text-xs font-bold text-zinc-400 text-center py-8">暂无历史对话</p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => {
                    loadConversation(conv.id);
                    setShowHistory(false);
                    clearContext();
                  }}
                  className={`w-full text-left p-3 rounded-2xl text-xs transition-all flex items-start gap-2.5 border-2 ${
                    currentConversationId === conv.id
                      ? "bg-amber-50 border-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      : "bg-white border-transparent text-zinc-500 hover:bg-zinc-100"
                  }`}
                >
                  <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-zinc-400" />
                  <div className="truncate min-w-0 flex-1 font-bold">
                    <span className="font-black block truncate leading-tight">{conv.title}</span>
                    <span className="text-[10px] text-zinc-400 block mt-1">
                      {conv.message_count || 0} 条消息 · {new Date(conv.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* 控制面板（导师选择与特性开关） */}
      <div className="p-2.5 border-b-2 border-dashed border-black/10 bg-white dark:bg-zinc-900/20 flex items-center justify-between gap-1.5 flex-wrap font-sans">
        {/* 导师切换 */}
        <div className="relative shrink-0" ref={agentMenuRef}>
          <button
            onClick={() => setShowAgentMenu(!showAgentMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-zinc-800 border-2 border-black text-xs font-black text-black dark:text-zinc-300 hover:bg-amber-50 cursor-pointer transition-colors shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]"
          >
            {agentDisplayNames[selectedAgentId] || "自动导师"}
            <ChevronDown
              className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${
                showAgentMenu ? "rotate-180" : ""
              }`}
            />
          </button>
          {showAgentMenu && (
            <div className="absolute top-full left-0 mt-1.5 w-36 bg-white dark:bg-zinc-800 border-2 border-black rounded-2xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] py-1 z-20 animate-in fade-in slide-in-from-top-1 duration-150">
              {Object.entries(agentDisplayNames).map(([id, name]) => (
                <button
                  key={id}
                  onClick={() => {
                    setSelectedAgentId(id);
                    setShowAgentMenu(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs font-black transition-colors hover:bg-amber-50 cursor-pointer flex items-center gap-2 ${
                    selectedAgentId === id
                      ? "text-black bg-amber-100 font-black"
                      : "text-zinc-500"
                  }`}
                >
                  <PixelAgentAvatar agentId={id} className="w-6 h-6 shrink-0" />
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 特性开关 */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setUseRAG(!useRAG)}
            className={`p-1.5 rounded-xl border-2 transition-all cursor-pointer shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)] ${
              useRAG
                ? "bg-amber-100 border-black text-black font-black"
                : "bg-white border-black text-zinc-400 hover:bg-amber-50"
            }`}
            title={`知识库 RAG: ${useRAG ? "开启" : "关闭"}`}
          >
            <BookOpen className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setUseMemory(!useMemory)}
            className={`p-1.5 rounded-xl border-2 transition-all cursor-pointer shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)] ${
              useMemory
                ? "bg-amber-100 border-black text-black font-black"
                : "bg-white border-black text-zinc-400 hover:bg-amber-50"
            }`}
            title={`长期记忆: ${useMemory ? "开启" : "关闭"}`}
          >
            <Brain className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setUseTools(!useTools)}
            className={`p-1.5 rounded-xl border-2 transition-all cursor-pointer shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)] ${
              useTools
                ? "bg-amber-100 border-black text-black font-black"
                : "bg-white border-black text-zinc-400 hover:bg-amber-50"
            }`}
            title={`工具调用: ${useTools ? "开启" : "关闭"}`}
          >
            <Wrench className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-transparent">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 border-2 border-black text-black flex items-center justify-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-black text-black dark:text-zinc-200">随时向你的专属导师提问</p>
              <p className="text-[10px] font-bold text-zinc-500 max-w-[245px] leading-relaxed">
                Python 语法、游戏开发、算法数据结构……任何问题都可以问我！
              </p>
            </div>
            {/* 快捷提问项 */}
            <div className="w-full space-y-2 pt-2">
              {quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => onSend(prompt.message)}
                  className="w-full text-left p-2.5 bg-white dark:bg-zinc-800 hover:bg-amber-50/50 border-2 border-black rounded-2xl text-[10px] font-bold text-black truncate cursor-pointer transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] block"
                >
                  {prompt.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isUser = msg.role === "user";
            const isLastAssistant = !isUser && index === messages.length - 1;
            const isStreaming = isLastAssistant && isLoading;
            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-lg bg-transparent flex items-center justify-center shrink-0 p-[1px] overflow-hidden border border-black/10">
                    <PixelAgentAvatar agentId={selectedAgentId} className="w-full h-full" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] p-3.5 rounded-2xl border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
                    isUser
                      ? "bg-amber-100 text-black rounded-tr-none font-bold"
                      : "bg-white dark:bg-zinc-800 text-black dark:text-zinc-200 rounded-tl-none font-bold"
                  }`}
                >
                  {isUser ? (
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                  ) : msg.content ? (
                    <div className="relative">
                      {isStreaming ? (
                        <div className="text-sm whitespace-pre-wrap leading-relaxed break-words">{msg.content}</div>
                      ) : (
                        renderMessageContent(msg.content)
                      )}
                      {isStreaming && (
                        <span className="inline-block w-[3px] h-4 bg-indigo-500 dark:bg-indigo-400 animate-pulse ml-0.5 align-middle rounded-sm" />
                      )}
                      {!isStreaming && msg.sources && msg.sources.length > 0 && (
                        <SourceChips sources={msg.sources} />
                      )}
                    </div>
                  ) : (
                    /* 等待时的思考动画 */
                    <div className="flex items-center gap-1 py-1">
                      <span className="w-1.5 h-1.5 bg-black dark:bg-zinc-300 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-black dark:bg-zinc-300 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-black dark:bg-zinc-300 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* 智能工作流监控 */}
        {workflowSteps.length > 0 && (
          <div className="border-2 border-black rounded-2xl p-3 bg-white dark:bg-zinc-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] animate-in fade-in duration-200 font-sans">
            <h4 className="text-[10px] font-black text-black dark:text-indigo-400 mb-2.5 flex items-center gap-1">
              <Network className="h-3.5 w-3.5 animate-spin" />
              智能工作流流程监控
            </h4>
            <WorkflowPanel steps={workflowSteps} />
          </div>
        )}

        {/* 错误展示 */}
        {errorMessage && (
          <div className="p-3 bg-rose-100 border-2 border-black text-black rounded-2xl text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            {errorMessage}
            <button
              onClick={handleRegenerate}
              className="block mt-1.5 font-black text-indigo-600 dark:text-indigo-400 underline cursor-pointer hover:no-underline"
            >
              重新生成回复
            </button>
          </div>
        )}

        {/* 自动滚动锚点 */}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="p-3 border-t-2 border-black bg-white dark:bg-zinc-950">
        {/* 上下文聚焦快捷引导 */}
        {contextNodeId && contextNodeName && messages.length === 1 && messages[0].id === "welcome-context" && (
          <div className="flex gap-2 mb-2 font-sans">
            <button
              onClick={() => onSend(`请用通俗的故事类比帮我解释一下什么是${contextNodeName}`)}
              className="flex-1 py-1.5 px-2 bg-amber-100 hover:bg-amber-200 text-black rounded-2xl text-[10px] font-black text-center border-2 border-black cursor-pointer transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              📖 生活故事类比
            </button>
            <button
              onClick={() => onSend(`带我用代码实操一下${contextNodeName}的相关逻辑`)}
              className="flex-1 py-1.5 px-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl text-[10px] font-black text-center border-2 border-black cursor-pointer transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              💻 代码实操演示
            </button>
          </div>
        )}

        <div className="relative flex items-end gap-1.5 bg-zinc-50 dark:bg-zinc-800 rounded-2xl p-1.5 border-2 border-black shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]">
          <button className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors text-zinc-400">
            <Paperclip className="h-4 w-4" />
          </button>
          
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="向 AI 导师发送消息..."
            className="flex-1 bg-transparent border-0 outline-none text-sm text-black dark:text-zinc-100 placeholder:text-zinc-400 resize-none py-1.5 max-h-[120px] focus:ring-0 focus:outline-none font-bold"
            disabled={isLoading}
          />
          
          <button
            onClick={() => onSend()}
            disabled={!input.trim() || isLoading}
            className={`p-2 rounded-xl transition-all border-2 border-black ${
              input.trim() && !isLoading
                ? "bg-indigo-500 text-white hover:bg-indigo-400 cursor-pointer shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)]"
                : "bg-zinc-200 text-zinc-400 dark:bg-zinc-700 dark:text-zinc-600"
            }`}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
