import { beforeEach, describe, expect, it, vi } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const sourceId = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({ user: null as string | null, settings: [] as Record<string, unknown>[], sources: [] as Record<string, unknown>[], rpc: vi.fn(), process: vi.fn(), after: [] as (() => Promise<void>)[] }));
function db() {
  return {
    auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }) },
    rpc: state.rpc,
    from(table: string) {
      const rows = () => (table === "marketing_collection_settings" ? state.settings : state.sources);
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      const result = () => ({ data: rows().filter((row) => filters.every((f) => f(row))), error: null, count: rows().filter((row) => filters.every((f) => f(row))).length });
      const query = {
        select: () => query, order: () => query, limit: () => query, not: () => query,
        eq(k: string, v: unknown) { filters.push((row) => row[k] === v); return query; },
        maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
        upsert: async (value: Record<string, unknown>) => { state.settings = [...state.settings.filter((s) => s.user_id !== value.user_id), value]; return { error: null }; },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
  };
}
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }));
vi.mock("@/lib/marketing/ig-collection-runner", () => ({ processCollectionQueue: (...args: unknown[]) => state.process(...args) }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (task: () => Promise<void>) => { state.after.push(task); } }));
import { POST as share } from "@/app/api/marketing/knowledge/share/route";
import { GET, POST } from "@/app/api/marketing/collection/route";
import { hashShareToken } from "@/lib/marketing/ig-collection-token";

const owned = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/marketing/collection", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
const shared = (token: string | null, body: unknown = { url: "https://www.instagram.com/reel/ABC123/?igsh=xyz" }) => new Request("http://localhost/api/marketing/knowledge/share", { method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const imported = (patch: Record<string, unknown> = {}) => ({ data: { added: 1, skipped: 0, skippedCollection: 0, skippedTips: 0, sourceIds: [sourceId], highWater: null, ...patch }, error: null });

beforeEach(() => {
  state.user = owner; state.settings = []; state.sources = []; state.after = [];
  state.rpc.mockReset(); state.rpc.mockResolvedValue(imported()); state.process.mockReset(); state.process.mockResolvedValue({ results: [], costUsd: 0 });
});

async function rotate() {
  const response = await POST(owned({ action: "rotate-token" }));
  return (await response.json()).token as string;
}

describe("IG Kolekce share token", () => {
  it("is shown once and stored only as its hash", async () => {
    const token = await rotate();
    expect(token).toMatch(/^igk_[A-Za-z0-9_-]{43}$/);
    expect(state.settings[0]).toMatchObject({ user_id: owner, share_token_hash: hashShareToken(token) });
    expect(JSON.stringify(state.settings)).not.toContain(token);
  });

  it("rejects a missing, malformed or wrong token before any write", async () => {
    await rotate();
    for (const token of [null, "nope", `igk_${"a".repeat(43)}`]) expect((await share(shared(token))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("stops accepting the old token after a rotation", async () => {
    const first = await rotate();
    expect((await share(shared(first))).status).toBe(200);
    const second = await rotate();
    expect((await share(shared(first))).status).toBe(401);
    expect((await share(shared(second))).status).toBe(200);
    await POST(owned({ action: "revoke-token" }));
    expect((await share(shared(second))).status).toBe(401);
  });

  it("stores the shared post as queued and never starts processing", async () => {
    const token = await rotate();
    const response = await share(shared(token, { text: "Look at this https://www.instagram.com/creator/p/ABC123/ nice" }));
    expect(await response.json()).toEqual({ status: "added", shortcode: "ABC123" });
    expect(state.rpc).toHaveBeenCalledWith("marketing_collection_import", expect.objectContaining({ p_owner: owner, p_provenance: "manual", p_rows: [expect.objectContaining({ shortcode: "ABC123" })] }));
    expect(state.after).toHaveLength(0); expect(state.process).not.toHaveBeenCalled();
  });

  it("reports a post already in IG TIPS and rejects text without a post URL", async () => {
    const token = await rotate();
    state.rpc.mockResolvedValue(imported({ added: 0, skipped: 1, skippedTips: 1 }));
    expect(await (await share(shared(token))).json()).toEqual({ status: "already-in-tips", shortcode: "ABC123" });
    expect((await share(shared(token, { url: "https://www.instagram.com/creator/saved/ideas/1/" }))).status).toBe(400);
  });
});

describe("IG Kolekce owner API", () => {
  it("requires the owner session and same origin", async () => {
    expect((await POST(owned({ action: "add-urls", text: "https://www.instagram.com/p/ABC/" }, "https://evil.example"))).status).toBe(403);
    state.user = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(owned({ action: "rotate-token" }))).status).toBe(401);
  });

  it("imports export rows and pasted URLs without processing them", async () => {
    await POST(owned({ action: "import", rows: [{ shortcode: "AAA", saved_at: "2026-11-01T10:00:00.000Z", author: "creator", collections: ["Tipy"] }] }));
    expect(state.rpc).toHaveBeenLastCalledWith("marketing_collection_import", expect.objectContaining({ p_provenance: "instagram-export" }));
    const response = await POST(owned({ action: "add-urls", text: "https://www.instagram.com/p/AAA/\nhttps://www.instagram.com/reel/BBB/ https://example.com/x" }));
    expect(await response.json()).toMatchObject({ added: 1, rejected: 1 });
    expect(state.rpc.mock.lastCall?.[1].p_rows.map((r: { shortcode: string }) => r.shortcode)).toEqual(["AAA", "BBB"]);
    expect(state.after).toHaveLength(0);
  });

  it("processes only on an explicit consent click", async () => {
    expect((await POST(owned({ action: "process" }))).status).toBe(400);
    expect((await POST(owned({ action: "process", consent: false }))).status).toBe(400);
    state.sources = [{ id: sourceId, user_id: owner, collection_status: "queued" }];
    const response = await POST(owned({ action: "process", consent: true }));
    expect(response.status).toBe(202);
    await state.after[0]();
    expect(state.process).toHaveBeenCalledWith(owner, { consent: true, sourceIds: [sourceId] }, {}, expect.any(Number));
  });

  it("requeues one post on Re-process and refuses one that is running", async () => {
    state.rpc.mockResolvedValue({ data: 1, error: null });
    expect((await POST(owned({ action: "reprocess", consent: true, sourceId }))).status).toBe(202);
    expect(state.rpc).toHaveBeenCalledWith("marketing_collection_requeue", { p_owner: owner, p_sources: [sourceId] });
    state.rpc.mockResolvedValue({ data: 0, error: null }); state.sources = [{ id: sourceId, user_id: owner, collection_status: "scraping" }];
    expect((await POST(owned({ action: "reprocess", consent: true, sourceId }))).status).toBe(409);
  });

  it("returns the header line with the IG TIPS count", async () => {
    state.settings = [{ user_id: owner, high_water_saved_at: "2026-11-01T10:00:00Z", last_run_at: null, last_import_at: null, share_token_created_at: null }];
    state.sources = [{ id: sourceId, user_id: owner, shortcode: "AAA", canonical_url: "https://www.instagram.com/p/AAA/", collection_status: "done", collections: [], ai_link_id: null }];
    const body = await (await GET()).json();
    expect(body.overview).toMatchObject({ highWater: "2026-11-01T10:00:00Z", count: 1, hasShareToken: false });
    expect(body.posts[0]).toMatchObject({ shortcode: "AAA", status: "done" });
  });
});
