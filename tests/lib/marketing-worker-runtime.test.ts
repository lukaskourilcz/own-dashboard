import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { enqueueMarketingJob, readMarketingJob, executeMarketingJob, marketingProviderConfiguration, createMarketingAssetStorage, marketingJobIdentityHash, MARKETING_ASSET_URL_SECONDS } from "@/lib/marketing/worker-runtime";
import { contentHash, revisionHash } from "@/lib/marketing/hashes";
import { pendingMarketingTemplate, type MarketingTemplate } from "@/lib/marketing/render";
import type { MarketingWorkerRequest, MarketingWorkerResult } from "../../services/marketing-worker/protocol";
import devDesign from "../../templates/marketing/devshark/derived-layout.json";
import type { createAdminClient } from "@/lib/supabase/admin";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const owner = "dbd55242-0c60-483d-8032-edeb348dfd0d";
const revisionId = "90246ac5-0587-407c-9048-3fce5f968a16";
const jobId = "abbb84c0-bdcc-46ea-924a-e71db4773d28";
const env = { MARKETING_AI_CONSENT: "true", ANTHROPIC_API_KEY: "test-only-no-real-call", MARKETING_CLAUDE_MODEL: "claude-sonnet-4-6", MARKETING_CLAUDE_INPUT_USD_PER_MTOK: "3", MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK: "15" };
const content = { title: "Test-only question", body: "Choose an option.", category: "JavaScript", difficulty: "Easy", code: null, options: ["A", "B"], answer: "A", explanation: "Test-only authored explanation.", evidence: [], image: null };
function request(): MarketingWorkerRequest {
  const base = pendingMarketingTemplate("devshark");
  // Synthetic test approval only. Repository manifests remain unapproved.
  const template: MarketingTemplate = { ...base, approved: true, authoring: "claude-design", approval: { approvedBy: owner, approvedAt: new Date().toISOString(), templateSha256: base.templateSha256, designExportSha256: devDesign.archiveSha256 } };
  return { schemaVersion: "marketing-job/1", idempotencyKey: revisionId, template, generation: { revisionId, consent: true, source: { schemaVersion: "marketing-source/1", brand: "devshark", kind: "question", sourceId: "test-only", sourceRevision: "test-only-v1", contentHash: contentHash(content), canonicalUrl: "https://devshark.app/test-only", locale: "en", observedAt: new Date().toISOString(), expiresAt: null, eligible: true, eligibilityReason: "test-only", content }, account: { id: "test-only-remote", platform: "instagram", handle: "test-only" }, scheduledAt: new Date(Date.now() + 3600000).toISOString(), templateVersion: template.version, knowledge: [] } };
}
function database() {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { id: "test-only-account", enabled: false, verified_at: new Date().toISOString() }, error: null });
  const rpc = vi.fn(); const from = vi.fn(() => query);
  return { db: { rpc, from } as unknown as ReturnType<typeof createAdminClient>, query, rpc, from };
}
const model = { model: "claude-sonnet-4-6", pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 }, invoke: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); });

