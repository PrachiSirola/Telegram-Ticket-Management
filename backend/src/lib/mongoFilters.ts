export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const contains = (q: string) => ({ $regex: escapeRegex(q), $options: "i" });

export const OPEN_STATUSES = ["OPEN", "IN_PROGRESS"] as const;


export function and(...parts: Array<Record<string, any> | undefined | null>): Record<string, any> {
  const live = parts.filter((p): p is Record<string, any> => Boolean(p) && Object.keys(p!).length > 0);
  if (live.length === 0) return {};
  return live.length === 1 ? live[0] : { $and: live };
}
