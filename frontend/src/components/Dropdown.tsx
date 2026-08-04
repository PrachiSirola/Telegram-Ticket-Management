import { useEffect, useRef, useState } from "react";
import { matchWords } from "../lib/search";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className = "",
  size = "md",
  align = "left",
  disabled = false,
  searchable = false,
  searchPlaceholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  align?: "left" | "right";
  disabled?: boolean;
  /** Adds a search box at the top of the menu, filtering options by
   *  word-prefix match (see lib/search.ts) instead of showing the full
   *  list. Off by default — only opt in where explicitly wanted (e.g. the
   *  project switcher), so every other existing Dropdown usage is
   *  unaffected. */
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value && o.value !== "");

  const visibleOptions =
    searchable && query.trim() ? options.filter((o) => matchWords(o.label, query)) : options;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Capture phase so an ancestor that stops propagation (e.g. the Modal card)
    // can't swallow the outside-click that should close the menu.
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      // Focus the search box as soon as the menu opens.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    if (!open) setQuery("");
  }, [open, searchable]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`dd-trigger ${size === "sm" ? "sm" : ""} ${open ? "open" : ""}`}
      >
        <span className={selected ? "truncate text-fg" : "truncate text-muted"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronIcon className="dd-chevron" />
      </button>
      {open && (
        <div
          className={`dd-menu absolute z-30 mt-1 min-w-full ${align === "right" ? "right-0" : "left-0"}`}
        >
          {searchable && (
            <div className="border-b border-line p-2">
              <input
                ref={searchRef}
                type="text"
                className="input"
                style={{ padding: "6px 10px", fontSize: 13 }}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {visibleOptions.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted">No matches</div>
          ) : (
            visibleOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`dd-option ${o.value === value ? "selected" : ""}`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function MultiDropdown({
  values,
  onChange,
  options,
  placeholder = "Select…",
  className = "",
  size = "md",
  align = "left",
  disabled = false,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.filter((o) => values.includes(o.value));

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Capture phase so an ancestor that stops propagation (e.g. the Modal card)
    // can't swallow the outside-click that should close the menu.
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(value: string) {
    onChange(
      values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
    );
  }

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
        ? selected.map((o) => o.label).join(", ")
        : `${selected.length} selected`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`dd-trigger ${size === "sm" ? "sm" : ""} ${open ? "open" : ""}`}
      >
        <span className={selected.length ? "truncate text-fg" : "truncate text-muted"}>
          {summary}
        </span>
        <ChevronIcon className="dd-chevron" />
      </button>
      {open && (
        <div
          className={`dd-menu absolute z-30 mt-1 min-w-full ${align === "right" ? "right-0" : "left-0"}`}
        >
          {options.map((o) => {
            const checked = values.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => toggle(o.value)}
                className={`dd-option ${checked ? "selected" : ""}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{o.label}</span>
                  <span aria-hidden className={checked ? "text-fg" : "text-transparent"}>
                    ✓
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}