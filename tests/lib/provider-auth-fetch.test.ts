import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("@/lib/oauth-access-token", () => ({ getOAuthAccessToken: state.token }));
import { createOAuthFetcher } from "@/lib/provider-auth-fetch";
beforeEach(() => { state.token.mockReset().mockResolvedValue("synthetic-access"); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("uses the refreshed grant for later requests without another rejected round trip", async () => {
  state.token.mockResolvedValueOnce("synthetic-access").mockResolvedValueOnce("synthetic-rotated");
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Response(null, { status: new Headers(init?.headers).get("authorization") === "Bearer synthetic-rotated" ? 200 : 401 })); vi.stubGlobal("fetch", fetcher);
  const request = createOAuthFetcher("github", "owner");
  expect((await request("/repos/owner/one")).ok).toBe(true); expect((await request("/repos/owner/two")).ok).toBe(true);
  expect(state.token).toHaveBeenCalledTimes(2); expect(fetcher).toHaveBeenCalledTimes(3);
});
it("uses one owner read for concurrent fan-out and preserves Headers objects", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({})); vi.stubGlobal("fetch", fetcher);
  const request = createOAuthFetcher("github", "owner");
  await Promise.all(Array.from({ length: 12 }, (_, index) => request(`/repos/fixture/${index}`, { headers: new Headers({ accept: "application/vnd.github.raw+json" }) })));
  expect(state.token).toHaveBeenCalledOnce(); expect(state.token.mock.calls[0].slice(0, 2)).toEqual(["github", "owner"]);
  expect(fetcher).toHaveBeenCalledTimes(12); const headers = fetcher.mock.calls[0][1]!.headers as Headers;
  expect(headers.get("accept")).toBe("application/vnd.github.raw+json"); expect(headers.get("authorization")).toBe("Bearer synthetic-access");
});
it("shares one forced refresh for a concurrent 401 wave and retries each call only once", async () => {
  state.token.mockResolvedValueOnce("synthetic-stale").mockResolvedValueOnce("synthetic-refreshed");
  const fetcher = vi.fn(async (_input, init) => new Response(null, { status: (init.headers as Headers).get("authorization") === "Bearer synthetic-stale" ? 401 : 200 })); vi.stubGlobal("fetch", fetcher);
  const request = createOAuthFetcher("github", "owner"); const responses = await Promise.all(Array.from({ length: 10 }, () => request("/user")));
  expect(responses.every(response => response.ok)).toBe(true); expect(state.token).toHaveBeenCalledTimes(2); expect(fetcher).toHaveBeenCalledTimes(20);
  expect(state.token.mock.calls[1][3]).toBe("synthetic-stale");
});
it("does not cache credentials between owners or requests", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  await createOAuthFetcher("github", "owner")("/user"); await createOAuthFetcher("github", "other")("/user"); await createOAuthFetcher("github", "owner")("/user");
  expect(state.token.mock.calls.map(call => call[1])).toEqual(["owner", "other", "owner"]);
});
it.each(["https://elsewhere.example/private", "//elsewhere.example/private", "https://person:synthetic@api.github.com/user", "http://api.github.com/user", "https://api.github.com/user#private"])("refuses unsafe targets before reading credentials (%s)", async target => {
  vi.stubGlobal("fetch", vi.fn()); await expect(createOAuthFetcher("github", "owner")(target)).rejects.toThrow("Provider target refused"); expect(state.token).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("permits bounded same-origin repository rename reads and refuses cross-origin redirects", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/repositories/123" } })).mockResolvedValueOnce(Response.json({})); vi.stubGlobal("fetch", fetcher);
  expect((await createOAuthFetcher("github", "owner")("/repos/old/name")).ok).toBe(true); expect(fetcher.mock.calls[1][0]).toBe("https://api.github.com/repositories/123");
  fetcher.mockReset().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://elsewhere.example/private" } }));
  await expect(createOAuthFetcher("github", "owner")("/user")).rejects.toThrow("Provider target refused"); expect(fetcher).toHaveBeenCalledOnce();
});
it("does not replay redirected writes or loop forever", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 307, headers: { location: "/user" } })); vi.stubGlobal("fetch", fetcher);
  await expect(createOAuthFetcher("github", "owner")("/user", { method: "PUT", body: "{}" })).rejects.toThrow("Provider redirect refused"); expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockClear(); await expect(createOAuthFetcher("github", "owner")("/user")).rejects.toThrow("Provider redirect refused"); expect(fetcher).toHaveBeenCalledTimes(4);
});
it("returns absence and an unchanged rejected token without repeating the upstream request", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 401 })); vi.stubGlobal("fetch", fetcher);
  state.token.mockResolvedValueOnce(null); const absent = await createOAuthFetcher("google", "owner")("/calendar/v3/users/me/calendarList"); expect(absent.statusText).toBe("no-token"); expect(fetcher).not.toHaveBeenCalled();
  await createOAuthFetcher("google", "owner")("/calendar/v3/users/me/calendarList"); expect(fetcher).toHaveBeenCalledOnce();
});
it("cancels waiting callers and starts no late provider request after a token arrives", async () => {
  let resolve!: (token: string) => void; state.token.mockReturnValue(new Promise(done => { resolve = done; })); vi.stubGlobal("fetch", vi.fn());
  const controller = new AbortController(); const pending = createOAuthFetcher("github", "owner")("/user", { signal: controller.signal });
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" }); resolve("synthetic-late-access"); await Promise.resolve(); expect(fetch).not.toHaveBeenCalled();
});
it("keeps a caller cancellation separate from the request's shared token lookup", async () => {
  let resolve!: (token: string) => void; state.token.mockReturnValue(new Promise(done => { resolve = done; })); vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  const request = createOAuthFetcher("github", "owner"), controller = new AbortController();
  const cancelled = request("/user", { signal: controller.signal }), retained = request("/user"); controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" }); resolve("synthetic-access"); expect((await retained).ok).toBe(true); expect(fetch).toHaveBeenCalledOnce();
});
