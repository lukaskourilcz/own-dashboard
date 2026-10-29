import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/crons/log/route";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ log: vi.fn(), limited: false }));
vi.mock("@/lib/cron-log", () => ({ logCronRun: (...args: unknown[]) => state.log(...args) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: !state.limited, retryAfter: 12 }) }));
const request = (body: unknown) => new Request("https://app.example.test/api/crons/log", { method: "POST", headers: { authorization: "Bearer synthetic-registry-fixture" }, body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv("CRON_REGISTRY_TOKEN", "synthetic-registry-fixture"); vi.stubEnv("DASHBOARD_OWNER_ID", "11111111-1111-4111-8111-111111111111"); state.log.mockReset(); state.log.mockResolvedValue({ recorded: true, successStamped: false }); state.limited = false; });
afterEach(() => vi.unstubAllEnvs());
it.each([null, [], "text", {}, { name: "Synthetic", status: "succes" }, { name: "Synthetic" }, { name: "Synthetic", status: "success", source: "unknown" }, { name: "Synthetic", status: "success", cron_id: "not-a-uuid" }])("rejects invalid reports without inventing a successful run", async body => {
  const reply = await POST(request(body)); expect(reply.status).toBe(400); expect(state.log).not.toHaveBeenCalled(); expect(reply.headers.get("cache-control")).toBe("private, no-store");
});
it("bounds oversized body downloads", async () => { expect((await POST(request({ name: "x".repeat(17000), status: "success" }))).status).toBe(413); expect(state.log).not.toHaveBeenCalled(); });
it("reports a saved run separately from its monitoring stamp", async () => {
  const reply = await POST(request({ name: " Synthetic ", status: "failure" })); expect(reply.status).toBe(200); expect(await reply.json()).toEqual({ ok: true, successStamped: false });
  expect(state.log).toHaveBeenCalledWith({ name: "Synthetic", status: "failure", source: "github_actions", cronId: null, endpoint: "", detail: "" }, expect.any(AbortSignal));
});
it("does not acknowledge a lost or suppressed insert", async () => { state.log.mockResolvedValue({ recorded: false, successStamped: false }); expect((await POST(request({ name: "Synthetic", status: "success" }))).status).toBe(503); });
it("rate limits authenticated reports before reading/writing them", async () => { state.limited = true; const reply = await POST(request({ name: "Synthetic", status: "success" })); expect(reply.status).toBe(429); expect(reply.headers.get("retry-after")).toBe("12"); expect(state.log).not.toHaveBeenCalled(); });
