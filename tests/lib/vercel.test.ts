import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const owner = "11111111-1111-4111-8111-111111111111";
const project = { id: "prj_test", name: "repo", link: { type: "github", org: "owner", repo: "repo", repoId: 1 } };
let getProjectTraffic: typeof import("@/lib/vercel").getProjectTraffic;
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv("VERCEL_API_TOKEN", "TEST_ONLY_SYNTHETIC_TOKEN"); vi.stubEnv("VERCEL_TEAM_ID", "team_test"); vi.stubEnv("DASHBOARD_OWNER_ID", owner);
  ({ getProjectTraffic } = await import("@/lib/vercel"));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const context = () => ({ ownerId: owner, signal: new AbortController().signal });
function wire(options: { failed?: boolean; wrongId?: boolean; malformed?: boolean; next?: number } = {}) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/projects")) return Response.json({ projects: [{ ...project, ...(options.wrongId ? { link: { ...project.link, repoId: 2 } } : {}) }], pagination: { count: 1, next: options.next ?? null, prev: null } });
    if (options.failed) return Response.json({ error: "TEST_ONLY upstream unavailable" }, { status: 503 });
    if (url.pathname.endsWith("/aggregate")) return Response.json({ version: 1, query: { since: url.searchParams.get("since"), until: url.searchParams.get("until"), groupBy: ["day"], limit: Number(url.searchParams.get("limit")) }, data: [] });
    return Response.json({ version: 1, query: { ...(url.searchParams.has("since") ? { since: url.searchParams.get("since") } : {}), ...(url.searchParams.has("until") ? { until: url.searchParams.get("until") } : {}) }, data: options.malformed ? { pageviews: "wrong", visitors: -1 } : { pageviews: 0, visitors: 0 } });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("keeps an analytics outage unavailable instead of inventing successful zeros", async () => {
  wire({ failed: true }); expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "error" });
});
it("does not override a mismatched permanent repository id with the same name", async () => {
  wire({ wrongId: true }); expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "error" });
});
it("rejects malformed totals without throwing or forwarding provider values", async () => {
  wire({ malformed: true }); await expect(getProjectTraffic("owner/repo", 1, context())).resolves.toMatchObject({ kind: "error" });
});
it("refuses an apparently unique project while another page remains", async () => {
  wire({ next: 123 }); expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "error" });
});
it("does not use the deployment credential for another app owner", async () => {
  const fetcher = wire(); expect(await getProjectTraffic("owner/repo", 1, { ...context(), ownerId: "22222222-2222-4222-8222-222222222222" })).toMatchObject({ kind: "error" }); expect(fetcher).not.toHaveBeenCalled();
});
it("holds a deployment credential whose owner is not configured", async () => {
  vi.stubEnv("DASHBOARD_OWNER_ID", ""); const fetcher = wire(); expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "error" }); expect(fetcher).not.toHaveBeenCalled();
});
it("does no provider work after cancellation", async () => {
  const fetcher = wire(), abort = new AbortController(); abort.abort(); expect(await getProjectTraffic("owner/repo", 1, { ownerId: owner, signal: abort.signal })).toMatchObject({ kind: "error" }); expect(fetcher).not.toHaveBeenCalled();
});
it("reuses a confirmed traffic read rather than fetching totals again on an immediate repeat", async () => {
  const fetcher = wire(); expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "ok" }); const first = fetcher.mock.calls.length;
  expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "ok" }); expect(fetcher).toHaveBeenCalledTimes(first);
});

