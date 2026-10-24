import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseRules, type TransactionRuleSet } from "@/lib/transaction-rules";

const ids = (limit: number) => z.array(z.string().min(1)).max(limit);
const contextSchema = z.object({
  owner_id: z.string().min(1), rules: z.array(z.unknown()).max(1000),
  project_ids: ids(10000), subscription_ids: ids(20000), rules_version: z.string().regex(/^[0-9a-f]{32}$/),
});
export type TransactionRuleContext = TransactionRuleSet & { projectIds: string[]; subscriptionIds: string[]; rulesVersion: string };

/** Keep malformed/incomplete responses out of the owner query cache. Malformed
 * rule rows stay visible as a dropped count; import/sync refuse that count. */
export function parseTransactionRuleContext(raw: unknown, ownerId?: string): TransactionRuleContext {
  const context = contextSchema.parse(raw);
  if (ownerId !== undefined && context.owner_id !== ownerId) throw new Error("Invalid rule owner");
  const parsed = parseRules(context.rules);
  if (parsed.rules.some(rule => rule.user_id !== context.owner_id)
    || new Set(parsed.rules.map(rule => rule.id)).size !== parsed.rules.length
    || new Set(context.project_ids).size !== context.project_ids.length
    || new Set(context.subscription_ids).size !== context.subscription_ids.length) throw new Error("Invalid rule context");
  return { ...parsed, projectIds: context.project_ids, subscriptionIds: context.subscription_ids, rulesVersion: context.rules_version };
}

export async function readTransactionRuleContext(client: SupabaseClient, ownerId?: string, signal?: AbortSignal): Promise<TransactionRuleContext> {
  const query = client.rpc("transaction_rule_context", { p_user_id: ownerId ?? null });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw new Error("Rule context unavailable");
  return parseTransactionRuleContext(data, ownerId);
}
