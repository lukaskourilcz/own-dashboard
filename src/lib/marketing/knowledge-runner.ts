import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentHash } from "./hashes";
import { KNOWLEDGE_PROMPT_VERSION, knowledgeSourceFromRow, instagramIdentity, unavailableMedia, type KnowledgeItem, type KnowledgeSource, type StoredKnowledgeSource } from "./knowledge";
import { createClaudeKnowledgeModel, extractKnowledge, knowledgeAnalysisKey, type KnowledgeModel, type KnowledgeDiagnostics } from "./knowledge-extraction";
import { prepareApifyKnowledgeRun } from "./knowledge-providers";

export interface KnowledgeRunnerStore {
 load(ownerId: string, sourceId: string): Promise<StoredKnowledgeSource | null>;
 claim(ownerId: string, sourceId: string, analysisKey: string): Promise<StoredKnowledgeSource | null>;
 save(ownerId: string, source: KnowledgeSource, items: KnowledgeItem[], eventId: string): Promise<void>;
}
export function createKnowledgeRunnerStore(): KnowledgeRunnerStore {
 const db = createAdminClient();
 const stored = (row: Record<string, unknown>): StoredKnowledgeSource => ({ ...knowledgeSourceFromRow(row), id: z.uuid().parse(row.id), user_id: z.uuid().parse(row.user_id) });
 return {
  async load(ownerId, sourceId) { const { data, error } = await db.from("marketing_knowledge_sources").select("*").eq("user_id", ownerId).eq("id", sourceId).maybeSingle(); if (error) throw new Error("knowledge-store-unavailable"); return data ? stored(data) : null; },
  async claim(ownerId, sourceId, analysisKey) { const { data, error } = await db.rpc("marketing_claim_knowledge_analysis", { p_owner: ownerId, p_source: sourceId, p_analysis_key: analysisKey }); if (error) throw new Error("knowledge-claim-unavailable"); return data ? stored(data) : null; },
  async save(ownerId, source, items, eventId) { const { error } = await db.rpc("marketing_import_knowledge", { p_owner: ownerId, p_sources: [source], p_items: items, p_event_id: eventId }); if (error) throw new Error("knowledge-save-failed"); },
 };
}
export type KnowledgeRunnerDependencies = { store?: KnowledgeRunnerStore; fetch?: typeof fetch; env?: Record<string, string | undefined>; model?: KnowledgeModel; diagnostics?: (event: KnowledgeDiagnostics) => Promise<void> };
const API = "https://api.apify.com/v2";
const RunSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), actId: z.string(), userId: z.string(), defaultDatasetId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), buildNumber: z.string(),
 status: z.enum(["READY", "RUNNING", "SUCCEEDED", "FAILED", "TIMING-OUT", "TIMED-OUT", "ABORTING", "ABORTED"]), usageTotalUsd: z.number().nonnegative().nullable().optional() });