describe("durable worker production boundaries", () => {
  it("requires explicit consent/model/prices without guessing defaults", () => {
    expect(() => marketingProviderConfiguration({})).toThrow("marketing-consent-required");
    expect(() => marketingProviderConfiguration({ ...env, MARKETING_CLAUDE_MODEL: undefined })).toThrow("claude-configuration-required");
    expect(() => marketingProviderConfiguration({ ...env, MARKETING_CLAUDE_INPUT_USD_PER_MTOK: undefined })).toThrow("claude-pricing-required");
    expect(marketingProviderConfiguration(env).pricing.inputPerMillionUsd).toBe(3);
  });
  it("refuses pending templates and schedules beyond the signed URL window before queue insertion", async () => {
    const { db, rpc } = database(); const input = request();
    await expect(enqueueMarketingJob(db, owner, { ...input, template: pendingMarketingTemplate("devshark") }, { env })).rejects.toThrow("claude-design-approval-required");
    await expect(enqueueMarketingJob(db, owner, { ...input, generation: { ...input.generation, scheduledAt: new Date(Date.now() + 7 * 86400000).toISOString() } }, { env, resolveTemplate: async () => input.template })).rejects.toThrow("schedule-outside-asset-window");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("binds idempotent admission and account reads to the fixed owner", async () => {
    const { db, rpc, query } = database(); const input = request();
    rpc.mockResolvedValue({ data: { jobId, status: "queued", duplicate: false }, error: null });
    expect(await enqueueMarketingJob(db, owner, input, { env, resolveTemplate: async () => input.template })).toEqual({ jobId, status: "queued", duplicate: false });
    expect(rpc).toHaveBeenCalledWith("marketing_enqueue_job", { p_owner: owner, p_key: revisionId, p_hash: marketingJobIdentityHash(input), p_request: input });
    expect(query.eq).toHaveBeenCalledWith("user_id", owner);
    expect(query.eq).toHaveBeenCalledWith("remote_account_id", input.generation.account.id);
  });
  it("keeps refreshed observation idempotent but binds source and delivery changes",()=>{
    const input=request();const source=input.generation.source as Record<string,unknown>;
    const observed={...input,generation:{...input.generation,source:{...source,observedAt:new Date(Date.now()+1000).toISOString()}}};
    expect(marketingJobIdentityHash(observed)).toBe(marketingJobIdentityHash(input));
    expect(marketingJobIdentityHash({...input,generation:{...input.generation,source:{...source,sourceRevision:'test-only-v2'}}})).not.toBe(marketingJobIdentityHash(input));
  });
  it("returns unavailable for foreign jobs and reports expired running leases as reconciliation", async () => {
    const { db, query } = database();
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await readMarketingJob(db, owner, jobId)).toBeNull();
    query.maybeSingle.mockResolvedValueOnce({ data: { id: jobId, status: "running", result: null, error_code: null, lease_until: "2000-01-01T00:00:00Z" }, error: null });
    expect(await readMarketingJob(db, owner, jobId)).toEqual({ jobId, status: "reconciliation", errorCode: "worker-lease-expired" });
    expect(query.eq).toHaveBeenCalledWith("user_id", owner);
  });
  it("does not generate for an already claimed/completed job", async () => {
    const { db, rpc, query } = database(); const run = vi.fn();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    query.maybeSingle.mockResolvedValue({ data: { id: jobId, status: "review", result: null }, error: null });
    expect((await executeMarketingJob(db, owner, jobId, { env, model, refreshSource: vi.fn(), run })).claimed).toBe(false);
    expect(run).not.toHaveBeenCalled(); expect(model.invoke).not.toHaveBeenCalled();
  });
  it("awaits the runner and atomically commits an exact ready result under the same fence", async () => {
    const { db, rpc } = database(); const input = request();
    rpc.mockImplementation(async (name) => ({ data: name === "marketing_claim_job" ? input : name === "marketing_finish_job" ? "review" : null, error: null }));
    const refreshSource = vi.fn(async () => input.generation.source);
    const revision = { schemaVersion: "marketing-content/1" as const, brand: "devshark" as const, title: "Test-only", caption: "Test-only", format: "carousel" as const, sources: [{ sourceId: "test-only", sourceRevision: "test-only-v1", contentHash: contentHash(content) }], knowledgeIds: [], assets: [1, 2].map((i) => ({ url: `https://example.com/test-only-${i}.jpg`, sha256: "c".repeat(64), mimeType: "image/jpeg" as const, width: 1080, height: 1350, alt: "Test-only" })), account: input.generation.account, scheduledAt: input.generation.scheduledAt, timeZone: "Europe/Prague" as const, templateVersion: input.template.version, promptVersion: "marketing-copy/1", model: model.model, traceId: null };
    const result: MarketingWorkerResult = { revision, slides: [], traceId: null, usage: { attempts: 1, inputTokens: 100, outputTokens: 100, estimatedCostUsd: 0.0018 }, revisionHash: revisionHash(revision) };
    const run = vi.fn(async (_request, deps) => { await deps.reloadSource("test-only"); await deps.reloadSource("test-only"); expect(deps.budget.maxLatencyMs).toBe(45000); return result; });
    expect(await executeMarketingJob(db, owner, jobId, { env, model, refreshSource, run, storage: { put: vi.fn() }, resolveTemplate: async () => input.template })).toEqual({ claimed: true, status: "review", revisionId });
    expect(refreshSource).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.filter(([name]) => name === "marketing_ingest_source")).toHaveLength(2);
    const fence = rpc.mock.calls[0][1].p_fence;
    expect(rpc).toHaveBeenLastCalledWith("marketing_finish_job", { p_owner: owner, p_job: jobId, p_fence: fence, p_result: result, p_error: null });
  });
  it("redacts arbitrary provider exceptions and never rewrites an ambiguous success as failure", async () => {
    const { db, rpc } = database(); const input = request();
    rpc.mockResolvedValueOnce({ data: input, error: null }).mockResolvedValueOnce({ data: "failed", error: null });
    const failure = await executeMarketingJob(db, owner, jobId, { env, model, refreshSource: vi.fn(), storage: { put: vi.fn() }, run: vi.fn(async () => { throw new Error("secret-only-provider-response"); }) });
    expect(failure).toEqual({ claimed: true, status: "failed", errorCode: "worker-execution-failed" });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("secret-only-provider-response");
  });
});

