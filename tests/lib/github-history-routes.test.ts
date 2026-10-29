import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const owner = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ user: true, authError: false, rows: [] as unknown[], count: 0 as number | null, dbError: null as unknown, calls: [] as unknown[][], owners: [] as string[], authCalls: 0, github: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  const builder = Object.fromEntries(["select", "eq", "neq", "not", "order", "limit", "abortSignal"].map(name => [name, (...args: unknown[]) => { state.calls.push([name, ...args]); return builder; }])) as Record<string, unknown>;
  builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: state.rows, count: state.count, error: state.dbError }).then(resolve, reject);
  return { auth: { getUser: async () => { state.authCalls++; return { data: { user: state.user ? { id: owner } : null }, error: state.authError ? {} : null }; } }, from: (name: string) => { state.calls.push(["from", name]); return builder; } };
} }));
vi.mock("@/lib/github-token", () => ({ createGitHubFetcher: (userId: string) => { state.owners.push(userId); return state.github; } }));
import { GET as commits } from "@/app/api/github/commits/route";
import { GET as activity } from "@/app/api/github/activity/route";
import { githubActivityResponse, githubCommitsResponse, summarizeGithubCodeVolume } from "@/lib/github-activity-contract";
const project = (n = 1, repo = `owner/repo-${n}`) => ({ id: `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`, name: `Project ${n}`, slug: `project-${n}`, repo_full_name: repo, parent_id: null, repo_id: null, updated_at: "2026-10-24T00:00:00Z" });
const rawCommit = (repo = "owner/repo-1", sha = "a".repeat(40)) => ({ sha, html_url: `https://github.com/${repo}/commit/${sha}`, commit: { message: "Reviewed change\nPRIVATE BODY", author: { name: "Fixture author", email: "private@example.test", date: "2026-10-24T00:00:00Z" } }, author: { login: "fixture-user", unrelated: "PRIVATE FIELD" } });
const request = (repo = "owner/repo-1") => new Request(`https://app.example/api/github/commits?repo=${encodeURIComponent(repo)}`);
beforeEach(() => { Object.assign(state, { user: true, authError: false, rows: [project()], count: 1, dbError: null, calls: [], owners: [], authCalls: 0 }); state.github.mockReset().mockImplementation(async (path: string) => path.includes("/stats/") ? Response.json([[1, 20, -5]]) : Response.json([rawCommit(path.match(/^\/repos\/(.+)\/commits/)![1])])); });
afterEach(() => vi.restoreAllMocks());
it("returns only validated commit projections and optional recent statistics with private caching", async () => {
  const reply = await commits(request()); expect(reply.status).toBe(200); expect(reply.headers.get("cache-control")).toBe("private, no-store");
  const body = await reply.json(); expect(githubCommitsResponse.safeParse(body).success).toBe(true); expect(body).toMatchObject({ commits: [{ message: "Reviewed change", shortSha: "aaaaaaa", author: "fixture-user" }], codeVolume: { additions: 20, deletions: 5, weeks: 1 } });
  expect(JSON.stringify(body)).not.toContain("PRIVATE"); expect(JSON.stringify(body)).not.toContain("private@example.test"); expect(state.owners).toEqual([owner]); expect(state.authCalls).toBe(1); expect(state.github).toHaveBeenCalledTimes(2);
});
it.each(["../repo", "owner/..", "owner/repo/extra", "owner/repo\n", "owner/" + "x".repeat(101)])("rejects invalid paths before provider access (%s)", async repo => { expect((await commits(request(repo))).status).toBe(400); expect(state.authCalls).toBe(0); expect(state.github).not.toHaveBeenCalled(); });
it("refuses repeated repository selectors", async () => { expect((await commits(new Request("https://app.example/api/github/commits?repo=owner/a&repo=owner/b"))).status).toBe(400); expect(state.github).not.toHaveBeenCalled(); });
it.each([commits, activity])("distinguishes unavailable authentication from missing login", async read => {
  state.authError = true; expect((await read(request())).status).toBe(503); state.authError = false; state.user = false; expect((await read(request())).status).toBe(401); expect(state.github).not.toHaveBeenCalled();
});
it("does not call a missing repository empty and accepts only the documented empty conflict", async () => {
  state.github.mockResolvedValue(new Response(null, { status: 404 })); expect((await commits(request())).status).toBe(404);
  state.github.mockImplementation(async () => Response.json({ message: "Git Repository is empty." }, { status: 409 })); expect(await (await commits(request())).json()).toEqual({ commits: [], codeVolume: null });
  state.github.mockImplementation(async () => Response.json({ message: "PRIVATE unavailable repository" }, { status: 409 })); expect((await commits(request())).status).toBe(503);
});
it.each([202, 204, 422, 503])("does not poll or fail confirmed history for unavailable optional statistics (%s)", async status => {
  state.github.mockImplementation(async (path: string) => path.includes("/stats/") ? new Response(null, { status }) : Response.json([rawCommit()]));
  const reply = await commits(request()); expect(reply.status).toBe(200); expect(await reply.json()).toMatchObject({ commits: [{ sha: "a".repeat(40) }], codeVolume: null }); expect(state.github).toHaveBeenCalledTimes(2);
});
it.each([{ ...rawCommit(), sha: "bad" }, { ...rawCommit(), html_url: "https://unsafe.example.test/" }, { ...rawCommit(), html_url: `https://github.com/owner/repo-1/commit/${"b".repeat(40)}` }, { ...rawCommit(), commit: { message: "Fixture", author: { date: "invalid" } } }])("refuses malformed successful provider commits (%j)", async row => {
  state.github.mockImplementation(async () => Response.json([row])); expect((await commits(request())).status).toBe(503); expect(state.github).toHaveBeenCalledOnce();
});
it("cancels an oversized history body without exposing it", async () => {
  const cancel = vi.fn(); state.github.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("PRIVATE".repeat(100_000))); }, cancel })));
  const reply = await commits(request()); expect(reply.status).toBe(503); expect(cancel).toHaveBeenCalledOnce(); expect(await reply.text()).not.toContain("PRIVATE");
});
it("bounds a stalled optional statistics body separately from the confirmed history", async () => {
  const stop = new AbortController(), cancel = vi.fn(); vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 3000 ? stop.signal : new AbortController().signal);
  const response = new Response(new ReadableStream({ cancel })); state.github.mockImplementation(async (path: string) => path.includes("/stats/") ? response : Response.json([rawCommit()]));
  const pending = commits(request()); await vi.waitFor(() => expect(response.body!.locked).toBe(true)); stop.abort("PRIVATE");
  expect(await (await pending).json()).toMatchObject({ commits: [{ sha: "a".repeat(40) }], codeVolume: null }); expect(cancel).toHaveBeenCalledOnce();
});
it("keeps unknown dates visible and uses a known committer date when the author date is absent", async () => {
  const raw = { ...rawCommit(), author: null, commit: { message: "Fixture", author: null, committer: { date: "2026-10-23T00:00:00Z" } } };
  state.github.mockImplementation(async (path: string) => path.includes("/stats/") ? Response.json([]) : Response.json([raw]));
  expect(await (await commits(request())).json()).toMatchObject({ commits: [{ date: "2026-10-23T00:00:00Z", author: "" }] });
});
it("checks the own active-project count and propagates read cancellation before any provider request", async () => {
  const reply = await activity(request()); expect(reply.status).toBe(200); expect(githubActivityResponse.safeParse(await reply.json()).success).toBe(true);
  expect(state.calls).toContainEqual(["eq", "user_id", owner]); expect(state.calls).toContainEqual(["eq", "is_active", true]); expect(state.calls).toContainEqual(["neq", "status", "archived"]); expect(state.calls).toContainEqual(["select", expect.any(String), { count: "exact" }]); expect(state.calls).toContainEqual(["abortSignal", expect.any(AbortSignal)]); expect(state.owners).toEqual([owner]);
});
it.each(["error", "count", "incomplete", "malformed", "duplicate"])("does not invent empty activity after an invalid project read (%s)", async mode => {
  if (mode === "error") state.dbError = { message: "PRIVATE" }; if (mode === "count") state.count = null; if (mode === "incomplete") state.count = 2;
  if (mode === "malformed") state.rows = [{ ...project(), repo_full_name: "../bad" }]; if (mode === "duplicate") { state.rows = [project(), project()]; state.count = 2; }
  const reply = await activity(request()); expect(reply.status).toBe(503); expect(await reply.text()).not.toContain("PRIVATE"); expect(state.github).not.toHaveBeenCalled();
});
it("reads shared/renamed project repositories once and prefers their selected parent", async () => {
  state.rows = [{ ...project(2, "owner/previous-name"), parent_id: project().id, repo_id: 123 }, { ...project(), repo_id: 123 }, { ...project(3), repo_full_name: "OWNER/REPO-1" }]; state.count = 3;
  const reply = await activity(request()); expect(reply.status).toBe(200); const body = await reply.json(); expect(body.scope).toEqual({ projects: 3, totalProjects: 3, repositories: 1, unavailableRepositories: 0 }); expect(body.items).toHaveLength(1); expect(body.items[0].projectId).toBe(project().id); expect(state.github).toHaveBeenCalledOnce();
});
it("returns explicit scope and unavailable counts for a partial feed and refuses an entirely failed feed", async () => {
  state.rows = Array.from({ length: 10 }, (_, i) => project(i + 1)); state.count = 15;
  state.github.mockImplementation(async (path: string) => path.includes("repo-1/") ? Response.json([rawCommit()]) : new Response(null, { status: 404 }));
  const reply = await activity(request()); expect(reply.status).toBe(200); expect(await reply.json()).toMatchObject({ scope: { projects: 10, totalProjects: 15, repositories: 10, unavailableRepositories: 9 }, items: [{ projectId: project().id }] });
  state.github.mockImplementation(async () => new Response(null, { status: 503 })); expect((await activity(request())).status).toBe(503);
});
it("limits repository fan-out to four active reads", async () => {
  state.rows = Array.from({ length: 10 }, (_, i) => project(i + 1)); state.count = 10; let active = 0, maximum = 0;
  state.github.mockImplementation(async (path: string) => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return Response.json([rawCommit(path.match(/^\/repos\/(.+)\/commits/)![1])]); });
  expect((await activity(request())).status).toBe(200); expect(maximum).toBe(4); expect(state.github).toHaveBeenCalledTimes(10);
});
it.each(["no-token", "expired"])("treats every rejected grant as disconnected instead of empty activity (%s)", async reason => { state.github.mockImplementation(async () => new Response(null, { status: 401, statusText: reason })); expect((await activity(request())).status).toBe(401); expect((await commits(request())).status).toBe(401); });
it("does not call a provider for a confirmed empty project scope", async () => { state.rows = []; state.count = 0; const reply = await activity(request()); expect(reply.status).toBe(200); expect(await reply.json()).toMatchObject({ items: [], scope: { projects: 0, repositories: 0, totalProjects: 0 } }); expect(state.github).not.toHaveBeenCalled(); });
it("sorts validated weekly statistics, sums only four weeks, and rejects unsafe totals", () => {
  expect(summarizeGithubCodeVolume([[5, 5, -5], [1, 1, -1], [4, 4, -4], [3, 3, -3], [2, 2, -2]])).toEqual({ additions: 14, deletions: 14, weeks: 4 });
  for (const value of [[[1, -1, 1]], [[1, 1, -1], [1, 2, -2]], [[1, Number.MAX_SAFE_INTEGER, 0], [2, 1, 0]], [[1, 1]]]) expect(() => summarizeGithubCodeVolume(value)).toThrow();
});

