import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { marketingJobIdentityHash, MarketingWorkerRequestSchema, createMarketingWorkerHandler, runMarketingWorkerJob, type MarketingWorkerRequest, type MarketingWorkerResult, type DurableMarketingQueue } from "../../../services/marketing-worker/protocol";
import { createClaudeMarketingModel, DEFAULT_GENERATION_BUDGET, MarketingGenerationError, type MarketingModel } from "./generation";
import { createMarketingTracer, LANGSMITH_EU_ENDPOINT, type MarketingTracer } from "./tracing";
import { validateMarketingTemplate, MarketingRenderError, type MarketingTemplate, type MarketingAssetStorage } from "./render";
import { parseSourcePacket, sourceUsable, revisionReadiness, parseContentRevision, type SourcePacket } from "./contracts";
import { contentHash, revisionHash } from "./hashes";
import { authenticateAutomation } from "./automation-auth";
import { ingestSource } from "./store";
import { marketingPilotConfiguration, MarketingPilotError, MARKETING_PILOT_JOB_RESERVATION_USD } from "./pilot";
import { resolveTrustedMarketingTemplate, MarketingTemplateApprovalError } from "./template-registry";
import { createDneskaiDeckRenderer, type DneskaiSlideStorage } from "./dneskai-render";
import type { LoadDneskaiMediaBytes, RenderDneskaiDeck } from "./dneskai-ports";

