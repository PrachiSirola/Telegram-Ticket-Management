import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "./Popover";
import { IconCalendar, IconChevronLeft, IconChevronRight } from "./Icons";
const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
};
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function formatYmd(s: string): string {
  if (!s) return "";
  const { y, m, d } = parse(s);
  return new Date(Date.UTC(y, m, d)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  today,
  placeholder = "Select date",
  ariaLabel,
  align = "left",
  className = "",
  testId,
  size = "sm",
  up = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Earliest selectable day (inclusive), yyyy-mm-dd. */
  min?: string;
  /** Latest selectable day (inclusive), yyyy-mm-dd. */
  max?: string;
  /** Today's date in the relevant timezone (highlighted); optional. */
  today?: string;
  placeholder?: string;
  ariaLabel: string;
  align?: "left" | "right";
  className?: string;
  testId?: string;
  /** Matches Dropdown sizes: "sm" for filter bars, "md" for form fields. */
  size?: "sm" | "md";
  /** Prefer opening above the field (it flips automatically when there is no room either way). */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const seed = value || (min && (!today || min > today) ? min : today) || min || "";
  const initial = seed ? parse(seed) : (() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: 1 }; })();
  const [view, setView] = useState({ y: initial.y, m: initial.m });
  useEffect(() => {
    if (!open) return;
    const s = value || (min && (!today || min > today) ? min : today) || min;
    if (s) { const p = parse(s); setView({ y: p.y, m: p.m }); }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const cells = useMemo(() => {
    const lead = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7; // Monday-first
    const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)] as (number | null)[];
  }, [view]);

  const shift = (n: number) => setView((v) => { const d = new Date(Date.UTC(v.y, v.m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const monthLabel = new Date(Date.UTC(view.y, view.m, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        className={`dd-trigger ${size === "sm" ? "sm" : ""} ${open ? "open" : ""}`}
      >
        <span className={value ? "truncate text-fg" : "truncate text-muted"}>{value ? formatYmd(value) : placeholder}</span>
        <IconCalendar size={15} className="dd-chevron" />
      </button>
      <Popover
        open={open}
        anchorRef={btnRef}
        popRef={popRef}
        align={align}
        preferUp={up}
        role="dialog"
        aria-label={`${ariaLabel} calendar`}
        className="w-[288px] p-3"
      >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" className="btn btn-secondary btn-sm !px-2" onClick={() => shift(-1)}>
              <IconChevronLeft size={16} />
            </button>
            <div className="text-sm font-semibold text-fg" data-testid="cal-month" aria-live="polite">{monthLabel}</div>
            <button type="button" aria-label="Next month" className="btn btn-secondary btn-sm !px-2" onClick={() => shift(1)}>
              <IconChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-muted">
            {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (d === null) return <div key={`b${i}`} />;
              const ymd = toYmd(view.y, view.m, d);
              const disabled = (!!min && ymd < min) || (!!max && ymd > max);
              const selected = ymd === value;
              return (
                <button
                  key={ymd}
                  type="button"
                  disabled={disabled}
                  data-date={ymd}
                  aria-label={formatYmd(ymd)}
                  aria-pressed={selected}
                  onClick={() => { onChange(ymd); setOpen(false); }}
                  className={`h-8 rounded-lg text-sm transition-colors ${
                    selected
                      ? "bg-primary font-semibold text-white"
                      : disabled
                        ? "cursor-not-allowed text-fg opacity-30"
                        : "text-fg hover:bg-accent"
                  } ${ymd === today && !selected ? "ring-1 ring-primary" : ""}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          {value && (
            <div className="mt-2 flex justify-end">
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => { onChange(""); setOpen(false); }}>
                Clear
              </button>
            </div>
          )}
      </Popover>
    </div>
  );
}