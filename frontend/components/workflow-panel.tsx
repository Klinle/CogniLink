"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Circle,
  ChevronDown,
  Bot,
  BookOpen,
  Brain,
  PenLine,
  GitBranch,
  HelpCircle,
  Wrench,
  Sparkles,
} from "lucide-react";

/** 工作流步骤状态 */
export interface WorkflowStep {
  node: string;
  label: string;
  status: "pending" | "running" | "done";
  message?: string;
  data?: Record<string, unknown>;
}

/** 节点图标映射 — RAG 六阶段流水线（memory_loader → query_rewriter → intent_classifier → ambiguity_gate → rag_bot/tool_call → reviewer）*/
const nodeIcons: Record<string, typeof Bot> = {
  memory_loader: Brain,
  query_rewriter: PenLine,
  intent_classifier: GitBranch,
  ambiguity_gate: HelpCircle,
  rag_bot: BookOpen,
  tool_call: Wrench,
  reviewer: Sparkles,
  orchestrator: Bot,
};

/** 工作流进度面板 */
export function WorkflowPanel({ steps }: { steps: WorkflowStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="mb-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40 p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Bot className="h-3.5 w-3.5 text-indigo-500" />
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          RAG 智能流水线
        </span>
      </div>
      <div className="space-y-0">
        {steps.map((step, index) => (
          <WorkflowStepItem
            key={`${step.node}-${index}`}
            step={step}
            isLast={index === steps.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

/** 单个步骤项 */
function WorkflowStepItem({
  step,
  isLast,
}: {
  step: WorkflowStep;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const NodeIcon = nodeIcons[step.node] || Bot;
  const hasData = step.data && Object.keys(step.data).length > 0;

  return (
    <div className="flex gap-2.5 relative">
      {/* 垂直连接线 */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
      )}

      {/* 状态图标 */}
      <div className="shrink-0 mt-0.5 relative z-10">
        {step.status === "done" ? (
          <CheckCircle2 className="h-5 w-5 text-green-500 bg-gray-50 dark:bg-gray-900" />
        ) : step.status === "running" ? (
          <Loader2 className="h-5 w-5 text-blue-500 animate-spin bg-gray-50 dark:bg-gray-900" />
        ) : (
          <Circle className="h-5 w-5 text-gray-300 dark:text-gray-600 bg-gray-50 dark:bg-gray-900" />
        )}
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <NodeIcon
            className={`h-3.5 w-3.5 ${
              step.status === "pending"
                ? "text-gray-300 dark:text-gray-600"
                : "text-gray-500 dark:text-gray-400"
            }`}
          />
          <span
            className={`text-sm font-medium ${
              step.status === "pending"
                ? "text-gray-400 dark:text-gray-600"
                : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {step.label}
          </span>
          {step.message && step.status === "running" && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {step.message}
            </span>
          )}
          {hasData && step.status === "done" && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="inline-flex items-center gap-0.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <span className="inline-flex items-center gap-0.5">
                  <ChevronDown className="h-3 w-3 rotate-[-90deg]" />
                  详情
                </span>
              )}
            </button>
          )}
        </div>
        {expanded && hasData && (
          <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700 overflow-hidden">
            <pre className="whitespace-pre-wrap break-words max-h-32 overflow-y-auto text-xs leading-relaxed">
              {JSON.stringify(step.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
