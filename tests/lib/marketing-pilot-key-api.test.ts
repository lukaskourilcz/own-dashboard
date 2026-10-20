import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), operation: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/marketing/orchestrator", () => ({
  synchronizeMarketingSources: mocks.operation, enqueueCalendarMarketingJob: mocks.operation,
  executeOrchestratedMarketingJob: mocks.operation, publishDueMarketing: mocks.operation,
  reconcileStoredMarketingPublication: mocks.operation,
}));
vi.mock("@/lib/marketing/worker-runtime", () => ({ enqueueMarketingJob: mocks.operation, readMarketingJob: mocks.operation }));
vi.mock("@/lib/marketing/knowledge-runner", () => ({
  runQueuedKnowledgeAnalysis: mocks.operation, pollQueuedKnowledgeAnalysis: mocks.operation,
  abortQueuedKnowledgeAnalysis: mocks.operation, createKnowledgeDiagnostics: mocks.operation,
}));
vi.mock("@/lib/marketing/source-refresh", () => ({ refreshSource: mocks.operation }));
vi.mock("@/lib/marketing/store", () => ({ ingestSource: mocks.operation }));
import { POST } from "@/app/api/marketing/n8n/route";

const owner = "11111111-1111-4111-8111-111111111111";
const secret = "test-only-n8n-pilot-key-".repeat(2);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T09:10:00Z"));
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("MARKETING_OWNER_ID", owner); vi.stubEnv("MARKETING_N8N_SECRET", secret);
  vi.stubEnv("MARKETING_PILOT_OWNER_ID", owner);
  vi.stubEnv("MARKETING_PILOT_STARTS_AT", "2026-10-13T09:11:07Z");
  vi.stubEnv("MARKETING_PILOT_EXPIRES_AT", "2026-10-15T09:10:00Z");
  mocks.admin.mockReset(); mocks.operation.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("expired pilot closes every n8n operation before database or provider access", () => {
  it.each([
    { operation: "status", jobId: owner },
    { operation: "knowledge-queue" },
    { operation: "knowledge-run", sourceId: owner },
    { operation: "knowledge-poll", sourceId: owner },
    { operation: "publication-plan", brand: "devshark" },
    { operation: "publish", brand: "devshark", dryRun: true },
    { operation: "reconcile", publicationId: owner },
    { operation: "discover", brand: "devshark" },
  ])("rejects $operation despite a correct key and existing deployment cookie", async (body) => {
    const response = await POST(new Request("https://preview.example.test/api/marketing/n8n", {
      method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Cookie: "deployment=test-only; sb-test-auth-token=test-only-existing-session" },
      body: JSON.stringify(body),
    }));
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.operation).not.toHaveBeenCalled();
  });
  it.each(["production", "development"])("ignores the same retired tuple in %s and reaches the ordinary operation", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment); mocks.operation.mockResolvedValue({ jobId: owner, status: "review" });
    const response = await POST(new Request("https://own.example.test/api/marketing/n8n", {
      method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "status", jobId: owner }),
    }));
    expect(response.status).toBe(200); expect(mocks.admin).toHaveBeenCalledTimes(1); expect(mocks.operation).toHaveBeenCalledTimes(1);
    const wrong = await POST(new Request("https://own.example.test/api/marketing/n8n", { method: "POST", headers: { Authorization: "Bearer wrong-test-only-key" }, body: JSON.stringify({ operation: "status", jobId: owner }) }));
    expect(wrong.status).toBe(401);
  });
});
