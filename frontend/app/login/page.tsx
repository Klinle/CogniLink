"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

// 设计一个大的卡通呆萌大眼睛大脑连接 SVG Logo Component (CogniLink)
function CogniLinkLogo() {
  return (
    <div className="flex flex-col items-center justify-center mb-6 select-none">
      <svg
        width="150"
        height="130"
        viewBox="0 0 150 130"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="transform hover:scale-105 transition-transform duration-300 filter drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]"
      >
        {/* 背景连接轨道线条 - 粗黑手绘风格线 */}
        <path d="M 25 80 Q 40 100 75 90" stroke="black" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M 125 80 Q 110 100 75 90" stroke="black" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M 75 90 L 75 118" stroke="black" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1 1" />

        {/* 轨道连接端点小圆球 */}
        <circle cx="25" cy="80" r="6" fill="#84cc16" stroke="black" strokeWidth="2.5" />
        <circle cx="125" cy="80" r="6" fill="#0ea5e9" stroke="black" strokeWidth="2.5" />
        <circle cx="75" cy="118" r="6" fill="#f97316" stroke="black" strokeWidth="2.5" />

        {/* 大脑主体 - 粉色呆萌大脑 (由云朵般相交的圆构成，带 3.5px 粗黑边) */}
        {/* 左脑半球 */}
        <circle cx="58" cy="50" r="28" fill="#fda4af" />
        <circle cx="42" cy="65" r="20" fill="#fda4af" />
        {/* 右脑半球 */}
        <circle cx="92" cy="50" r="28" fill="#fda4af" />
        <circle cx="108" cy="65" r="20" fill="#fda4af" />
        {/* 脑桥底部 */}
        <rect x="52" y="60" width="46" height="24" rx="10" fill="#fda4af" />

        {/* 大脑粗黑描边层 */}
        <path
          d="M 42 85 C 30 85 22 75 22 65 C 22 55 30 45 42 45 C 42 32 54 22 68 22 C 75 22 81 25 85 30 C 89 25 95 22 102 22 C 116 22 128 32 128 45 C 140 45 148 55 148 65 C 148 75 140 85 128 85 C 122 85 110 84 98 84 C 94 84 88 86 85 86 C 82 86 76 84 72 84 C 60 84 48 85 42 85 Z"
          stroke="black"
          strokeWidth="3.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 大脑沟回波纹手绘线 */}
        <path d="M 52 35 C 56 38 60 35 62 38" stroke="black" strokeWidth="3" strokeLinecap="round" />
        <path d="M 98 35 C 94 38 90 35 88 38" stroke="black" strokeWidth="3" strokeLinecap="round" />

        {/* 两眼较大设计 - 两只巨大的呆萌圆眼 */}
        {/* 左眼框 */}
        <circle cx="56" cy="58" r="15" fill="white" stroke="black" strokeWidth="3.5" />
        {/* 左瞳孔 (向内看，显得呆萌) */}
        <circle cx="60" cy="58" r="6.5" fill="black" />
        {/* 左高光 */}
        <circle cx="58" cy="56" r="2" fill="white" />

        {/* 右眼框 */}
        <circle cx="94" cy="58" r="15" fill="white" stroke="black" strokeWidth="3.5" />
        {/* 右瞳孔 (向内看，产生对眼呆萌感) */}
        <circle cx="90" cy="58" r="6.5" fill="black" />
        {/* 右高光 */}
        <circle cx="88" cy="56" r="2" fill="white" />

        {/* 呆萌的小红晕 */}
        <ellipse cx="38" cy="72" rx="4" ry="2" fill="#f43f5e" opacity="0.6" />
        <ellipse cx="112" cy="72" rx="4" ry="2" fill="#f43f5e" opacity="0.6" />
      </svg>
      <h1 className="text-2xl font-black tracking-wider text-black dark:text-white mt-1">
        CogniLink
      </h1>
      <p className="text-[10px] font-black uppercase text-zinc-400 dark:text-zinc-500 mt-1 tracking-widest">
        Cognition & Link
      </p>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("cognilink_token");
      if (token) {
        document.cookie = `cognilink_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
        router.push("/");
      }
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("请输入用户名和密码");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data =
        mode === "login"
          ? await authApi.login(username, password)
          : await authApi.register(username, password, nickname || undefined);

      localStorage.setItem("cognilink_token", data.access_token);
      localStorage.setItem("cognilink_user_id", data.user.id);
      localStorage.setItem("cognilink_user_role", data.user.role);
      localStorage.setItem("cognilink_user_nickname", data.user.nickname);

      document.cookie = `cognilink_token=${data.access_token}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;

      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfaf2] dark:bg-[#181611] px-4 bg-[linear-gradient(rgba(139,90,43,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(139,90,43,0.02)_1px,transparent_1px)] bg-[size:24px_24px] font-sans">
      <div className="w-full max-w-sm">
        
        {/* 卡通大脑 Logo */}
        <CogniLinkLogo />

        {/* 登录注册主面板卡片 (Neo-brutalism) */}
        <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          
          {/* 模式选择切换按钮组 */}
          <div className="flex gap-2.5 mb-6 bg-zinc-100 dark:bg-zinc-800 p-1 border-2 border-black rounded-2xl">
            <button
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-black transition-all border-2 ${
                mode === "login"
                  ? "bg-amber-100 border-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  : "border-transparent text-zinc-500 hover:text-black"
              }`}
            >
              登录
            </button>
            <button
              onClick={() => {
                setMode("register");
                setError(null);
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-black transition-all border-2 ${
                mode === "register"
                  ? "bg-amber-100 border-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  : "border-transparent text-zinc-500 hover:text-black"
              }`}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 font-bold">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs text-zinc-600">用户名</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="输入用户名"
                disabled={isLoading}
                autoComplete="username"
                className="border-2 border-black rounded-2xl px-3 py-2 text-xs focus:outline-none focus-visible:ring-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] bg-white dark:bg-zinc-800"
              />
            </div>

            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="nickname" className="text-xs text-zinc-600">昵称（可选）</Label>
                <Input
                  id="nickname"
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="显示名称"
                  disabled={isLoading}
                  className="border-2 border-black rounded-2xl px-3 py-2 text-xs focus:outline-none focus-visible:ring-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] bg-white dark:bg-zinc-800"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-zinc-600">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入密码"
                disabled={isLoading}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="border-2 border-black rounded-2xl px-3 py-2 text-xs focus:outline-none focus-visible:ring-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] bg-white dark:bg-zinc-800"
              />
            </div>

            {error && (
              <div className="px-4 py-3 rounded-2xl bg-rose-100 border-2 border-black text-rose-700 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-indigo-500 hover:bg-indigo-400 border-2 border-black text-white rounded-2xl py-5 text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] cursor-pointer mt-2"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === "login" ? "登录中..." : "注册中..."}
                </>
              ) : mode === "login" ? (
                "进入探索"
              ) : (
                "加入星系"
              )}
            </Button>
          </form>

          <p className="text-[10px] text-center text-zinc-400 font-bold mt-6">
            {mode === "login" ? "还没有账号？点击上方注册" : "已有账号？点击上方登录"}
          </p>
        </div>

      </div>
    </div>
  );
}