const ReelSchema = z.object({ url: z.string().optional(), shortCode: z.string().optional(), caption: z.string().max(30000).nullable().optional(), transcript: z.string().max(12000).nullable().optional(), timestamp: z.iso.datetime({ offset: true }).nullable().optional(), error: z.string().optional() });
const isEnabled = (env: Record<string,string|undefined>) => env.MARKETING_KNOWLEDGE_WORKER_ENABLED === "true";
const sourceOnly = (source: StoredKnowledgeSource): KnowledgeSource => knowledgeSourceFromRow(source);
async function ownedSource(ownerId: string, sourceId: string, store: KnowledgeRunnerStore): Promise<StoredKnowledgeSource> {
 z.uuid().parse(ownerId); z.uuid().parse(sourceId); const source = await store.load(ownerId, sourceId);
 if (!source || source.user_id !== ownerId) throw new Error("knowledge-source-unavailable");
 if (!source.analysis_request || !source.analysis_key) throw new Error("knowledge-reviewed-consent-required");
 return source;
}
function apifyConfig(env: Record<string,string|undefined>) {
 if (!env.APIFY_TOKEN || !env.APIFY_ACTOR_ID || !env.APIFY_ACTOR_BUILD || !/^\d+\.\d+\.\d+$/.test(env.APIFY_ACTOR_BUILD)) throw new Error("knowledge-apify-configuration-required");
 return { actorId: env.APIFY_ACTOR_ID, build: env.APIFY_ACTOR_BUILD, token: env.APIFY_TOKEN };
}
async function jsonProvider(url: string, token: string, transport: typeof fetch, method: "GET" | "POST", body?: unknown): Promise<unknown> {
 const response = await transport(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000) });
 if (!response.ok) throw new Error("knowledge-apify-request-failed");
 const text = await response.text(); if (Buffer.byteLength(text) > 1_100_000) throw new Error("knowledge-apify-response-too-large");
 return JSON.parse(text);
}
function verifyApifyPlan(source: StoredKnowledgeSource, config: ReturnType<typeof apifyConfig>) {
 const plan = prepareApifyKnowledgeRun([source], source.budget_usd, config);
 if (source.analysis_request?.provider !== "apify" || source.analysis_request.reviewHash !== plan.reviewHash ||
     source.analysis_key !== contentHash({ shortcode: source.shortcode, plan: plan.reviewHash })) throw new Error("knowledge-reviewed-plan-changed");
 return plan;
}
function verifyRegisteredRun(source: StoredKnowledgeSource, run: z.infer<typeof RunSchema>, config: ReturnType<typeof apifyConfig>) {
 const registration = source.analysis_request?.registration;
 if (!registration || source.run_id !== run.id || source.dataset_id !== run.defaultDatasetId || registration.userId !== run.userId ||
     registration.actorId !== run.actId || run.actId !== config.actorId || run.buildNumber !== config.build || registration.actorBuild !== run.buildNumber) throw new Error("knowledge-unexpected-provider-run");
}
/** Durable claim precedes the one paid attempt. Missing setup leaves the queue held. */
export async function runQueuedKnowledgeAnalysis(ownerId: string, sourceId: string, dependencies: KnowledgeRunnerDependencies = {}) {
 const env = dependencies.env ?? process.env; const store = dependencies.store ?? createKnowledgeRunnerStore();
 const source = await ownedSource(ownerId, sourceId, store);
 if (!isEnabled(env)) return { status: "held", reason: "knowledge-worker-disabled" };
 if (source.status !== "queued") return { status: source.status, duplicate: true };
 const transport = dependencies.fetch ?? fetch;
 if (source.analysis_request!.provider === "apify") {
  const config = apifyConfig(env); const plan = verifyApifyPlan(source, config);
  const claimed = await store.claim(ownerId, sourceId, source.analysis_key!); if (!claimed) return { status: "held", duplicate: true };
  let run: z.infer<typeof RunSchema>;
  try {
   const response = await jsonProvider(plan.request.url, config.token, transport, "POST", plan.request.input);
   run = RunSchema.parse(z.object({ data: z.unknown() }).parse(response).data);
   if (run.actId !== config.actorId || run.buildNumber !== config.build) throw new Error("knowledge-unexpected-provider-run");
  } catch {
   await store.save(ownerId, { ...sourceOnly(claimed), status: "failed" }, [], `callback:apify-start-failed:${source.analysis_key}`);
   return { status: "failed", reason: "knowledge-apify-start-ambiguous", retryAutomatically: false };
  }
  const registered = { ...sourceOnly(claimed), run_id: run.id, dataset_id: run.defaultDatasetId, analysis_request: { ...claimed.analysis_request!, registration: { runId: run.id, datasetId: run.defaultDatasetId, actorId: run.actId, actorBuild: run.buildNumber, userId: run.userId } } };
  try { await store.save(ownerId, registered, [], `callback:apify-register:${source.analysis_key}`); }
  catch { return { status: "reconciliation", reason: "knowledge-run-registration-failed", runId: run.id, retryAutomatically: false }; }
  return { status: "analyzing", runId: run.id, datasetId: run.defaultDatasetId };
 }
 const modelName = env.MARKETING_CLAUDE_MODEL;
 const inputPrice = Number(env.MARKETING_CLAUDE_INPUT_USD_PER_MTOK); const outputPrice = Number(env.MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK);
 if (!modelName || !/^claude-[a-z0-9.-]+$/.test(modelName) || ![inputPrice,outputPrice].every((p) => Number.isFinite(p) && p > 0) || (!dependencies.model && !env.ANTHROPIC_API_KEY)) throw new Error("knowledge-claude-configuration-required");
 const reviewHash = contentHash({ sourceVersions: [{ shortcode: source.shortcode, contentHash: contentHash(source.content) }], model: modelName, maxCostUsd: source.budget_usd });
 if (source.analysis_request!.reviewHash !== reviewHash || source.analysis_key !== knowledgeAnalysisKey(source, modelName)) throw new Error("knowledge-reviewed-plan-changed");
 const model = dependencies.model ?? await createClaudeKnowledgeModel({ apiKey: env.ANTHROPIC_API_KEY!, model: modelName, pricing: { inputPerMillionUsd: inputPrice, outputPerMillionUsd: outputPrice } });
 if (model.model !== modelName || model.pricing.inputPerMillionUsd !== inputPrice || model.pricing.outputPerMillionUsd !== outputPrice) throw new Error("knowledge-model-configuration-changed");
 const diagnostics = dependencies.diagnostics ?? await createKnowledgeDiagnostics(env);
 const claimed = await store.claim(ownerId, sourceId, source.analysis_key!); if (!claimed) return { status: "held", duplicate: true };
 try {
  const extracted = await extractKnowledge(claimed, { model, consent: true, maxCostUsd: claimed.budget_usd, diagnostics });
  const current = await store.load(ownerId, sourceId);
  if (!current || current.status !== "analyzing" || current.analysis_key !== claimed.analysis_key) return { status: "cancelled", costUsd: extracted.usage.costUsd };
  await store.save(ownerId, { ...sourceOnly(claimed), status: "review", analysis: { model: modelName, promptVersion: KNOWLEDGE_PROMPT_VERSION, ...extracted.usage, missingParts: extracted.missingParts } }, extracted.items, `callback:claude-complete:${source.analysis_key}`);
  return { status: "review", count: extracted.items.length, costUsd: extracted.usage.costUsd };
 } catch {
  await store.save(ownerId, { ...sourceOnly(claimed), status: "failed" }, [], `callback:claude-failed:${source.analysis_key}`);
  return { status: "failed", reason: "knowledge-analysis-failed", retryAutomatically: false };
 }
}
/** Never trust webhook captions or dataset IDs; fetch the registered provider run. */
export async function pollQueuedKnowledgeAnalysis(ownerId: string, sourceId: string, dependencies: KnowledgeRunnerDependencies = {}) {
 const env = dependencies.env ?? process.env; const store = dependencies.store ?? createKnowledgeRunnerStore(); const source = await ownedSource(ownerId, sourceId, store);
 if (!isEnabled(env)) return { status: "held", reason: "knowledge-worker-disabled" };
 if (source.status !== "analyzing") return { status: source.status, duplicate: true };
 if (source.analysis_request?.provider === "claude") return { status: "analyzing" };
 const config = apifyConfig(env); verifyApifyPlan(source, config);
 if (!source.run_id || !source.dataset_id) return { status: "reconciliation", reason: "knowledge-registered-run-required" };
 const transport = dependencies.fetch ?? fetch;
 const response = await jsonProvider(`${API}/actor-runs/${encodeURIComponent(source.run_id)}`, config.token, transport, "GET");
 const run = RunSchema.parse(z.object({ data: z.unknown() }).parse(response).data); verifyRegisteredRun(source, run, config);
 if (run.usageTotalUsd !== null && run.usageTotalUsd !== undefined && run.usageTotalUsd > source.budget_usd) throw new Error("knowledge-provider-budget-exceeded");
 if (["READY","RUNNING","TIMING-OUT","ABORTING"].includes(run.status)) return { status: "analyzing" };
 if (run.status !== "SUCCEEDED") {
  const status = run.status === "ABORTED" ? "cancelled" as const : "failed" as const;
  await store.save(ownerId, { ...sourceOnly(source), status }, [], `callback:apify-terminal:${source.analysis_key}:${run.status}`);
  return { status, reason: run.status.toLowerCase(), costUsd: run.usageTotalUsd ?? null };
 }
 const params = new URLSearchParams({ format: "json", clean: "true", offset: "0", limit: "2", fields: "url,shortCode,caption,transcript,timestamp,error,errorDescription" });
 const rows = z.array(ReelSchema).max(2).parse(await jsonProvider(`${API}/datasets/${encodeURIComponent(source.dataset_id)}/items?${params}`, config.token, transport, "GET"));
 if (rows.length !== 1) throw new Error("knowledge-provider-dataset-count-invalid");
 const item = rows[0]; const identity = item.url ? instagramIdentity(item.url) : null;
 if ((!item.error && item.shortCode !== source.shortcode) || (identity && identity.shortcode !== source.shortcode)) throw new Error("knowledge-provider-source-mismatch");
 const speech = item.transcript?.trim();
 const transcript = speech ? { status: "available" as const, provider: `apify/instagram-reel-scraper@${config.build}`, costUsd: null, segments: [{ text: speech, startSeconds: null, endSeconds: null }], reason: null } : { ...unavailableMedia(), status: "unavailable" as const, provider: `apify/instagram-reel-scraper@${config.build}`, reason: "transcript-not-returned" };
 const updated: KnowledgeSource = { ...sourceOnly(source), status: item.error ? "inaccessible" : item.caption || speech ? "captured" : "partial", published_at: item.timestamp ?? source.published_at,
  content: { caption: item.caption ?? null, captionProvider: "apify/instagram-reel-scraper", transcript, ocr: { ...unavailableMedia(), reason: "actor-does-not-provide-ocr" } },
  analysis: { model: `apify:${config.actorId}`, promptVersion: `actor-build:${config.build}`, inputTokens: 0, outputTokens: 0, costUsd: run.usageTotalUsd ?? null, missingParts: ["OCR unavailable", ...(speech ? ["Transcript segment timecodes unavailable"] : ["Actual transcript unavailable"])] } };
 await store.save(ownerId, updated, [], `callback:apify-dataset:${source.analysis_key}`);
 return { status: updated.status, transcriptAvailable: !!speech, costUsd: run.usageTotalUsd ?? null };
}
export async function abortQueuedKnowledgeAnalysis(ownerId: string, sourceId: string, dependencies: KnowledgeRunnerDependencies = {}) {
 const env = dependencies.env ?? process.env; const store = dependencies.store ?? createKnowledgeRunnerStore(); const source = await ownedSource(ownerId, sourceId, store);
 if (source.status === "queued") { await store.save(ownerId, { ...sourceOnly(source), status: "cancelled" }, [], `callback:cancel-queued:${source.analysis_key}`); return { status: "cancelled" }; }
 if (source.status !== "analyzing") return { status: source.status, duplicate: true };
 if (source.analysis_request?.provider === "claude") {
  await store.save(ownerId, { ...sourceOnly(source), status: "cancelled" }, [], `callback:cancel-claude:${source.analysis_key}`);
  return { status: "cancelled", providerMayHaveCharged: true };
 }
 if (!isEnabled(env)) return { status: "held", reason: "knowledge-worker-disabled" };
 const config = apifyConfig(env); verifyApifyPlan(source, config);
 if (!source.run_id) return { status: "reconciliation", reason: "knowledge-registered-run-required" };
 const response = await jsonProvider(`${API}/actor-runs/${encodeURIComponent(source.run_id)}/abort`, config.token, dependencies.fetch ?? fetch, "POST");
 const run = RunSchema.parse(z.object({ data: z.unknown() }).parse(response).data); verifyRegisteredRun(source, run, config);
 return { status: run.status === "ABORTED" ? "cancelled" : "analyzing" }; // Poll records the verified terminal state.
}

