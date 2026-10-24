import { z } from "zod";
import { parseTransactionRuleContext } from "@/lib/transaction-rule-data";
import { assertRuleEvaluationBounds, createRuleEvaluator, type TransactionRule } from "@/lib/transaction-rules";

const version = z.string().regex(/^[0-9a-f]{32}$/);
const nullableText = z.string().nullable();
const snapshotSchema = z.object({ context: z.unknown(), transactions: z.array(z.object({
  id: z.uuid(), user_id: z.string(), version, note: nullableText, account_id: nullableText,
  amount: z.union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d+)?$/)]),
  occurred_on: z.string(), kind: z.string(), category: nullableText,
  project_id: z.uuid().nullable(), subscription_id: z.uuid().nullable(),
})).max(20000) });

export function parseRuleApplicationSnapshot(raw: unknown, ownerId: string) {
  const parsed = snapshotSchema.parse(raw);
  const context = parseTransactionRuleContext(parsed.context, ownerId);
  if (context.dropped || new Set(parsed.transactions.map(row => row.id)).size !== parsed.transactions.length
    || parsed.transactions.some(row => row.user_id !== ownerId)) throw new Error("Invalid rule snapshot");
  return { context, transactions: parsed.transactions };
}

/** Explicit work bounds refuse the whole request before evaluation or writes.
 * No shortened count or plan is returned when a ledger is too expensive. */
export function evaluateRuleApplication(snapshot: ReturnType<typeof parseRuleApplicationSnapshot>, rules: TransactionRule[]) {
  assertRuleEvaluationBounds(snapshot.transactions, rules);
  const evaluator = createRuleEvaluator(rules, { projectIds: new Set(snapshot.context.projectIds), subscriptionIds: new Set(snapshot.context.subscriptionIds) });
  const plan = [];
  let matched = 0;
  for (const row of snapshot.transactions) {
    const result = evaluator.evaluate(row);
    if (result.matched) matched++;
    if (Object.keys(result.changes).length) plan.push({ id: row.id, version: row.version, changes: result.changes });
  }
  if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > 4 * 1024 * 1024) throw new Error("Rule plan bound exceeded");
  return { scanned: snapshot.transactions.length, matched, changed: plan.length, plan };
}

export function parseRuleApplicationReceipt(raw: unknown, ids: string[]) {
  const receipt = z.object({ updated: z.number().int().min(0).max(20000), ids: z.array(z.uuid()).max(20000) }).parse(raw);
  const expected = new Set(ids);
  if (receipt.updated !== ids.length || receipt.ids.length !== ids.length || new Set(receipt.ids).size !== ids.length
    || receipt.ids.some(id => !expected.has(id))) throw new Error("Rule application not confirmed");
  return receipt.updated;
}
