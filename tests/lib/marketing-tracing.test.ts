import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMarketingTracer, marketingTraceMetadata, LANGSMITH_EU_ENDPOINT } from "@/lib/marketing/tracing";
import { createClaudeMarketingModel } from "@/lib/marketing/generation";
import { parseSourcePacket } from "@/lib/marketing/contracts";
import { contentHash } from "@/lib/marketing/hashes";

const mocks = vi.hoisted(() => ({ config: {} as Record<string, unknown>, createRun: vi.fn(), createExample: vi.fn(), readRun: vi.fn(), updateRun: vi.fn(), createFeedback: vi.fn(), getRunUrl: vi.fn(), awaitPendingTraceBatches: vi.fn() }));
vi.mock("langsmith", () => ({ Client: class {
  constructor(config: Record<string, unknown>) { mocks.config = config; }
  createRun = mocks.createRun; createExample = mocks.createExample; readRun = mocks.readRun; updateRun = mocks.updateRun; createFeedback = mocks.createFeedback;
  getRunUrl = mocks.getRunUrl; awaitPendingTraceBatches = mocks.awaitPendingTraceBatches;
} }));
const content = { title: "TEST PRIVATE TITLE", body: "TEST PRIVATE BODY", category: "JavaScript", difficulty: null, code: null, options: ["A", "B"], answer: "A", explanation: "TEST PRIVATE EXPLANATION", evidence: [], image: null };
const source = parseSourcePacket({ schemaVersion: "marketing-source/1", brand: "devshark", kind: "question", sourceId: "TEST PRIVATE SOURCE ID", sourceRevision: "TEST PRIVATE REVISION ID", contentHash: contentHash(content), canonicalUrl: "https://devshark.app/private-test-only", locale: "en", observedAt: "2026-10-13T08:00:00Z", expiresAt: null, eligible: true, eligibilityReason: "test-only", content });
const start = { revisionId: "4486ad3e-1c25-4f51-baad-1554ae89a067", source, model: "claude-sonnet-4-6", promptVersion: "TEST PRIVATE PROMPT VERSION", templateVersion: "TEST PRIVATE TEMPLATE VERSION", knowledgeIds: [] };
const usage = { attempts: 1, inputTokens: 100, outputTokens: 200, estimatedCostUsd: 0.0033 };
beforeEach(() => { vi.clearAllMocks(); mocks.createRun.mockResolvedValue(undefined); mocks.updateRun.mockResolvedValue(undefined); mocks.createFeedback.mockResolvedValue({}); mocks.readRun.mockResolvedValue({ extra: { metadata: { ...marketingTraceMetadata(start), status: "review", revision_hash: "a".repeat(64), attempts: 1, input_tokens: 100, output_tokens: 200, estimated_cost_usd: 0.0033, issue_codes: [] } } }); mocks.awaitPendingTraceBatches.mockResolvedValue(undefined); });

