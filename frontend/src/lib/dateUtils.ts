// Returns today's date as a "yyyy-mm-dd" string in the user's local timezone,
// suitable for use as the `min` attribute of an <input type="date" />.
export function todayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Today's calendar date ("yyyy-mm-dd") in the given IANA timezone — e.g. the
 * organisation's — instead of the browser's or UTC's. Falls back to the
 * browser's local date if the timezone name is unknown.
 */
export function todayInTimeZone(timeZone: string | undefined, now: Date = new Date()): string {
  if (!timeZone) return todayStr();
  try {
    // en-CA formats as yyyy-mm-dd.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return todayStr();
  }
}