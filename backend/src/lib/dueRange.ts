import { dueDateFilter, isValidYmd, resolveWorkRange, WORK_RANGES, type WorkRange } from "./dateRanges.js";

type Query = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * The due-date filter shared by every ticket list (project tickets, Dashboard → My Tickets).
 *
 * Accepts the same vocabulary as "My Work":
 *   range = all | today | last_24h | last_3d | last_7d | last_1m | last_1y | custom
 *   from / to = yyyy-mm-dd, used when range = custom (either may be left out)
 * and, for older clients, the previous single-day `dueDate` and the `dueFrom`/`dueTo` pair
 * (both are treated as a custom range).
 *
 * Presets are resolved in the ORGANISATION's timezone. Due dates are stored as midnight-UTC of the
 * picked day, so they are matched by calendar day (see dueDateFilter).
 */
export function parseDueRange(
  query: Query,
  timeZone: string | undefined,
): { ok: true; where: { dueDate?: { gte?: Date; lt?: Date } }; range: WorkRange } | { ok: false; error: string } {
  let range: WorkRange = "all";
  let from: string | undefined;
  let to: string | undefined;

  const rawRange = str(query.range);
  if (rawRange) {
    if (!WORK_RANGES.includes(rawRange as WorkRange)) return { ok: false, error: "Invalid date range" };
    range = rawRange as WorkRange;
    if (range === "custom") {
      from = str(query.from);
      to = str(query.to);
    }
  } else {
    const day = str(query.dueDate);
    from = str(query.dueFrom) ?? day;
    to = str(query.dueTo) ?? day;
    if (from || to) range = "custom";
  }

  if (range === "custom") {
    if ((from && !isValidYmd(from)) || (to && !isValidYmd(to))) {
      return { ok: false, error: "Dates must be valid yyyy-mm-dd values." };
    }
    if (from && to && from > to) {
      return { ok: false, error: "The start date must be on or before the end date." };
    }
  }
  return { ok: true, range, where: dueDateFilter(resolveWorkRange(range, { from, to }, timeZone)) };
}