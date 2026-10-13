import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { abortQueuedKnowledgeAnalysis, pollQueuedKnowledgeAnalysis, runQueuedKnowledgeAnalysis, type KnowledgeRunnerStore } from "@/lib/marketing/knowledge-runner";
import { emptyTags, planKnowledgeCapture, type KnowledgeItem, type StoredKnowledgeSource } from "@/lib/marketing/knowledge";
import { prepareApifyKnowledgeRun } from "@/lib/marketing/knowledge-providers";
import { contentHash } from "@/lib/marketing/hashes";
import { knowledgeAnalysisKey, type KnowledgeModel } from "@/lib/marketing/knowledge-extraction";
const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const env = { MARKETING_KNOWLEDGE_WORKER_ENABLED: "true", APIFY_ACTOR_ID: "xMc5Ga1oCONPmWJIa", APIFY_ACTOR_BUILD: "0.0.568", APIFY_TOKEN: "local-test-token", MARKETING_CLAUDE_MODEL: "claude-test", MARKETING_CLAUDE_INPUT_USD_PER_MTOK: "1", MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK: "1" };
const source = (provider: "apify" | "claude" = "apify"): StoredKnowledgeSource => {
 const s = { ...planKnowledgeCapture({ cutoff: "2026-10-13T00:00:00Z", input: [{ url: "https://instagram.com/reel/ABC123/", saved_at: "2026-10-01T00:00:00Z", caption: "Choose one goal." }] }).sources[0], id, user_id: owner, status: "queued" as const, budget_usd: 0.25 };
 const plan = provider === "apify" ? prepareApifyKnowledgeRun([s], 0.25, { actorId: env.APIFY_ACTOR_ID, build: env.APIFY_ACTOR_BUILD }) : { reviewHash: contentHash({ sourceVersions: [{ shortcode: s.shortcode, contentHash: contentHash(s.content) }], model: "claude-test", maxCostUsd: 0.25 }) };
 return { ...s, analysis_key: provider === "apify" ? contentHash({ shortcode: s.shortcode, plan: plan.reviewHash }) : knowledgeAnalysisKey(s, "claude-test"),
  analysis_request: { provider, plan, reviewHash: plan.reviewHash, consentAt: "2026-10-13T12:00:00Z", registration: null } };
};
function memory(initial: StoredKnowledgeSource) {
 let current = structuredClone(initial); const writes: { source: StoredKnowledgeSource; items: KnowledgeItem[]; eventId: string }[] = [];
 const store: KnowledgeRunnerStore = {
  async load(user, sourceId) { return user === current.user_id && sourceId === current.id ? structuredClone(current) : null; },
  async claim(user, sourceId, hash) { if (user !== current.user_id || sourceId !== current.id || hash !== current.analysis_key || current.status !== "queued") return null; current.status = "analyzing"; return structuredClone(current); },
  async save(user, value, items, eventId) { if (user !== current.user_id) throw new Error("unowned"); current = { ...current, ...structuredClone(value) }; writes.push({ source: structuredClone(current), items, eventId }); },
 };
 return { store, writes, get: () => current };
}
const run = (status = "READY") => ({ id: "registered-run", actId: env.APIFY_ACTOR_ID, userId: "provider-owner", defaultDatasetId: "registered-dataset", buildNumber: env.APIFY_ACTOR_BUILD, status, usageTotalUsd: 0.02 });
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
describe("Reviewed queued worker adapters", () => {
 it("makes no provider call with disabled worker, missing keys, unowned source or changed reviewed plan", async () => {
  const m = memory(source()); const transport = vi.fn();
  expect((await runQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env: {} })).status).toBe("held");
  await expect(runQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env: { MARKETING_KNOWLEDGE_WORKER_ENABLED: "true" } })).rejects.toThrow("configuration-required");
  await expect(runQueuedKnowledgeAnalysis("33333333-3333-4333-8333-333333333333", id, { store: m.store, fetch: transport, env })).rejects.toThrow("source-unavailable");
  await expect(runQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env: { ...env, APIFY_ACTOR_BUILD: "0.0.569" } })).rejects.toThrow("reviewed-plan-changed");
  expect(transport).not.toHaveBeenCalled(); expect(m.get().status).toBe("queued");
 });
 it("claims once before asynchronous one-URL launch, pins build/cost and registers the actual run/dataset", async () => {
  const m = memory(source()); const transport = vi.fn(async () => json({ data: run() }));
  const result = await runQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env });
  expect(result).toEqual({ status: "analyzing", runId: "registered-run", datasetId: "registered-dataset" });
  const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/v2/actors/xMc5Ga1oCONPmWJIa/runs"); expect(url).toContain("build=0.0.568"); expect(url).toContain("maxTotalChargeUsd=0.25"); expect(url).toContain("restartOnError=false"); expect(url).toContain("waitForFinish=0");
  expect(JSON.parse(String(options.body))).toEqual({ username: ["https://www.instagram.com/reel/ABC123/"], resultsLimit: 1, includeTranscript: true, includeSharesCount: false, includeDownloadedVideo: false });
  expect(m.get().analysis_request?.registration?.userId).toBe("provider-owner");
  await runQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env }); expect(transport).toHaveBeenCalledTimes(1);
 });
 it("does not automatically repeat an ambiguous paid start", async () => {
  const m = memory(source()); const transport = vi.fn(async () => { throw new Error("transport failed after potential charge"); });
  const result = await runQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env }); expect(result.status).toBe("failed"); expect(result).toHaveProperty("retryAutomatically", false);
  await runQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env }); expect(transport).toHaveBeenCalledTimes(1);
 });
 it("fetches only the registered run/dataset and keeps transcript timecodes and OCR absence explicit", async () => {
  const s = source(); s.status = "analyzing"; s.run_id = "registered-run"; s.dataset_id = "registered-dataset";
  s.analysis_request!.registration = { runId: s.run_id, datasetId: s.dataset_id, actorId: env.APIFY_ACTOR_ID, actorBuild: env.APIFY_ACTOR_BUILD, userId: "provider-owner" };
  const m = memory(s); const transport = vi.fn(async (url: string | URL | Request) => String(url).includes("/actor-runs/") ? json({ data: run("SUCCEEDED") }) : json([{ shortCode: "ABC123", url: "https://instagram.com/reel/ABC123/", caption: "Choose one goal.", transcript: "Actual returned speech", timestamp: "2020-01-01T00:00:00Z" }]));
  const result = await pollQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env }); expect(result.status).toBe("captured");
  expect(transport.mock.calls[1][0]).toContain("/datasets/registered-dataset/items"); expect(transport.mock.calls[1][0]).toContain("limit=2");
  expect(m.get().content.transcript.status).toBe("available"); expect(m.get().content.transcript.segments[0].startSeconds).toBeNull();
  expect(m.get().content.ocr.status).toBe("not-requested"); expect(m.get().saved_at).toContain("2026-10-01"); expect(m.get().published_at).toContain("2020-01-01"); expect(m.get().analysis?.costUsd).toBe(0.02);
  await pollQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env }); expect(transport).toHaveBeenCalledTimes(2);
 });
 it("rejects unrelated source rows or extra dataset rows despite the billable maxItems cap", async () => {
  const s = source(); s.status = "analyzing"; s.run_id = "registered-run"; s.dataset_id = "registered-dataset";
  s.analysis_request!.registration = { runId: s.run_id, datasetId: s.dataset_id, actorId: env.APIFY_ACTOR_ID, actorBuild: env.APIFY_ACTOR_BUILD, userId: "provider-owner" };
  const m = memory(s);
  const wrong = vi.fn(async (url: string | URL | Request) => String(url).includes("/actor-runs/") ? json({ data: run("SUCCEEDED") }) : json([{ shortCode: "OTHER", caption: "Unrelated content" }]));
  await expect(pollQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: wrong, env })).rejects.toThrow("source-mismatch");
  const many = vi.fn(async (url: string | URL | Request) => String(url).includes("/actor-runs/") ? json({ data: run("SUCCEEDED") }) : json([{ shortCode: "ABC123" }, { shortCode: "OTHER" }]));
  await expect(pollQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: many, env })).rejects.toThrow("dataset-count-invalid"); expect(m.writes).toHaveLength(0);
 });
 it("executes one Claude attempt into several atomic items and prevents parallel duplicate charges", async () => {
  const m = memory(source("claude")); const model: KnowledgeModel = { model: "claude-test", pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 }, invoke: vi.fn(async () => ({ extraction: { procedures: ["Goal", "Measure"].map((title) => ({ title, summary: "Choose one goal.", steps: ["Choose one goal."], category: "marketing", tipGroup: "content", tags: emptyTags(), evidence: [{ shortcode: "ABC123", channel: "caption", quote: "Choose one goal.", startSeconds: null, endSeconds: null }], missingParts: [], contraryClaims: [] })), missingParts: [] }, usage: { inputTokens: 100, outputTokens: 100 } })) };
  await Promise.all([runQueuedKnowledgeAnalysis(owner, id, { store: m.store, env, model }), runQueuedKnowledgeAnalysis(owner, id, { store: m.store, env, model })]);
  expect(model.invoke).toHaveBeenCalledTimes(1); expect(m.get().status).toBe("review"); expect(m.writes[0].items).toHaveLength(2); expect(m.get().analysis?.inputTokens).toBe(100);
 });
 it("allows a queued cancellation without spending or credentials", async () => {
  const m = memory(source()); const transport = vi.fn();
  expect((await abortQueuedKnowledgeAnalysis(owner, id, { store: m.store, fetch: transport, env: {} })).status).toBe("cancelled"); expect(transport).not.toHaveBeenCalled();
 });
});
