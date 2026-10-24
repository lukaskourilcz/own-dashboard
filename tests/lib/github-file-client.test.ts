import { afterEach, expect, it, vi } from "vitest";
import { commitFile, loadRepoFile } from "@/lib/github";

const input = { intent: "edit" as const, owner: "owner", repo: "repo", path: "notes/test.md", content: "Reviewed text", message: "Update note", expectedSha: "a".repeat(40) };
const result = { path: input.path, updated: true, unchanged: false, commit: { sha: "b".repeat(40), html_url: "https://github.com/owner/repo/commit/fixture" }, content: { sha: "c".repeat(40), html_url: "https://github.com/owner/repo/blob/main/notes/test.md" } };
afterEach(() => vi.unstubAllGlobals());
it("sends the reviewed edit intent/version and accepts only a complete receipt", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => { expect(url).toBe("/api/github/commit"); expect(init?.method).toBe("POST"); return Response.json(result); }); vi.stubGlobal("fetch", fetcher);
  expect(await commitFile(input)).toEqual({ ok: true, result });
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual(input);
});
it.each([{}, { ...result, path: "other.md" }, { ...result, commit: null }, { ...result, commit: { ...result.commit, html_url: "https://other.example" } }, { ...result, content: { sha: "bad" } }])("refuses malformed/foreign success receipts", async body => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
  expect(await commitFile(input)).toMatchObject({ ok: false, status: 502 });
});
it("confirms identical content without requiring a new commit", async () => {
  const unchanged = { ...result, unchanged: true, commit: null };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(unchanged)));
  expect(await commitFile(input)).toEqual({ ok: true, result: unchanged });
});
it("rejects UTF-8 byte overflow and invalid paths before sending a request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await commitFile({ ...input, content: "🚀".repeat(250001) })).toMatchObject({ ok: false, status: 413 });
  expect(await commitFile({ ...input, path: "../private" })).toMatchObject({ ok: false, status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 409, 502])("keeps an HTTP %s failure distinct without returning its body", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ private: "invented-fixture" }, { status })));
  expect(await commitFile(input)).toEqual({ ok: false, status, error: "commit-unconfirmed" });
});
it("refuses oversized or invalid JSON receipts", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(" ".repeat(32769))));
  expect(await commitFile(input)).toMatchObject({ ok: false, status: 502 });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{")));
  expect(await commitFile(input)).toMatchObject({ ok: false });
});
it("requires a file version before exposing editable content", async () => {
  const file = { content: input.content, html_url: result.content.html_url, sha: input.expectedSha };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(file)));
  expect(await loadRepoFile("owner", "repo", input.path)).toEqual({ kind: "ok", content: file.content, htmlUrl: file.html_url, sha: file.sha });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: "" })));
  expect(await loadRepoFile("owner", "repo", input.path)).toEqual({ kind: "error" });
});
it("does not send a file write after caller cancellation", async () => {
  const controller = new AbortController(); controller.abort(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await commitFile(input, controller.signal)).toMatchObject({ ok: false, status: 0 }); expect(fetcher).not.toHaveBeenCalled();
});
it("settles an unresponsive commit without accepting its late receipt", async () => {
  const controller = new AbortController(); let release!: (reply: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; })); vi.stubGlobal("fetch", fetcher);
  const pending = commitFile(input, controller.signal); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); controller.abort();
  expect(await pending).toEqual({ ok: false, status: 0, error: "commit-unconfirmed" });
  expect(fetcher.mock.calls[0]).toBeDefined(); release(Response.json(result));
});
it("settles a stalled file body when its caller aborts", async () => {
  const controller = new AbortController(); vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start() {} }))));
  const pending = loadRepoFile("owner", "repo", input.path, controller.signal); controller.abort();
  expect(await pending).toEqual({ kind: "error" });
});
