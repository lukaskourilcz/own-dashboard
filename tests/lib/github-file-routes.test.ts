import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, authError: false, limited: false, fetcher: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null }, error: state.authError ? Error("TEST_ONLY_PRIVATE_AUTH") : null }) } }) }));
vi.mock("@/lib/github-token", () => ({ createGitHubFetcher: () => state.fetcher }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: !state.limited, retryAfter: 60 }) }));
import { POST } from "@/app/api/github/commit/route";
import { GET } from "@/app/api/github/file/route";
import { gitBlobSha } from "@/lib/github-file-server";
const path = "notes/test.md", old = "Earlier fixture text", text = "Žluťoučký test 🚀\n";
const metadata = (content = old) => ({ type: "file", path, size: Buffer.byteLength(content), sha: gitBlobSha(content), html_url: `https://github.com/owner/repo/blob/main/${path}` });
const receipt = (content = text) => ({ content: metadata(content), commit: { sha: "b".repeat(40), html_url: `https://github.com/owner/repo/commit/${"b".repeat(40)}` } });
const input = { intent: "edit", expectedSha: gitBlobSha(old), owner: "owner", repo: "repo", path, content: text, message: "Update fixture" };
const request = (body: unknown = input, origin = "https://app.example") => new Request("https://app.example/api/github/commit", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
it("matches Git's independently documented blob hash", () => {
  expect(gitBlobSha("test content\n")).toBe("d670460b4b4aece5915caf5c68d12f560a9fe3e4");
});
beforeEach(() => {
  state.user = true; state.authError = false; state.limited = false;
  state.fetcher.mockReset().mockImplementation(async (_url, init) => Response.json(init?.method === "PUT" ? receipt() : metadata()));
});
afterEach(() => vi.restoreAllMocks());
it("writes against the reviewed SHA and confirms the exact UTF-8 blob receipt", async () => {
  const response = await POST(request()); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ path, updated: true, unchanged: false, content: { sha: gitBlobSha(text) } });
  const put = JSON.parse(state.fetcher.mock.calls[1][1].body);
  expect(put.sha).toBe(gitBlobSha(old)); expect(Buffer.from(put.content, "base64").toString("utf8")).toBe(text);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("refuses a stale or removed file before sending any write", async () => {
  expect((await POST(request({ ...input, expectedSha: "c".repeat(40) }))).status).toBe(409); expect(state.fetcher).toHaveBeenCalledOnce();
  state.fetcher.mockReset().mockResolvedValue(new Response(null, { status: 404 })); expect((await POST(request())).status).toBe(409); expect(state.fetcher).toHaveBeenCalledOnce();
});
it("requires explicit replacement for new/arbitrary file contents", async () => {
  state.fetcher.mockImplementation(async (_url, init) => init?.method === "PUT" ? Response.json(receipt()) : new Response(null, { status: 404 }));
  const replacement = { intent: "replace", owner: input.owner, repo: input.repo, path, content: text, message: input.message };
  expect((await POST(request(replacement))).status).toBe(200); expect(JSON.parse(state.fetcher.mock.calls[1][1].body).sha).toBeUndefined();
});
it("confirms identical contents without creating another commit", async () => {
  state.fetcher.mockResolvedValue(Response.json(metadata(text)));
  const response = await POST(request({ ...input, expectedSha: gitBlobSha(text) })); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ unchanged: true, commit: null, content: { sha: gitBlobSha(text) } }); expect(state.fetcher).toHaveBeenCalledOnce();
});
it.each([null, [], {}, { ...input, intent: undefined }, { ...input, path: "../private" }, { ...input, path: "a\\b" }, { ...input, owner: ".." }, { ...input, expectedSha: "bad" }, { ...input, message: " " }, { ...input, user_id: "foreign" }, { ...input, branch: "bad\nbranch" }])("refuses malformed commit input before provider access", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(state.fetcher).not.toHaveBeenCalled();
});
it("checks UTF-8 byte size and a bounded raw body, not just JS string length", async () => {
  expect((await POST(request({ ...input, content: "🚀".repeat(250001) }))).status).toBe(413);
  const oversized = new Request("https://app.example/api/github/commit", { method: "POST", headers: { origin: "https://app.example" }, body: " ".repeat(2100001) });
  expect((await POST(oversized)).status).toBe(413); expect(state.fetcher).not.toHaveBeenCalled();
});
it.each(["blob", "path", "size", "url", "missing"])("does not confirm an altered/missing upstream %s receipt", async kind => {
  const changed = receipt();
  if (kind === "blob") changed.content.sha = "c".repeat(40);
  if (kind === "path") changed.content.path = "other.md";
  if (kind === "size") changed.content.size++;
  if (kind === "url") changed.commit.html_url = "https://other.example/private";
  state.fetcher.mockImplementation(async (_url, init) => Response.json(init?.method === "PUT" ? kind === "missing" ? {} : changed : metadata()));
  expect((await POST(request())).status).toBe(502);
});
it("retains owner/origin/rate and upstream conflict boundaries without echoing provider bodies", async () => {
  expect((await POST(request(input, "http://app.example"))).status).toBe(403);
  state.user = false; expect((await POST(request())).status).toBe(401); state.user = true;
  state.limited = true; expect((await POST(request())).status).toBe(429); expect(state.fetcher).not.toHaveBeenCalled(); state.limited = false;
  state.fetcher.mockImplementation(async (_url, init) => init?.method === "PUT" ? Response.json({ error: "synthetic-private" }, { status: 409 }) : Response.json(metadata()));
  const response = await POST(request()); expect(response.status).toBe(409); expect(await response.text()).not.toContain("synthetic-private");
});
it("uses a canonical read URL after a repository rename without redirecting the write", async () => {
  const head = Response.json(metadata()); Object.defineProperty(head, "url", { value: `https://api.github.com/repositories/123/contents/${path}?ref=main` });
  state.fetcher.mockResolvedValueOnce(head).mockResolvedValueOnce(Response.json(receipt()));
  expect((await POST(request())).status).toBe(200); expect(state.fetcher.mock.calls[1][0]).toBe(`/repositories/123/contents/${path}`);
});
const fileRequest = () => new Request(`https://app.example/api/github/file?owner=owner&repo=repo&path=${encodeURIComponent(path)}`);
it("reads a complete, hash-verified UTF-8 file with its version", async () => {
  state.fetcher.mockResolvedValue(Response.json({ ...metadata(text), encoding: "base64", content: Buffer.from(text).toString("base64") }));
  const response = await GET(fileRequest()); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ content: text, sha: gitBlobSha(text) });
});
it.each(["oversized", "invalid-encoding", "different-sha", "different-path", "invalid-utf8"])("refuses %s file replies instead of an empty success", async kind => {
  const bytes = kind === "invalid-utf8" ? Buffer.from([0xff, 0xfe]) : Buffer.from(text);
  const payload = { ...metadata(text), sha: gitBlobSha(bytes), size: bytes.length, encoding: "base64", content: bytes.toString("base64") };
  if (kind === "oversized") payload.size = 1000001;
  if (kind === "invalid-encoding") payload.encoding = "none";
  if (kind === "different-sha") payload.sha = "a".repeat(40);
  if (kind === "different-path") payload.path = "other.md";
  state.fetcher.mockResolvedValue(Response.json(payload)); expect((await GET(fileRequest())).status).toBe(502);
});