type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;
export const MARKETING_ASSET_BUCKET = "marketing-assets";
export const MARKETING_ASSET_URL_SECONDS = 7 * 24 * 60 * 60;
const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
export class MarketingWorkerRuntimeError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MarketingWorkerRuntimeError"; }
}
export async function resolveMarketingTemplate(version: string, options: { env?: Environment; now?: Date } = {}): Promise<MarketingTemplate | null> {
  return resolveTrustedMarketingTemplate(version, options.env, options.now);
}
function templateResolver(override: typeof resolveMarketingTemplate | undefined, env: Environment = process.env, now?: () => Date): typeof resolveMarketingTemplate {
  // Offline tests may inject a template without changing public manifests.
  // Deployed workers and any supplied pilot receipt always use the trusted registry.
  if (override && process.env.NODE_ENV !== 'production' && env.NODE_ENV !== 'production' && env.MARKETING_PILOT_TEMPLATE_APPROVALS === undefined) return override;
  return version => resolveMarketingTemplate(version, { env, now: now?.() });
}
function assertOwner(ownerId: string) { z.uuid().parse(ownerId); }
export function assertMarketingGenerationConsent(env: Environment = process.env) {
  if (env.MARKETING_AI_CONSENT !== "true") throw new MarketingWorkerRuntimeError("marketing-consent-required");
}
export function marketingProviderConfiguration(env: Environment = process.env) {
  assertMarketingGenerationConsent(env);
  const rate = (value: string | undefined): number => {
    if (!value || !/^(?:\d+)(?:\.\d+)?$/.test(value)) throw new MarketingWorkerRuntimeError("claude-pricing-required");
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) throw new MarketingWorkerRuntimeError("claude-pricing-required");
    return parsed;
  };
  if (!env.ANTHROPIC_API_KEY || !env.MARKETING_CLAUDE_MODEL || !/^claude-[a-z0-9.-]+$/.test(env.MARKETING_CLAUDE_MODEL)) throw new MarketingWorkerRuntimeError("claude-configuration-required");
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.MARKETING_CLAUDE_MODEL, pricing: { inputPerMillionUsd: rate(env.MARKETING_CLAUDE_INPUT_USD_PER_MTOK), outputPerMillionUsd: rate(env.MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK) } };
}
function assertSchedule(scheduledAt: string, now: Date) {
  const scheduled = Date.parse(scheduledAt);
  if (!Number.isFinite(scheduled) || scheduled <= now.getTime() || scheduled > now.getTime() + sixDaysMs) throw new MarketingWorkerRuntimeError("schedule-outside-asset-window");
}
async function assertAccount(db: Database, ownerId: string, request: MarketingWorkerRequest) {
  const source = parseSourcePacket(request.generation.source);
  const { data, error } = await db.from("marketing_accounts").select("id,handle,enabled,verified_at")
    .eq("user_id", ownerId).eq("brand", source.brand).eq("platform", request.generation.account.platform)
    .eq("remote_account_id", request.generation.account.id).eq("handle", request.generation.account.handle).maybeSingle();
  if (error || !data || !data.verified_at) throw new MarketingWorkerRuntimeError("marketing-account-unavailable");
}
async function assertKnowledge(db: Database, ownerId: string, request: MarketingWorkerRequest) {
  const references = request.generation.knowledge;
  if (!references.length) return;
  const brand = parseSourcePacket(request.generation.source).brand;
  const ids = references.map((reference) => reference.id);
  if (references.length > 8 || new Set(ids).size !== ids.length || references.some((reference) => reference.brand !== brand)) throw new MarketingWorkerRuntimeError("knowledge-reference-unavailable");
  try {
    // Read only approved presentation and brand tags, never canonical notes,
    // project/prompt/tool references or the owner's other knowledge content.
    const { data, error } = await db.from("marketing_knowledge_items")
      .select("ai_link_id,user_id,review_status,summary:metadata->summary,brands:metadata->tags->brand")
      .eq("user_id", ownerId).eq("review_status", "reviewed").in("ai_link_id", ids).limit(8);
    if (error || !data || data.length !== ids.length || references.some((reference) => {
      const item = data.find((row) => row.ai_link_id === reference.id);
      return !item || item.user_id !== ownerId || item.review_status !== "reviewed" || !Array.isArray(item.brands) || !item.brands.includes(brand) ||
        typeof item.summary !== "string" || String(item.summary).slice(0, 1200) !== reference.presentation;
    })) throw new MarketingWorkerRuntimeError("knowledge-reference-unavailable");
  } catch { throw new MarketingWorkerRuntimeError("knowledge-reference-unavailable"); }
}
export { marketingJobIdentityHash } from '../../../services/marketing-worker/protocol';
export async function enqueueMarketingJob(db: Database, ownerId: string, value: unknown, options: {
  env?: Environment; now?: () => Date; resolveTemplate?: typeof resolveMarketingTemplate;
} = {}) {
  assertOwner(ownerId);
  assertMarketingGenerationConsent(options.env);
  const pilot = marketingPilotConfiguration(ownerId, options.env, (options.now ?? (() => new Date()))());
  const request = MarketingWorkerRequestSchema.parse(value);
  if (!request.generation.consent || request.idempotencyKey !== request.generation.revisionId) throw new MarketingWorkerRuntimeError("invalid-job-consent-or-key");
  const source = parseSourcePacket(request.generation.source);
  if (!sourceUsable(source, (options.now ?? (() => new Date()))()) || contentHash(source.content) !== source.contentHash || source.kind === "instagram-reference") throw new MarketingWorkerRuntimeError("source-unavailable");
  assertSchedule(request.generation.scheduledAt, (options.now ?? (() => new Date()))());
  const trusted = await templateResolver(options.resolveTemplate, options.env, options.now)(request.template.version);
  if (!trusted || contentHash(trusted) !== contentHash(request.template)) throw new MarketingWorkerRuntimeError("template-not-approved");
  validateMarketingTemplate(trusted, true);
  if (trusted.brand !== source.brand || request.generation.templateVersion !== trusted.version) throw new MarketingWorkerRuntimeError("template-revision-mismatch");
  await assertAccount(db, ownerId, request);
  await assertKnowledge(db, ownerId, request);
  const { data, error } = await db.rpc("marketing_enqueue_job", { p_owner: ownerId, p_key: request.idempotencyKey, p_hash: marketingJobIdentityHash(request), p_request: request, ...(pilot ? { p_pilot: pilot } : {}) });
  if (error) throw new MarketingWorkerRuntimeError("job-enqueue-failed");
  return z.strictObject({ jobId: z.uuid(), status: z.enum(["queued", "running", "review", "failed", "reconciliation"]), duplicate: z.boolean() }).parse(data);
}
export async function readMarketingJob(db: Database, ownerId: string, jobId: string) {
  assertOwner(ownerId); z.uuid().parse(jobId);
  const { data, error } = await db.from("marketing_jobs").select("id,status,result,error_code,lease_until").eq("user_id", ownerId).eq("id", jobId).maybeSingle();
  if (error) throw new MarketingWorkerRuntimeError("job-read-failed");
  if (!data) return null;
  const expired = data.status === "running" && data.lease_until && Date.parse(data.lease_until) <= Date.now();
  return { jobId: z.uuid().parse(data.id), status: z.enum(["queued", "running", "review", "failed", "reconciliation"]).parse(expired ? "reconciliation" : data.status), ...(data.result ? { result: data.result as MarketingWorkerResult } : {}), ...(expired || data.error_code ? { errorCode: expired ? "worker-lease-expired" : String(data.error_code) } : {}) };
}
const MARKETING_ASSET_MAX_BYTES = 8 * 1024 * 1024;
async function privateAssetFiles(db: Database) {
  const { data: bucket, error: bucketError } = await db.storage.getBucket(MARKETING_ASSET_BUCKET);
  if (bucketError || !bucket || bucket.public) throw new MarketingWorkerRuntimeError("private-asset-bucket-required");
  return db.storage.from(MARKETING_ASSET_BUCKET);
}
type AssetFiles = Awaited<ReturnType<typeof privateAssetFiles>>;
async function signedAssetUrl(files: AssetFiles, key: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new MarketingWorkerRuntimeError("worker-timeout");
  const signed = await files.createSignedUrl(key, MARKETING_ASSET_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl || !signed.data.signedUrl.startsWith("https://")) throw new MarketingWorkerRuntimeError("asset-signing-failed");
  return signed.data.signedUrl;
}
/** Upload once, then prove size, type, metadata and bytes before signing. Never rewrites an object. */
async function storeVerifiedJpeg(files: AssetFiles, key: string, bytes: Buffer, sha256: string, metadata: Record<string, string>, signal?: AbortSignal): Promise<string> {
  // Never rewrite. A retry may reuse an existing object only after byte and metadata verification.
  if (signal?.aborted) throw new MarketingWorkerRuntimeError("worker-timeout");
  const uploaded = await files.upload(key, bytes, { upsert: false, contentType: "image/jpeg", cacheControl: "3600", metadata });
  const info = await files.info(key);
  if (info.error || !info.data || info.data.size !== bytes.length || info.data.contentType !== "image/jpeg" || !Object.entries(metadata).every(([field, value]) => info.data.metadata?.[field] === value)) throw new MarketingWorkerRuntimeError("stored-asset-metadata-mismatch");
  const downloaded = await files.download(key);
  if (downloaded.error || !downloaded.data || createHash("sha256").update(Buffer.from(await downloaded.data.arrayBuffer())).digest("hex") !== sha256) throw new MarketingWorkerRuntimeError(uploaded.error ? "existing-asset-conflict" : "stored-asset-hash-mismatch");
  return signedAssetUrl(files, key, signal);
}
export function createMarketingAssetStorage(db: Database, ownerId: string, scheduledAt: string, options: { now?: () => Date; signal?: AbortSignal } = {}): MarketingAssetStorage {
  assertOwner(ownerId);
  assertSchedule(scheduledAt, (options.now ?? (() => new Date()))());
  return {
    async put(input) {
      if (options.signal?.aborted) throw new MarketingWorkerRuntimeError("worker-timeout");
      assertSchedule(scheduledAt, (options.now ?? (() => new Date()))());
      if (!/^marketing\/devshark\/[a-f0-9-]{36}\/[a-f0-9]{64}\/[1-5]-[a-f0-9]{64}\.jpg$/.test(input.key) || input.contentType !== "image/jpeg" || input.bytes.length > MARKETING_ASSET_MAX_BYTES || createHash("sha256").update(input.bytes).digest("hex") !== input.sha256) throw new MarketingWorkerRuntimeError("asset-input-invalid");
      const files = await privateAssetFiles(db);
      const url = await storeVerifiedJpeg(files, `${ownerId}/${input.key}`, input.bytes, input.sha256, { ...input.metadata, sha256: input.sha256, ownerId }, options.signal);
      return { url, sha256: input.sha256 };
    },
  };
}
/** Where a DNESKAi slide lives: one immutable object per owner and render key, reused by every revision that draws it. */
export function dneskaiSlideObjectKey(ownerId: string, renderKey: string): string {
  assertOwner(ownerId);
  if (!/^[a-f0-9]{64}$/.test(renderKey)) throw new MarketingWorkerRuntimeError("asset-input-invalid");
  return `${ownerId}/marketing/dneskai/slides/${renderKey}.jpg`;
}
/**
 * The DNESKAi render cache in the private `marketing-assets` bucket: the same upload, metadata,
 * re-download and signing path as `createMarketingAssetStorage`, keyed by render key instead of
 * revision so an unchanged slide is never rendered twice. Signed URLs last seven days.
 */
