/**
 * Word-based, prefix-matching, multi-keyword search — NOT substring
 * matching. Used for the project switcher's search box.
 *
 * Rules (see examples below):
 *  - The query is split into keywords by whitespace.
 *  - The candidate name is split into words the same way.
 *  - A keyword matches if it's a PREFIX of at least one word in the name
 *    (so results narrow naturally as you type, without needing the whole
 *    word yet).
 *  - ALL keywords must match (AND) — multi-word queries narrow further.
 *  - Case-insensitive throughout.
 *  - Critically, a keyword never matches merely because it appears
 *    somewhere INSIDE a word — only at a word boundary (start of word).
 *    "women" must not match "forewomen": "women" is a suffix of
 *    "forewomen", not a prefix of it, so it's correctly excluded.
 *
 * Examples (projects "Vastra" and "Vastra Clothing"):
 *   matchWords("Vastra", "v")            -> true   ("vastra" starts with "v")
 *   matchWords("Vastra Clothing", "v")   -> true
 *   matchWords("Vastra", "vastra c")     -> false  (no word starts with "c")
 *   matchWords("Vastra Clothing", "vastra c") -> true  (both keywords match)
 */
export function matchWords(name: string, query: string): boolean {
  const keywords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return true;
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  return keywords.every((kw) => words.some((w) => w.startsWith(kw)));
}