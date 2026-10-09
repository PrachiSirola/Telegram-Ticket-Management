import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck } from "./Icons";

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  hidden?: boolean;
}
export function MenuButton({
  label,
  icon,
  items,
  align = "left",
  testId,
  disabled,
  width = "w-56",
  variant = "btn-secondary",
  iconOnly = false,
  header,
}: {
  label: string;
  icon?: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  testId?: string;
  disabled?: boolean;
  width?: string;
  variant?: string;
  iconOnly?: boolean;
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"left" | "right">(align);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);
  useLayoutEffect(() => {
    if (!open) {
      setSide(align);
      return;
    }
    const el = menu.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (side === "left" && r.right > window.innerWidth - 8) setSide("right");
    else if (side === "right" && r.left < 8) setSide("left");
  }, [open, align, side]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    const btns = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      btns[(i + 1) % btns.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      btns[(i - 1 + btns.length) % btns.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      btns[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      btns[btns.length - 1].focus();
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`btn ${variant} btn-sm`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={iconOnly ? label : undefined}
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {!iconOnly && label}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          onKeyDown={onMenuKey}
          className={`dd-menu absolute z-40 mt-1 max-w-[calc(100vw-1.5rem)] ${width} ${side === "right" ? "right-0" : "left-0"}`}
          style={{ maxHeight: "min(24rem, 70vh)", overflowY: "auto" }}
        >
          {header}
          {visible.map((it) => (
            <div key={it.key}>
              {it.separator && <div className="my-1 border-t border-card-border" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                data-testid={`menu-${it.key}`}
                className={`dd-option flex w-full items-center gap-2 ${it.danger ? "text-danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon && <span className="shrink-0 opacity-80">{it.icon}</span>}
                <span className="min-w-0 flex-1 truncate text-left">{it.label}</span>
                {it.checked && <IconCheck size={14} />}
              </button>
            </div>
          ))}
          {visible.length === 0 && <div className="p-3 text-xs text-muted">Nothing available.</div>}
        </div>
      )}
    </div>
  );
}