export function createDneskaiSlideStorage(db: Database, ownerId: string, options: { signal?: AbortSignal } = {}): DneskaiSlideStorage {
  assertOwner(ownerId);
  let bucket: Promise<AssetFiles> | null = null;
  const files = () => { bucket ??= privateAssetFiles(db); return bucket; };
  return {
    async find(renderKey) {
      const key = dneskaiSlideObjectKey(ownerId, renderKey);
      const store = await files();
      if (options.signal?.aborted) throw new MarketingWorkerRuntimeError("worker-timeout");
      const info = await store.info(key);
      if (info.error || !info.data) return null;
      const metadata: Record<string, unknown> = info.data.metadata ?? {};
      const recorded = typeof metadata.sha256 === "string" ? metadata.sha256 : "";
      if (!/^[a-f0-9]{64}$/.test(recorded) || metadata.ownerId !== ownerId || metadata.renderKey !== renderKey || info.data.contentType !== "image/jpeg"
        || !Number.isInteger(info.data.size) || !info.data.size || info.data.size > MARKETING_ASSET_MAX_BYTES) throw new MarketingWorkerRuntimeError("stored-asset-metadata-mismatch");
      const downloaded = await store.download(key);
      if (downloaded.error || !downloaded.data) throw new MarketingWorkerRuntimeError("asset-storage-failed");
      if (createHash("sha256").update(Buffer.from(await downloaded.data.arrayBuffer())).digest("hex") !== recorded) throw new MarketingWorkerRuntimeError("stored-asset-hash-mismatch");
      const url = await signedAssetUrl(store, key, options.signal);
      return { url, sha256: recorded, metadata: Object.fromEntries(Object.entries(metadata).map(([field, value]) => [field, String(value)])) };
    },
    async put(input) {
      const key = dneskaiSlideObjectKey(ownerId, input.renderKey);
      if (input.bytes.length > MARKETING_ASSET_MAX_BYTES || createHash("sha256").update(input.bytes).digest("hex") !== input.sha256) throw new MarketingWorkerRuntimeError("asset-input-invalid");
      const metadata = { ...input.metadata, renderKey: input.renderKey, sha256: input.sha256, ownerId };
      const url = await storeVerifiedJpeg(await files(), key, input.bytes, input.sha256, metadata, options.signal);
      return { url, sha256: input.sha256, metadata };
    },
  };
}
const DneskaiFailureProblemSchema = z.strictObject({ slide: z.number().int().min(-1).max(9), code: z.string().regex(/^[a-z0-9-]{1,64}$/), blocking: z.boolean(), field: z.string().max(80).nullable(), message: z.string().max(600) });
/** At most 40 problems of a refused deck, each in the renderer's shape; anything else is dropped. */
function dneskaiFailureProblems(problems: readonly unknown[] | undefined) {
  return (problems ?? []).slice(0, 40).flatMap((problem) => {
    const value = problem as Record<string, unknown>;
    const parsed = DneskaiFailureProblemSchema.safeParse({ slide: value.slide, code: value.code, blocking: value.blocking, field: value.field ?? null, message: value.message });
    return parsed.success ? [parsed.data] : [];
  });
}
export type SourceRefresh = (source: SourcePacket, signal: AbortSignal) => Promise<unknown>;
export type ExecuteMarketingDependencies = {
  refreshSource: SourceRefresh; env?: Environment; signal?: AbortSignal;
  model?: MarketingModel; tracer?: MarketingTracer; storage?: MarketingAssetStorage;
  resolveTemplate?: typeof resolveMarketingTemplate;
  run?: typeof runMarketingWorkerJob;
  /** The stored source media (#114). Without it a DNESKAi deck is refused as `dneskai-renderer-unavailable`. */
  loadDneskaiMedia?: LoadDneskaiMediaBytes;
  /** Defaults to the carousel studio renderer over `createDneskaiSlideStorage`. */
  renderDneskaiDeck?: RenderDneskaiDeck;
};
export async function executeMarketingJob(db: Database, ownerId: string, jobId: string, dependencies: ExecuteMarketingDependencies) {
  assertOwner(ownerId); z.uuid().parse(jobId);
  const config = marketingProviderConfiguration(dependencies.env);
  const pilot = marketingPilotConfiguration(ownerId, dependencies.env);
  if (!dependencies.refreshSource) throw new MarketingWorkerRuntimeError("source-refresh-required");
  const fence = randomUUID();
  const { data, error } = await db.rpc("marketing_claim_job", { p_owner: ownerId, p_job: jobId, p_fence: fence, ...(pilot ? { p_pilot: pilot } : {}) });
  if (error) throw new MarketingWorkerRuntimeError("job-claim-failed");
  if (!data) return { claimed: false, job: await readMarketingJob(db, ownerId, jobId) };
  const remainingMs = pilot ? Math.min(55000, Date.parse(pilot.expiresAt) - Date.now()) : 55000;
  if (remainingMs <= 0) throw new MarketingPilotError("pilot-outside-window");
  const signal = dependencies.signal ? AbortSignal.any([dependencies.signal, AbortSignal.timeout(remainingMs)]) : AbortSignal.timeout(remainingMs);
  let result: MarketingWorkerResult;
  let knowledgeUnavailable = false;
  let pilotUnavailable = false;
  try {
    const request = MarketingWorkerRequestSchema.parse(data);
    if (!request.generation.consent) throw new MarketingWorkerRuntimeError("marketing-consent-required");
    assertSchedule(request.generation.scheduledAt, new Date());
    await assertAccount(db, ownerId, request);
    await assertKnowledge(db, ownerId, request);
    const originalSource = parseSourcePacket(request.generation.source);
    const env = dependencies.env ?? process.env;
    const model = dependencies.model ?? await createClaudeMarketingModel(config);
    const guardedModel: MarketingModel = { model: model.model, pricing: model.pricing, async invoke(input) {
      // Producer refresh/render preparation can take time. Recheck immediately
      // before every paid invocation too, including a copy-validation retry.
      try { await assertKnowledge(db, ownerId, request); }
      catch (failure) { knowledgeUnavailable = true; throw failure; }
      if (pilot) {
        try {
          marketingPilotConfiguration(ownerId, env);
          // An RPC outage is ambiguous: never invoke the provider after it.
          const check = await db.rpc("marketing_check_pilot_attempt", { p_owner: ownerId, p_job: jobId, p_fence: fence, p_pilot: pilot });
          if (check.error || check.data !== true || signal.aborted) throw new MarketingPilotError("pilot-admission-unavailable");
        } catch (failure) { pilotUnavailable = true; throw failure; }
      }
      return model.invoke(input);
    } };
    let tracer = dependencies.tracer;
    if (!tracer && env.MARKETING_LANGSMITH_ENABLED === "true") {
      if (!env.LANGSMITH_API_KEY || !env.LANGSMITH_PROJECT || env.LANGSMITH_ENDPOINT !== LANGSMITH_EU_ENDPOINT) throw new MarketingWorkerRuntimeError("langsmith-eu-configuration-required");
      tracer = await createMarketingTracer({ apiKey: env.LANGSMITH_API_KEY, projectName: env.LANGSMITH_PROJECT, endpoint: env.LANGSMITH_ENDPOINT });
    }
    result = await (dependencies.run ?? runMarketingWorkerJob)(request, {
      model: guardedModel, tracer, storage: dependencies.storage ?? createMarketingAssetStorage(db, ownerId, request.generation.scheduledAt, { signal }),
      signal, budget: { ...DEFAULT_GENERATION_BUDGET, maxLatencyMs: 45000, ...(pilot ? { maxCostUsd: Math.min(DEFAULT_GENERATION_BUDGET.maxCostUsd, MARKETING_PILOT_JOB_RESERVATION_USD) } : {}) },
      reloadTemplate: templateResolver(dependencies.resolveTemplate, env),
      renderDneskaiDeck: dependencies.loadDneskaiMedia ? (input) => (dependencies.renderDneskaiDeck
        ?? createDneskaiDeckRenderer({ storage: (owner, slideSignal) => createDneskaiSlideStorage(db, owner, { signal: slideSignal }) }))({ ...input, owner: ownerId, loadMedia: dependencies.loadDneskaiMedia! }) : undefined,
      reloadSource: async (sourceId) => {
        if (sourceId !== originalSource.sourceId || signal.aborted) throw new MarketingWorkerRuntimeError("source-refresh-failed");
        const current = parseSourcePacket(await dependencies.refreshSource(originalSource, signal));
        if (current.brand !== originalSource.brand || current.sourceId !== originalSource.sourceId) throw new MarketingWorkerRuntimeError("source-refresh-mismatch");
        await ingestSource(db, ownerId, current, current.brand);
        return current;
      },
    });
    const revision = parseContentRevision(result.revision);
    if (signal.aborted || revisionReadiness(revision).length || revisionHash(revision) !== result.revisionHash) throw new MarketingWorkerRuntimeError("job-result-invalid");
  } catch (failure) {
    // No automatic replay; never persist provider response/credentials/exception text.
    const knownCode = pilotUnavailable ? "pilot-admission-unavailable" : knowledgeUnavailable ? "knowledge-reference-unavailable" : failure instanceof MarketingWorkerRuntimeError || failure instanceof MarketingGenerationError || failure instanceof MarketingRenderError || failure instanceof MarketingPilotError || failure instanceof MarketingTemplateApprovalError
      ? failure.code : failure instanceof Error && ["source-superseded", "template-superseded"].includes(failure.message) ? failure.message : "worker-execution-failed";
    const { data: finishedStatus, error: finishError } = await db.rpc("marketing_finish_job", { p_owner: ownerId, p_job: jobId, p_fence: fence, p_result: null, p_error: knownCode });
    if (finishError || finishedStatus !== "failed") throw new MarketingWorkerRuntimeError("job-finish-reconciliation-required");
    // A refused DNESKAi deck says what to fix: the renderer's own bounded problems, never exception text.
    const problems = failure instanceof MarketingRenderError && knownCode === failure.code ? dneskaiFailureProblems(failure.problems) : [];
    return { claimed: true, status: "failed" as const, errorCode: knownCode, ...(problems.length ? { problems } : {}) };
  }
  // A lost/ambiguous final commit must not become a second failure write or a second model call.
  const { data: finishedStatus, error: finishError } = await db.rpc("marketing_finish_job", { p_owner: ownerId, p_job: jobId, p_fence: fence, p_result: result, p_error: null });
  if (finishError || finishedStatus !== "review") throw new MarketingWorkerRuntimeError("job-finish-reconciliation-required");
  return { claimed: true, status: "review" as const, revisionId: (data as MarketingWorkerRequest).generation.revisionId };
}
export async function marketingJobsHttpHandler(request: Request) {
  const raw = request.method === "GET" ? "" : await readBoundedMarketingJobBody(request);
  const principal = authenticateAutomation(request, raw);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (principal.role !== "worker") return Response.json({ error: "forbidden" }, { status: 403 });
  const db = createAdminClient();
  const queue: DurableMarketingQueue = { enqueue: (input) => enqueueMarketingJob(db, principal.ownerId, input.request), read: (id) => readMarketingJob(db, principal.ownerId, id) };
  return createMarketingWorkerHandler({ authenticate: async () => true, queue, resolveTemplate: resolveMarketingTemplate })(new Request(request.url, { method: request.method, headers: request.headers, ...(request.method === "POST" ? { body: raw } : {}) }));
}
export async function readBoundedMarketingJobBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 200000) { await reader.cancel(); throw new MarketingWorkerRuntimeError("payload-too-large"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
