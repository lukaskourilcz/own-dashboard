import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET as registry } from "@/app/api/crons/registry/route";
import { GET as runs } from "@/app/api/crons/runs/route";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ configured: true, user: "11111111-1111-4111-8111-111111111111" as string | null, authError: false, projects: [] as unknown[], projectCount: 0, aliases: [] as unknown[], crons: [] as unknown[], cronCount: 0, runs: [] as unknown[], runCount: 0, fail: "", calls: [] as { table: string; method: string; args: unknown[] }[] }));
function query(table: string) {
  let alias = false;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "limit", "abortSignal", "gte", "order", "contains"]) builder[method] = (...args: unknown[]) => {
    state.calls.push({ table, method, args }); if (method === "contains") alias = true; return builder;
  };
  builder.then = (resolve: (value: unknown) => unknown) => {
    const data = table === "projects" ? alias ? state.aliases : state.projects : table === "crons" ? state.crons : state.runs;
    const count = table === "projects" ? alias ? state.aliases.length : state.projectCount : table === "crons" ? state.cronCount : state.runCount;
    return Promise.resolve({ data, count, error: state.fail === table ? { message: "Synthetic private database detail" } : null }).then(resolve);
  };
  return builder;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { if (!state.configured) throw Error("Synthetic missing configuration"); return { from: query }; } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: query, auth: { getUser: async () => { if (state.authError) throw Error("Synthetic auth failure"); return { data: { user: state.user ? { id: state.user } : null } }; } } }) }));
const owner = "11111111-1111-4111-8111-111111111111";
const project = { id: "22222222-2222-4222-8222-222222222222", user_id: owner, slug: "fixture" };
const cron = { id: "33333333-3333-4333-8333-333333333333", user_id: owner, project_id: project.id, enabled: true, name: "Fixture job", schedule: "0 6 * * *", description: "", endpoint: "/api/fixture", is_ai_call: true, cost_per_run: "0.01", currency: "USD", runs_per_month: 30, last_run_at: null, last_success_at: null, heartbeat_url: "https://monitor.example.test/push/invented-fixture" };
const run = { id: "44444444-4444-4444-8444-444444444444", name: "Fixture run", endpoint: "/api/fixture", status: "success", source: "app", detail: "", fired_at: "2026-10-24T06:00:00+00:00", cron_id: cron.id };
const request = (path = "/api/crons/registry") => new Request(`https://app.example.test${path}`, { headers: { authorization: "Bearer invented-registry-fixture" } });
beforeEach(() => {
  state.configured = true; state.user = owner; state.authError = false; state.projects = [project]; state.projectCount = 1; state.aliases = []; state.crons = [cron]; state.cronCount = 1; state.runs = [run]; state.runCount = 1; state.fail = ""; state.calls = [];
  vi.stubEnv("CRON_REGISTRY_TOKEN", "invented-registry-fixture"); vi.stubEnv("DASHBOARD_OWNER_ID", owner);
});
afterEach(() => vi.unstubAllEnvs());
it("filters both registry reads by owner and exposes monitor presence only", async () => {
  const reply = await registry(request()); const body = await reply.json(); expect(reply.status).toBe(200); expect(body.count).toBe(1); expect(body.crons[0]).toMatchObject({ monitored: true, estimatedMonthlyCost: 0.3 });
  expect(JSON.stringify(body)).not.toContain(cron.heartbeat_url);
  for (const table of ["projects", "crons"]) expect(state.calls).toContainEqual({ table, method: "eq", args: ["user_id", owner] });
  expect(reply.headers.get("cache-control")).toBe("private, no-store");
});
it("owner-scopes the old-slug fallback too", async () => {
  state.projects = []; state.projectCount = 0; state.aliases = [project];
  const reply = await registry(request("/api/crons/registry?project=old-name")); expect(reply.status).toBe(200);
  expect(state.calls.filter(call => call.table === "projects" && call.method === "eq" && call.args[0] === "user_id")).toHaveLength(2);
});
it.each(["projects", "crons"])("does not expose raw %s errors or report an empty registry", async table => {
  state.fail = table; const reply = await registry(request()); expect(reply.status).toBe(503); expect(await reply.text()).not.toContain("private database"); expect(reply.headers.get("cache-control")).toBe("private, no-store");
});
it.each(["missing-service", "missing-owner", "foreign-project", "foreign-cron", "wrong-parent", "partial-projects", "partial-crons"])("fails closed for %s", async failure => {
  if (failure === "missing-service") state.configured = false;
  if (failure === "missing-owner") vi.stubEnv("DASHBOARD_OWNER_ID", "");
  if (failure === "foreign-project") state.projects = [{ ...project, user_id: "foreign" }];
  if (failure === "foreign-cron") state.crons = [{ ...cron, user_id: "foreign" }];
  if (failure === "wrong-parent") state.crons = [{ ...cron, project_id: "foreign" }];
  if (failure === "partial-projects") state.projectCount = 2;
  if (failure === "partial-crons") state.cronCount = 2;
  expect((await registry(request())).status).toBe(503);
});
it("rejects an invalid slug and unauthorized registry calls before database access", async () => {
  expect((await registry(request("/api/crons/registry?project=../bad"))).status).toBe(400); expect(state.calls).toEqual([]);
  const reply = await registry(new Request("https://app.example.test/api/crons/registry")); expect(reply.status).toBe(403); expect(reply.headers.get("cache-control")).toBe("private, no-store"); expect(state.calls).toEqual([]);
});
it("returns a genuinely empty owned registry", async () => {
  state.projects = []; state.projectCount = 0; expect(await (await registry(request())).json()).toEqual({ project: null, count: 0, crons: [] });
});
it.each([["", 14], ["?days=", 14], ["?days=nonsense", 14], ["?days=2.9", 2], ["?days=0", 1], ["?days=99", 14]])("history %s uses %s days and stable ordering", async (suffix, days) => {
  const reply = await runs(request(`/api/crons/runs${suffix}`)); expect(reply.status).toBe(200); expect(await reply.json()).toMatchObject({ days, partial: false, runs: [run] });
  const since = state.calls.find(call => call.method === "gte")!.args[1] as string; expect(Math.abs(Date.now() - Date.parse(since) - days * 86400000)).toBeLessThan(2000);
  expect(state.calls).toContainEqual({ table: "cron_runs", method: "eq", args: ["user_id", owner] }); expect(state.calls.filter(call => call.method === "order")).toHaveLength(2);
});
it("marks the latest 1,000 runs as partial rather than claiming a complete fortnight", async () => {
  state.runs = Array.from({ length: 1000 }, (_, i) => ({ ...run, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` })); state.runCount = 1005;
  expect(await (await runs(request("/api/crons/runs"))).json()).toMatchObject({ partial: true });
});
it.each(["failed-read", "truncated-before-bound", "invalid-status", "invalid-date", "auth-failure", "absent-user"])("history handles %s without rendering malformed data", async failure => {
  if (failure === "failed-read") state.fail = "cron_runs";
  if (failure === "truncated-before-bound") state.runCount = 2;
  if (failure === "invalid-status") state.runs = [{ ...run, status: "unknown" }];
  if (failure === "invalid-date") state.runs = [{ ...run, fired_at: "bad date" }];
  if (failure === "auth-failure") state.authError = true;
  if (failure === "absent-user") state.user = null;
  const reply = await runs(request("/api/crons/runs")); expect(reply.status).toBe(failure === "absent-user" ? 401 : 503); expect(reply.headers.get("cache-control")).toBe("private, no-store");
});
