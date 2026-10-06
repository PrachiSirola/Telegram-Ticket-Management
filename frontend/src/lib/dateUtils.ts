// Returns today's date as a "yyyy-mm-dd" string in the user's local timezone,
// suitable for use as the `min` attribute of an <input type="date" />.
export function todayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}