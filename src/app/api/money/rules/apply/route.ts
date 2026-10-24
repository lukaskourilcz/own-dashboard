import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { readTextPrefix } from "@/lib/bounded-text";
import { rateLimit } from "@/lib/rate-limit";
import { parseRule, usableRules, type TransactionRule } from "@/lib/transaction-rules";
import { evaluateRuleApplication, parseRuleApplicationReceipt, parseRuleApplicationSnapshot } from "@/lib/transaction-rule-application";

export const dynamic = "force-dynamic";
const bodySchema = z.object({
  mode: z.enum(["preview", "apply"]).default("preview"), ruleId: z.uuid().optional(),
  expectedRulesVersion: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  draft: z.object({ stage: z.string().optional(), conditions: z.array(z.unknown()), actions: z.record(z.string(), z.unknown()) }).strict().optional(),
}).strict().refine(body => !(body.draft && body.ruleId) && !(body.mode === "apply" && body.draft)
  && (body.mode !== "apply" || Boolean(body.expectedRulesVersion)));
const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Complete owner snapshot → one prepared evaluation → one atomic confirmed
 * metadata update. Never count a capped read or an unconfirmed write. */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return fail(401, "Not authenticated.");
  let body: z.infer<typeof bodySchema>;
  try {
    const prefix = await readTextPrefix(new Response(request.body), 64 * 1024);
    if (prefix.truncated) return fail(413, "Body too large.");
    const parsed = bodySchema.safeParse(JSON.parse(prefix.text));
    if (!parsed.success) return fail(400, "Invalid body.");
    body = parsed.data;
  } catch { return fail(400, "Invalid body."); }
  let draft: TransactionRule | null = null;
  if (body.draft) {
    draft = parseRule({ id: "draft", user_id: user.id, name: "", stage: body.draft.stage ?? "default",
      conditions: body.draft.conditions, actions: body.draft.actions, enabled: true });
    if (!draft || !draft.conditions.length) return fail(400, "Invalid rule.");
  }
  const limited = await rateLimit(user.id, { key: `rule-${body.mode}`, limit: body.mode === "apply" ? 5 : 20, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  let snapshot: ReturnType<typeof parseRuleApplicationSnapshot>;
  try {
    const { data, error } = await client.rpc("transaction_rule_snapshot").abortSignal(signal);
    if (error) throw error;
    snapshot = parseRuleApplicationSnapshot(data, user.id);
  } catch { return fail(503, "Complete rule snapshot unavailable."); }
  if (body.mode === "apply" && body.expectedRulesVersion !== snapshot.context.rulesVersion) return fail(409, "Rules changed. Reload before applying.");
  const candidates = draft ? [draft] : body.ruleId ? snapshot.context.rules.filter(rule => rule.id === body.ruleId) : snapshot.context.rules;
  if (body.ruleId && !candidates.length) return fail(404, "Rule not found.");
  const rules = body.mode === "preview" && (draft || body.ruleId) ? candidates.map(rule => ({ ...rule, enabled: true })) : usableRules(candidates);
  let evaluated: ReturnType<typeof evaluateRuleApplication>;
  try { evaluated = evaluateRuleApplication(snapshot, rules); }
  catch { return fail(422, "Rule evaluation exceeds the complete processing bound."); }
  const { scanned, matched, changed, plan } = evaluated;
  if (body.mode === "preview") return NextResponse.json({ scanned, matched, changed, updated: 0, truncated: false });
  // Even an empty plan checks the captured rule version under the owner lock.
  try {
    const { data, error } = await client.rpc("apply_transaction_rule_plan", { p_rules_version: snapshot.context.rulesVersion, p_plan: plan }).abortSignal(signal);
    if (error) return fail(error.code === "40001" ? 409 : 503, "Rule application not confirmed.");
    const updated = parseRuleApplicationReceipt(data, plan.map(row => row.id));
    return NextResponse.json({ scanned, matched, changed, updated, truncated: false });
  } catch { return fail(503, "Rule application not confirmed."); }
}
