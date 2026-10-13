import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { CaptureInputSchema, knowledgeSourceFromRow, normalizeExistingTips, planKnowledgeCapture, KNOWLEDGE_PROMPT_VERSION } from "@/lib/marketing/knowledge";
import { contentHash } from "@/lib/marketing/hashes";
import { prepareApifyKnowledgeRun } from "@/lib/marketing/knowledge-providers";
import { knowledgeAnalysisKey } from "@/lib/marketing/knowledge-extraction";
import type { AiLink } from "@/lib/types";
import { readKnowledgeBody } from "@/lib/marketing/knowledge-body";

const ActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("preview"), capture: CaptureInputSchema }),
  z.strictObject({ action: z.literal("capture"), capture: CaptureInputSchema, reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ action: z.literal("normalize-existing"), apply: z.boolean() }),
  z.strictObject({ action: z.literal("review-item"), aiLinkId: z.uuid(), expectedProcedureHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(["reviewed", "needs-review"]) }),
  z.strictObject({ action: z.literal("analysis-plan"), sourceIds: z.array(z.uuid()).min(1).max(50), provider: z.enum(["apify", "claude"]), maxCostUsd: z.number().positive().max(1) }),
  z.strictObject({ action: z.literal("prepare-analysis"), sourceIds: z.array(z.uuid()).min(1).max(50), provider: z.enum(["apify", "claude"]), consent: z.boolean(), reviewHash: z.string().regex(/^[a-f0-9]{64}$/), maxCostUsd: z.number().positive().max(1) }),
]);
const captureHash = (capture: z.infer<typeof CaptureInputSchema>) => contentHash(capture);
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return fail(401, "unauthorized");
  const query = new URL(request.url).searchParams;
  const projectId = query.get("projectId");
  if (projectId && !z.uuid().safeParse(projectId).success) return fail(400, "invalid-project");
  if (projectId) {
    const { data, error } = await db.from("projects").select("id").eq("user_id", user.id).eq("id", projectId).maybeSingle();
    if (error || !data) return fail(404, "project-unavailable");
  }
  const [sources, items] = await Promise.all([
    db.from("marketing_knowledge_sources").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(500),
    db.from("marketing_knowledge_items").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(1000),
  ]);
  if (sources.error || items.error) return fail(503, "knowledge-unavailable");
  const ownedItems = (items.data ?? []).filter((item) => !projectId || (item.metadata?.references?.projectIds ?? []).includes(projectId));
  const sourceIds = new Set(ownedItems.flatMap((item) => item.source_ids ?? []));
  return NextResponse.json({ sources: (sources.data ?? []).filter((source) => !projectId || sourceIds.has(source.id)), items: ownedItems }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return fail(401, "unauthorized");
  const limit = await rateLimit(user.id, { key: "marketing-knowledge", limit: 20, windowSec: 60 });
  if (!limit.ok) return fail(429, "knowledge-rate-limited");
  try {
    const raw = await readKnowledgeBody(request);
    const input = ActionSchema.parse(JSON.parse(raw));
    if (input.action === "review-item") {
      const { data, error } = await createAdminClient().rpc("marketing_review_knowledge_item", { p_owner: user.id, p_link: input.aiLinkId, p_hash: input.expectedProcedureHash, p_status: input.status });
      if (error) return fail(String(error.message).includes("procedure changed") ? 409 : String(error.message).includes("unavailable") ? 404 : 403, "knowledge-review-unavailable");
      return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (input.action === "preview" || input.action === "capture") {
      const plan = planKnowledgeCapture(input.capture);
      const reviewHash = captureHash(input.capture);
      if (input.action === "preview") return NextResponse.json({ ...plan, reviewHash });
      if (input.reviewHash !== reviewHash) return fail(409, "capture-changed");
      if (!plan.sources.length) return fail(400, "no-sources-in-scope");
      const { data, error } = await createAdminClient().rpc("marketing_import_knowledge", { p_owner: user.id, p_sources: plan.sources, p_items: [], p_event_id: `capture:${reviewHash}` });
      if (error) return fail(503, "knowledge-save-failed");
      return NextResponse.json({ ...plan, saved: data });
    }
    if (input.action === "normalize-existing") {
      const { data, error } = await db.from("ai_links").select("*").eq("user_id", user.id).eq("record_type", "idea").limit(1000);
      if (error) return fail(503, "tips-unavailable");
      const [projects, prompts, tools] = await Promise.all([
        db.from("project_links").select("project_id,ai_link_id").eq("user_id", user.id).limit(2000),
        db.from("prompt_links").select("prompt_id,ai_link_id").eq("user_id", user.id).limit(2000),
        db.from("tools").select("id,ai_link_id").eq("user_id", user.id).limit(1000),
      ]);
      if (projects.error || prompts.error || tools.error) return fail(503, "knowledge-references-unavailable");
      const normalized = normalizeExistingTips((data ?? []) as AiLink[], { projects: projects.data ?? [], prompts: prompts.data ?? [], tools: tools.data ?? [] });
      if (!input.apply) return NextResponse.json(normalized);
      const { data: saved, error: saveError } = await createAdminClient().rpc("marketing_import_knowledge", { p_owner: user.id, p_sources: normalized.sources, p_items: normalized.items, p_event_id: `legacy:${contentHash(normalized.items)}` });
      return saveError ? fail(503, "knowledge-save-failed") : NextResponse.json({ report: normalized.report, saved });
    }
    if (input.action === "prepare-analysis" && !input.consent) return fail(400, "knowledge-consent-and-review-required");
    const { data, error } = await db.from("marketing_knowledge_sources").select("*").eq("user_id", user.id).in("id", input.sourceIds).limit(50);
    if (error || !data || data.length !== new Set(input.sourceIds).size) return fail(404, "source-unavailable");
    const ordered = [...data].sort((a, b) => String(a.shortcode).localeCompare(String(b.shortcode)));
    const sources = ordered.map(knowledgeSourceFromRow);
    const model = process.env.MARKETING_CLAUDE_MODEL;
    if (sources.length !== 1) return fail(400, "knowledge-analysis-needs-one-source");
    if (input.provider === "claude" && (!model || !/^claude-[a-z0-9.-]+$/.test(model))) return fail(503, "knowledge-model-configuration-required");
    const plan = input.provider === "apify" ? prepareApifyKnowledgeRun(sources, input.maxCostUsd, { actorId: process.env.APIFY_ACTOR_ID, build: process.env.APIFY_ACTOR_BUILD }) : {
      version: KNOWLEDGE_PROMPT_VERSION, model, maxCostUsd: input.maxCostUsd, maxInputTokens: 24000, maxOutputTokens: 4000, maxAttempts: 1,
      allowedData: "Submitted source caption/transcript/OCR only; no owner notes, projects, invoices or credentials", diagnostics: "Hashes/counts only", reviewHash: contentHash({ sourceVersions: sources.map((s) => ({ shortcode: s.shortcode, contentHash: contentHash(s.content) })), model, maxCostUsd: input.maxCostUsd }) };
    if (input.action === "analysis-plan") return NextResponse.json({ plan });
    if (input.reviewHash !== plan.reviewHash) return fail(409, "analysis-plan-changed");
    const pending = sources.map((source) => ({ ...source, status: "queued" as const, analysis_key: input.provider === "apify" ? contentHash({ shortcode: source.shortcode, plan: plan.reviewHash }) : knowledgeAnalysisKey(source, model!), budget_usd: input.maxCostUsd, analysis_request: { provider: input.provider, reviewHash: plan.reviewHash, consentAt: new Date().toISOString(), plan, registration: null } }));
    if (pending.some((source, index) => source.analysis_key === sources[index].analysis_key)) return NextResponse.json({ plan, alreadyProcessed: true, requests: [] });
    const { data: saved, error: saveError } = await createAdminClient().rpc("marketing_import_knowledge", { p_owner: user.id, p_sources: pending, p_items: [], p_event_id: `prepare:${contentHash(pending)}` });
    return saveError ? fail(503, "knowledge-queue-failed") : NextResponse.json({ plan, saved, alreadyProcessed: !!saved?.duplicate, requests: saved?.duplicate ? [] : ordered.map((row, index) => ({ sourceId: row.id, analysisKey: pending[index].analysis_key })) });
  } catch (error) { return fail(error instanceof Error && error.message === "capture-too-large" ? 413 : 400, error instanceof Error && error.message === "capture-too-large" ? "capture-too-large" : "knowledge-import-invalid"); }
}
