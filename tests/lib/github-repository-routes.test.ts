import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, authError: false, github: vi.fn(), owners: [] as string[], signals: [] as AbortSignal[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null }, error: state.authError ? {} : null }) } }) }));
vi.mock("@/lib/github-token", () => ({ createGitHubFetcher: (owner: string, signal: AbortSignal) => { state.owners.push(owner); state.signals.push(signal); return state.github; } }));
import { GET as list } from "@/app/api/github/repos/route";
import { GET as lookup } from "@/app/api/github/repos/lookup/route";
import { githubHasNextPage, githubRepositoriesResponse, githubRepositoryLookupResponse } from "@/lib/github-repository-contract";
const raw = { id: 123, name: "fixture", full_name: "owner/fixture", owner: { login: "owner", email: "private@example.test" }, description: "Fixture", private: true, fork: false, archived: false, html_url: "https://unsafe.example.test/", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", unrelated: "PRIVATE PROVIDER FIELD" };
const request = (repo = "owner/fixture") => new Request(`https://app.example/api/github/repos/lookup?repo=${encodeURIComponent(repo)}`);
beforeEach(() => { Object.assign(state, { user: true, authError: false, owners: [], signals: [] }); state.github.mockReset().mockImplementation(async (path: string) => Response.json(path.startsWith("/user/repos") ? [raw] : raw)); });
afterEach(() => vi.restoreAllMocks());
it("returns only bounded app metadata and derives a safe canonical web link", async () => {
  const response = await list(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json(); expect(githubRepositoriesResponse.safeParse(body).success).toBe(true); expect(body).toMatchObject({ repos: [{ id: 123, owner: "owner", html_url: "https://github.com/owner/fixture" }], hasMore: false });
  expect(JSON.stringify(body)).not.toContain("PRIVATE"); expect(JSON.stringify(body)).not.toContain("private@example.test"); expect(state.owners).toEqual(["owner"]); expect(state.signals[0]).toBeInstanceOf(AbortSignal);
});
it("reports a continuation without following any header-provided URL", async () => {
  state.github.mockResolvedValue(Response.json([raw], { headers: { link: '<https://untrusted.example.test/anything>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"' } }));
  expect(await (await list(request())).json()).toMatchObject({ hasMore: true }); expect(state.github).toHaveBeenCalledOnce();
});
it.each([null, "", '<https://api.github.com/user/repos?page=1>; rel="prev"', '<https://api.github.com/user/repos?page=5>; rel="last"'])("does not invent an extra page (%s)", value => { expect(githubHasNextPage(value)).toBe(false); });
it.each(['<https://api.github.com/user/repos?page=2>; rel="next"', '<https://api.github.com/user/repos?page=2>; rel=next', '<https://api.github.com/user/repos?page=2>; rel="next last"'])("recognizes documented next relations (%s)", value => { expect(githubHasNextPage(value)).toBe(true); });
it.each([{ ...raw, id: 9007199254740992 }, { ...raw, name: "wrong-target" }, { ...raw, owner: { login: "foreign" } }, { ...raw, pushed_at: "invalid" }, { ...raw, stargazers_count: -1 }, { ...raw, full_name: "../fixture" }, { ...raw, default_branch: "main\nheader" }])("refuses malformed metadata rather than casting it into the cache (%j)", async repo => {
  state.github.mockResolvedValue(Response.json([repo])); const response = await list(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE");
});
it.each([[raw, raw], Array(101).fill(raw), { items: [raw] }])("does not return duplicate, oversized or non-array pages (%j)", async body => { state.github.mockResolvedValue(Response.json(body)); expect((await list(request())).status).toBe(503); });
it("returns validated scoped metadata and canonical renamed identity from a single lookup", async () => {
  state.github.mockResolvedValue(Response.json({ ...raw, name: "renamed", full_name: "owner/renamed" }));
  const response = await lookup(request("owner/old-name")); expect(response.status).toBe(200); const body = await response.json(); expect(githubRepositoryLookupResponse.safeParse(body).success).toBe(true); expect(body).toMatchObject({ id: 123, full_name: "owner/renamed", repo: { id: 123, name: "renamed" } }); expect(state.github).toHaveBeenCalledOnce(); expect(state.github.mock.calls[0][0]).toBe("/repos/owner/old-name");
});
it.each(["../repo", "owner/..", "owner/repo/extra", "owner/repo?query", "owner/repo#fragment", "owner/repo\n", "owner/" + "x".repeat(101)])("rejects unsafe repository paths before authentication/provider lookup (%s)", async repo => { expect((await lookup(request(repo))).status).toBe(400); expect(state.github).not.toHaveBeenCalled(); expect(state.owners).toEqual([]); });
it("distinguishes missing login, unavailable authentication and invisible repositories", async () => {
  state.user = false; expect((await list(request())).status).toBe(401); state.user = true; state.authError = true; expect((await list(request())).status).toBe(503);
  state.authError = false; state.github.mockResolvedValue(new Response(null, { status: 404 })); expect((await lookup(request())).status).toBe(404); expect((await list(request())).status).toBe(503);
});
it.each(["no-token", "expired"])("preserves provider reauthorization reasons (%s)", async reason => { state.github.mockResolvedValue(new Response(null, { status: 401, statusText: reason })); for (const read of [list, lookup]) { const response = await read(request()); expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ reason }); } });
it("does not buffer an oversized lookup result or expose an upstream exception", async () => {
  const cancel = vi.fn(); state.github.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(270_000))); }, cancel })));
  expect((await lookup(request())).status).toBe(503); expect(cancel).toHaveBeenCalledOnce();
  state.github.mockRejectedValue(Error("PRIVATE PROVIDER EXCEPTION")); const response = await list(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE");
});
it("cancels a stalled lookup body within the complete request budget", async () => {
  const stop = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(stop.signal);
  const cancel = vi.fn(), response = new Response(new ReadableStream({ cancel })); state.github.mockResolvedValue(response);
  const pending = lookup(request()); await vi.waitFor(() => expect(response.body!.locked).toBe(true)); stop.abort("PRIVATE");
  expect((await pending).status).toBe(503); expect(cancel).toHaveBeenCalledOnce(); expect(state.github).toHaveBeenCalledOnce();
});
