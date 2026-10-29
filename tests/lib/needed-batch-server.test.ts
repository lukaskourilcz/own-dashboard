import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ auth: vi.fn(), factory: vi.fn(), fetcher: vi.fn(), limited: false, user: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: state.auth } }) }));
vi.mock("@/lib/github-token", () => ({ createGitHubFetcher: state.factory }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: !state.limited, retryAfter: 60 }) }));
import { POST } from "@/app/api/github/needed/route";
import { readNeededBatch } from "@/lib/needed-batch-server";
import { gitBlobSha } from "@/lib/github-file-server";
const repos = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, owner: "owner", name: `fixture-${index}` }));
const file = (path = "NEEDED.md", content = "- [ ] Actual task") => Response.json({ type: "file", path, size: Buffer.byteLength(content), sha: gitBlobSha(content), html_url: `https://github.com/owner/fixture/blob/main/${path}`, encoding: "base64", content: Buffer.from(content).toString("base64") });
const snapshot = (id: number, name: string, root: string | null = "- [ ] Actual task", docs: string | null = null) => {
  const entry = (path: string, text: string | null) => text === null ? null : { path, oid: gitBlobSha(text), size: Buffer.byteLength(text), type: "blob", mode: 33188 };
  return Response.json({ data: { repository: { databaseId: id, nameWithOwner: `owner/${name}`, isArchived: false, branch: { id: `REF_${id}`, name: "main", prefix: "refs/heads/", target: { __typename: "Commit", oid: "a".repeat(40), primary: entry("NEEDED.md", root), secondary: entry("docs/NEEDED.md", docs) } } } } });
};
const defaultFetch = async (path: string, init?: RequestInit) => {
  if (path !== "/graphql") return file();
  const { variables } = JSON.parse(String(init?.body)); return snapshot(Number(variables.repo.split("-").at(-1)) + 1, variables.repo);
};
const request = (body: unknown = { repos }, origin = "https://app.example") => new Request("https://app.example/api/github/needed", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
beforeEach(() => { state.user = true; state.limited = false; state.auth.mockReset().mockImplementation(async () => ({ data: { user: state.user ? { id: "owner" } : null } })); state.fetcher.mockReset().mockImplementation(defaultFetch); state.factory.mockReset().mockReturnValue(state.fetcher); });
afterEach(() => vi.restoreAllMocks());
it("uses one authentication/provider context and at most four active repository reads", async () => {
  let active = 0, maximum = 0;
  state.fetcher.mockImplementation(async (path, init) => { maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return defaultFetch(path, init); });
  const response = await POST(request()); expect(response.status).toBe(200);
  const body = await response.json(); expect(body.files).toHaveLength(12); expect(body.files.every((entry: { result: { kind: string } }) => entry.result.kind === "ok")).toBe(true);
  expect(state.auth).toHaveBeenCalledOnce(); expect(state.factory).toHaveBeenCalledOnce(); expect(state.fetcher).toHaveBeenCalledTimes(24); expect(maximum).toBe(4);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("tries docs only after confirmed root absence and preserves per-source failures", async () => {
  state.fetcher.mockImplementation(async (path, init) => {
    if (path === "/graphql") { const { variables } = JSON.parse(init.body); return variables.repo === "fixture-0" ? snapshot(1, variables.repo, null, "- [ ] Actual task") : Response.json({ private: "invented-provider-detail" }, { status: 503 }); }
    expect(path).toContain("/docs/NEEDED.md?ref=" + "a".repeat(40)); return file("docs/NEEDED.md");
  });
  const response = await POST(request({ repos: repos.slice(0, 2) })); const body = await response.json();
  expect(body.files[0].result).toMatchObject({ kind: "ok", path: "docs/NEEDED.md" }); expect(body.files[1].result).toEqual({ kind: "error" }); expect(state.fetcher).toHaveBeenCalledTimes(3); expect(JSON.stringify(body)).not.toContain("invented-provider-detail");
});
it("confirms not-found only from both paths in the identified commit", async () => {
  state.fetcher.mockImplementation(async () => snapshot(1, "fixture-0", null, null));
  const result = await readNeededBatch(repos.slice(0, 1), state.fetcher, new AbortController().signal);
  expect(result).toEqual({ kind: "ok", files: [{ repoId: "1", result: { kind: "not-found" } }] });
});
it("cancels hanging reads and leaves unread sources unavailable instead of empty", async () => {
  const controller = new AbortController(); state.fetcher.mockImplementation(() => new Promise(() => undefined));
  const pending = readNeededBatch(repos, state.fetcher, controller.signal); expect(state.fetcher).toHaveBeenCalledTimes(4); controller.abort();
  const result = await pending; expect(result.kind).toBe("ok"); if (result.kind === "ok") expect(result.files.every(file => file.result.kind === "error")).toBe(true); expect(state.fetcher).toHaveBeenCalledTimes(4);
});
it("does not turn a root-only 404 into confirmed absence after cancellation", async () => {
  const controller = new AbortController(); state.fetcher.mockImplementation(async () => { controller.abort(); return new Response(null, { status: 404 }); });
  expect(await readNeededBatch(repos.slice(0, 1), state.fetcher, controller.signal)).toEqual({ kind: "ok", files: [{ repoId: "1", result: { kind: "error" } }] });
});
it("bounds actual serialized UTF-8 bytes across results", async () => {
  state.fetcher.mockImplementation(async (path, init) => path === "/graphql" ? snapshot(Number(JSON.parse(init.body).variables.repo.split("-").at(-1)) + 1, JSON.parse(init.body).variables.repo, "Ž".repeat(500)) : file("NEEDED.md", "Ž".repeat(500)));
  const result = await readNeededBatch(repos.slice(0, 2), state.fetcher, new AbortController().signal, 2000);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(2000);
  if (result.kind === "ok") { expect(result.files.filter(file => file.result.kind === "ok")).toHaveLength(1); expect(result.files.filter(file => file.result.kind === "error")).toHaveLength(1); }
});
it.each([{}, null, { repos: [repos[0], repos[0]] }, { repos: [{ ...repos[0], id: 1.5 }] }, { repos: [{ ...repos[0], owner: "../foreign" }] }, { repos: Array.from({ length: 101 }, (_, index) => ({ ...repos[0], id: index + 1 })) }, { repos, user_id: "foreign" }])("refuses invalid/ambiguous inputs before provider access", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(state.factory).not.toHaveBeenCalled();
});
it("retains origin, owner, request-size and rate boundaries", async () => {
  expect((await POST(request({ repos }, "http://app.example"))).status).toBe(403);
  state.user = false; expect((await POST(request())).status).toBe(401); state.user = true;
  state.limited = true; expect((await POST(request())).status).toBe(429); state.limited = false;
  const invalid = new Request("https://app.example/api/github/needed", { method: "POST", headers: { origin: "https://app.example" }, body: "{" }); expect((await POST(invalid)).status).toBe(400);
  const oversized = new Request("https://app.example/api/github/needed", { method: "POST", headers: { origin: "https://app.example" }, body: " ".repeat(65537) }); expect((await POST(oversized)).status).toBe(413); expect(state.factory).not.toHaveBeenCalled();
});
it("stops further work when a provider context is disconnected", async () => {
  state.fetcher.mockResolvedValue(new Response(null, { status: 401 }));
  expect(await readNeededBatch(repos, state.fetcher, new AbortController().signal)).toEqual({ kind: "disconnected" }); expect(state.fetcher.mock.calls.length).toBeLessThanOrEqual(4);
});

it("retains a source when its name was reused, even when both files are absent", async () => {
  state.fetcher.mockImplementation(async () => snapshot(999, "fixture-0", null, null));
  expect(await readNeededBatch(repos.slice(0, 1), state.fetcher, new AbortController().signal)).toEqual({ kind: "ok", files: [{ repoId: "1", result: { kind: "error" } }] }); expect(state.fetcher).toHaveBeenCalledOnce();
});
it("does not treat a failed pinned file read as confirmed absence", async () => {
  state.fetcher.mockImplementation(async path => path === "/graphql" ? snapshot(1, "fixture-0") : new Response(null, { status: 404 }));
  expect(await readNeededBatch(repos.slice(0, 1), state.fetcher, new AbortController().signal)).toEqual({ kind: "ok", files: [{ repoId: "1", result: { kind: "error" } }] });
});
it("rejects a mismatched file blob and keeps its existing tasks", async () => {
  state.fetcher.mockImplementation(async path => path === "/graphql" ? snapshot(1, "fixture-0") : file("NEEDED.md", "- [ ] Foreign source"));
  expect(await readNeededBatch(repos.slice(0, 1), state.fetcher, new AbortController().signal)).toEqual({ kind: "ok", files: [{ repoId: "1", result: { kind: "error" } }] });
});

it("refuses an authentication error even when a cached user is present", async () => {
  state.auth.mockResolvedValueOnce({ data: { user: { id: "owner" } }, error: Error("TEST_ONLY_PRIVATE_AUTH") }); const response = await POST(request()); expect(response.status).toBe(401); expect(state.factory).not.toHaveBeenCalled(); expect(await response.text()).not.toContain("TEST_ONLY_PRIVATE_AUTH");
});
