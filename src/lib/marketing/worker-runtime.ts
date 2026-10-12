import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { MarketingWorkerRequestSchema, createMarketingWorkerHandler, runMarketingWorkerJob, type MarketingWorkerRequest, type MarketingWorkerResult, type DurableMarketingQueue } from "../../../services/marketing-worker/protocol";
import { createClaudeMarketingModel, DEFAULT_GENERATION_BUDGET, MarketingGenerationError, type MarketingModel } from "./generation";
import { createMarketingTracer, LANGSMITH_EU_ENDPOINT, type MarketingTracer } from "./tracing";
import { MarketingTemplateSchema, validateMarketingTemplate, MarketingRenderError, type MarketingTemplate, type MarketingAssetStorage } from "./render";
import { parseSourcePacket, sourceUsable, revisionReadiness, parseContentRevision, type SourcePacket } from "./contracts";
import { contentHash, revisionHash } from "./hashes";
import { authenticateAutomation } from "./automation-auth";
import { ingestSource } from "./store";
import dneskaiTemplate from "../../../templates/marketing/dneskai/template.json";
import devsharkTemplate from "../../../templates/marketing/devshark/template.json";

type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;
export const MARKETING_ASSET_BUCKET = "marketing-assets";
export const MARKETING_ASSET_URL_SECONDS = 7 * 24 * 60 * 60;
const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
export class MarketingWorkerRuntimeError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MarketingWorkerRuntimeError"; }
}
export async function resolveMarketingTemplate(version: string): Promise<MarketingTemplate | null> {
  const template = [dneskaiTemplate, devsharkTemplate].find((candidate) => candidate.version === version);
  return template ? MarketingTemplateSchema.parse(template) : null;
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
export async function enqueueMarketingJob(db: Database, ownerId: string, value: unknown, options: {
  env?: Environment; now?: () => Date; resolveTemplate?: typeof resolveMarketingTemplate;
} = {}) {
  assertOwner(ownerId);
  assertMarketingGenerationConsent(options.env);
  const request = MarketingWorkerRequestSchema.parse(value);
  if (!request.generation.consent || request.idempotencyKey !== request.generation.revisionId) throw new MarketingWorkerRuntimeError("invalid-job-consent-or-key");
  const source = parseSourcePacket(request.generation.source);
  if (!sourceUsable(source, (options.now ?? (() => new Date()))()) || contentHash(source.content) !== source.contentHash || source.kind === "instagram-reference") throw new MarketingWorkerRuntimeError("source-unavailable");
  assertSchedule(request.generation.scheduledAt, (options.now ?? (() => new Date()))());
  const trusted = await (options.resolveTemplate ?? resolveMarketingTemplate)(request.template.version);
  if (!trusted || contentHash(trusted) !== contentHash(request.template)) throw new MarketingWorkerRuntimeError("template-not-approved");
  validateMarketingTemplate(trusted, true);
  if (trusted.brand !== source.brand || request.generation.templateVersion !== trusted.version) throw new MarketingWorkerRuntimeError("template-revision-mismatch");
  await assertAccount(db, ownerId, request);
  const { data, error } = await db.rpc("marketing_enqueue_job", { p_owner: ownerId, p_key: request.idempotencyKey, p_hash: contentHash(request), p_request: request });
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
export function createMarketingAssetStorage(db: Database, ownerId: string, scheduledAt: string, options: { now?: () => Date; signal?: AbortSignal } = {}): MarketingAssetStorage {
  assertOwner(ownerId);
  assertSchedule(scheduledAt, (options.now ?? (() => new Date()))());
  return {
    async put(input) {
      if (options.signal?.aborted) throw new MarketingWorkerRuntimeError("worker-timeout");
      assertSchedule(scheduledAt, (options.now ?? (() => new Date()))());
      if (!/^marketing\/(?:dneskai|devshark)\/[a-f0-9-]{36}\/[a-f0-9]{64}\/[1-5]-[a-f0-9]{64}\.jpg$/.test(input.key) || input.contentType !== "image/jpeg" || input.bytes.length > 8 * 1024 * 1024 || createHash("sha256").update(input.bytes).digest("hex") !== input.sha256) throw new MarketingWorkerRuntimeError("asset-input-invalid");
      const { data: bucket, error: bucketError } = await db.storage.getBucket(MARKETING_ASSET_BUCKET);
      if (bucketError || !bucket || bucket.public) throw new MarketingWorkerRuntimeError("private-asset-bucket-required");
      const key = `${ownerId}/${input.key}`;
      const expectedMetadata = { ...input.metadata, sha256: input.sha256, ownerId };
      const files = db.storage.from(MARKETING_ASSET_BUCKET);
      // Never rewrite. A retry may reuse an existing object only after byte and metadata verification.
      const uploaded = await files.upload(key, input.bytes, { upsert: false, contentType: "image/jpeg", cacheControl: "3600", metadata: expectedMetadata });
      const info = await files.info(key);
      if (info.error || !info.data || info.data.size !== input.bytes.length || info.data.contentType !== "image/jpeg" || !Object.entries(expectedMetadata).every(([field, value]) => info.data.metadata?.[field] === value)) throw new MarketingWorkerRuntimeError("stored-asset-metadata-mismatch");
      const downloaded = await files.download(key);
      if (downloaded.error || !downloaded.data || createHash("sha256").update(Buffer.from(await downloaded.data.arrayBuffer())).digest("hex") !== input.sha256) throw new MarketingWorkerRuntimeError(uploaded.error ? "existing-asset-conflict" : "stored-asset-hash-mismatch");
      if (options.signal?.aborted) throw new MarketingWorkerRuntimeError("worker-timeout");
      const signed = await files.createSignedUrl(key, MARKETING_ASSET_URL_SECONDS);
      if (signed.error || !signed.data?.signedUrl || !signed.data.signedUrl.startsWith("https://")) throw new MarketingWorkerRuntimeError("asset-signing-failed");
      return { url: signed.data.signedUrl, sha256: input.sha256 };
    },
  };
}
export type SourceRefresh = (source: SourcePacket, signal: AbortSignal) => Promise<unknown>;
export type ExecuteMarketingDependencies = {
  refreshSource: SourceRefresh; env?: Environment; signal?: AbortSignal;
  model?: MarketingModel; tracer?: MarketingTracer; storage?: MarketingAssetStorage;
  resolveTemplate?: typeof resolveMarketingTemplate;
  run?: typeof runMarketingWorkerJob;
};
export async function executeMarketingJob(db: Database, ownerId: string, jobId: string, dependencies: ExecuteMarketingDependencies) {
  assertOwner(ownerId); z.uuid().parse(jobId);
  const config = marketingProviderConfiguration(dependencies.env);
  if (!dependencies.refreshSource) throw new MarketingWorkerRuntimeError("source-refresh-required");
  const fence = randomUUID();
  const { data, error } = await db.rpc("marketing_claim_job", { p_owner: ownerId, p_job: jobId, p_fence: fence });
  if (error) throw new MarketingWorkerRuntimeError("job-claim-failed");
  if (!data) return { claimed: false, job: await readMarketingJob(db, ownerId, jobId) };
  const signal = dependencies.signal ? AbortSignal.any([dependencies.signal, AbortSignal.timeout(55000)]) : AbortSignal.timeout(55000);
  let result: MarketingWorkerResult;
  try {
    const request = MarketingWorkerRequestSchema.parse(data);
    if (!request.generation.consent) throw new MarketingWorkerRuntimeError("marketing-consent-required");
    assertSchedule(request.generation.scheduledAt, new Date());
    await assertAccount(db, ownerId, request);
    const originalSource = parseSourcePacket(request.generation.source);
    const env = dependencies.env ?? process.env;
    const model = dependencies.model ?? await createClaudeMarketingModel(config);
    let tracer = dependencies.tracer;
    if (!tracer && env.MARKETING_LANGSMITH_ENABLED === "true") {
      if (!env.LANGSMITH_API_KEY || !env.LANGSMITH_PROJECT || env.LANGSMITH_ENDPOINT !== LANGSMITH_EU_ENDPOINT) throw new MarketingWorkerRuntimeError("langsmith-eu-configuration-required");
      tracer = await createMarketingTracer({ apiKey: env.LANGSMITH_API_KEY, projectName: env.LANGSMITH_PROJECT, endpoint: env.LANGSMITH_ENDPOINT });
    }
    result = await (dependencies.run ?? runMarketingWorkerJob)(request, {
      model, tracer, storage: dependencies.storage ?? createMarketingAssetStorage(db, ownerId, request.generation.scheduledAt, { signal }),
      signal, budget: { ...DEFAULT_GENERATION_BUDGET, maxLatencyMs: 45000 },
      reloadTemplate: dependencies.resolveTemplate ?? resolveMarketingTemplate,
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
    const knownCode = failure instanceof MarketingWorkerRuntimeError || failure instanceof MarketingGenerationError || failure instanceof MarketingRenderError
      ? failure.code : failure instanceof Error && ["source-superseded", "template-superseded"].includes(failure.message) ? failure.message : "worker-execution-failed";
    const { error: finishError } = await db.rpc("marketing_finish_job", { p_owner: ownerId, p_job: jobId, p_fence: fence, p_result: null, p_error: knownCode });
    if (finishError) throw new MarketingWorkerRuntimeError("job-finish-reconciliation-required");
    return { claimed: true, status: "failed" as const, errorCode: knownCode };
  }
  // A lost/ambiguous final commit must not become a second failure write or a second model call.
  const { error: finishError } = await db.rpc("marketing_finish_job", { p_owner: ownerId, p_job: jobId, p_fence: fence, p_result: result, p_error: null });
  if (finishError) throw new MarketingWorkerRuntimeError("job-finish-reconciliation-required");
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
