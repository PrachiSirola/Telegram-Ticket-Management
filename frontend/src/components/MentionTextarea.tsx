import { useRef, useState } from "react";
import { Avatar } from "./ui";

export interface MentionMember {
  id: string;
  name: string;
}
export function extractMentionIds(body: string, picked: MentionMember[]): string[] {
  return [...new Set(picked.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id))];
}
export function MentionTextarea({
  value,
  onChange,
  onMention,
  members,
  rows = 3,
  placeholder,
  className = "input",
  textareaRef,
  disabled,
  maxLength,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onMention: (m: MentionMember) => void;
  members: MentionMember[];
  rows?: number;
  placeholder?: string;
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? innerRef;
  const [query, setQuery] = useState<string | null>(null); 
  const [active, setActive] = useState(0);

  const matches =
    query === null
      ? []
      : members.filter((m) => m.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);
  const open = query !== null && matches.length > 0;

  function refreshQuery(text: string, caret: number) {
    const upToCaret = text.slice(0, caret);
    const match = upToCaret.match(/(^|\s)@(\S*)$/);
    setQuery(match ? match[2] : null);
    setActive(0);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    refreshQuery(e.target.value, e.target.selectionStart);
  }

  function select(m: MentionMember) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const upToCaret = value.slice(0, caret);
    const replaced = upToCaret.replace(/(^|\s)@\S*$/, `$1@${m.name} `);
    onChange(replaced + value.slice(caret));
    onMention(m);
    setQuery(null);
    const pos = replaced.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      select(matches[active]);
    } else if (e.key === "Escape") {
      setQuery(null);
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={className}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        autoFocus={autoFocus}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(e) => refreshQuery(value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {open && (
        <div className="dd-menu absolute left-0 top-full z-40 w-64">
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={`dd-option flex items-center gap-2 ${i === active ? "selected" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault(); // keep textarea focus
                select(m);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar name={m.name} size={20} />
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}