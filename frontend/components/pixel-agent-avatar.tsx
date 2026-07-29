import React from "react";

interface PixelAgentAvatarProps {
  agentId: string; // "humor_mentor" | "academic_mentor" | "coach_mentor" | "auto" | uuid
  className?: string;
}

/**
 * AI 导师卡通形象 — 极简几何 + 粗黑描边 + 大眼睛（与站内硬描边卡片和大眼脑 Logo 同基因），
 * 每只一个专属待机动效，参考 Claude 小螃蟹的设计语言（少量形状传达性格）。
 * humor = 小蟒蛇（Python 本体） / academic = 戴眼镜小猫头鹰 / coach = 举钳小螃蟹 / auto = 大眼小脑
 */

const INK = "#18181b";

// 动画统一注入（多实例重复渲染 style 无副作用）；reduced-motion 全部静止
const styleTag = (
  <style>{`
    @keyframes av-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1.2px); } }
    @keyframes av-bounce { 0%, 100% { transform: translateY(0) scaleY(1); } 50% { transform: translateY(-1.6px) scaleY(1.03); } }
    @keyframes av-blink { 0%, 90%, 100% { transform: scaleY(0); } 93%, 96% { transform: scaleY(1); } }
    @keyframes av-tilt { 0%, 78%, 100% { transform: rotate(0deg); } 84%, 92% { transform: rotate(6deg); } }
    @keyframes av-tongue { 0%, 82%, 100% { transform: scaleX(0); } 86%, 94% { transform: scaleX(1); } }
    @keyframes av-claw { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-16deg); } }
    @keyframes av-claw-r { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(16deg); } }
    @keyframes av-pupils { 0%, 20%, 100% { transform: translateX(0); } 35%, 50% { transform: translateX(1.4px); } 65%, 85% { transform: translateX(-1.4px); } }
    @keyframes av-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
    @keyframes av-spark { 0%, 100% { opacity: 0.25; transform: scale(0.85) rotate(0deg); } 50% { opacity: 1; transform: scale(1.1) rotate(18deg); } }
    .av-bob { animation: av-bob 3s ease-in-out infinite; }
    .av-bounce { animation: av-bounce 2.2s ease-in-out infinite; transform-origin: 24px 44px; }
    .av-blink { animation: av-blink 4.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
    .av-tilt { animation: av-tilt 7s ease-in-out infinite; transform-origin: 24px 40px; }
    .av-tongue { animation: av-tongue 3.6s ease-in-out infinite; transform-origin: left center; transform-box: fill-box; }
    .av-claw-l { animation: av-claw 1.8s ease-in-out infinite; transform-origin: 11px 22px; }
    .av-claw-r { animation: av-claw-r 1.8s ease-in-out infinite; animation-delay: 0.9s; transform-origin: 37px 22px; }
    .av-pupils { animation: av-pupils 5.5s ease-in-out infinite; }
    .av-pulse { animation: av-pulse 2.6s ease-in-out infinite; transform-origin: 24px 26px; }
    .av-spark { animation: av-spark 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
    @media (prefers-reduced-motion: reduce) {
      .av-bob, .av-bounce, .av-blink, .av-tilt, .av-tongue, .av-claw-l, .av-claw-r, .av-pupils, .av-pulse, .av-spark { animation: none; }
    }
  `}</style>
);

// 大白眼 + 黑瞳 + 高光；eyelid 用身体色圆片做眨眼
const Eye = ({ cx, cy, r = 3.6, lidFill, pupilsClass = "", delay }: {
  cx: number; cy: number; r?: number; lidFill: string; pupilsClass?: string; delay?: string;
}) => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke={INK} strokeWidth="1.6" />
    <g className={pupilsClass}>
      <circle cx={cx} cy={cy + 0.3} r={r * 0.46} fill={INK} />
      <circle cx={cx + r * 0.22} cy={cy - r * 0.25} r={r * 0.16} fill="#ffffff" />
    </g>
    <circle
      cx={cx} cy={cy} r={r + 0.4} fill={lidFill} stroke={INK} strokeWidth="1.2"
      className="av-blink" style={delay ? { animationDelay: delay } : undefined}
    />
  </g>
);

