"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, RefreshCw, X } from "lucide-react";
import { API_BASE_URL, getAuthHeaders } from "@/lib/api";

interface DocumentPreviewModalProps {
  documentId: string;
  title: string;
  /** 目标页码（1 起）；文本文档按页游标截取，PDF 用 #page= 定位 */
  pageNumber?: number | null;
  onClose: () => void;
}

interface PreviewInfo {
  file_type?: string;
  total_pages?: number;
  file_size_mb?: number;
}

const TEXT_PAGES_PER_LOAD = 10;

/** 溯源跳转的文档预览弹层：PDF 走带鉴权的 blob + #page 定位，文本走分页内容接口 */
export default function DocumentPreviewModal({
  documentId,
  title,
  pageNumber,
  onClose,
}: DocumentPreviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<PreviewInfo>({});
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const objectUrlRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const infoResp = await fetch(
        `${API_BASE_URL}/api/documents/${documentId}/preview-info`,
        { headers: getAuthHeaders() },
      );
      if (infoResp.status === 404) {
        setError("文档已删除或不可访问");
        return;
      }
      if (!infoResp.ok) throw new Error(`加载失败 (${infoResp.status})`);
      const infoData: PreviewInfo = await infoResp.json();
      setInfo(infoData);

      if (infoData.file_type === ".pdf") {
        // iframe 无法携带 Authorization 头，先鉴权拉取 blob 再用对象 URL 展示
        const fileResp = await fetch(
          `${API_BASE_URL}/api/documents/${documentId}/file`,
          { headers: getAuthHeaders() },
        );
        if (!fileResp.ok) throw new Error(`文件加载失败 (${fileResp.status})`);
        const blob = await fileResp.blob();
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setPdfUrl(pageNumber ? `${url}#page=${pageNumber}` : url);
      } else {
        const start = pageNumber && pageNumber > 0 ? pageNumber - 1 : 0;
        const contentResp = await fetch(
          `${API_BASE_URL}/api/documents/${documentId}/content?start_page=${start}&end_page=${start + TEXT_PAGES_PER_LOAD}`,
          { headers: getAuthHeaders() },
        );
        if (!contentResp.ok) throw new Error(`内容加载失败 (${contentResp.status})`);
        const data = await contentResp.json();
        setTextContent(data.content || "（文档内容为空）");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览加载失败");
    } finally {
      setLoading(false);
    }
  }, [documentId, pageNumber]);

  useEffect(() => {
    load();
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [load]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 md:p-6 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b-2 border-black bg-amber-50 dark:bg-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-5 w-5 shrink-0 text-amber-600" />
            <span className="font-black text-sm text-black dark:text-white truncate">
              {title}
            </span>
            {pageNumber ? (
              <span className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full border-2 border-black bg-amber-200 dark:bg-amber-600 text-black dark:text-white">
                第 {pageNumber} 页
              </span>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-xl border-2 border-black bg-white dark:bg-zinc-700 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
            aria-label="关闭预览"
          >
            <X className="h-4 w-4 text-black dark:text-white" />
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-[#fdfaf2] dark:bg-[#181611]">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-sm font-bold text-zinc-500">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
              正在打开教材原文...
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-sm font-bold text-zinc-500">
              <span>{error}</span>
              {error !== "文档已删除或不可访问" && (
                <button
                  onClick={load}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 border-black bg-amber-200 dark:bg-amber-600 text-black dark:text-white text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试
                </button>
              )}
            </div>
          ) : pdfUrl ? (
            <iframe src={pdfUrl} title={title} className="w-full h-full border-0" />
          ) : (
            <div className="h-full overflow-y-auto p-5">
              {pageNumber ? (
                <div className="mb-3 text-xs font-bold text-zinc-500">
                  已定位到第 {pageNumber} 页起的内容
                  {info.total_pages ? `（全文共 ${info.total_pages} 页）` : ""}
                </div>
              ) : null}
              <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 border-2 border-black rounded-2xl p-4">
                {textContent}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
