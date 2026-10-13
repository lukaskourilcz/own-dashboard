import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({ user: "11111111-1111-4111-8111-111111111111" as string | null, tables: {} as Record<string, Record<string, unknown>[]>, rpc: vi.fn(), poll: vi.fn() }));
function db() {
 return { auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }) }, rpc: state.rpc,
 from(table: string) {
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const result = () => ({ data: (state.tables[table] ?? []).filter((row) => filters.every((f) => f(row))), error: null });
  const query = { select: () => query, order: () => query, limit: () => query,
   eq(k: string, v: unknown) { filters.push((row) => row[k] === v); return query; },
   in(k: string, v: unknown[]) { filters.push((row) => v.includes(row[k])); return query; },
   maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
   then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
  }; return query;
 } };
}
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db() }));
vi.mock("@/lib/marketing/knowledge-runner", () => ({ pollQueuedKnowledgeAnalysis: (...args: unknown[]) => state.poll(...args) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }));
import { GET, POST } from "@/app/api/marketing/knowledge/route";
import { POST as callbackPOST } from "@/app/api/marketing/knowledge/callback/route";
import { signAutomationBody } from "@/lib/marketing/automation-auth";
import { planKnowledgeCapture } from "@/lib/marketing/knowledge";
import { knowledgeAnalysisKey } from "@/lib/marketing/knowledge-extraction";
import { readKnowledgeBody } from "@/lib/marketing/knowledge-body";
const capture = { cutoff: "2026-10-13T00:00:00Z", input: [{ url: "https://instagram.com/reel/ABC123/", saved_at: "2026-10-01T00:00:00Z", caption: "Choose one goal." }], includeUnknownDates: false, timestampProof: null };
const base = () => ({ ...planKnowledgeCapture(capture).sources[0], id: sourceId, user_id: owner });
const request = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/marketing/knowledge", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
const signedCallback = (body: unknown, secret = "w".repeat(40)) => { const raw = JSON.stringify(body); return new Request("http://localhost/api/marketing/knowledge/callback", { method: "POST", headers: signAutomationBody(raw, secret), body: raw }); };
beforeEach(() => {
 state.user = owner; state.tables = { marketing_knowledge_sources: [base()], marketing_knowledge_items: [], projects: [] };
 state.poll.mockReset(); state.poll.mockResolvedValue({ status: "captured", transcriptAvailable: true }); state.rpc.mockReset(); state.rpc.mockResolvedValue({ data: { sourceIds: [sourceId], knowledgeIds: [], createdItems: 0, duplicate: false }, error: null });
 vi.stubEnv("MARKETING_OWNER_ID", owner); vi.stubEnv("MARKETING_WORKER_SECRET", "w".repeat(40)); vi.stubEnv("MARKETING_CLAUDE_MODEL", "claude-test");
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("Knowledge owner API", () => {
 it("rejects missing auth and cross-origin writes before privileged work", async () => {
  expect((await POST(request({ action: "preview", capture }, "https://evil.example"))).status).toBe(403);
  state.user = null; expect((await GET(new Request("http://localhost/api/marketing/knowledge"))).status).toBe(401);
  expect((await POST(request({ action: "preview", capture }))).status).toBe(401); expect(state.rpc).not.toHaveBeenCalled();
 });
 it("excludes unowned sources and projects", async () => {
  state.tables.marketing_knowledge_sources.push({ ...base(), id: "44444444-4444-4444-8444-444444444444", user_id: other });
  const response = await GET(new Request("http://localhost/api/marketing/knowledge")); expect((await response.json()).sources).toHaveLength(1);
  state.tables.projects = [{ id: sourceId, user_id: other }];
  expect((await GET(new Request(`http://localhost/api/marketing/knowledge?projectId=${sourceId}`))).status).toBe(404);
 });
 it("binds capture to its preview and uses authenticated owner rather than caller owner IDs", async () => {
  const preview = await (await POST(request({ action: "preview", capture }))).json();
  expect((await POST(request({ action: "capture", capture, reviewHash: "a".repeat(64) }))).status).toBe(409);
  expect((await POST(request({ action: "capture", capture, reviewHash: preview.reviewHash }))).status).toBe(200);
  expect(state.rpc.mock.calls[0][1].p_owner).toBe(owner);
  expect(state.rpc.mock.calls[0][1].p_sources[0].imported_at).not.toBe(capture.cutoff);
  expect((await POST(request({ action: "capture", capture, reviewHash: preview.reviewHash, ownerId: other }))).status).toBe(400);
 });
 it("requires exact plan review and consent, and suppresses repeat paid requests durably", async () => {
  const fields = { sourceIds: [sourceId], provider: "claude", maxCostUsd: 0.25 };
  const preview = await (await POST(request({ action: "analysis-plan", ...fields }))).json();
  expect((await POST(request({ action: "prepare-analysis", ...fields, consent: false, reviewHash: preview.plan.reviewHash }))).status).toBe(400);
  expect((await POST(request({ action: "prepare-analysis", ...fields, consent: true, reviewHash: "a".repeat(64) }))).status).toBe(409);
  state.rpc.mockResolvedValue({ data: { duplicate: true }, error: null });
  const duplicate = await (await POST(request({ action: "prepare-analysis", ...fields, consent: true, reviewHash: preview.plan.reviewHash }))).json();
  expect(duplicate.requests).toEqual([]); expect(duplicate.alreadyProcessed).toBe(true);
  state.tables.marketing_knowledge_sources[0].analysis_key = knowledgeAnalysisKey(base(), "claude-test");
  state.rpc.mockClear();
  const prior = await (await POST(request({ action: "prepare-analysis", ...fields, consent: true, reviewHash: preview.plan.reviewHash }))).json();
  expect(prior.alreadyProcessed).toBe(true); expect(state.rpc).not.toHaveBeenCalled();
 });
 it("bounds streamed request bytes without trusting Content-Length", async () => {
  await expect(readKnowledgeBody(new Request("http://localhost", { method: "POST", body: "abcdef" }), 3)).rejects.toThrow("capture-too-large");
 });
 it("reviews an exact owned item hash and rejects unknown approval fields", async () => {
  const action = { action: "review-item", aiLinkId: sourceId, expectedProcedureHash: "a".repeat(64), status: "reviewed" };
  state.rpc.mockResolvedValue({ data: { aiLinkId: sourceId, procedureHash: action.expectedProcedureHash, status: "reviewed", reviewedAt: new Date().toISOString() }, error: null });
  const result = await POST(request(action)); expect(result.status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith("marketing_review_knowledge_item", { p_owner: owner, p_link: sourceId, p_hash: action.expectedProcedureHash, p_status: "reviewed" });
  expect((await POST(request({ ...action, approveFuturePosts: true }))).status).toBe(400);
  state.rpc.mockResolvedValue({ data: null, error: { message: "knowledge procedure changed" } });
  expect((await POST(request(action))).status).toBe(409);
 });
});
describe("Signed knowledge callback", () => {
 const body = () => ({ eventId: "event-1", sourceId, analysisKey: knowledgeAnalysisKey(base(), "claude-test"), runId: "run-1", datasetId: null,
  status: "RUNNING", capture: null, extraction: null, usage: null });
 it("requires the worker HMAC and an owned queued source", async () => {
  const event = body(); expect((await callbackPOST(signedCallback(event, "wrong".repeat(10)))).status).toBe(401);
  state.tables.marketing_knowledge_sources[0].user_id = other; expect((await callbackPOST(signedCallback(event))).status).toBe(404);
  expect(state.rpc).not.toHaveBeenCalled();
 });
 it("holds stale hashes and unexpected registered runs", async () => {
  state.tables.marketing_knowledge_sources[0] = { ...base(), status: "queued", analysis_key: body().analysisKey, run_id: "expected-run" };
  expect((await callbackPOST(signedCallback(body()))).status).toBe(409);
  expect((await callbackPOST(signedCallback({ ...body(), runId: "expected-run", analysisKey: "a".repeat(64) }))).status).toBe(409);
 });
 it("refuses callback source text and uses server-side registered-run polling", async () => {
  const event = body();
  const source = { ...base(), status: "analyzing", analysis_key: event.analysisKey, run_id: event.runId, dataset_id: "dataset-1",
    analysis_request: { provider: "apify", reviewHash: "a".repeat(64), consentAt: new Date().toISOString(), plan: {}, registration: null } };
  state.tables.marketing_knowledge_sources[0] = source;
  const notified = { ...event, datasetId: "dataset-1", status: "SUCCEEDED" };
  expect((await callbackPOST(signedCallback({ ...notified, capture: { caption: "Forged callback source text", publishedAt: null, transcript: base().content.transcript, ocr: base().content.ocr } }))).status).toBe(400);
  expect(state.poll).not.toHaveBeenCalled();
  const response = await callbackPOST(signedCallback(notified)); expect(response.status).toBe(200);
  expect(state.poll).toHaveBeenCalledWith(owner, sourceId); expect(state.rpc).not.toHaveBeenCalled();
 });
 it("acknowledges completed notifications without resetting or repeating analysis", async () => {
  const event = body(); state.tables.marketing_knowledge_sources[0] = { ...base(), status: "captured", analysis_key: event.analysisKey, run_id: event.runId, dataset_id: "dataset-1",
    analysis_request: { provider: "apify", reviewHash: "a".repeat(64), consentAt: new Date().toISOString(), plan: {}, registration: null } };
  const response = await callbackPOST(signedCallback({ ...event, datasetId: "dataset-1", status: "SUCCEEDED" }));
  expect(response.status).toBe(200); expect((await response.json()).duplicate).toBe(true); expect(state.poll).not.toHaveBeenCalled();
 });
});
