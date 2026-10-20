import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { enqueueMarketingJob, executeMarketingJob } from "@/lib/marketing/worker-runtime";
import { currentMarketingTemplate, type MarketingTemplate } from "@/lib/marketing/render";
import { contentHash, revisionHash } from "@/lib/marketing/hashes";
import { parseSourcePacket } from "@/lib/marketing/contracts";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { MarketingWorkerRequest, MarketingWorkerResult } from "../../services/marketing-worker/protocol";
import question from "../../templates/marketing/benchmarks/devshark-question.json";
import design from "../../templates/marketing/devshark/derived-layout.json";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const owner = "11111111-1111-4111-8111-111111111111";
const start = new Date("2026-10-13T10:00:00.000Z");
// The pilot tuple is read only on Vercel Preview (#113).
const env = { VERCEL_ENV: "preview", MARKETING_AI_CONSENT: "true", ANTHROPIC_API_KEY: "TEST-ONLY-NO-REAL-PROVIDER", MARKETING_CLAUDE_MODEL: "claude-sonnet-4-6",
  MARKETING_CLAUDE_INPUT_USD_PER_MTOK: "3", MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK: "15",
  MARKETING_PILOT_OWNER_ID: owner, MARKETING_PILOT_STARTS_AT: start.toISOString(), MARKETING_PILOT_EXPIRES_AT: "2026-10-15T10:00:00.000Z" };
const pilot = { ownerId: owner, startsAt: env.MARKETING_PILOT_STARTS_AT, expiresAt: env.MARKETING_PILOT_EXPIRES_AT };
function request(): MarketingWorkerRequest {
  // These are labelled local simulations only; retained source and templates stay held.
  const source = { ...structuredClone(question), eligible: true, eligibilityReason: "OFFLINE PILOT GUARD TEST ONLY", observedAt: new Date().toISOString() };
  const original = currentMarketingTemplate("devshark");
  const template: MarketingTemplate = { ...original, approved: true, approval: { approvedBy: owner, approvedAt: new Date().toISOString(), templateSha256: original.templateSha256, designExportSha256: design.archiveSha256 } };
  const id = randomUUID();
  return { schemaVersion: "marketing-job/1", idempotencyKey: id, template, generation: { revisionId: id, consent: true, source,
    account: { id: "TEST-ONLY-REMOTE", handle: "test-only", platform: "threads" }, knowledge: [], templateVersion: template.version, scheduledAt: new Date(Date.now() + 3600000).toISOString() } };
}
function setup() {
  const input = request(), jobId = randomUUID();
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }; query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { id: "test-only", verified_at: new Date().toISOString(), enabled: false }, error: null });
  const rpc = vi.fn(async (name: string, values: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => {
    void values;
    return { data: name === "marketing_claim_job" ? input : name === "marketing_enqueue_job" ? { jobId, status: "queued", duplicate: false } : name === "marketing_check_pilot_attempt" ? true : "failed", error: null };
  });
  const db = { from: vi.fn(() => query), rpc } as unknown as ReturnType<typeof createAdminClient>;
  const model = { model: "claude-sonnet-4-6", pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 }, invoke: vi.fn(async () => ({ copy: {}, usage: { inputTokens: 100, outputTokens: 100 } })) };
  const invoke = { system: "test-only", prompt: "test-only", maxOutputTokens: 2500, signal: AbortSignal.timeout(10000) };
  const source = parseSourcePacket(input.generation.source);
  const revision = { schemaVersion: "marketing-content/1" as const, brand: "devshark" as const, title: "Offline simulation", caption: "Offline simulation", format: "thread" as const,
    sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: contentHash(source.content) }],
    account: input.generation.account, assets: [], knowledgeIds: [], scheduledAt: input.generation.scheduledAt, timeZone: "Europe/Prague" as const, templateVersion: input.template.version,
    promptVersion: "marketing-copy/3", model: model.model, traceId: null };
  const result: MarketingWorkerResult = { revision, slides: [], traceId: null, revisionHash: revisionHash(revision), usage: { attempts: 1, inputTokens: 100, outputTokens: 100, estimatedCostUsd: 0.0018 } };
  return { input, jobId, db, rpc, model, invoke, result };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(start.getTime() + 1000)); });
