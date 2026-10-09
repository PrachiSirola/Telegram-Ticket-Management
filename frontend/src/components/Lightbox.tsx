import { useEffect, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconDownload, IconX } from "./Icons";
import { downloadAttachment, getBlobUrl, humanSize } from "../lib/attachments";

export interface LightboxItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  uploader?: { name: string };
}
export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: LightboxItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [dlError, setDlError] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    setDlError(false);
    let live = true;
    if (item) getBlobUrl(item.id, "preview").then((u) => live && setUrl(u)).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [item?.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [index, items.length, onClose, onIndex]);

  if (!item) return null;
  const isPdf = item.mimeType === "application/pdf";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: "rgba(10, 14, 22, 0.92)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${item.filename}`}
      data-testid="lightbox"
      onMouseDown={onClose}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 text-white"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" title={item.filename}>
            {item.filename}
          </div>
          <div className="truncate text-xs text-white/70">
            {humanSize(item.size)}
            {item.uploader && ` · ${item.uploader.name}`}
            {item.createdAt && ` · ${new Date(item.createdAt).toLocaleString()}`}
            {items.length > 1 && ` · ${index + 1} of ${items.length}`}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => downloadAttachment(item).catch(() => setDlError(true))}
        >
          <IconDownload size={14} />
          <span className="hidden sm:inline">Download</span>
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close preview">
          <IconX size={14} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-14">
        {index > 0 && (
          <button
            type="button"
            aria-label="Previous"
            className="absolute left-1 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/30 sm:left-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onIndex(index - 1)}
          >
            <IconChevronLeft />
          </button>
        )}
        <div className="flex h-full w-full items-center justify-center" onMouseDown={(e) => e.stopPropagation()}>
          {failed ? (
            <div className="rounded-lg bg-white p-6 text-center text-sm text-danger">
              Couldn't load this file. It may have been removed or you no longer have access.
            </div>
          ) : !url ? (
            <div className="text-sm text-white/70 pulse">Loading…</div>
          ) : isPdf ? (
            <iframe title={item.filename} src={url} className="h-full w-full rounded-lg bg-white" />
          ) : (
            <img
              src={url}
              alt={item.filename}
              className="max-h-full max-w-full rounded-lg object-contain"
              onError={() => setFailed(true)}
            />
          )}
        </div>
        {index < items.length - 1 && (
          <button
            type="button"
            aria-label="Next"
            className="absolute right-1 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/30 sm:right-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onIndex(index + 1)}
          >
            <IconChevronRight />
          </button>
        )}
      </div>
      {dlError && (
        <div className="pb-3 text-center text-sm text-red-300">Download failed. Please try again.</div>
      )}
    </div>
  );
}