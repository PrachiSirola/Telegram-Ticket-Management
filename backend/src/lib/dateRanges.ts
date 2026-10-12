export type WorkRange =
  | "all"
  | "today"
  | "last_24h"
  | "last_3d"
  | "last_7d"
  | "last_1m"
  | "last_1y"
  | "custom";

export const WORK_RANGES: WorkRange[] = [
  "all",
  "today",
  "last_24h",
  "last_3d",
  "last_7d",
  "last_1m",
  "last_1y",
  "custom",
];

export interface DateWindow {
  start: Date | null;
  end: Date | null;
  fromDay: string | null;
  toDay: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function isValidYmd(s: unknown): s is string {
  if (typeof s !== "string" || !YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}
function safeZone(timeZone: string | undefined): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
export function ymdInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)))
    .toISOString()
    .slice(0, 10);
}
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
export function zonedDayStart(ymd: string, timeZone: string): Date {
  const guess = Date.parse(`${ymd}T00:00:00Z`);
  let t = guess - zoneOffsetMs(new Date(guess), timeZone);
  t = guess - zoneOffsetMs(new Date(t), timeZone);
  return new Date(t);
}
export function resolveWorkRange(
  range: WorkRange,
  custom: { from?: string; to?: string } | undefined,
  timeZone: string | undefined,
  now: Date = new Date(),
): DateWindow {
  const tz = safeZone(timeZone);
  const today = ymdInZone(now, tz);
  const dayWindow = (fromDay: string | null, toDay: string | null): DateWindow => ({
    fromDay,
    toDay,
    start: fromDay ? zonedDayStart(fromDay, tz) : null,
    end: toDay ? new Date(zonedDayStart(addDays(toDay, 1), tz).getTime() - 1) : null,
  });

  switch (range) {
    case "today":
      return dayWindow(today, today);
    case "last_24h": {
      const start = new Date(now.getTime() - DAY_MS);
      return { start, end: now, fromDay: ymdInZone(start, tz), toDay: today };
    }
    case "last_3d":
      return dayWindow(addDays(today, -2), today);
    case "last_7d":
      return dayWindow(addDays(today, -6), today);
    case "last_1m":
      return dayWindow(addMonths(today, -1), today);
    case "last_1y":
      return dayWindow(addMonths(today, -12), today);
    case "custom":
      return dayWindow(custom?.from || null, custom?.to || null);
    default:
      return { start: null, end: null, fromDay: null, toDay: null };
  }
}
export function dueDateFilter(w: DateWindow) {
  if (!w.fromDay && !w.toDay) return {};
  return {
    dueDate: {
      ...(w.fromDay ? { gte: new Date(`${w.fromDay}T00:00:00Z`) } : {}),
      ...(w.toDay ? { lt: new Date(`${addDays(w.toDay, 1)}T00:00:00Z`) } : {}),
    },
  };
}