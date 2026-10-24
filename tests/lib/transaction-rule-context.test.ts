import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { parseTransactionRuleContext, readTransactionRuleContext } from "@/lib/transaction-rule-data";

const rule = { id: "r1", user_id: "owner", stage: "default", conditions: [{ field: "note", op: "contains", value: "merchant" }], actions: { category: null } };
const context = { owner_id: "owner", rules: [rule], rules_version: "0123456789abcdef0123456789abcdef", project_ids: ["p1"], subscription_ids: ["s1"] };
it("retains complete parent identities and reports refused rules", () => {
  const parsed = parseTransactionRuleContext({ ...context, rules: [rule, { ...rule, id: "bad", conditions: [null] }] }, "owner");
  expect(parsed).toMatchObject({ dropped: 1, projectIds: ["p1"], subscriptionIds: ["s1"] });
  expect(parsed.rules).toHaveLength(1); expect(parsed.rules[0].actions).toEqual({ category: null });
});
it.each([
  null, [], { ...context, rules: null }, { ...context, rules_version: "0123456789abcdef0123456789abcdef", project_ids: null },
  { ...context, rules: [{ ...rule, user_id: "foreign" }] },
  { ...context, rules: [rule, rule] }, { ...context, rules_version: "0123456789abcdef0123456789abcdef", project_ids: ["p1", "p1"] },
  { ...context, subscription_ids: ["s1", "s1"] }, { ...context, rules: Array(1001).fill(rule) },
])("refuses incomplete, foreign or duplicate context (%j)", raw => {
  expect(() => parseTransactionRuleContext(raw, "owner")).toThrow();
});
it("asserts the verified server owner and redacts upstream failure details", async () => {
  expect(() => parseTransactionRuleContext(context, "foreign")).toThrow();
  const rpc = vi.fn().mockResolvedValue({ data: context, error: null });
  const client = { rpc } as unknown as SupabaseClient;
  expect((await readTransactionRuleContext(client, "owner")).rules).toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith("transaction_rule_context", { p_user_id: "owner" });
  rpc.mockResolvedValue({ data: null, error: new Error("Synthetic private upstream detail") });
  await expect(readTransactionRuleContext(client, "owner")).rejects.toThrow("Rule context unavailable");
});