afterEach(() => { vi.useRealTimers(); });
describe("pilot guard in the actual worker admission and invocation path; no network", () => {
  it("sends the immutable pilot tuple to atomic admission but still refuses authentic pending templates", async () => {
    const { input, db, rpc } = setup();
    await enqueueMarketingJob(db, owner, input, { env, resolveTemplate: async () => input.template });
    expect(rpc).toHaveBeenCalledWith("marketing_enqueue_job", expect.objectContaining({ p_owner: owner, p_pilot: pilot }));
    rpc.mockClear(); const pending = currentMarketingTemplate("devshark");
    await expect(enqueueMarketingJob(db, owner, { ...input, template: pending }, { env })).rejects.toThrow("claude-design-approval-required");
    expect(rpc).not.toHaveBeenCalled(); expect(question.eligible).toBe(false); expect(pending.approved).toBe(false);
  });
  it("rejects malformed or expired configuration before claiming a job or calling a model", async () => {
    const { db, jobId, rpc, model } = setup();
    for (const values of [{ ...env, MARKETING_PILOT_EXPIRES_AT: undefined }, { ...env, MARKETING_PILOT_OWNER_ID: randomUUID() }, { ...env, MARKETING_PILOT_EXPIRES_AT: start.toISOString() }])
      await expect(executeMarketingJob(db, owner, jobId, { env: values, model, refreshSource: vi.fn() })).rejects.toThrow(/pilot-/);
    expect(rpc).not.toHaveBeenCalled(); expect(model.invoke).not.toHaveBeenCalled();
  });
  it("rechecks durable admission on every attempted model call, including a validation retry", async () => {
    const { input, db, jobId, rpc, model, invoke, result } = setup();
    rpc.mockImplementation(async (name: string) => ({ data: name === "marketing_claim_job" ? input : name === "marketing_check_pilot_attempt" ? true : "review", error: null }));
    const run = vi.fn(async (_input, deps) => { expect(deps.budget.maxCostUsd).toBe(0.25); await deps.model.invoke(invoke); await deps.model.invoke(invoke); return result; });
    await executeMarketingJob(db, owner, jobId, { env, model, run, refreshSource: vi.fn(), storage: { put: vi.fn() } });
    expect(model.invoke).toHaveBeenCalledTimes(2);
    const claim = rpc.mock.calls.find(([name]) => name === "marketing_claim_job");
    expect(claim).toEqual(["marketing_claim_job", expect.objectContaining({ p_owner: owner, p_job: jobId, p_pilot: pilot })]);
    expect(rpc.mock.calls.filter(([name]) => name === "marketing_check_pilot_attempt")).toHaveLength(2);
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(model.invoke.mock.invocationCallOrder[0]);
  });
  it("holds RPC denial/outage before the paid call and records only a bounded error without refunding", async () => {
    for (const failure of [{ data: false, error: null }, { data: null, error: { message: "secret-test-database-exception" } }]) {
      const { db, jobId, rpc, model, invoke } = setup();
      rpc.mockImplementation(async (name: string) => name === "marketing_claim_job" ? { data: request(), error: null } : name === "marketing_check_pilot_attempt" ? failure : { data: "failed", error: null });
      const run = vi.fn(async (_input, deps) => { await deps.model.invoke(invoke); throw new Error("unreachable"); });
      expect(await executeMarketingJob(db, owner, jobId, { env, model, run, refreshSource: vi.fn(), storage: { put: vi.fn() } })).toEqual({ claimed: true, status: "failed", errorCode: "pilot-admission-unavailable" });
      expect(model.invoke).not.toHaveBeenCalled(); expect(rpc.mock.calls.map(([name]) => name)).toEqual(["marketing_claim_job", "marketing_check_pilot_attempt", "marketing_finish_job"]);
      expect(JSON.stringify(rpc.mock.calls)).not.toContain("secret-test-database-exception");
    }
  });
  it("stops a second attempt after wall-clock expiry without another database or model call", async () => {
    const { db, jobId, rpc, model, invoke } = setup();
    const run = vi.fn(async (_input, deps) => {
      await deps.model.invoke(invoke); vi.setSystemTime(new Date(env.MARKETING_PILOT_EXPIRES_AT)); await deps.model.invoke(invoke); throw new Error("unreachable");
    });
    expect((await executeMarketingJob(db, owner, jobId, { env, model, run, refreshSource: vi.fn(), storage: { put: vi.fn() } })).status).toBe("failed");
    expect(model.invoke).toHaveBeenCalledTimes(1); expect(rpc.mock.calls.filter(([name]) => name === "marketing_check_pilot_attempt")).toHaveLength(1);
  });
});