function healthy(options: { period?: { pageviews: number; visitors: number }; duplicate?: boolean; outside?: boolean; saturated?: boolean; alteredWindow?: boolean; extra?: boolean; array?: boolean } = {}) {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    expect(url.origin).toBe("https://api.vercel.com"); expect(init?.redirect).toBe("error"); expect(url.searchParams.has("token")).toBe(false);
    if (url.pathname.endsWith("/projects")) {
      expect(url.pathname).toBe("/v10/projects"); expect(url.searchParams.get("limit")).toBe("2"); expect(url.searchParams.get("teamId")).toBe("team_test");
      const rows = options.saturated ? [project, { ...project, id: "prj_other" }] : [project];
      return Response.json(options.array ? rows : { projects: rows, pagination: { count: rows.length, next: null, prev: null } });
    }
    const today = new Date(Date.now()).toISOString().slice(0, 10), since = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    expect(url.searchParams.get("until")).toBe(today);
    if (url.pathname.endsWith("/aggregate")) {
      expect(url.searchParams.get("by")).toBe("day"); expect(url.searchParams.get("limit")).toBe("31"); expect(url.searchParams.get("since")).toBe(since);
      return Response.json({ version: 1, query: { since: options.alteredWindow ? "2000-01-01" : since, until: today, groupBy: ["day"], limit: options.extra ? 10 : 31 }, data: [
        { timestamp: options.outside ? "2000-01-01T00:00:00Z" : `${since}T00:00:00Z`, pageviews: 50, visitors: 40, privateMetadata: "TEST_ONLY_PRIVATE" },
        { timestamp: `${options.duplicate ? since : today}T00:00:00Z`, pageviews: 50, visitors: 40 },
      ] });
    }
    return Response.json({ version: 1, query: { ...(url.searchParams.has("since") ? { since: url.searchParams.get("since") } : {}), until: today },
      data: { ...(url.searchParams.has("since") ? options.period ?? { pageviews: 100, visitors: 65 } : { pageviews: 200, visitors: 120 }), privateMetadata: "TEST_ONLY_PRIVATE" } });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("uses complete explicit UTC windows and provider period totals rather than summing daily visitors", async () => {
  const fetcher = healthy(); const result = await getProjectTraffic("owner/repo", 1, context());
  expect(result).toMatchObject({ kind: "ok", lifetime: { pageviews: 200, visitors: 120 }, last30: { pageviews: 100, visitors: 65 } });
  expect(fetcher).toHaveBeenCalledTimes(4); expect(JSON.stringify(result)).not.toContain("TEST_ONLY_PRIVATE");
  if (result.kind === "ok") { expect(result.daily.reduce((sum, row) => sum + row.visitors, 0)).toBe(80); expect(Date.parse(result.window.until) - Date.parse(result.window.since)).toBe(29 * 86_400_000); }
});
it("supports the documented array project response", async () => {
  healthy({ array: true }); expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "ok" });
});
it.each([{ duplicate: true }, { outside: true }, { saturated: true }, { alteredWindow: true }, { extra: true }, { period: { pageviews: 101, visitors: 65 } }, { period: { pageviews: 100, visitors: 90 } }])("refuses incomplete or inconsistent project/daily evidence %j", async options => {
  healthy(options); expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "error" });
});
it("does not silently resolve a legacy repository by its short project name", async () => {
  const fetcher = wire({ wrongId: true });
  // An exact full-name link is supported when no permanent id was saved.
  expect(await getProjectTraffic("someone/repo", null, context())).toMatchObject({ kind: "error" }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not cache a failed read and does cache isolated copies of confirmed data", async () => {
  wire({ failed: true }); expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "error" });
  const fetcher = healthy(), result = await getProjectTraffic("owner/repo", 1, context()); expect(result.kind).toBe("ok");
  if (result.kind === "ok") result.daily[0].pageviews = 999;
  const cached = await getProjectTraffic("owner/repo", 1, context()); expect(fetcher).toHaveBeenCalledTimes(4);
  if (cached.kind !== "ok") throw Error("Expected cached traffic"); expect(cached.daily[0].pageviews).toBe(50);
});
it("expires successes and isolates a new credential realm", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T06:00:00Z")), fetcher = healthy();
  await getProjectTraffic("owner/repo", 1, context()); await getProjectTraffic("owner/repo", 1, context()); expect(fetcher).toHaveBeenCalledTimes(4);
  clock.mockReturnValue(Date.parse("2026-10-25T06:01:01Z")); await getProjectTraffic("owner/repo", 1, context()); expect(fetcher).toHaveBeenCalledTimes(8);
  vi.stubEnv("VERCEL_API_TOKEN", "TEST_ONLY_ROTATED_TOKEN"); await getProjectTraffic("owner/repo", 1, context()); expect(fetcher).toHaveBeenCalledTimes(12);
});
it("refuses invalid clocks before a provider read", async () => {
  const fetcher = wire(); vi.spyOn(Date, "now").mockReturnValue(NaN); expect(await getProjectTraffic("owner/repo", 1, context())).toMatchObject({ kind: "error" }); expect(fetcher).not.toHaveBeenCalled();
});
it("releases late headers after an uncooperative request outlives its caller", async () => {
  let release!: (response: Response) => void; const cancel = vi.fn(), fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; })); vi.stubGlobal("fetch", fetcher);
  const stop = new AbortController(), pending = getProjectTraffic("owner/repo", 1, { ownerId: owner, signal: stop.signal });
  stop.abort(); expect(await pending).toMatchObject({ kind: "error" });
  release(new Response(new ReadableStream({ cancel }))); await Promise.resolve(); await Promise.resolve(); expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(1);
});
