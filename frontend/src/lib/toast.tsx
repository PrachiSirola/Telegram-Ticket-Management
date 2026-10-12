import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconAlertTriangle, IconCheckCircle, IconX } from "../components/Icons";

/**
 * Central toast service. One store for the whole app: call `toast.success(...)`
 * from anywhere (components, mutation callbacks, the global mutation error
 * handler in main.tsx) and render <Toaster /> once at the root.
 *
 *  - identical toasts (same kind + title + message) that are still on screen
 *    are NOT shown twice; the existing one just has its timer restarted
 *  - at most MAX_VISIBLE are shown; the oldest is dropped
 *  - success/info/warning dismiss after 4s, errors after 7s; hovering or
 *    focusing a toast pauses its timer; every toast has a close button
 */
export type ToastKind = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  duration: number;
  /** Bumped when a duplicate arrives, so the card restarts its timer. */
  nonce: number;
}

export interface ToastOptions {
  title?: string;
  /** ms; 0 = stay until closed. Defaults: 4000 (7000 for errors). */
  duration?: number;
}

const MAX_VISIBLE = 3;
const DEFAULT_MS: Record<ToastKind, number> = { success: 4000, info: 4000, warning: 5500, error: 7000 };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(kind: ToastKind, message: string, opts: ToastOptions = {}): number {
  const text = String(message ?? "").trim();
  if (!text) return -1;
  const dup = items.find((t) => t.kind === kind && t.message === text && t.title === opts.title);
  if (dup) {
    items = items.map((t) => (t === dup ? { ...t, nonce: t.nonce + 1 } : t));
    emit();
    return dup.id;
  }
  const item: ToastItem = {
    id: nextId++,
    kind,
    title: opts.title,
    message: text,
    duration: opts.duration ?? DEFAULT_MS[kind],
    nonce: 0,
  };
  items = [...items, item].slice(-MAX_VISIBLE);
  emit();
  return item.id;
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => push("success", message, opts),
  error: (message: string, opts?: ToastOptions) => push("error", message, opts),
  warning: (message: string, opts?: ToastOptions) => push("warning", message, opts),
  info: (message: string, opts?: ToastOptions) => push("info", message, opts),
  dismiss(id: number) {
    const next = items.filter((t) => t.id !== id);
    if (next.length !== items.length) {
      items = next;
      emit();
    }
  },
  clear() {
    items = [];
    emit();
  },
};

/** Hook form of the same service (stable object, safe in deps arrays). */
export function useToast() {
  return toast;
}

/** Best human-readable message from an axios/zod/network error. */
export function apiError(e: unknown, fallback = "Something went wrong. Please try again."): string {
  const err = e as {
    response?: { data?: { error?: unknown; message?: unknown } };
    request?: unknown;
    message?: string;
  };
  const data = err?.response?.data;
  const raw = data?.error ?? data?.message;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object") {
    // zod .flatten() shape: { formErrors: string[], fieldErrors: { field: string[] } }
    const o = raw as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
    const first = o.formErrors?.[0] ?? Object.values(o.fieldErrors ?? {}).flat()[0];
    if (first) return first;
  }
  if (!err?.response && err?.request) return "Can't reach the server. Check your connection and try again.";
  return fallback;
}

/** Shows an error toast for a failed request and returns its message (for inline UI). */
export function failure(e: unknown, fallback: string, title?: string): string {
  const message = apiError(e, fallback);
  toast.error(message, title ? { title } : undefined);
  return message;
}

/** "Open" / "IN_PROGRESS" -> "In Progress" for before/after wording. */
export function humanize(v: string | null | undefined): string {
  if (!v) return "None";
  return v
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Quote a user-supplied name, trimming very long ones. */
export function q(name: string | null | undefined, max = 60): string {
  const n = (name ?? "").trim();
  return `‘${n.length > max ? n.slice(0, max - 1) + "…" : n}’`;
}

const KIND_STYLE: Record<ToastKind, { bar: string; icon: string; bg: string }> = {
  success: { bar: "var(--ok)", icon: "var(--ok)", bg: "var(--ok-bg)" },
  error: { bar: "var(--danger)", icon: "var(--danger)", bg: "var(--danger-bg)" },
  warning: { bar: "var(--warn)", icon: "var(--warn)", bg: "var(--warn-bg)" },
  info: { bar: "var(--primary)", icon: "var(--primary)", bg: "var(--accent)" },
};

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function ToastCard({ t }: { t: ToastItem }) {
  const style = KIND_STYLE[t.kind];
  const [paused, setPaused] = useState(false);
  const remaining = useRef(t.duration);
  const startedAt = useRef(0);

  // (Re)start whenever a duplicate bumps the nonce.
  useEffect(() => {
    remaining.current = t.duration;
  }, [t.nonce, t.duration]);

  useEffect(() => {
    if (t.duration <= 0 || paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => toast.dismiss(t.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(600, remaining.current - (Date.now() - startedAt.current));
    };
  }, [t.id, t.nonce, t.duration, paused]);

  return (
    <div
      role={t.kind === "error" ? "alert" : "status"}
      data-testid="toast"
      data-kind={t.kind}
      className="tm-toast pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3.5 pr-2.5 shadow-elevated"
      style={{ borderColor: "var(--card-border)", borderLeft: `4px solid ${style.bar}` }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="mt-0.5 shrink-0" style={{ color: style.icon }}>
        {t.kind === "success" ? <IconCheckCircle size={18} /> : t.kind === "info" ? <InfoIcon /> : <IconAlertTriangle size={18} />}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {t.title && <div className="font-semibold text-fg">{t.title}</div>}
        <div className={`break-words ${t.title ? "text-fg-soft" : "font-medium text-fg"}`} data-testid="toast-message">
          {t.message}
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        data-testid="toast-close"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-accent hover:text-fg"
        onClick={() => toast.dismiss(t.id)}
      >
        <IconX size={15} />
      </button>
    </div>
  );
}

/** Render once, near the root. */
export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => items,
  );
  return (
    <div
      aria-live="polite"
      data-testid="toaster"
      className="pointer-events-none fixed inset-x-3 top-3 z-[100] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:w-[380px]"
    >
      {list.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>
  );
}