const stableSnapshot = (id = 42) => ({ databaseId: id, nameWithOwner: "owner/repo", isArchived: false, branch: { id: "REF_42", prefix: "refs/heads/", name: "main", target: { __typename: "Commit", oid: "a".repeat(40), primary: { path, oid: gitBlobSha(old), size: Buffer.byteLength(old), type: "blob", mode: 33188 }, secondary: { path, oid: gitBlobSha(old), size: Buffer.byteLength(old), type: "blob", mode: 33188 } } } });
it("routes a captured repository edit through a permanent branch and confirms its receipt", async () => {
  state.fetcher.mockImplementation(async (_url, init) => Response.json({ data: JSON.parse(init.body).query.startsWith("mutation") ? { createCommitOnBranch: { commit: { oid: "b".repeat(40), url: `https://github.com/owner/repo/commit/${"b".repeat(40)}`, repository: { databaseId: 42 }, parents: { nodes: [{ oid: "a".repeat(40) }] }, file: { path, oid: gitBlobSha(text), size: Buffer.byteLength(text), type: "blob", mode: 33188 } }, ref: { id: "REF_42", prefix: "refs/heads/", target: { oid: "b".repeat(40) }, repository: { databaseId: 42 } } } } : { repository: stableSnapshot() } }));
  const response = await POST(request({ ...input, expectedRepositoryId: 42 })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ path, content: { sha: gitBlobSha(text) } }); expect(state.fetcher.mock.calls.map(call => call[0])).toEqual(["/graphql", "/graphql"]);
});
it("does not mutate a reused repository namespace or expose its mismatch", async () => {
  state.fetcher.mockImplementation(async () => Response.json({ data: { repository: stableSnapshot(99) } })); const response = await POST(request({ ...input, expectedRepositoryId: 42 })); expect(response.status).toBe(409); expect(state.fetcher).toHaveBeenCalledOnce();
});
it("rejects invalid captured repository ids and authentication errors with cached users", async () => {
  expect((await POST(request({ ...input, expectedRepositoryId: 0 }))).status).toBe(400); expect(state.fetcher).not.toHaveBeenCalled(); state.authError = true; const response = await POST(request(input)); expect(response.status).toBe(401); expect(await response.text()).not.toContain("TEST_ONLY_PRIVATE_AUTH"); expect(state.fetcher).not.toHaveBeenCalled();
});
