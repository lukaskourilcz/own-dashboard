import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMarketingWorkerJob, type MarketingWorkerRequest } from "../../services/marketing-worker/protocol";
import { parseSourcePacket, type SourcePacket } from "@/lib/marketing/contracts";
import { contentHash } from "@/lib/marketing/hashes";
import { currentMarketingTemplate, renderMarketingAssets, type MarketingAssetStorage } from "@/lib/marketing/render";
import type { MarketingModel } from "@/lib/marketing/generation";
import heldQuestion from "../../templates/marketing/benchmarks/devshark-question.json";
import design from "../../templates/marketing/devshark/derived-layout.json";

vi.mock("@/lib/marketing/render", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/marketing/render")>();
  return { ...original, renderMarketingAssets: vi.fn(original.renderMarketingAssets) };
});
const owner = "11111111-1111-4111-8111-111111111111";
const revisionId = "33333333-3333-4333-8333-333333333333";
function setup() {
  // The genuine retained packet stays held. Eligibility and template approval are in-memory test simulations.
  const source = parseSourcePacket({ ...structuredClone(heldQuestion), eligible: true,
    eligibilityReason: "OFFLINE SOURCE BINDING SIMULATION ONLY", observedAt: new Date().toISOString() });
  const base = currentMarketingTemplate("devshark");
  const request: MarketingWorkerRequest = { schemaVersion: "marketing-job/1", idempotencyKey: revisionId,
    template: { ...base, approved: true, approval: { approvedBy: owner, approvedAt: new Date().toISOString(), templateSha256: base.templateSha256, designExportSha256: design.archiveSha256 } },
    generation: { revisionId, source, consent: true, knowledge: [], templateVersion: base.version, scheduledAt: new Date(Date.now() + 3600000).toISOString(), account: { id: "test-only", platform: "instagram", handle: "test-only" } } };
  const invoke = vi.fn(async () => ({ copy: { title: source.content.title, caption: "Read the authored question and explanation.", locale: "en", slides: [
    { headline: "Question", body: "Read the authored question.", code: null, evidenceIndexes: [] },
    { headline: "Explanation", body: "Read the authored explanation.", code: null, evidenceIndexes: [] },
  ] }, usage: { inputTokens: 100, outputTokens: 100 } }));
  const model: MarketingModel = { model: "claude-offline-source-binding-test", pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 }, invoke };
  const put: MarketingAssetStorage["put"] = vi.fn(async (input) => ({ url: `https://assets.example.invalid/${input.key}`, sha256: input.sha256 }));
  return { source, request, invoke, model, put };
}
beforeEach(() => { vi.clearAllMocks(); });

describe("exact producer authority independent of worker runtime wrappers", () => {
  it.each([
    ["canonicalUrl", "https://devshark.app/forged-caption-target"],
    ["kind", "coding-task"],
    ["locale", "cs"],
    ["sourceId", "question:forged-identity"],
    ["brand", "dneskai"],
    ["sourceRevision", "forged-revision"],
    ["contentHash", "a".repeat(64)],
  ])("rejects a request's forged %s before any model or rendering call", async (field, value) => {
    const test = setup(); const request = structuredClone(test.request);
    Object.assign(request.generation.source as SourcePacket, { [field]: value });
    const reloadSource = vi.fn(async () => structuredClone(test.source));
    await expect(runMarketingWorkerJob(request, { model: test.model, storage: { put: test.put }, reloadSource })).rejects.toThrow();
    expect(test.invoke).not.toHaveBeenCalled(); expect(renderMarketingAssets).not.toHaveBeenCalled(); expect(test.put).not.toHaveBeenCalled();
    expect(heldQuestion.eligible).toBe(false); expect(currentMarketingTemplate("devshark").approved).toBe(false);
  });
  it("rejects modified canonical content even when metadata retains the original hash and revision", async () => {
    const test = setup(); const live = structuredClone(test.source); live.content.body += " OFFLINE MUTATION";
    await expect(runMarketingWorkerJob(test.request, { model: test.model, storage: { put: test.put }, reloadSource: async () => live })).rejects.toThrow("source-superseded");
    expect(test.invoke).not.toHaveBeenCalled(); expect(renderMarketingAssets).not.toHaveBeenCalled();
  });
  it.each([{ eligible: false }, { expiresAt: "2000-01-01T00:00:00Z" }])("separately holds a retired or expired authoritative packet: %j", async (patch) => {
    const test = setup(); const live = { ...test.source, ...patch };
    await expect(runMarketingWorkerJob(test.request, { model: test.model, storage: { put: test.put }, reloadSource: async () => live })).rejects.toThrow("source-superseded");
    expect(test.invoke).not.toHaveBeenCalled(); expect(renderMarketingAssets).not.toHaveBeenCalled();
  });
  it("allows changing observedAt and holds a canonical URL change after generation without returning a ready revision", async () => {
    const test = setup(); const snapshot = structuredClone(test.request);
    const reloadSource = vi.fn().mockResolvedValueOnce({ ...test.source, observedAt: new Date(Date.now() + 1).toISOString() })
      .mockResolvedValueOnce({ ...test.source, observedAt: new Date(Date.now() + 2).toISOString(), canonicalUrl: "https://devshark.app/changed-after-generation" });
    await expect(runMarketingWorkerJob(test.request, { model: test.model, storage: { put: test.put }, reloadSource })).rejects.toThrow("source-superseded");
    expect(test.invoke).toHaveBeenCalledTimes(1); expect(renderMarketingAssets).toHaveBeenCalledTimes(1);
    // The final producer check happens after rendering. These orphan QA uploads confer no readiness/approval.
    expect(test.put).toHaveBeenCalledTimes(4); expect(reloadSource).toHaveBeenCalledTimes(2);
    expect(test.request).toEqual(snapshot);
  }, 60000);
  it("accepts unchanged stable authority with refreshed observation timestamps and preserves the request packet", async () => {
    const test = setup(); const snapshot = structuredClone(test.request);
    let count = 0;
    const result = await runMarketingWorkerJob(test.request, { model: test.model, storage: { put: test.put }, reloadSource: async () => ({ ...structuredClone(test.source), observedAt: new Date(Date.now() + ++count).toISOString() }) });
    expect(result.revision.caption).toContain(heldQuestion.canonicalUrl);
    expect(result.revision.assets).toHaveLength(4);
    expect(test.invoke).toHaveBeenCalledTimes(1); expect(count).toBe(2);
    expect(test.request).toEqual(snapshot);
    expect(contentHash(test.source.content)).toBe(heldQuestion.contentHash);
    expect(heldQuestion.eligible).toBe(false);
  }, 60000);
});
