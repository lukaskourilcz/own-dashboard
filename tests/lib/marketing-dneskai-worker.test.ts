import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DneskaiDeckJobRequestSchema, MarketingWorkerRequestSchema, dneskaiBriefJobRequest, marketingJobIdentityHash, runMarketingWorkerJob, type DneskaiDeckJobRequest } from "../../services/marketing-worker/protocol";
import { DEFAULT_DNESKAI_DAILY_GENERATION_USD, dneskaiDailyGenerationCeiling, enqueueMarketingJob, executeMarketingJob, readMarketingJob } from "@/lib/marketing/worker-runtime";
import { DNESKAI_DECK_TEMPLATE_VERSION, MARKETING_BRIEF_PROMPT_ID } from "@/lib/marketing/dneskai-generation";
import { DNESKAI_STUDIO } from "@/lib/marketing/dneskai-render";
import { MARKETING_DECK_CONTENT_VERSION, parseContentRevision, revisionReadiness } from "@/lib/marketing/contracts";
import { revisionContentHash } from "@/lib/marketing/hashes";
import { pendingMarketingTemplate, type MarketingTemplate } from "@/lib/marketing/render";
import { contentHash } from "@/lib/marketing/hashes";
import devDesign from "../../templates/marketing/devshark/derived-layout.json";
import type { DneskaiDeckRenderResult } from "@/lib/marketing/dneskai-ports";
import type { MarketingModel } from "@/lib/marketing/generation";
import type { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT, briefFixture, briefPacket, briefPictures, validCopy, type BriefPictures } from "./marketing-dneskai-generation-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const owner = "dbd55242-0c60-483d-8032-edeb348dfd0d";
const jobId = "abbb84c0-bdcc-46ea-924a-e71db4773d28";
const revisionId = "90246ac5-0587-407c-9048-3fce5f968a16";
const env = { MARKETING_AI_CONSENT: "true", ANTHROPIC_API_KEY: "test-only-no-real-call" };
let pictures: BriefPictures;
beforeAll(async () => { pictures = await briefPictures(); });
beforeEach(() => { vi.clearAllMocks(); current = null; });

/** A brief whose windows sit around the real clock, because the worker reads it. */
function liveBrief() {
  const now = Date.now();
  const scheduledAt = new Date(now + 3 * 3600000).toISOString();
  return briefFixture(pictures, { observedAt: new Date(now - 1800000).toISOString(), expiresAt: new Date(now + 2 * 86400000).toISOString(), scheduledAt, targetDate: scheduledAt.slice(0, 10) });
}
let current: DneskaiDeckJobRequest | null = null;
/** The test's one job: the packet carries the clock in its evidence, so it is built once per test. */
function job(): DneskaiDeckJobRequest {
  current ??= dneskaiBriefJobRequest({ source: briefPacket(liveBrief()), account: ACCOUNT, revisionId });
  return structuredClone(current);
}
const loadDneskaiMedia = vi.fn(async (sha256: string) => {
  const found = Object.values(pictures).find((entry) => entry.sha256 === sha256);
  if (!found) throw new Error("media-asset-unavailable");
  return found.bytes;
});
function model(answers: Array<{ copy: unknown; usage: { inputTokens: number; outputTokens: number } | null }> = []) {
  const invoke = vi.fn(async (input: Parameters<MarketingModel["invoke"]>[0]) => { void input; return answers.shift() ?? { copy: validCopy(pictures), usage: { inputTokens: 3000, outputTokens: 1500 } }; });
  return { model: "claude-sonnet-5-5", pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 10 }, invoke } satisfies MarketingModel;
}
/** One rendered JPEG per slide, as the studio renderer returns them. */
const renderDneskaiDeck = vi.fn(async ({ deck }: { deck: { slides: { alt: string }[] } }): Promise<DneskaiDeckRenderResult> => ({
  status: "rendered", renderKeys: deck.slides.map((_, index) => String(index).repeat(64).slice(0, 64)), problems: [],
  assets: deck.slides.map((slide, index) => ({ url: `https://test-only.supabase.co/storage/v1/object/sign/marketing-assets/slide-${index}.jpg?token=test-only`, sha256: String((index + 1) % 10).repeat(64), mimeType: "image/jpeg", width: 1080, height: 1350, alt: slide.alt })),
}));
function database(reserve: (args: Record<string, unknown>) => { data: unknown; error: unknown } = () => ({ data: { admitted: true, spentUsd: 0, reservationUsd: 0.13, ceilingUsd: 1 }, error: null }), request: unknown = job()) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { id: "test-only-account", enabled: true, verified_at: new Date().toISOString() }, error: null });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "marketing_claim_job") return { data: request, error: null };
    if (name === "marketing_reserve_dneskai_generation") return reserve(args);
    if (name === "marketing_finish_job") return { data: args.p_error ? "failed" : "review", error: null };
    if (name === "marketing_enqueue_job") return { data: { jobId, status: "queued", duplicate: false }, error: null };
    return { data: "test-only-id", error: null };
  });
  return { db: { rpc, from: vi.fn(() => query) } as unknown as ReturnType<typeof createAdminClient>, rpc, query };
}

