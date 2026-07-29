"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import type { SourceItem } from "@/types";
import DocumentPreviewModal from "@/components/document-preview-modal";

const MAX_VISIBLE_CHIPS = 4;

/** 回答底部的来源索引标签：点击打开文档预览并定位页码（T3 溯源跳转） */
export default function SourceChips({ sources }: { sources: SourceItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<SourceItem | null>(null);

  if (!sources.length) return null;
  const visible = expanded ? sources : sources.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = sources.length - visible.length;

  return (
    <div className="mt-2.5 pt-2 border-t-2 border-dashed border-black/15 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          来源
        </span>
        {visible.map((source, i) => (
          <button
            key={`${source.document_id}-${source.page_number ?? "x"}-${i}`}
            onClick={() => setActive(source)}
            title={`${source.title}${source.page_number ? ` · 第${source.page_number}页` : ""}`}
            className="inline-flex items-center gap-1 max-w-[220px] px-2 py-0.5 rounded-lg border-2 border-black bg-amber-100 dark:bg-amber-700/60 text-[11px] font-bold text-black dark:text-amber-50 shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
          >
            <BookOpen className="h-3 w-3 shrink-0" />
            <span className="truncate">{source.title}</span>
            {source.page_number ? (
              <span className="shrink-0 text-[10px] opacity-70">
                · 第{source.page_number}页
              </span>
            ) : null}
          </button>
        ))}
        {hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="px-2 py-0.5 rounded-lg border-2 border-black bg-white dark:bg-zinc-700 text-[11px] font-black text-black dark:text-white shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
          >
            +{hiddenCount}
          </button>
        )}
      </div>
      {active && (
        <DocumentPreviewModal
          documentId={active.document_id}
          title={active.title}
          pageNumber={active.page_number}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