it("merges legacy-name groups when a later known identity connects both aliases", async () => {
  state.rows = [{ ...project(1, "owner/old"), repo_id: 123 }, project(2, "owner/new"), { ...project(3, "owner/new"), repo_id: 123 }]; state.count = 3;
  const reply = await activity(request()); expect(reply.status).toBe(200); expect(await reply.json()).toMatchObject({ scope: { repositories: 1 } }); expect(state.github).toHaveBeenCalledOnce();
});
it("refuses conflicting stored identities rather than duplicating repository reads", async () => {
  state.rows = [{ ...project(), repo_id: 123 }, { ...project(2, "owner/repo-1"), repo_id: 456 }]; state.count = 2;
  expect((await activity(request())).status).toBe(503); expect(state.github).not.toHaveBeenCalled();
});
it("cancels a stalled primary history within the complete request budget", async () => {
  const stop = new AbortController(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel })); vi.spyOn(AbortSignal, "timeout").mockReturnValue(stop.signal); state.github.mockResolvedValue(response);
  const pending = commits(request()); await vi.waitFor(() => expect(response.body!.locked).toBe(true)); stop.abort("PRIVATE");
  const reply = await pending; expect(reply.status).toBe(503); expect(await reply.text()).not.toContain("PRIVATE"); expect(cancel).toHaveBeenCalledOnce(); expect(state.github).toHaveBeenCalledOnce();
});