describe("redacted LangSmith EU SDK tracing", () => {
  it("resolves an exact stored revision with UUID+source hashes and excludes authored or private fields", () => {
    const metadata = marketingTraceMetadata(start);
    expect(metadata.revision_id).toBe(start.revisionId);
    expect(metadata.source_id_hash).toBe(contentHash(source.sourceId));
    expect(metadata.source_revision_hash).toBe(contentHash(source.sourceRevision));
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain("TEST PRIVATE");
    expect(serialized).not.toContain(source.canonicalUrl);
  });
  it("pins EU endpoint and blocks another region", async () => {
    await expect(createMarketingTracer({ apiKey: "test-only", projectName: "test-only", endpoint: "https://api.smith.langchain.com" })).rejects.toThrow("langsmith-eu-required");
    await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    expect(mocks.config).toEqual(expect.objectContaining({ apiUrl: LANGSMITH_EU_ENDPOINT, hideInputs: true, hideOutputs: true, omitTracedRuntimeInfo: true, autoBatchTracing: false }));
    const filter = mocks.config.hideMetadata as (value: object) => object;
    expect(filter({ apiKey: "TEST PRIVATE TOKEN", notes: "TEST PRIVATE" })).toEqual({});
    expect(filter(marketingTraceMetadata(start))).toEqual(marketingTraceMetadata(start));
  });
  it("records stages/latency/cost/QA and sanitized errors without prompts, outputs or URLs", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const trace = await tracer.start(start);
    expect(trace).not.toBeNull();
    await trace!.stage({ name: "generation", attempt: 1, latencyMs: 123, usage, costUsd: usage.estimatedCostUsd, issues: ["missing-evidence"] });
    await trace!.finish({ status: "failed", revisionHash: null, usage, issues: ["copy-validation-failed"] });
    const root = mocks.createRun.mock.calls[0][0]; const stage = mocks.createRun.mock.calls[1][0];
    expect(root.inputs).toEqual({});
    expect(stage.extra.metadata).toEqual(expect.objectContaining({ latency_ms: 123, estimated_cost_usd: 0.0033, issue_codes: ["missing-evidence"] }));
    const update = mocks.updateRun.mock.calls[0][1];
    expect(update.error).toBe("marketing-generation-failed");
    expect(update.outputs).toEqual({});
    expect(JSON.stringify([root, stage, update])).not.toContain("TEST PRIVATE");
  });
  it("degrades cleanly on diagnostics network failure and sends typed owner feedback without text", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    mocks.createRun.mockRejectedValue(new Error("TEST PRIVATE PROVIDER ERROR"));
    expect(await tracer.start(start)).toBeNull();
    const feedback = { traceId: "67a15323-4a6f-4463-a03b-c4c010015d80", revisionId: start.revisionId, revisionHash: "a".repeat(64), decision: "returned" as const, qualityScore: 0.25 };
    expect(await tracer.recordOwnerFeedback(feedback)).toBe(true);
    expect(mocks.createFeedback).toHaveBeenCalledWith(feedback.traceId, "owner-review", { score: 0.25, value: "returned", sourceInfo: { revision_id: feedback.revisionId, revision_hash: feedback.revisionHash } });
    await expect(tracer.recordOwnerFeedback({ ...feedback, comment: "TEST PRIVATE OWNER NOTE" } as typeof feedback)).rejects.toThrow();
  });
  it("retains deduplicated generation reasons in the failed root even when child ingestion fails", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const trace = await tracer.start(start);
    mocks.createRun.mockRejectedValue(new Error("TEST PRIVATE CHILD INGESTION ERROR"));
    await trace!.stage({ name: "generation", attempt: 1, latencyMs: 123, usage, costUsd: usage.estimatedCostUsd, issues: ["model-code-forbidden", "unknown-evidence"] });
    await trace!.stage({ name: "generation", attempt: 2, latencyMs: 123, usage, costUsd: usage.estimatedCostUsd, issues: ["unknown-evidence", "unsupported-number"] });
    await trace!.finish({ status: "failed", revisionHash: null, usage: { ...usage, attempts: 2 }, issues: ["copy-validation-failed"] });
    const update = mocks.updateRun.mock.calls[0][1];
    expect(update.extra.metadata.issue_codes).toEqual(["model-code-forbidden", "unknown-evidence", "unsupported-number", "copy-validation-failed"]);
    expect(update.outputs).toEqual({}); expect(JSON.stringify(update)).not.toContain("TEST PRIVATE");
  });
  it("binds exact prepared asset/revision hashes and refuses mismatched owner feedback", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const traceId = "67a15323-4a6f-4463-a03b-c4c010015d80";
    expect(await tracer.recordPreparedRevision!({ traceId, revisionId: start.revisionId, revisionHash: "b".repeat(64), assetHashes: ["c".repeat(64)], templateSha256: "d".repeat(64), latencyMs: 123 })).toBe(true);
    expect(mocks.updateRun.mock.calls[0][1].extra.metadata).toEqual(expect.objectContaining({ revision_hash: "b".repeat(64), asset_hashes: ["c".repeat(64)], render_latency_ms: 123 }));
    expect(await tracer.recordOwnerFeedback({ traceId, revisionId: start.revisionId, revisionHash: "b".repeat(64), decision: "approved", qualityScore: 1 })).toBe(false);
    expect(mocks.createFeedback).not.toHaveBeenCalled();
  });
  it("only returns private EU trace links; never enables public sharing", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    mocks.getRunUrl.mockResolvedValue("https://smith.langchain.com/private-run");
    expect(await tracer.getTraceUrl("67a15323-4a6f-4463-a03b-c4c010015d80")).toBeNull();
    mocks.getRunUrl.mockResolvedValue("https://eu.smith.langchain.com/private-run");
    expect(await tracer.getTraceUrl("67a15323-4a6f-4463-a03b-c4c010015d80")).toBe("https://eu.smith.langchain.com/private-run");
  });
  it("records downstream preparation failure only on the exact generated revision, preserving measured usage/hashes", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const traceId = "67a15323-4a6f-4463-a03b-c4c010015d80";
    const previous = structuredClone((await mocks.readRun()).extra.metadata);
    expect(await tracer.recordPreparationFailure!({ traceId, revisionId: start.revisionId, code: "font-unavailable" })).toBe(true);
    expect(mocks.updateRun.mock.calls[0][1]).toMatchObject({ outputs: {}, error: "marketing-preparation-failed", extra: { metadata: { ...previous, status: "failed", issue_codes: ["font-unavailable"] } } });
    mocks.updateRun.mockClear();
    expect(await tracer.recordPreparationFailure!({ traceId, revisionId: "11111111-1111-4111-8111-111111111111", code: "font-unavailable" })).toBe(false);
    expect(mocks.updateRun).not.toHaveBeenCalled();
    await expect(tracer.recordPreparationFailure!({ traceId, revisionId: start.revisionId, code: "TEST PRIVATE SVG PATH" })).rejects.toThrow();
    mocks.readRun.mockRejectedValueOnce(new Error("TEST PRIVATE TRACE OUTAGE"));
    expect(await tracer.recordPreparationFailure!({ traceId, revisionId: start.revisionId, code: "render-preparation-failed" })).toBe(false);
    expect(mocks.updateRun).not.toHaveBeenCalled();
  });
  it("binds edited feedback to original immutable metadata while sending the exact reviewed tuple", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const metadataBefore = structuredClone((await mocks.readRun()).extra.metadata);
    const feedback = { traceId: "67a15323-4a6f-4463-a03b-c4c010015d80", revisionId: "3e4382f1-1c71-4aac-9e0d-33aef28f355f", revisionHash: "b".repeat(64), decision: "edited" as const, qualityScore: 0,
      generatedRevisionId: start.revisionId, generatedRevisionHash: "a".repeat(64) };
    expect(await tracer.recordOwnerFeedback(feedback)).toBe(true);
    expect(mocks.createFeedback).toHaveBeenCalledWith(feedback.traceId, "owner-review", { score: 0, value: "edited", sourceInfo: {
      revision_id: feedback.revisionId, revision_hash: feedback.revisionHash, generated_revision_id: start.revisionId, generated_revision_hash: "a".repeat(64),
    } });
    expect(mocks.updateRun).not.toHaveBeenCalled();
    expect((await mocks.readRun()).extra.metadata).toEqual(metadataBefore);
    mocks.createFeedback.mockClear();
    expect(await tracer.recordOwnerFeedback({ ...feedback, generatedRevisionHash: "c".repeat(64) })).toBe(false);
    expect(await tracer.recordOwnerFeedback({ ...feedback, generatedRevisionId: feedback.revisionId })).toBe(false);
    expect(mocks.createFeedback).not.toHaveBeenCalled();
  });
  it("rejects incomplete lineage pairs and returns false for trace-read or feedback outages", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const feedback = { traceId: "67a15323-4a6f-4463-a03b-c4c010015d80", revisionId: start.revisionId, revisionHash: "a".repeat(64), decision: "approved" as const, qualityScore: 1 };
    await expect(tracer.recordOwnerFeedback({ ...feedback, generatedRevisionId: start.revisionId })).rejects.toThrow("generated-revision-pair-required");
    mocks.readRun.mockRejectedValueOnce(new Error("TEST PRIVATE TRACE READ ERROR"));
    expect(await tracer.recordOwnerFeedback(feedback)).toBe(false);
    expect(mocks.createFeedback).not.toHaveBeenCalled();
    mocks.createFeedback.mockRejectedValueOnce(new Error("TEST PRIVATE TRACE WRITE ERROR"));
    expect(await tracer.recordOwnerFeedback(feedback)).toBe(false);
    expect(mocks.updateRun).not.toHaveBeenCalled();
  });
  it("blocks ambient LangChain tracing before loading/calling Claude", async () => {
    vi.stubEnv("LANGSMITH_TRACING", "true");
    await expect(createClaudeMarketingModel({ apiKey: "test-only", model: "claude-sonnet-4-6", pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } })).rejects.toThrow("unsafe-native-tracing-enabled");
    vi.unstubAllEnvs();
  });
});
