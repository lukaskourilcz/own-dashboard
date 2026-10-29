import { expect, it } from "vitest";
import { evaluateRuleApplication, parseRuleApplicationReceipt, parseRuleApplicationSnapshot } from "@/lib/transaction-rule-application";

const version = "0123456789abcdef0123456789abcdef", id = "33333333-3333-4333-8333-333333333333";
const rule = { id, user_id: "owner", stage: "default", conditions: [{ field: "note", op: "contains", value: "merchant" }], actions: { note: null, category: "Work" } };
const row = { id, user_id: "owner", version, note: "Synthetic merchant", account_id: null, amount: 1, occurred_on: "2026-10-24", kind: "expense", category: null, project_id: null, subscription_id: null };
const raw = { context: { owner_id: "owner", rules_version: version, rules: [rule], project_ids: [], subscription_ids: [] }, transactions: [row] };
it("prepares one complete evaluation with explicit clears and stable identities", () => {
  const snapshot = parseRuleApplicationSnapshot(raw, "owner");
  expect(evaluateRuleApplication(snapshot, snapshot.context.rules)).toEqual({ scanned: 1, matched: 1, changed: 1, plan: [{ id, version, changes: { note: null, category: "Work" } }] });
});
it.each([
  { ...raw, transactions: [row, row] }, { ...raw, transactions: [{ ...row, user_id: "other" }] },
  { ...raw, transactions: [{ ...row, version: "bad" }] }, { ...raw, context: { ...raw.context, rules_version: undefined } },
])("refuses ambiguous snapshot identities and missing versions %j", value => expect(() => parseRuleApplicationSnapshot(value, "owner")).toThrow());
it("refuses excessive complete evaluation and write work before returning a partial plan", () => {
  const snapshot = parseRuleApplicationSnapshot(raw, "owner");
  const expensive = { ...snapshot, transactions: Array.from({ length: 20000 }, (_, n) => ({ ...row, id: String(n) })) };
  const manyRules = Array.from({ length: 101 }, () => snapshot.context.rules[0]);
  expect(() => evaluateRuleApplication(expensive, manyRules)).toThrow("Rule evaluation bound exceeded");
  expect(() => evaluateRuleApplication({ ...snapshot, transactions: [{ ...row, note: "x".repeat(20000000) }] }, snapshot.context.rules)).toThrow("Rule evaluation bound exceeded");
  expect(() => evaluateRuleApplication(snapshot, [{ ...snapshot.context.rules[0], actions: { note: "x".repeat(4194304) } }])).toThrow("Rule plan bound exceeded");
});
it("requires a receipt for the exact distinct changed set", () => {
  expect(parseRuleApplicationReceipt({ updated: 1, ids: [id] }, [id])).toBe(1);
  expect(() => parseRuleApplicationReceipt({ updated: 1, ids: [] }, [id])).toThrow();
  expect(() => parseRuleApplicationReceipt({ updated: 2, ids: [id, id] }, [id, id])).toThrow();
});
