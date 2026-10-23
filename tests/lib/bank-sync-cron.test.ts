import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ allowed: true, configured: true, expiryError: false, readError: false, count: 1,
  rows: [{ id: "connection", user_id: "owner", provider: "gocardless" }], sync: vi.fn(), log: vi.fn(), ping: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/cron-auth", () => ({ rejectUnlessCron: () => state.allowed ? null : new Response(null, { status: 403 }) }));
vi.mock("@/lib/cron-log", () => ({ logCronRun: state.log }));
vi.mock("@/lib/heartbeat", () => ({ heartbeatUrlForJob: () => null, pingHeartbeat: state.ping }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
vi.mock("@/lib/bank/registry", () => ({ getProvider: () => ({ isConfigured: async () => state.configured }) }));
vi.mock("@/lib/bank-sync-server", () => ({ syncConnection: state.sync }));
import { GET } from "@/app/api/cron/bank-sync/route";
const request = () => new Request("https://app.example/api/cron/bank-sync");
beforeEach(() => {
  state.allowed = true; state.configured = true; state.expiryError = false; state.readError = false; state.count = 1;
  state.sync.mockReset().mockResolvedValue({ status: "linked", inserted: 2 }); state.log.mockReset(); state.ping.mockReset();
  state.from.mockReset().mockImplementation(() => {
    let writing = false;
    const query = { update: () => { writing = true; return query; }, eq: () => query, not: () => query, lt: () => query,
      select: () => writing ? Promise.resolve({ count: 0, error: state.expiryError ? {} : null }) : query,
      limit: async () => ({ data: state.rows, count: state.count, error: state.readError ? {} : null }),
    }; return query;
  });
});
it("retains cron authorization and refuses incomplete metadata reads", async () => {
  state.allowed = false; expect((await GET(request())).status).toBe(403); expect(state.from).not.toHaveBeenCalled();
  state.allowed = true; state.expiryError = true; expect((await GET(request())).status).toBe(500);
  state.expiryError = false; state.count = 2; expect((await GET(request())).status).toBe(500);
  state.count = 1; state.readError = true; expect((await GET(request())).status).toBe(500);
  expect(state.sync).not.toHaveBeenCalled(); expect(state.ping).not.toHaveBeenCalled();
});
it.each(["consent", "throw"])("marks %s failure in the response and log, without a success heartbeat", async failure => {
  if (failure === "consent") state.sync.mockResolvedValue({ status: "error", inserted: 0 });
  else state.sync.mockRejectedValue(new Error("Synthetic private upstream detail"));
  const response = await GET(request()); expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ ok: false, failed: 1 });
  expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ status: "failure" })); expect(state.ping).not.toHaveBeenCalled();
  expect(JSON.stringify(state.log.mock.calls)).not.toContain("private");
});
it("confirms successful pulls and preserves the configured-provider skip boundary", async () => {
  const response = await GET(request()); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, banks: 1, inserted: 2, failed: 0 }); expect(state.ping).toHaveBeenCalledOnce();
  state.configured = false; state.sync.mockClear(); state.ping.mockClear();
  expect(await (await GET(request())).json()).toMatchObject({ ok: true, skipped: 1, banks: 0 }); expect(state.sync).not.toHaveBeenCalled();
});
