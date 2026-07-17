/**
 * Keyword → category rules for transactions. Bank feeds (GoCardless) and CSV
 * statements rarely carry a clean category, but the merchant/remittance text is
 * usually enough: a rule like { match: "albert", category: "Groceries" } files
 * every "ALBERT 1234 PRAHA" line automatically.
 *
 * Pure + framework-free so it runs on the server (sync + cron) and client (CSV
 * import) alike, and is easy to unit-test.
 */

export type Rule = { match: string; category: string };

/**
 * First rule whose (lowercased, trimmed) `match` is a substring of `note` wins.
 * Order the rules most-specific first. Returns null when nothing matches or the
 * note is empty.
 */
export function categorizeNote(
  note: string | null | undefined,
  rules: readonly Rule[],
): string | null {
  if (!note) return null;
  const haystack = note.toLowerCase();
  for (const rule of rules) {
    const needle = rule.match.trim().toLowerCase();
    if (needle && haystack.includes(needle)) return rule.category;
  }
  return null;
}
