import { useCallback, useRef, useState, type ReactNode } from "react";
import { IconFile, IconUpload, IconX } from "./Icons";
import {
  ACCEPT,
  ALLOWED_SUMMARY,
  MAX_FILE_MB,
  MAX_FILES_PER_UPLOAD,
  humanSize,
  validateFiles,
  type RejectedFile,
} from "../lib/attachments";
export function useStagedFiles(max = MAX_FILES_PER_UPLOAD) {
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);

  const add = useCallback(
    (incoming: File[]) => {
      setFiles((cur) => {
        const { accepted, rejected: rej } = validateFiles(incoming, cur, max);
        setRejected(rej);
        return accepted.length ? [...cur, ...accepted] : cur;
      });
    },
    [max],
  );
  const remove = (i: number) => setFiles((cur) => cur.filter((_, j) => j !== i));
  const clear = () => {
    setFiles([]);
    setRejected([]);
  };
  return { files, rejected, add, remove, clear, dismissRejected: () => setRejected([]) };
}
export function FileDropzone({
  onFiles,
  disabled = false,
  compact = false,
  children,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  return (
    <div
      className={`dropzone ${over ? "active" : ""} ${compact ? "p-3" : "p-5"} ${disabled ? "opacity-60" : ""}`}
      data-testid="dropzone"
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        if (disabled) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const dropped = Array.from(e.dataTransfer.files ?? []);
        if (dropped.length) onFiles(dropped);
      }}
    >
      <div className={`flex ${compact ? "flex-row items-center gap-3" : "flex-col items-center gap-2 text-center sm:flex-row sm:text-left"}`}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
          <IconUpload size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">
            {over ? "Drop to add files" : "Drag & drop files here"}
          </div>
          <div className="text-xs text-muted">
            {ALLOWED_SUMMARY} · up to {MAX_FILES_PER_UPLOAD} files · max {MAX_FILE_MB} MB each
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <IconUpload size={14} />
          Add Attachment
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          data-testid="file-input"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length) onFiles(picked);
            e.target.value = ""; 
          }}
        />
      </div>
      {children}
    </div>
  );
}

export function StagedList({
  files,
  rejected,
  onRemove,
  onDismissRejected,
  disabled,
}: {
  files: File[];
  rejected: RejectedFile[];
  onRemove: (i: number) => void;
  onDismissRejected: () => void;
  disabled?: boolean;
}) {
  if (files.length === 0 && rejected.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {rejected.length > 0 && (
        <div className="alert alert-danger text-sm" role="alert" data-testid="rejected-files">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium">
              {rejected.length === 1 ? "1 file wasn't added" : `${rejected.length} files weren't added`}
            </div>
            <button type="button" onClick={onDismissRejected} aria-label="Dismiss" className="text-danger">
              <IconX size={14} />
            </button>
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">
            {rejected.map((r, i) => (
              <li key={i} className="break-words">
                <span className="font-medium">{r.name}</span> {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {files.length > 0 && (
        <ul className="space-y-1.5" data-testid="staged-files">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-card-border bg-white px-3 py-2 text-sm"
            >
              <IconFile size={16} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-xs text-muted">{humanSize(f.size)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(i)}
                aria-label={`Remove ${f.name}`}
                className="shrink-0 text-muted hover:text-danger disabled:opacity-40"
              >
                <IconX size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  return (
    <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} data-testid="upload-progress">
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{label ?? "Uploading…"}</span>
        <span>{percent}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}