describe("the DNESKAi deck job request (#116)", () => {
  it("is built from a brief packet with consent, no knowledge, the brief's schedule and the studio template version", () => {
    const request = job();
    expect(request.generation).toMatchObject({ templateVersion: DNESKAI_DECK_TEMPLATE_VERSION, knowledge: [], consent: true, revisionId, scheduledAt: request.generation.source && (request.generation.source as { brief: { scheduledAt: string } }).brief.scheduledAt,
      account: ACCOUNT });
    expect(request).not.toHaveProperty("template");
    expect(MarketingWorkerRequestSchema.safeParse(request).success).toBe(false);
    expect(marketingJobIdentityHash(request)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("keeps the job identity across a fresh observation of the same brief, and not across changed media", () => {
    const request = job();
    const source = request.generation.source as { observedAt: string; brief: { observedAt: string; media: { credit: string }[] } };
    const later = new Date(Date.parse(source.observedAt) + 60000).toISOString();
    const observed = structuredClone(request);
    Object.assign(observed.generation.source as object, { observedAt: later });
    (observed.generation.source as typeof source).brief.observedAt = later;
    expect(marketingJobIdentityHash(observed)).toBe(marketingJobIdentityHash(request));
    const changed = structuredClone(request);
    (changed.generation.source as typeof source).brief.media[0]!.credit = "Obrázek: test-only.example";
    expect(marketingJobIdentityHash(changed)).not.toBe(marketingJobIdentityHash(request));
  });
  it("refuses a template, knowledge, Threads and a source that is not a DNESKAi brief", () => {
    const request = job();
    const knowledge = [{ id: "51550112-b4b7-4556-a604-8431b24401e8", brand: "dneskai" as const, presentation: "Test-only." }];
    expect(DneskaiDeckJobRequestSchema.safeParse({ ...request, template: pendingMarketingTemplate("devshark") }).success).toBe(false);
    expect(DneskaiDeckJobRequestSchema.safeParse({ ...request, generation: { ...request.generation, knowledge } }).success).toBe(false);
    expect(DneskaiDeckJobRequestSchema.safeParse({ ...request, generation: { ...request.generation, account: { ...ACCOUNT, platform: "threads" } } }).success).toBe(false);
    const article = { ...(request.generation.source as object), kind: "article", brief: undefined };
    expect(DneskaiDeckJobRequestSchema.safeParse({ ...request, generation: { ...request.generation, source: article } }).success).toBe(false);
    expect(() => dneskaiBriefJobRequest({ source: article as never, account: ACCOUNT, revisionId })).toThrow();
  });
  it("is admitted without a template and refused with another template version", async () => {
    const { db, rpc } = database();
    expect(await enqueueMarketingJob(db, owner, job(), { env })).toEqual({ jobId, status: "queued", duplicate: false });
    expect(rpc).toHaveBeenCalledWith("marketing_enqueue_job", expect.objectContaining({ p_owner: owner, p_key: revisionId, p_hash: marketingJobIdentityHash(job()) }));
    const stale = job(); stale.generation.templateVersion = "carousel-studio/0.9.0+0000000";
    await expect(enqueueMarketingJob(db, owner, stale, { env })).rejects.toThrow("template-revision-mismatch");
  });
});

describe("deck -> revision -> render in the worker", () => {
  it("generates, validates against the real studio gate, renders through the deck port and hashes the final revision", async () => {
    const request = job();
    const reloadSource = vi.fn(async () => request.generation.source);
    const recordPreparedRevision = vi.fn(async () => true);
    const tracer = { start: vi.fn(async () => ({ id: "66666666-6666-4666-8666-666666666666", stage: vi.fn(async () => {}), finish: vi.fn(async () => {}) })), recordPreparedRevision };
    const provider = model();
    const admitPaidCall = vi.fn(async (input: { attempt: number; maxCostUsd: number }) => { void input; });
    const result = await runMarketingWorkerJob(request, { model: provider, tracer, storage: { put: vi.fn() }, reloadSource, loadDneskaiMedia,
      renderDneskaiDeck: (input) => renderDneskaiDeck(input), admitPaidCall });
    expect(provider.invoke).toHaveBeenCalledTimes(1); expect(reloadSource).toHaveBeenCalledTimes(2); expect(admitPaidCall).toHaveBeenCalledTimes(1);
    const revision = parseContentRevision(result.revision);
    expect(revision).toMatchObject({ schemaVersion: MARKETING_DECK_CONTENT_VERSION, format: "carousel", promptVersion: MARKETING_BRIEF_PROMPT_ID, templateVersion: DNESKAI_DECK_TEMPLATE_VERSION });
    expect(revision.assets).toHaveLength(revision.deck!.slides.length);
    expect(revisionReadiness(revision)).toEqual([]);
    expect(result.revisionHash).toBe(revisionContentHash(revision));
    expect(renderDneskaiDeck).toHaveBeenCalledWith({ revisionId, deck: revision.deck, signal: undefined });
    expect(recordPreparedRevision).toHaveBeenCalledWith(expect.objectContaining({ revisionHash: result.revisionHash, templateSha256: DNESKAI_STUDIO.treeSha256 }));
  }, 30000);
  it("never pays for a deck job it could not render", async () => {
    const provider = model();
    await expect(runMarketingWorkerJob(job(), { model: provider, storage: { put: vi.fn() }, reloadSource: vi.fn(), loadDneskaiMedia })).rejects.toThrow("dneskai-renderer-unavailable");
    await expect(runMarketingWorkerJob(job(), { model: provider, storage: { put: vi.fn() }, reloadSource: vi.fn(async () => job().generation.source), renderDneskaiDeck: (input) => renderDneskaiDeck(input) })).rejects.toThrow("dneskai-media-loader-required");
    expect(provider.invoke).not.toHaveBeenCalled();
  });
  it("never reserves or pays for a deck job when the JPEG encoder does not load", async () => {
    const request = job();
    const provider = model();
    const admitPaidCall = vi.fn(async () => {});
    const reloadSource = vi.fn(async () => request.generation.source);
    const { db, rpc } = database();
    // The deployed failure: sharp's native library is missing from the function, so the module does not load.
    vi.resetModules();
    vi.doMock("sharp", () => { throw new Error("TEST-ONLY libvips-cpp.so: cannot open shared object file"); });
    try {
      const broken = await import("../../services/marketing-worker/protocol");
      await expect(broken.runMarketingWorkerJob(request, { model: provider, storage: { put: vi.fn() }, reloadSource, loadDneskaiMedia, renderDneskaiDeck: (input) => renderDneskaiDeck(input), admitPaidCall }))
        .rejects.toMatchObject({ code: "render-jpeg-encoder-unavailable", message: "render-jpeg-encoder-unavailable" });
      const runtime = await import("@/lib/marketing/worker-runtime");
      expect(await runtime.executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck }))
        .toEqual({ claimed: true, status: "failed", errorCode: "render-jpeg-encoder-unavailable" });
    } finally { vi.doUnmock("sharp"); vi.resetModules(); }
    expect(provider.invoke).not.toHaveBeenCalled(); expect(admitPaidCall).not.toHaveBeenCalled(); expect(reloadSource).not.toHaveBeenCalled();
    expect(renderDneskaiDeck).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("marketing_reserve_dneskai_generation");
    expect(rpc).toHaveBeenCalledWith("marketing_finish_job", expect.objectContaining({ p_error: "render-jpeg-encoder-unavailable", p_result: null }));
  });
});

describe("the DNESKAi daily generation ceiling at the paid call", () => {
  it("reserves the job's maximum before the call and passes the configured ceiling", async () => {
    const { db, rpc } = database();
    const provider = model();
    expect(await executeMarketingJob(db, owner, jobId, { env: { ...env, MARKETING_DNESKAI_DAILY_GENERATION_USD: "0.80" }, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck }))
      .toEqual({ claimed: true, status: "review", revisionId });
    const fence = rpc.mock.calls.find(([name]) => name === "marketing_claim_job")![1].p_fence;
    expect(rpc).toHaveBeenCalledWith("marketing_reserve_dneskai_generation", { p_owner: owner, p_job: jobId, p_fence: fence, p_reservation: 0.13, p_ceiling: 0.8 });
    const order = rpc.mock.invocationCallOrder[rpc.mock.calls.findIndex(([name]) => name === "marketing_reserve_dneskai_generation")]!;
    expect(order).toBeLessThan(provider.invoke.mock.invocationCallOrder[0]!);
  }, 30000);
  it("refuses the call when the ceiling would pass, records no spend and never invokes the model", async () => {
    const { db, rpc } = database(() => ({ data: { admitted: false, spentUsd: 0.9, reservationUsd: 0.13, ceilingUsd: 1 }, error: null }));
    const provider = model();
    expect(await executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck }))
      .toEqual({ claimed: true, status: "failed", errorCode: "dneskai-daily-generation-budget-exhausted" });
    expect(provider.invoke).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("marketing_finish_job", expect.objectContaining({ p_error: "dneskai-daily-generation-budget-exhausted", p_result: null }));
  });
  it("treats an unreadable ledger and a malformed ceiling as a refusal", async () => {
    for (const [reserve, environment, code] of [
      [() => ({ data: null, error: { message: "test-only outage" } }), env, "dneskai-daily-generation-budget-unavailable"],
      [() => ({ data: { admitted: "yes" }, error: null }), env, "dneskai-daily-generation-budget-unavailable"],
      [() => ({ data: { admitted: true }, error: null }), { ...env, MARKETING_DNESKAI_DAILY_GENERATION_USD: "1,00" }, "dneskai-daily-generation-budget-invalid"],
    ] as const) {
      const { db } = database(reserve);
      const provider = model();
      expect(await executeMarketingJob(db, owner, jobId, { env: environment, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck }))
        .toMatchObject({ status: "failed", errorCode: code });
      expect(provider.invoke).not.toHaveBeenCalled();
    }
    expect(dneskaiDailyGenerationCeiling({})).toBe(DEFAULT_DNESKAI_DAILY_GENERATION_USD);
    expect(dneskaiDailyGenerationCeiling({ MARKETING_DNESKAI_DAILY_GENERATION_USD: "2.5" })).toBe(2.5);
    for (const value of ["0", "51", "-1", "abc"]) expect(() => dneskaiDailyGenerationCeiling({ MARKETING_DNESKAI_DAILY_GENERATION_USD: value })).toThrow("dneskai-daily-generation-budget-invalid");
  });
  it("records what a failed job spent, so the ledger counts its measured cost instead of the reservation", async () => {
    const { db, rpc } = database();
    const wrong = validCopy(pictures); wrong.slides[1]!.images[0]!.assetSha256 = "f".repeat(64);
    const provider = model([{ copy: wrong, usage: { inputTokens: 3000, outputTokens: 1500 } }, { copy: wrong, usage: { inputTokens: 3200, outputTokens: 1500 } }]);
    expect(await executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck }))
      .toEqual({ claimed: true, status: "failed", errorCode: "copy-validation-failed" });
    expect(rpc.mock.calls.filter(([name]) => name === "marketing_reserve_dneskai_generation")).toHaveLength(2);
    expect(rpc).toHaveBeenCalledWith("marketing_finish_job", expect.objectContaining({ p_error: "copy-validation-failed",
      p_result: { schemaVersion: "marketing-job-failure/1", usage: { attempts: 2, inputTokens: 6200, outputTokens: 3000, estimatedCostUsd: 0.0424 } } }));
  }, 30000);
  it("leaves devShark jobs outside the DNESKAi ledger and hides a failed job's usage record from readers", async () => {
    const base = pendingMarketingTemplate("devshark");
    const template: MarketingTemplate = { ...base, approved: true, authoring: "claude-design", approval: { approvedBy: owner, approvedAt: new Date().toISOString(), templateSha256: base.templateSha256, designExportSha256: devDesign.archiveSha256 } };
    const content = { title: "Test-only question", body: "Choose an option.", category: "JavaScript", difficulty: "Easy", code: null, options: ["A", "B"], answer: "A", explanation: "Test-only authored explanation.", evidence: [], image: null };
    const devshark = { schemaVersion: "marketing-job/1", idempotencyKey: revisionId, template, generation: { revisionId, consent: true, source: { schemaVersion: "marketing-source/1", brand: "devshark", kind: "question", sourceId: "test-only", sourceRevision: "test-only-v1", contentHash: contentHash(content), canonicalUrl: "https://devshark.app/test-only", locale: "en", observedAt: new Date().toISOString(), expiresAt: null, eligible: true, eligibilityReason: "test-only", content }, account: { id: "test-only-remote", platform: "threads", handle: "test-only" }, scheduledAt: new Date(Date.now() + 3600000).toISOString(), templateVersion: template.version, knowledge: [] } };
    const { db, rpc, query } = database(undefined, devshark);
    const run = vi.fn(async () => { throw new Error("test-only-stop"); });
    await executeMarketingJob(db, owner, jobId, { env, model: model(), refreshSource: vi.fn(), run, storage: { put: vi.fn() } });
    expect(run).toHaveBeenCalledTimes(1);
    expect((run.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1]).not.toHaveProperty("admitPaidCall");
    expect(rpc.mock.calls.some(([name]) => name === "marketing_reserve_dneskai_generation")).toBe(false);
    query.maybeSingle.mockResolvedValueOnce({ data: { id: jobId, status: "failed", result: { schemaVersion: "marketing-job-failure/1", usage: { estimatedCostUsd: 0.02 } }, error_code: "copy-validation-failed", lease_until: null }, error: null });
    expect(await readMarketingJob(db, owner, jobId)).toEqual({ jobId, status: "failed", errorCode: "copy-validation-failed" });
  });
});