// 幽默导师：盘圈小蟒蛇（Python 本体）— 弹跳 + 吐舌
const SnakeAvatar = () => (
  <svg viewBox="0 0 48 48" className="w-full h-full" role="img" aria-label="幽默导师小蟒蛇">
    {styleTag}
    <g className="av-bounce">
      <ellipse cx="24" cy="38" rx="14" ry="6.5" fill="#a3e635" stroke={INK} strokeWidth="2" />
      <ellipse cx="24" cy="31" rx="10.5" ry="5.5" fill="#bef264" stroke={INK} strokeWidth="2" />
      <path d="M35 36 Q41 35 41 30" fill="none" stroke={INK} strokeWidth="5.6" strokeLinecap="round" />
      <path d="M35 36 Q41 35 41 30" fill="none" stroke="#a3e635" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="17" r="9" fill="#a3e635" stroke={INK} strokeWidth="2" />
      {/* 舌头（周期性吐出） */}
      <g className="av-tongue">
        <path d="M33 19 h4.5 M37.5 19 l2.2 -1.6 M37.5 19 l2.2 1.6" fill="none" stroke="#f43f5e" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <Eye cx={20.4} cy={15.6} lidFill="#a3e635" />
      <Eye cx={27.6} cy={15.6} lidFill="#a3e635" delay="0.12s" />
      <path d="M21.5 21.5 Q24 23.5 26.5 21.5" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16.2" cy="19.4" r="1.5" fill="#fda4af" opacity="0.75" />
      <circle cx="31.8" cy="19.4" r="1.5" fill="#fda4af" opacity="0.75" />
    </g>
  </svg>
);

// 学术导师：戴大圆眼镜的小猫头鹰 — 慢呼吸 + 偶尔歪头
const OwlAvatar = () => (
  <svg viewBox="0 0 48 48" className="w-full h-full" role="img" aria-label="学术导师小猫头鹰">
    {styleTag}
    <g className="av-tilt">
      <g className="av-bob">
        <path d="M14 13 L11 4.5 L20 9 Z" fill="#7dd3fc" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M34 13 L37 4.5 L28 9 Z" fill="#7dd3fc" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M24 8 C33.5 8 38.5 16 38.5 27 C38.5 37 32.5 43 24 43 C15.5 43 9.5 37 9.5 27 C9.5 16 14.5 8 24 8 Z" fill="#7dd3fc" stroke={INK} strokeWidth="2" />
        <ellipse cx="24" cy="33.5" rx="7.6" ry="7.2" fill="#e0f2fe" stroke={INK} strokeWidth="1.3" />
        <path d="M11.5 25 C9.5 29.5 10.5 34.5 13.5 38" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M36.5 25 C38.5 29.5 37.5 34.5 34.5 38" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
        {/* 大圆眼镜 */}
        <line x1="22" y1="21.5" x2="26" y2="21.5" stroke={INK} strokeWidth="1.8" />
        <circle cx="17.2" cy="21.5" r="6" fill="#ffffff" stroke={INK} strokeWidth="2.2" />
        <circle cx="30.8" cy="21.5" r="6" fill="#ffffff" stroke={INK} strokeWidth="2.2" />
        <g>
          <circle cx="17.2" cy="22" r="2.4" fill={INK} />
          <circle cx="18" cy="20.9" r="0.8" fill="#ffffff" />
          <circle cx="30.8" cy="22" r="2.4" fill={INK} />
          <circle cx="31.6" cy="20.9" r="0.8" fill="#ffffff" />
        </g>
        <circle cx="17.2" cy="21.5" r="5.6" fill="#ffffff" stroke="none" className="av-blink" style={{ animationDelay: "0.3s" }} />
        <circle cx="30.8" cy="21.5" r="5.6" fill="#ffffff" stroke="none" className="av-blink" style={{ animationDelay: "0.42s" }} />
        <path d="M24 27.5 L21.6 30.8 L26.4 30.8 Z" fill="#f59e0b" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      </g>
    </g>
  </svg>
);

