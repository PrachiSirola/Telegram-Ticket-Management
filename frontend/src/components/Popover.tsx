import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const MARGIN = 8; // minimum gap to the screen edge
const GAP = 6; // gap between the field and the popup

interface Pos {
  top: number;
  left: number;
  maxHeight: number;
  placement: "down" | "up";
}

/**
 * A floating panel anchored to a field (dropdown menu, calendar).
 *
 * It is rendered in a portal on <body> with `position: fixed`, so it is never clipped by a
 * scrolling area or a modal, and it always stacks above them. It opens below the field when
 * it fits, flips above when there isn't enough room below (or the other way round), is kept
 * inside the screen horizontally, and follows the field while the page or any container
 * scrolls or the window is resized. If neither side has enough room it takes the larger
 * side and scrolls inside itself.
 */
export function Popover({
  open,
  anchorRef,
  popRef,
  align = "left",
  matchAnchorWidth = false,
  preferUp = false,
  className = "",
  children,
  ...aria
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  popRef: RefObject<HTMLDivElement>;
  align?: "left" | "right";
  /** Make the panel at least as wide as the field (dropdown menus). */
  matchAnchorWidth?: boolean;
  /** Open above the field when there is room (e.g. controls at the bottom of a page). */
  preferUp?: boolean;
  className?: string;
  children: ReactNode;
  role?: string;
  "aria-label"?: string;
}) {
  const [pos, setPos] = useState<Pos | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;
    const a = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    // Natural size: measure without our own max-height applied.
    const prevMax = pop.style.maxHeight;
    pop.style.maxHeight = "none";
    const h = pop.offsetHeight;
    const w = pop.offsetWidth;
    pop.style.maxHeight = prevMax;

    const below = vh - a.bottom - GAP - MARGIN;
    const above = a.top - GAP - MARGIN;
    const first = preferUp ? "up" : "down";
    const fits = (p: "up" | "down") => h <= (p === "down" ? below : above);
    const other = first === "down" ? "up" : "down";
    const placement: "up" | "down" = fits(first) ? first : fits(other) ? other : below >= above ? "down" : "up";
    const room = Math.max(120, placement === "down" ? below : above);
    const height = Math.min(h, room);
    const top = placement === "down" ? a.bottom + GAP : a.top - GAP - height;
    let left = align === "right" ? a.right - w : a.left;
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - w - MARGIN));
    setPos((p) =>
      p && Math.abs(p.top - top) < 0.5 && Math.abs(p.left - left) < 0.5 && p.maxHeight === room && p.placement === placement
        ? p
        : { top, left, maxHeight: room, placement },
    );
  }, [anchorRef, popRef, align, preferUp]);

  // Position before paint, then keep following the field.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
  }, [open, place, children]);

  useEffect(() => {
    if (!open) return;
    const on = () => place();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true); // any scrolling ancestor, not just the window
    const vv = window.visualViewport;
    vv?.addEventListener("resize", on);
    const ro = typeof ResizeObserver !== "undefined" && popRef.current ? new ResizeObserver(on) : null;
    if (ro && popRef.current) ro.observe(popRef.current);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
      vv?.removeEventListener("resize", on);
      ro?.disconnect();
    };
  }, [open, place, popRef]);

  if (!open || typeof document === "undefined") return null;

  const style: CSSProperties = {
    position: "fixed",
    top: pos?.top ?? 0,
    left: pos?.left ?? 0,
    margin: 0,
    maxHeight: pos?.maxHeight,
    overflowY: "auto",
    maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
    minWidth: matchAnchorWidth ? anchorRef.current?.getBoundingClientRect().width : 0, // overrides .dd-menu { min-width: 100% }, which would mean the whole viewport here
    visibility: pos ? "visible" : "hidden", // hidden for the one frame needed to measure
    zIndex: 70, // above modals (z-50) and sticky headers
    transformOrigin: pos?.placement === "up" ? "bottom" : "top",
  };
  return createPortal(
    <div ref={popRef} style={style} data-placement={pos?.placement} className={`dd-menu ${className}`} {...aria}>
      {children}
    </div>,
    document.body,
  );
}