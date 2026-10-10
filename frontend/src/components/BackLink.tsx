import { Link, useLocation } from "react-router-dom";
import { IconArrowLeft } from "./Icons";

/**
 * "Back to <place>" support for drill-down navigation (e.g. Member Details ->
 * project / ticket). The source page passes `backState({ path, label })` as the
 * router `state` of its links; the destination page renders <BackLink/>, which
 * shows nothing when the page was opened directly (so those pages look exactly
 * as before). Only same-app paths are accepted.
 */
export interface BackTarget {
  path: string;
  label: string;
}

export const backState = (target: BackTarget) => ({ from: target });

export function readBack(state: unknown): BackTarget | null {
  const from = (state as { from?: Partial<BackTarget> } | null)?.from;
  if (!from || typeof from.path !== "string" || typeof from.label !== "string") return null;
  if (!from.path.startsWith("/") || from.path.startsWith("//")) return null;
  return { path: from.path, label: from.label };
}

export function BackLink({ className = "mb-4" }: { className?: string }) {
  const { state } = useLocation();
  const back = readBack(state);
  if (!back) return null;
  return (
    <Link
      to={back.path}
      data-testid="back-link"
      className={`inline-flex items-center gap-1.5 text-sm font-medium text-fg-soft hover:text-fg ${className}`}
    >
      <IconArrowLeft size={14} />
      Back to {back.label}
    </Link>
  );
}
