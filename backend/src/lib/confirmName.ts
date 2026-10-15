export function confirmed(sent: unknown, expected: string): boolean {
  return typeof sent === "string" && sent.trim() === expected.trim();
}