describe("immutable private JPEG storage", () => {
  function storageDatabase(override: { public?: boolean; mismatchBytes?: boolean; mismatchMetadata?: boolean; uploadError?: boolean } = {}) {
    const bytes = Buffer.from("test-only-jpeg"); const sha256 = createHash("sha256").update(bytes).digest("hex");
    const metadata = { revisionId, sha256, ownerId: owner };
    const files = { upload: vi.fn(async () => ({ error: override.uploadError ? { message: "already exists" } : null })), download: vi.fn(async () => ({ data: new Blob([override.mismatchBytes ? "wrong" : bytes]), error: null })), info: vi.fn(async () => ({ data: { size: bytes.length, contentType: "image/jpeg", metadata: override.mismatchMetadata ? {} : metadata }, error: null })), createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://example.supabase.co/storage/v1/object/sign/test-only" }, error: null })) };
    const db = { storage: { getBucket: vi.fn(async () => ({ data: { public: override.public ?? false }, error: null })), from: vi.fn(() => files) } } as unknown as ReturnType<typeof createAdminClient>;
    return { db, files, input: { key: `marketing/devshark/${revisionId}/${"a".repeat(64)}/1-${sha256}.jpg`, bytes, sha256, contentType: "image/jpeg" as const, metadata: { revisionId } } };
  }
  it("prefixes immutable objects with owner, rechecks bytes/metadata, and signs for seven days", async () => {
    const { db, files, input } = storageDatabase({ uploadError: true });
    const storage = createMarketingAssetStorage(db, owner, new Date(Date.now() + 3600000).toISOString());
    expect((await storage.put(input)).sha256).toBe(input.sha256);
    expect(files.upload).toHaveBeenCalledWith(`${owner}/${input.key}`, input.bytes, expect.objectContaining({ upsert: false, contentType: "image/jpeg" }));
    expect(files.createSignedUrl).toHaveBeenCalledWith(`${owner}/${input.key}`, MARKETING_ASSET_URL_SECONDS);
  });
  it("refuses public buckets, conflicting bytes and conflicting metadata before signing", async () => {
    for (const override of [{ public: true }, { mismatchBytes: true }, { mismatchMetadata: true }]) {
      const { db, files, input } = storageDatabase(override);
      await expect(createMarketingAssetStorage(db, owner, new Date(Date.now() + 3600000).toISOString()).put(input)).rejects.toThrow();
      expect(files.createSignedUrl).not.toHaveBeenCalled();
    }
  });
});

describe("Threads text worker path", () => {
  it("refreshes sources twice, preserves caption readiness and skips JPEG upload", async () => {
    const { runMarketingWorkerJob } = await import("../../services/marketing-worker/protocol");
    const input = request(); input.generation.account.platform = "threads";
    const source = input.generation.source;
    const reloadSource = vi.fn(async () => source); const put = vi.fn();
    const invoke = vi.fn(async () => ({ copy: { title: "Test-only", caption: "Choose an option and read the explanation.", locale: "en", slides: [{ headline: "Test-only", body: "Read the question.", code: null, evidenceIndexes: [] }, { headline: "Test-only", body: "Read the explanation.", code: null, evidenceIndexes: [] }] }, usage: { inputTokens: 100, outputTokens: 100 } }));
    const result = await runMarketingWorkerJob(input, { model: { ...model, invoke }, storage: { put }, reloadSource, reloadTemplate: async () => input.template });
    expect(result.revision.account.platform).toBe("threads");
    expect(result.revision.caption.length).toBeLessThanOrEqual(500);
    expect(result.revision.assets).toEqual([]); expect(put).not.toHaveBeenCalled();
    expect(reloadSource).toHaveBeenCalledTimes(2);
  });
});