/** Optional EU diagnostics contain metadata only. Automatic/native tracing stays off. */
export async function createKnowledgeDiagnostics(env: Record<string,string|undefined> = process.env): Promise<((event: KnowledgeDiagnostics) => Promise<void>) | undefined> {
 if (!env.LANGSMITH_API_KEY || !env.LANGSMITH_PROJECT) return undefined;
 const endpoint = "https://eu.api.smith.langchain.com";
 if (env.LANGSMITH_ENDPOINT && env.LANGSMITH_ENDPOINT !== endpoint) throw new Error("knowledge-langsmith-eu-required");
 const { Client } = await import("langsmith"); const { randomUUID } = await import("node:crypto");
 const client = new Client({ apiKey: env.LANGSMITH_API_KEY, apiUrl: endpoint, webUrl: "https://eu.smith.langchain.com", hideInputs: true, hideOutputs: true });
 return async (event) => {
  const safe = z.strictObject({ event: z.enum(["started","review","failed"]), analysisKey: z.string().regex(/^[a-f0-9]{64}$/), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), model: z.string().regex(/^claude-[a-z0-9.-]+$/), inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), costUsd: z.number().nonnegative().optional(), error: z.string().regex(/^knowledge-[a-z-]{1,80}$/).optional() }).parse(event);
  try {
   await client.createRun({ id: randomUUID(), name: "marketing-knowledge-extraction", run_type: "chain", inputs: {}, outputs: {}, project_name: env.LANGSMITH_PROJECT,
    start_time: Date.now(), end_time: Date.now(), extra: { metadata: { analysis_key_hash: safe.analysisKey, source_content_hash: safe.sourceHash, model: safe.model, stage: safe.event,
     input_tokens: safe.inputTokens, output_tokens: safe.outputTokens, estimated_cost_usd: safe.costUsd, issue_code: safe.error } } });
   await client.awaitPendingTraceBatches();
  } catch { /* diagnostics cannot cause a repeated paid call */ }
 };
}