/** `database()` plus the job row: the fenced retry-state read and the fenced requeue (GEN-14). */
function retryDatabase(stored: unknown = null, requeued: Array<{ id: string }> = [{ id: jobId }]) {
  const base = database();
  const jobs = { mode: "read" as "read" | "update", update: vi.fn(), select: vi.fn(), eq: vi.fn(), gt: vi.fn(), maybeSingle: vi.fn() };
  jobs.update.mockImplementation(() => { jobs.mode = "update"; return jobs; });
  jobs.select.mockImplementation(() => jobs.mode === "update" ? Promise.resolve({ data: requeued, error: null }) : jobs);
  jobs.eq.mockReturnValue(jobs); jobs.gt.mockReturnValue(jobs);
  jobs.maybeSingle.mockImplementation(async () => ({ data: { result: stored }, error: null }));
  const from = vi.fn((table: string) => table === "marketing_jobs" ? jobs : base.query);
  return { ...base, jobs, db: { rpc: base.rpc, from } as unknown as ReturnType<typeof createAdminClient> };
}
const wrongCopy = () => { const copy = validCopy(pictures); copy.slides[1]!.images[0]!.assetSha256 = "f".repeat(64); return copy; };

describe("the copy-validation retry on the next tick (GEN-14)", () => {
  it("puts the job back in the queue after a failed first attempt, with its feedback and usage, under the same fence", async () => {
    const { db, rpc, jobs } = retryDatabase();
    const provider = model([{ copy: wrongCopy(), usage: { inputTokens: 3000, outputTokens: 1500 } }]);
    const result = await executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck, deferRetry: true });
    expect(result).toMatchObject({ claimed: true, status: "queued", retry: { attempt: 2 } });
    expect(provider.invoke).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.filter(([name]) => name === "marketing_reserve_dneskai_generation")).toHaveLength(1);
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("marketing_finish_job");
    const fence = rpc.mock.calls.find(([name]) => name === "marketing_claim_job")![1].p_fence;
    const update = jobs.update.mock.calls[0]![0] as { status: string; fence: null; lease_until: null; result: { schemaVersion: string; resume: { attempt: number; feedback: string; issues: string[]; usage: unknown } } };
    expect(update).toMatchObject({ status: "queued", fence: null, lease_until: null, error_code: null });
    expect(update.result.schemaVersion).toBe("marketing-job-retry/1");
    expect(update.result.resume).toMatchObject({ attempt: 1, usage: { attempts: 1, inputTokens: 3000, outputTokens: 1500, estimatedCostUsd: 0.021 } });
    expect(update.result.resume.issues.length).toBeGreaterThan(0);
    expect(update.result.resume.feedback).toContain("Correct exactly these problems");
    expect(jobs.eq).toHaveBeenCalledWith("status", "running"); expect(jobs.eq).toHaveBeenCalledWith("fence", fence);
    expect(jobs.gt).toHaveBeenCalledWith("lease_until", expect.any(String));
  }, 30000);
  it("makes the second attempt on the next execution with the stored feedback and counts both attempts", async () => {
    const first = retryDatabase();
    await executeMarketingJob(first.db, owner, jobId, { env, model: model([{ copy: wrongCopy(), usage: { inputTokens: 3000, outputTokens: 1500 } }]), refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck, deferRetry: true });
    const stored = (first.jobs.update.mock.calls[0]![0] as { result: { resume: { feedback: string } } }).result;
    const { db, rpc } = retryDatabase(stored);
    const provider = model([{ copy: validCopy(pictures), usage: { inputTokens: 3500, outputTokens: 1500 } }]);
    expect(await executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck, deferRetry: true }))
      .toEqual({ claimed: true, status: "review", revisionId });
    expect(provider.invoke).toHaveBeenCalledTimes(1);
    expect(provider.invoke.mock.calls[0]![0].prompt.endsWith(stored.resume.feedback)).toBe(true);
    // Same reservation as an in-process retry: the job's whole $0.13 under the new fence.
    expect(rpc).toHaveBeenCalledWith("marketing_reserve_dneskai_generation", expect.objectContaining({ p_job: jobId, p_reservation: 0.13 }));
    const finish = rpc.mock.calls.find(([name]) => name === "marketing_finish_job")![1] as { p_result: { usage: unknown } };
    expect(finish.p_result.usage).toEqual({ attempts: 2, inputTokens: 6500, outputTokens: 3000, estimatedCostUsd: 0.043 });
  }, 30000);
  it("fails the job after the second attempt also fails, recording both attempts, and never makes a third call", async () => {
    const stored = { schemaVersion: "marketing-job-retry/1", resume: { attempt: 1, feedback: "\nTest-only feedback.", issues: ["image-unknown"], usage: { attempts: 1, inputTokens: 3000, outputTokens: 1500, estimatedCostUsd: 0.021 } } };
    const { db, rpc, jobs } = retryDatabase(stored);
    const provider = model([{ copy: wrongCopy(), usage: { inputTokens: 3200, outputTokens: 1500 } }, { copy: validCopy(pictures), usage: { inputTokens: 1, outputTokens: 1 } }]);
    expect(await executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck, deferRetry: true }))
      .toEqual({ claimed: true, status: "failed", errorCode: "copy-validation-failed" });
    expect(provider.invoke).toHaveBeenCalledTimes(1);
    expect(jobs.update).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("marketing_finish_job", expect.objectContaining({ p_error: "copy-validation-failed",
      p_result: { schemaVersion: "marketing-job-failure/1", usage: { attempts: 2, inputTokens: 6200, outputTokens: 3000, estimatedCostUsd: 0.0424 } } }));
  }, 30000);
  it("records the first attempt's usage when the second is refused before the call", async () => {
    const stored = { schemaVersion: "marketing-job-retry/1", resume: { attempt: 1, feedback: "\nTest-only feedback.", issues: ["image-unknown"], usage: { attempts: 1, inputTokens: 3000, outputTokens: 1500, estimatedCostUsd: 0.021 } } };
    const base = retryDatabase(stored);
    base.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "marketing_claim_job" ? { data: job(), error: null }
      : name === "marketing_reserve_dneskai_generation" ? { data: { admitted: false, spentUsd: 0.9, reservationUsd: 0.13, ceilingUsd: 1 }, error: null }
      : name === "marketing_finish_job" ? { data: args.p_error ? "failed" : "review", error: null } : { data: null, error: null });
    const provider = model();
    expect(await executeMarketingJob(base.db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck, deferRetry: true }))
      .toEqual({ claimed: true, status: "failed", errorCode: "dneskai-daily-generation-budget-exhausted" });
    expect(provider.invoke).not.toHaveBeenCalled();
    expect(base.rpc).toHaveBeenCalledWith("marketing_finish_job", expect.objectContaining({ p_result: { schemaVersion: "marketing-job-failure/1", usage: stored.resume.usage } }));
  }, 30000);
  it("never retries a provider failure, deferred or not", async () => {
    const { db, rpc, jobs } = retryDatabase();
    const provider = model();
    provider.invoke.mockRejectedValueOnce(Object.assign(new Error("test-only"), { status: 500 }));
    const result = await executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck, deferRetry: true });
    expect(result).toMatchObject({ claimed: true, status: "failed" });
    expect(provider.invoke).toHaveBeenCalledTimes(1);
    expect(jobs.update).not.toHaveBeenCalled();
    // A 500 may come after the model ran: the brief job books its whole maximum.
    expect(rpc).toHaveBeenCalledWith("marketing_finish_job", expect.objectContaining({ p_result: { schemaVersion: "marketing-job-failure/1", usage: expect.objectContaining({ attempts: 1, estimatedCostUsd: 0.13 }) } }));
  }, 30000);
  it("records $0 for a call the API rejected whole, and still does not retry (decision 16)", async () => {
    const { db, rpc, jobs } = retryDatabase();
    const provider = model();
    provider.invoke.mockRejectedValueOnce(Object.assign(new Error("test-only"), { status: 529 }));
    const result = await executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck, deferRetry: true });
    expect(result).toMatchObject({ claimed: true, status: "failed", errorCode: "provider-overloaded" });
    expect(provider.invoke).toHaveBeenCalledTimes(1);
    expect(jobs.update).not.toHaveBeenCalled();
    // The failed job carries a measured $0, which the daily ledger counts instead of its reservation.
    expect(rpc).toHaveBeenCalledWith("marketing_finish_job", expect.objectContaining({ p_result: { schemaVersion: "marketing-job-failure/1", usage: { attempts: 1, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } } }));
  }, 30000);
  it("refuses a stored state it cannot read and makes no call, so a job never gets a third attempt", async () => {
    for (const stored of [{ schemaVersion: "marketing-job-retry/1", resume: { attempt: 2, feedback: "x", issues: [], usage: { attempts: 2, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.01 } } },
      { schemaVersion: "marketing-job-failure/1", usage: {} }, "test-only"]) {
      const { db } = retryDatabase(stored);
      const provider = model();
      const result = await executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck, deferRetry: true });
      expect(result).toMatchObject({ claimed: true, status: "failed" });
      expect(["job-retry-state-invalid", "generation-retry-invalid"]).toContain((result as { errorCode: string }).errorCode);
      expect(provider.invoke).not.toHaveBeenCalled();
    }
  }, 30000);
  it("leaves the lease to reconciliation when the requeue write is lost", async () => {
    const { db, rpc } = retryDatabase(null, []);
    await expect(executeMarketingJob(db, owner, jobId, { env, model: model([{ copy: wrongCopy(), usage: { inputTokens: 3000, outputTokens: 1500 } }]), refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck, deferRetry: true }))
      .rejects.toThrow("job-finish-reconciliation-required");
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("marketing_finish_job");
  }, 30000);
  it("keeps the in-process retry for callers that do not defer", async () => {
    const { db, jobs } = retryDatabase();
    const provider = model([{ copy: wrongCopy(), usage: { inputTokens: 3000, outputTokens: 1500 } }, { copy: validCopy(pictures), usage: { inputTokens: 3500, outputTokens: 1500 } }]);
    expect(await executeMarketingJob(db, owner, jobId, { env, model: provider, refreshSource: vi.fn(async () => job().generation.source), loadDneskaiMedia, renderDneskaiDeck }))
      .toEqual({ claimed: true, status: "review", revisionId });
    expect(provider.invoke).toHaveBeenCalledTimes(2);
    expect(jobs.update).not.toHaveBeenCalled();
  }, 30000);
});
