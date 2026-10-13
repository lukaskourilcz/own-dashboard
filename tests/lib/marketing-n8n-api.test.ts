import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sourceFixture from "../../templates/marketing/benchmarks/devshark-question.json";
import templateFixture from "../../templates/marketing/devshark/template.json";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), sync: vi.fn(), enqueueCalendar: vi.fn(), execute: vi.fn(), publish: vi.fn(), reconcile: vi.fn(), enqueue: vi.fn(), read: vi.fn(), run: vi.fn(), poll: vi.fn(), abort: vi.fn(), diagnostics: vi.fn(), ingest: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin() }));
vi.mock("@/lib/marketing/orchestrator", () => ({ synchronizeMarketingSources: (...args: unknown[]) => mocks.sync(...args), enqueueCalendarMarketingJob: (...args: unknown[]) => mocks.enqueueCalendar(...args), executeOrchestratedMarketingJob: (...args: unknown[]) => mocks.execute(...args), publishDueMarketing: (...args: unknown[]) => mocks.publish(...args), reconcileStoredMarketingPublication: (...args: unknown[]) => mocks.reconcile(...args) }));
vi.mock("@/lib/marketing/worker-runtime", () => ({ enqueueMarketingJob: (...args: unknown[]) => mocks.enqueue(...args), readMarketingJob: (...args: unknown[]) => mocks.read(...args) }));
vi.mock("@/lib/marketing/knowledge-runner", () => ({ runQueuedKnowledgeAnalysis: (...args: unknown[]) => mocks.run(...args), pollQueuedKnowledgeAnalysis: (...args: unknown[]) => mocks.poll(...args), abortQueuedKnowledgeAnalysis: (...args: unknown[]) => mocks.abort(...args), createKnowledgeDiagnostics: () => mocks.diagnostics() }));
vi.mock("@/lib/marketing/store", () => ({ ingestSource: (...args: unknown[]) => mocks.ingest(...args) }));
vi.mock("@/lib/marketing/source-refresh", () => ({ refreshSource: (...args: unknown[]) => mocks.refresh(...args) }));
import { POST } from "@/app/api/marketing/n8n/route";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const secret = "test-only-n8n-secret-".repeat(3);
type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]> = {}) {
  const queries: Array<{ table: string; filters: Array<[string, unknown]>; limit: number | null; order: string | null }> = [];
  const db = { from(table: string) {
    const trace = { table, filters: [] as Array<[string, unknown]>, limit: null as number | null, order: null as string | null }; queries.push(trace);
    const conditions: Array<(row: Row) => boolean> = [];
    const query = { select: () => query,
      eq: (key: string, value: unknown) => { trace.filters.push([key, value]); conditions.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { trace.filters.push([key, values]); conditions.push((row) => values.includes(row[key])); return query; },
      order: (key: string) => { trace.order = key; return query; },
      limit: (count: number) => { trace.limit = count; return query; },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
        const rows = (tables[table] ?? []).filter((row) => conditions.every((condition) => condition(row)));
        return Promise.resolve({ data: rows.slice(0, trace.limit ?? rows.length), error: null }).then(resolve);
      },
    }; return query;
  } };
  return { db, queries };
}
function request(body: unknown, authorization: string | null = `Bearer ${secret}`) {
  return new Request("http://localhost/api/marketing/n8n", { method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) });
}
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.admin.mockReturnValue(database().db);
  mocks.publish.mockResolvedValue({ outcomes: [] }); mocks.run.mockResolvedValue({ status: "captured" }); mocks.poll.mockResolvedValue({ status: "analyzing" }); mocks.abort.mockResolvedValue({ status: "aborted" });
  mocks.diagnostics.mockResolvedValue(vi.fn()); mocks.execute.mockResolvedValue({ status: "review" }); mocks.read.mockResolvedValue({ status: "review" });
  mocks.sync.mockResolvedValue({ packets: [], held: [], nextCursor: "test-cursor", observedAt: "2026-10-13T12:00:00Z", noEditionDates: [], dropped: 0 });
  vi.stubEnv("MARKETING_OWNER_ID", owner); vi.stubEnv("MARKETING_N8N_SECRET", secret);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("authenticated n8n marketing operation boundary", () => {
  function rawJob(source = sourceFixture) {
    return { schemaVersion: "marketing-job/1", idempotencyKey: sourceId, generation: {
      source, account: { id: "test-account", platform: "instagram", handle: "test-only" },
      scheduledAt: "2026-10-18T08:00:00Z", templateVersion: templateFixture.version,
      knowledge: [], consent: true, revisionId: sourceId,
    }, template: templateFixture };
  }
  it("refreshes explicit jobs before storing any source and forwards the authoritative held packet", async () => {
    // This fixture intentionally remains ineligible; the mocked queue does not prove eligibility.
    const current = { ...sourceFixture, observedAt: "2026-10-13T12:00:00Z" };
    mocks.refresh.mockResolvedValue(current); mocks.enqueue.mockResolvedValue({ status: "held" });
    const response = await POST(request({ operation: "enqueue", brand: "devshark", job: rawJob() }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "held" });
    expect(mocks.refresh).toHaveBeenCalledWith(sourceFixture, expect.any(AbortSignal));
    expect(mocks.ingest).toHaveBeenCalledWith(expect.anything(), owner, current, "devshark");
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), owner, rawJob(current));
    expect(current.eligible).toBe(false);
  });
  it.each(["canonicalUrl", "sourceRevision", "contentHash"] as const)("holds a changed explicit source %s before ingestion or enqueue", async (field) => {
    const changed = { ...sourceFixture, [field]: field === "canonicalUrl" ? "https://devshark.app/forged" : "a".repeat(64) };
    mocks.refresh.mockResolvedValue(sourceFixture);
    const response = await POST(request({ operation: "enqueue", brand: "devshark", job: rawJob(changed) }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "source-superseded" });
    expect(mocks.ingest).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("rejects an invalid brand locale before producer refresh or privileged writes", async () => {
    const response = await POST(request({ operation: "enqueue", brand: "devshark", job: rawJob({ ...sourceFixture, locale: "cs" }) }));
    expect(response.status).toBe(409);
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.ingest).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("holds inconsistent producer content before ingestion despite an unchanged declared hash", async () => {
    mocks.refresh.mockResolvedValue({ ...sourceFixture, content: { ...sourceFixture.content, answer: "16" } });
    const response = await POST(request({ operation: "enqueue", brand: "devshark", job: rawJob() }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "source-superseded" });
    expect(mocks.ingest).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it.each([null, "Bearer wrong-token", `Bearer ${secret}extra`])("rejects a missing or invalid token before privileged work: %s", async (authorization) => {
    const response = await POST(request({ operation: "knowledge-run", sourceId }, authorization));
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "unauthorized" });
    Object.values(mocks).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
  it("requires a configured fixed owner and a sufficiently long secret", async () => {
    vi.stubEnv("MARKETING_OWNER_ID", "invalid-owner"); expect((await POST(request({ operation: "publish", brand: "devshark" }))).status).toBe(401);
    vi.stubEnv("MARKETING_OWNER_ID", owner); vi.stubEnv("MARKETING_N8N_SECRET", "short");
    expect((await POST(request({ operation: "publish", brand: "devshark" }, "Bearer short"))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each([
    { operation: "knowledge-run", sourceId, ownerId: other },
    { operation: "knowledge-run", sourceId, consent: true, provider: "claude" },
    { operation: "knowledge-poll", sourceId: "not-a-uuid" },
    { operation: "knowledge-arbitrary", sourceId },
    { operation: "publish", brand: "devshark", ownerId: other },
  ])("rejects unknown operation fields and caller-supplied consent/owners: %j", async (body) => {
    const response = await POST(request(body)); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid-request" });
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("lists only the configured owner's queued/analyzing knowledge sources with a bounded result", async () => {
    const state = database({ marketing_knowledge_sources: [
      { id: sourceId, user_id: owner, status: "queued" }, { id: "own-analyzing-test", user_id: owner, status: "analyzing" },
      { id: "own-completed-test", user_id: owner, status: "captured" }, { id: "foreign-source-test", user_id: other, status: "queued" },
    ] }); mocks.admin.mockReturnValue(state.db);
    const response = await POST(request({ operation: "knowledge-queue" }));
    expect(response.status).toBe(200); expect((await response.json()).sources.map((row: Row) => row.id)).toEqual([sourceId, "own-analyzing-test"]);
    expect(state.queries).toEqual([{ table: "marketing_knowledge_sources", filters: [["user_id", owner], ["status", ["queued", "analyzing"]]], order: "updated_at", limit: 5 }]);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.poll).not.toHaveBeenCalled();
  });
  it.each(["knowledge-run", "knowledge-poll", "knowledge-abort"] as const)("dispatches %s to its exact owner-scoped runner without entering reconciliation", async (operation) => {
    const response = await POST(request({ operation, sourceId })); expect(response.status).toBe(200);
    if (operation === "knowledge-run") expect(mocks.run).toHaveBeenCalledWith(owner, sourceId, { diagnostics: expect.any(Function) });
    else expect(operation === "knowledge-poll" ? mocks.poll : mocks.abort).toHaveBeenCalledWith(owner, sourceId);
    expect(mocks.reconcile).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
    const calls = [mocks.run, mocks.poll, mocks.abort].map((mock) => mock.mock.calls.length); expect(calls.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(mocks.diagnostics.mock.calls.length).toBe(operation === "knowledge-run" ? 1 : 0);
  });
  it("holds missing reviewed knowledge consent and redacts arbitrary provider error details", async () => {
    mocks.run.mockRejectedValueOnce(new Error("knowledge-reviewed-consent-required"));
    let response = await POST(request({ operation: "knowledge-run", sourceId }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "knowledge-reviewed-consent-required" });
    mocks.run.mockRejectedValueOnce(new Error("private raw provider payload TEST SECRET"));
    response = await POST(request({ operation: "knowledge-run", sourceId }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "marketing-operation-held" });
    mocks.refresh.mockResolvedValue(sourceFixture);
    mocks.enqueue.mockRejectedValueOnce(new Error("knowledge-reference-unavailable"));
    response = await POST(request({ operation: "enqueue", brand: "devshark", job: rawJob() }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "knowledge-reference-unavailable" });
  });
  it("defaults publishing to dry-run and forwards an explicit live flag only for the authenticated owner", async () => {
    expect((await POST(request({ operation: "publish", brand: "devshark" }))).status).toBe(200);
    expect(mocks.publish).toHaveBeenLastCalledWith(expect.anything(), owner, "devshark", true, expect.any(AbortSignal),undefined);
    expect((await POST(request({ operation: "publish", brand: "dneskai", dryRun: false }))).status).toBe(200);
    expect(mocks.publish).toHaveBeenLastCalledWith(expect.anything(), owner, "dneskai", false, expect.any(AbortSignal),undefined);
  });
  it("forwards bounded discovery parameters and returns only released planned slots in active owned campaigns", async () => {
    const state = database({ marketing_campaigns: [{ id: "own-campaign", user_id: owner, brand: "devshark", status: "active" }, { id: "foreign-campaign", user_id: other, brand: "devshark", status: "active" }], marketing_calendar_entries: [
      { id: "owned-slot", user_id: owner, campaign_id: "own-campaign", date: "2026-10-15", kind: "carousel", platform: "instagram", status: "planned", needs_review: false },
      { id: "held-slot", user_id: owner, campaign_id: "own-campaign", date: "2026-10-15", kind: "carousel", platform: "instagram", status: "planned", needs_review: true },
      { id: "foreign-slot", user_id: other, campaign_id: "foreign-campaign", date: "2026-10-15", kind: "carousel", platform: "instagram", status: "planned", needs_review: false },
    ] }); mocks.admin.mockReturnValue(state.db);
    const response = await POST(request({ operation: "discover", brand: "devshark", date: "2026-10-15", cursor: "test-cursor" }));
    expect(response.status).toBe(200); expect((await response.json()).entries.map((row: Row) => row.id)).toEqual(["owned-slot"]);
    expect(mocks.sync).toHaveBeenCalledWith(state.db, owner, "devshark", undefined, "test-cursor", expect.any(AbortSignal));
    expect(state.queries[1].limit).toBe(8);
  });
  it("routes job execution/status by fixed owner and never invokes a paid knowledge runner", async () => {
    await POST(request({ operation: "execute", jobId: sourceId })); await POST(request({ operation: "status", jobId: sourceId }));
    expect(mocks.execute).toHaveBeenCalledWith(expect.anything(), owner, sourceId); expect(mocks.read).toHaveBeenCalledWith(expect.anything(), owner, sourceId);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
});
