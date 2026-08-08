export type WorkRange =
  | "current"
  | "today"
  | "week"
  | "prev_week"
  | "month"
  | "prev_month"
  | "custom";

export interface DateWindow {
  /** Inclusive start of the range, or null for "current" (no date bound). */
  start: Date | null;
  /** Inclusive end of the range, or null for "current" (no date bound). */
  end: Date | null;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Monday-start week, matching common project-management convention. */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  x.setDate(x.getDate() + diff);
  return x;
}

function endOfWeek(d: Date): Date {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return endOfDay(e);
}

function startOfMonth(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

function endOfMonth(d: Date): Date {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * Resolves a range key (+ optional custom from/to) into a concrete date
 * window. Computed against the SERVER's local time — acceptable for now
 * since the app doesn't track per-user timezones anywhere else either; if
 * that's ever added, this is the one place that needs updating.
 *
 * "current" and "today" both return `{ start: null, end: null }` /
 * `{ start: todayStart, end: todayEnd }` respectively — "current" has NO
 * date bound at all (it means "everything on my plate right now", filtered
 * by status elsewhere, not by date), which is why it's distinct from every
 * other range here.
 */
export function resolveWorkRange(
  range: WorkRange,
  custom?: { from?: string; to?: string },
): DateWindow {
  const now = new Date();
  switch (range) {
    case "current":
      return { start: null, end: null };
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "week":
      return { start: startOfWeek(now), end: endOfWeek(now) };
    case "prev_week": {
      const prev = new Date(now);
      prev.setDate(prev.getDate() - 7);
      return { start: startOfWeek(prev), end: endOfWeek(prev) };
    }
    case "month":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "prev_month": {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start: startOfMonth(prev), end: endOfMonth(prev) };
    }
    case "custom": {
      const from = custom?.from ? startOfDay(new Date(custom.from)) : null;
      const to = custom?.to ? endOfDay(new Date(custom.to)) : null;
      return { start: from, end: to };
    }
    default:
      return { start: null, end: null };
  }
}

export const WORK_RANGES: WorkRange[] = [
  "current",
  "today",
  "week",
  "prev_week",
  "month",
  "prev_month",
  "custom",
];