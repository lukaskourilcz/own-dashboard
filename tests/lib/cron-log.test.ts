import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { logCronRun } from "@/lib/cron-log";
vi.mock("server-only", () => ({}));
const owner = "11111111-1111-4111-8111-111111111111", cronId = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({ mode: "", ping: vi.fn(), writes: [] as { table: string; payload: Record<string, unknown> }[], filters: [] as [string, unknown][] }));
vi.mock("@/lib/heartbeat", () => ({ pingHeartbeat: (...args: unknown[]) => state.ping(...args) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  if (state.mode === "missing-service") throw Error("Synthetic unavailable service");
  return { from: (table: string) => {
    let payload: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "limit", "eq", "abortSignal", "maybeSingle", "single", "insert", "update"]) builder[method] = (...args: unknown[]) => {
      if (method === "eq") state.filters.push(args as [string, unknown]);
      if (method === "insert" || method === "update") { payload = args[0] as Record<string, unknown>; state.writes.push({ table, payload }); }
      return builder;
    };
    builder.then = (resolve: (value: unknown) => unknown) => {
      if (!payload) {
        if (state.mode === "stall-lookup") return new Promise(() => {});
        return Promise.resolve({ data: state.mode === "missing-cron" ? null : { id: cronId, user_id: state.mode === "foreign-cron" ? "33333333-3333-4333-8333-333333333333" : owner, heartbeat_url: "https://monitor.example.test/push/synthetic", updated_at: "2026-10-24T07:00:00Z" }, error: state.mode === "lookup-error" ? {} : null }).then(resolve);
      }
      if (table === "cron_runs") return Promise.resolve({ data: state.mode === "suppressed-insert" ? null : { ...payload, ...(state.mode === "altered-insert" ? { status: "failure" } : {}) }, error: state.mode === "insert-error" ? {} : null }).then(resolve);
      if (state.mode === "stall-stamp") return new Promise(() => {});
      return Promise.resolve({ data: state.mode === "suppressed-stamp" ? null : { ...payload, id: cronId, user_id: owner, heartbeat_url: state.mode === "changed-monitor" ? "https://other.example.test/push/synthetic" : "https://monitor.example.test/push/synthetic", ...(state.mode === "altered-stamp" ? { last_success_at: "2026-10-23T00:00:00Z" } : {}) }, error: state.mode === "stamp-error" ? {} : null }).then(resolve);
    };
    return builder;
  } };
} }));
beforeEach(() => { state.mode = ""; state.ping.mockReset(); state.ping.mockResolvedValue(true); state.writes = []; state.filters = []; vi.stubEnv("DASHBOARD_OWNER_ID", owner); });
afterEach(() => vi.unstubAllEnvs());
it("confirms the exact run and unchanged owning cron before pinging", async () => {
  expect(await logCronRun({ name: "Synthetic job", endpoint: "/api/synthetic", cronId, status: "success" })).toEqual({ recorded: true, successStamped: true });
  expect(state.writes).toHaveLength(2); expect(state.writes[0].payload).toMatchObject({ user_id: owner, cron_id: cronId, source: "app" }); expect(state.ping).toHaveBeenCalledOnce();
  expect(state.filters.filter(([key, value]) => key === "user_id" && value === owner)).toHaveLength(2); expect(state.filters).toContainEqual(["updated_at", "2026-10-24T07:00:00Z"]);
  expect(state.filters.some(([, value]) => String(value).includes("/push/"))).toBe(false);
});
it.each(["missing-service", "lookup-error", "foreign-cron", "missing-cron", "insert-error", "suppressed-insert", "altered-insert"])("never stamps or pings an unconfirmed %s run", async mode => {
  state.mode = mode; expect(await logCronRun({ name: "Synthetic job", cronId })).toEqual({ recorded: false, successStamped: false });
  expect(state.writes.filter(write => write.table === "crons")).toHaveLength(0); expect(state.ping).not.toHaveBeenCalled();
});
it.each(["stamp-error", "suppressed-stamp", "altered-stamp", "changed-monitor"])("separates a recorded run from an unconfirmed %s success stamp", async mode => {
  state.mode = mode; expect(await logCronRun({ name: "Synthetic job", cronId })).toEqual({ recorded: true, successStamped: false }); expect(state.ping).not.toHaveBeenCalled();
});
it.each(["failure", "running"] as const)("records %s without advancing success or pinging", async status => {
  expect(await logCronRun({ name: "Synthetic job", cronId, status })).toEqual({ recorded: true, successStamped: false }); expect(state.writes).toHaveLength(1); expect(state.ping).not.toHaveBeenCalled();
});
it("records an unlinked run without guessing a monitor", async () => {
  state.mode = "missing-cron"; expect(await logCronRun({ name: "Synthetic job", endpoint: "/api/unregistered" })).toEqual({ recorded: true, successStamped: false }); expect(state.writes[0].payload.cron_id).toBeNull(); expect(state.ping).not.toHaveBeenCalled();
});
it("refuses invalid metadata/owner before a write", async () => {
  expect(await logCronRun({ name: " ", cronId })).toMatchObject({ recorded: false }); vi.stubEnv("DASHBOARD_OWNER_ID", "not-an-owner"); expect(await logCronRun({ name: "Synthetic job" })).toMatchObject({ recorded: false }); expect(state.writes).toHaveLength(0);
});
it.each(["stall-lookup", "stall-stamp"])("settles %s on caller cancellation and never pings", async mode => {
  state.mode = mode; const controller = new AbortController(); const pending = logCronRun({ name: "Synthetic job", cronId }, controller.signal);
  if (mode === "stall-stamp") await vi.waitFor(() => expect(state.writes).toHaveLength(2)); controller.abort();
  expect(await pending).toEqual({ recorded: mode === "stall-stamp", successStamped: false }); expect(state.ping).not.toHaveBeenCalled();
});
