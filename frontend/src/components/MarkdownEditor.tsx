import { useRef, useState } from "react";
import { MentionTextarea, type MentionMember } from "./MentionTextarea";
import { Markdown } from "../lib/markdown";

export const MAX_COMMENT_LENGTH = 10000;

type Kind = "bold" | "italic" | "code" | "link" | "ul" | "ol" | "quote";

const TOOLS: { kind: Kind; label: string; title: string; content: React.ReactNode }[] = [
  { kind: "bold", label: "Bold", title: "Bold (Ctrl+B)", content: <b>B</b> },
  { kind: "italic", label: "Italic", title: "Italic (Ctrl+I)", content: <i className="font-serif">I</i> },
  { kind: "code", label: "Code", title: "Code", content: <span className="font-mono text-[11px]">{"</>"}</span> },
  { kind: "link", label: "Link", title: "Link (Ctrl+K)", content: <span className="text-[11px]">🔗</span> },
  { kind: "ul", label: "Bulleted list", title: "Bulleted list", content: <span>•≡</span> },
  { kind: "ol", label: "Numbered list", title: "Numbered list", content: <span className="text-[11px]">1.</span> },
  { kind: "quote", label: "Quote", title: "Quote", content: <span className="font-serif text-base leading-none">“</span> },
];
export function MarkdownEditor({
  value,
  onChange,
  members,
  onMention,
  rows = 4,
  placeholder,
  disabled,
  autoFocus,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  members: MentionMember[];
  onMention: (m: MentionMember) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Ctrl/⌘+Enter */
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");

  function apply(kind: Kind) {
    const el = ref.current;
    if (!el || disabled) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = value.slice(start, end);
    let next = value;
    let a = start;
    let b = end;

    const wrap = (pre: string, post: string, ph: string) => {
      const inner = sel || ph;
      if (sel && value.slice(start - pre.length, start) === pre && value.slice(end, end + post.length) === post) {
        next = value.slice(0, start - pre.length) + sel + value.slice(end + post.length);
        a = start - pre.length;
        b = a + sel.length;
      } else {
        next = value.slice(0, start) + pre + inner + post + value.slice(end);
        a = start + pre.length;
        b = a + inner.length;
      }
    };

    const prefixLines = (make: (i: number) => string, test: RegExp) => {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = value.indexOf("\n", end);
      if (lineEnd === -1) lineEnd = value.length;
      const block = value.slice(lineStart, lineEnd);
      const lines = block.split("\n");
      const allPrefixed = lines.every((l) => test.test(l));
      const out = lines.map((l, i) => (allPrefixed ? l.replace(test, "") : make(i) + l)).join("\n");
      next = value.slice(0, lineStart) + out + value.slice(lineEnd);
      a = lineStart;
      b = lineStart + out.length;
    };

    switch (kind) {
      case "bold": wrap("**", "**", "bold text"); break;
      case "italic": wrap("_", "_", "italic text"); break;
      case "code":
        if (sel.includes("\n")) wrap("```\n", "\n```", "code");
        else wrap("`", "`", "code");
        break;
      case "link": {
        const text = sel || "link text";
        next = value.slice(0, start) + `[${text}](https://)` + value.slice(end);
        a = start + text.length + 3;
        b = a + "https://".length;
        break;
      }
      case "ul": prefixLines(() => "- ", /^\s*[-*]\s+/); break;
      case "ol": prefixLines((i) => `${i + 1}. `, /^\s*\d+[.)]\s+/); break;
      case "quote": prefixLines(() => "> ", /^>\s?/); break;
    }
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a, b);
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); apply("bold"); }
    else if (k === "i") { e.preventDefault(); apply("italic"); }
    else if (k === "k") { e.preventDefault(); apply("link"); }
    else if (k === "enter" && onSubmit) { e.preventDefault(); onSubmit(); }
  }

  const near = value.length > MAX_COMMENT_LENGTH * 0.9;

  return (
    <div className="rounded-xl border border-card-border bg-white" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-card-border px-1.5 py-1" role="toolbar" aria-label="Formatting">
        {TOOLS.map((t) => (
          <button
            key={t.kind}
            type="button"
            title={t.title}
            aria-label={t.label}
            data-testid={`md-${t.kind}`}
            disabled={disabled || tab === "preview"}
            onMouseDown={(e) => e.preventDefault()} 
            onClick={() => apply(t.kind)}
            className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-md px-1.5 text-sm text-fg-soft hover:bg-accent disabled:opacity-40"
          >
            {t.content}
          </button>
        ))}
        <div className="ml-auto flex gap-1 text-xs">
          {(["write", "preview"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              className={`rounded-md px-2 py-1 capitalize ${tab === k ? "bg-accent font-semibold text-primary" : "text-muted hover:text-fg"}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      {tab === "write" ? (
        <MentionTextarea
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          members={members}
          onMention={onMention}
          textareaRef={ref}
          disabled={disabled}
          maxLength={MAX_COMMENT_LENGTH}
          autoFocus={autoFocus}
          className="block w-full resize-y rounded-b-xl bg-transparent p-3 text-sm outline-none"
        />
      ) : (
        <div className="min-h-[96px] p-3" data-testid="md-preview">
          {value.trim() ? (
            <Markdown text={value} memberNames={members.map((m) => m.name)} />
          ) : (
            <span className="text-sm text-muted">Nothing to preview.</span>
          )}
        </div>
      )}
      {near && (
        <div className={`px-3 pb-1.5 text-right text-[11px] ${value.length >= MAX_COMMENT_LENGTH ? "text-danger" : "text-muted"}`}>
          {value.length}/{MAX_COMMENT_LENGTH}
        </div>
      )}
    </div>
  );
}