/**
 * Keyword → category rules for transactions. Bank feeds (GoCardless) and CSV
 * statements rarely carry a clean category, but the merchant/remittance text is
 * usually enough: a rule like { match: "albert", category: "Groceries" } files
 * every "ALBERT 1234 PRAHA" line automatically.
 *
 * Pure + framework-free so it runs on the server (sync + cron) and client (CSV
 * import) alike, and is easy to unit-test.
 *
 * Superseded by src/lib/transaction-rules.ts and `public.transaction_rules`,
 * which match more than the note and write more than a category. This module
 * stays for the legacy `transaction_category_rules` table, which is still
 * exported and is the rollback path; `legacyRuleToTransactionRule` below folds
 * one of its rows into the current engine.
 */

import type { TransactionRule } from "./transaction-rules";

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

/**
 * Bridge a legacy keyword rule into the current engine
 * (`public.transaction_rules`, src/lib/transaction-rules.ts), which is now the
 * canonical rule store. The migration backfills every existing row the same
 * way; this keeps a hand-added legacy row usable until that table is dropped.
 */
export function legacyRuleToTransactionRule(
  rule: Rule,
  index: number,
  userId = "",
): TransactionRule {
  return {
    id: `legacy:${index}`,
    user_id: userId,
    name: rule.match,
    stage: "default",
    conditions: [{ field: "note", op: "contains", value: rule.match.trim() }],
    actions: { category: rule.category },
    sort_order: index,
    enabled: rule.match.trim() !== "",
    created_at: "",
    updated_at: "",
  };
}