// 实战教练：举钳小螃蟹（致敬 Claude 小螃蟹）— 双钳交替上举
const CrabAvatar = () => (
  <svg viewBox="0 0 48 48" className="w-full h-full" role="img" aria-label="实战教练小螃蟹">
    {styleTag}
    <g className="av-bob">
      {/* 腿 */}
      <g stroke={INK} strokeWidth="2" strokeLinecap="round">
        <path d="M14 36 L10 41" /><path d="M18 38 L15.5 43" /><path d="M34 36 L38 41" /><path d="M30 38 L32.5 43" />
      </g>
      {/* 左右钳（交替上举，像教练喊加油） */}
      <g className="av-claw-l">
        <path d="M15 26 Q11 25 10 21" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="9.5" cy="17.5" r="5" fill="#fb7185" stroke={INK} strokeWidth="2" />
        <path d="M9.5 17.5 L6.2 13 M9.5 17.5 L12.8 13" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      </g>
      <g className="av-claw-r">
        <path d="M33 26 Q37 25 38 21" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="38.5" cy="17.5" r="5" fill="#fb7185" stroke={INK} strokeWidth="2" />
        <path d="M38.5 17.5 L35.2 13 M38.5 17.5 L41.8 13" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      </g>
      {/* 蟹壳 */}
      <ellipse cx="24" cy="29" rx="13" ry="10" fill="#fb7185" stroke={INK} strokeWidth="2" />
      <path d="M17 20.5 L18.5 17.5 M24 19 L24 16 M31 20.5 L29.5 17.5" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <Eye cx={19.4} cy={26.5} lidFill="#fb7185" />
      <Eye cx={28.6} cy={26.5} lidFill="#fb7185" delay="0.1s" />
      <path d="M21 32.5 Q24 35 27 32.5" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14.6" cy="31" r="1.6" fill="#fecdd3" opacity="0.85" />
      <circle cx="33.4" cy="31" r="1.6" fill="#fecdd3" opacity="0.85" />
    </g>
  </svg>
);

// 自动模式：大眼小脑（品牌 Logo 本尊）— 思考脉动 + 瞳孔扫视 + 头顶火花
const BrainAvatar = () => (
  <svg viewBox="0 0 48 48" className="w-full h-full" role="img" aria-label="智能路由大眼小脑">
    {styleTag}
    <g className="av-pulse">
      <path
        d="M12 37 C7.5 37 5 32.5 6.5 28.5 C4.5 24 8 18.5 12.5 18 C13 12.5 19 9.5 23.5 12 C28 8.5 35 11 36 16.5 C41 17 44 22.5 41.5 27 C43.5 31.5 40.5 36.5 35.5 37 Z"
        fill="#d8b4fe" stroke={INK} strokeWidth="2" strokeLinejoin="round"
      />
      <path d="M24 12.5 C22.8 18 25.2 24 23.8 31 M15 19 C17 21 17.5 24 16.5 26.5 M32.5 18 C31 20.5 30.8 23.5 32 26" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" opacity="0.3" />
      <Eye cx={18.4} cy={27} r={4} lidFill="#d8b4fe" pupilsClass="av-pupils" />
      <Eye cx={29.6} cy={27} r={4} lidFill="#d8b4fe" pupilsClass="av-pupils" delay="0.14s" />
      <path d="M21 34 Q24 36.5 27 34" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12.8" cy="31.5" r="1.6" fill="#f0abfc" opacity="0.8" />
      <circle cx="35.2" cy="31.5" r="1.6" fill="#f0abfc" opacity="0.8" />
    </g>
    <path
      d="M39.5 3.5 L40.6 6.6 L43.7 7.7 L40.6 8.8 L39.5 11.9 L38.4 8.8 L35.3 7.7 L38.4 6.6 Z"
      fill="#fbbf24" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" className="av-spark"
    />
  </svg>
);

export const PixelAgentAvatar: React.FC<PixelAgentAvatarProps> = ({
  agentId,
  className = "w-10 h-10",
}) => {
  const inner = (() => {
    switch (agentId) {
      case "humor_mentor":
        return <SnakeAvatar />;
      case "academic_mentor":
        return <OwlAvatar />;
      case "coach_mentor":
        return <CrabAvatar />;
      case "auto":
      default:
        return <BrainAvatar />;
    }
  })();

  return <div className={`relative select-none ${className}`}>{inner}</div>;
};
