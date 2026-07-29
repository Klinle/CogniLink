"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Brain,
  Grid3X3,
  Shield,
  Activity,
  Network,
  Award,
  Settings,
  LogOut,
  Sparkles,
  ChevronDown,
  Menu,
  User,
  RotateCcw,
} from "lucide-react";
import { useChatAssistantStore } from "@/stores/chat-assistant";

interface UserLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

export default function UserLayout({ children, activePath }: UserLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [userRole, setUserRole] = useState<string>("");
  const [nickname, setNickname] = useState<string>("");
  const [navOpen, setNavOpen] = useState(false);       // 小屏下拉导航菜单
  const [profileOpen, setProfileOpen] = useState(false); // 头像下拉菜单
  const navRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const openAssistant = useChatAssistantStore((state) => state.openAssistant);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
      if (typeof window !== "undefined") {
        setUserRole(localStorage.getItem("cognilink_user_role") || "student");
        setNickname(localStorage.getItem("cognilink_user_nickname") || "学生");
      }
    }, 50);

    if (typeof window !== "undefined") {
      const token = localStorage.getItem("cognilink_token");
      if (!token) {
        router.push("/login");
        return;
      }
    }

    return () => clearTimeout(timer);
  }, [router]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setNavOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    if (confirm("确认退出登录？")) {
      localStorage.removeItem("cognilink_token");
      localStorage.removeItem("cognilink_user_id");
      localStorage.removeItem("cognilink_user_role");
      localStorage.removeItem("cognilink_user_nickname");
      document.cookie = "cognilink_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      // 通知全局 AI 助手重置状态（同标签页登出感知）
      window.dispatchEvent(new Event("cognilink-logout"));
      router.push("/login");
    }
  };

  if (!mounted) {
    return <div className="min-h-screen bg-background" />;
  }

  const navItems = [
    { name: "学习主脑", href: "/dashboard", icon: Grid3X3 },
    { name: "知识图谱", href: "/graph", icon: Network },
    { name: "在线练习", href: "/practice", icon: Award },
    { name: "错题复习", href: "/review", icon: RotateCcw },
    { name: "学习画像", href: "/profile", icon: Activity },
    { name: "记忆系统", href: "/memories", icon: Brain },
  ];

  const currentPath = activePath || pathname;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden text-foreground">

      {/* ── 顶部导航栏 (Neo-brutalism) ── */}
      <header className="h-16 shrink-0 bg-white dark:bg-zinc-900 border-b-2 border-black flex items-center px-4 md:px-6 gap-4 z-30 font-sans">

        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 shrink-0 group">
          <Image
            src="/logo.png"
            alt="CogniLink"
            width={28}
            height={28}
            className="rounded-lg group-hover:scale-105 transition-transform"
          />
          <span className="font-black text-sm tracking-wide bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent hidden sm:block">
            CogniLink
          </span>
        </Link>

        {/* ── 大屏：手绘木牌式导航链接 ── */}
        <nav className="hidden md:flex items-center gap-2 flex-1 mx-2">
          {navItems.map((item) => {
            const isActive =
              currentPath === item.href ||
              (item.href !== "/dashboard" && currentPath.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all border-2 ${
                  isActive
                    ? "bg-amber-100 dark:bg-zinc-800 border-black text-black dark:text-amber-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    : "border-transparent text-zinc-500 dark:text-zinc-400 hover:border-black/25 hover:text-black dark:hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.name}
              </Link>
            );
          })}

          {/* 管理后台入口 */}
          {(userRole === "admin" || userRole === "teacher") && (
            <Link
              href="/admin"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all border-2 ml-1 ${
                currentPath.startsWith("/admin")
                  ? "bg-violet-100 dark:bg-violet-950/40 border-black text-violet-700 dark:text-violet-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  : "border-transparent text-indigo-500 dark:text-indigo-400 hover:border-black/25"
              }`}
            >
              <Shield className="h-4 w-4 shrink-0" />
              管理后台
            </Link>
          )}
        </nav>

        {/* ── 小屏：下拉导航菜单按钮 ── */}
        <div className="flex md:hidden flex-1" ref={navRef}>
          <button
            onClick={() => setNavOpen(!navOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black text-black dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-850 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer"
          >
            <Menu className="h-4 w-4" />
            导航菜单
            <ChevronDown
              className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${
                navOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* 小屏下拉面板 */}
          {navOpen && (
            <div className="absolute top-16 left-0 right-0 bg-white dark:bg-zinc-900 border-b-2 border-black shadow-xl z-40 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="p-3 grid grid-cols-3 gap-2">
                {navItems.map((item) => {
                  const isActive =
                    currentPath === item.href ||
                    (item.href !== "/dashboard" && currentPath.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setNavOpen(false)}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl text-xs font-black transition-all border-2 ${
                        isActive
                          ? "bg-amber-100 border-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                          : "border-transparent text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100/50"
                      }`}
                    >
                      <Icon className={`h-5 w-5 ${isActive ? "text-amber-600" : "text-zinc-400"}`} />
                      {item.name}
                    </Link>
                  );
                })}
                {(userRole === "admin" || userRole === "teacher") && (
                  <Link
                    href="/admin"
                    onClick={() => setNavOpen(false)}
                    className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl text-xs font-black text-indigo-600 dark:text-indigo-400 border-2 border-transparent hover:border-black/25 transition-all"
                  >
                    <Shield className="h-5 w-5" />
                    管理后台
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 右侧操作区 ── */}
        <div className="flex items-center gap-3 shrink-0 ml-auto font-sans">

          {/* AI 导师召唤按钮 */}
          <button
            onClick={() => openAssistant()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 border-2 border-black text-white text-xs font-black transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
            title="召唤 AI 导师"
          >
            <Sparkles className="h-4 w-4 animate-pulse shrink-0" />
            <span className="hidden sm:inline">AI 导师</span>
          </button>

          {/* 用户头像下拉 */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-1.5 p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all cursor-pointer"
              title={nickname}
            >
              <div className="w-8 h-8 rounded-xl bg-amber-300 border-2 border-black text-black flex items-center justify-center font-black text-xs shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]">
                {nickname ? nickname[0].toUpperCase() : "U"}
              </div>
              <ChevronDown
                className={`h-3.5 w-3.5 text-zinc-500 hidden sm:block transition-transform duration-200 ${
                  profileOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-full mt-2.5 w-52 bg-white dark:bg-zinc-900 border-2 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] py-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                {/* 用户信息 */}
                <div className="px-4 py-2.5 border-b-2 border-dashed border-black/10">
                  <p className="text-xs font-black text-black dark:text-zinc-200">{nickname}</p>
                  <p className="text-[10px] font-bold text-zinc-400 mt-1">
                    {userRole === "admin" ? "管理员" : userRole === "teacher" ? "教师" : "学生"}
                  </p>
                </div>

                <Link
                  href="/profile"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-amber-50/50 transition-colors"
                >
                  <User className="h-4 w-4 text-zinc-400" />
                  学习画像
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-amber-50/50 transition-colors"
                >
                  <Settings className="h-4 w-4 text-zinc-400" />
                  系统设置
                </Link>

                <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-1.5" />

                <button
                  onClick={() => { setProfileOpen(false); handleLogout(); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/10 transition-colors cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── 主内容区 ── */}
      <main className="flex-1 overflow-hidden relative flex flex-col">
        {children}
      </main>
    </div>
  );
}
