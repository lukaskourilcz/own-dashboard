import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), render: vi.fn(), media: vi.fn(), lister: vi.fn(), feedback: vi.fn(async () => false), refresh: vi.fn(), freeSlot: vi.fn(), regenerate: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.user() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin() }));
vi.mock("@/lib/marketing/owner-feedback", () => ({ recordMarketingOwnerFeedback: mocks.feedback }));
vi.mock("@/lib/marketing/asset-urls", () => ({ refreshMarketingAssetUrls: mocks.refresh }));
vi.mock("@/lib/marketing/dneskai-wiring", () => ({ getRenderDneskaiDeck: () => mocks.render(), getDneskaiMediaLoader: (...args: unknown[]) => mocks.media(...args), getBriefAssetHashLister: (...args: unknown[]) => mocks.lister(...args), getBriefPoolLoader: () => async () => ({ media: [], primaryCandidateId: null }) }));
vi.mock("@/lib/marketing/dneskai-move", () => ({ dneskaiServerNextFreeSlot: mocks.freeSlot }));
vi.mock("@/lib/marketing/dneskai-paid-actions", () => ({
  DNESKAI_REGENERATE_NOTE_MAX: 1000, regenerateDneskaiRevision: mocks.regenerate,
  DneskaiPaidActionError: class DneskaiPaidActionError extends Error { constructor(readonly code: string, readonly status = 409) { super(code); } },
}));
import { POST } from "@/app/api/marketing/revisions/route";
import { DneskaiPaidActionError } from "@/lib/marketing/dneskai-paid-actions";
import { revisionContentHash } from "@/lib/marketing/hashes";
import { DNESKAI_RENDER_REPORT_VERSION, type ContentRevision, type DneskaiRenderReport } from "@/lib/marketing/contracts";
import { a, b, c, deckRevision, signed } from "./marketing-dneskai-revision-fixture";

const owner = "11111111-1111-4111-8111-111111111111";
const current = "33333333-3333-4333-8333-333333333333";
const saved = "66666666-6666-4666-8666-666666666666";
const account = "77777777-7777-4777-8777-777777777777";
const scheduledAt = () => new Date(Date.now() + 86400000).toISOString();
const request = (body: unknown) => new Request("https://own.example/api/marketing/revisions", { method: "POST", headers: { Origin: "https://own.example", "Content-Type": "application/json" }, body: JSON.stringify(body) });
type Rpc = { name: string; args: Record<string, unknown> };
function userDb(revision: ContentRevision, accounts: Record<string, unknown> = {}, approveError: { message: string } | null = null, renderReport: DneskaiRenderReport | null = null) {
  const rpc = vi.fn(async (name: string) => name === "marketing_approve_revision" ? (approveError ? { data: null, error: approveError } : { data: "88888888-8888-4888-8888-888888888888", error: null }) : { data: null, error: null });
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const query = { select: () => query, eq: (column: string, value: unknown) => { filters[column] = value; return query; },
      maybeSingle: async () => table === "marketing_accounts" ? { data: accounts[String(filters.id)] ?? null, error: null } : { data: { revision, content_hash: revisionContentHash(revision) }, error: null },
      single: async () => ({ data: { revision, slides: [], offline_import_receipt: null, render_report: renderReport }, error: null }) };
    return query;
  });
  return { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, from, rpc };
}
function adminDb() {
  const calls: Rpc[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: name === "marketing_save_revision" ? saved : null, error: null }; });
  return { db: { rpc }, calls };
}
const rendered = deckRevision().assets;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.render.mockReturnValue(vi.fn(async () => ({ status: "rendered", assets: rendered, renderKeys: [], problems: [] })));
  mocks.media.mockReturnValue(vi.fn(async () => Buffer.from("test-only")));
  mocks.lister.mockReturnValue(vi.fn(async () => [a, b, c]));
  mocks.refresh.mockImplementation(async (_db: unknown, _owner: string, assets: ContentRevision["assets"]) => assets.map((asset, i) => ({ ...asset, url: signed(i + 1, "renewed-test-only-token") })));
});
const cleanReport: DneskaiRenderReport = { schemaVersion: DNESKAI_RENDER_REPORT_VERSION, status: "rendered", renderKeys: ["k1", "k2", "k3"], renderedAt: "2026-10-20T09:00:00.000Z", problems: [] };

describe("POST /api/marketing/revisions deck edits (#118)", () => {
  it("saves an unready replacement, renders it with the injected media loader and attaches the rendered hash", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db); mocks.user.mockReturnValue(userDb(deckRevision()));
    const when = scheduledAt();
    const response = await POST(request({ action: "edit", id: current, caption: "Upravený caption.", scheduledAt: when,
      deck: { slides: [{ from: 1, headline: "Nový titulek", images: [{ slot: "image-1", assetSha256: c }, { slot: "image-2", assetSha256: a, crop: { focal: { x: 0.9, y: 0.1 } } }] }, { from: 0 }, { from: 2 }] } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const save = admin.calls.find((call) => call.name === "marketing_save_revision")!;
    expect(save.args).toMatchObject({ p_owner: owner, p_replace: current, p_ready: false, p_slides: [] });
    const unrendered = save.args.p_revision as ContentRevision;
    expect(unrendered).toMatchObject({ caption: "Upravený caption.", scheduledAt: when, assets: [] });
    expect(unrendered.deck!.slides[0]).toMatchObject({ type: "split", headline: "Nový titulek", images: [{ assetSha256: c }, { crop: { focal: { x: 0.9, y: 0.1 } } }] });
    expect(save.args.p_hash).toBe(revisionContentHash(unrendered));
    const render = mocks.render.mock.results[0]!.value as ReturnType<typeof vi.fn>;
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ owner, revisionId: saved, deck: unrendered.deck, loadMedia: mocks.media.mock.results[0]!.value }));
    expect(mocks.media).toHaveBeenCalledWith(admin.db, owner);
    const attach = admin.calls.find((call) => call.name === "marketing_attach_revision_render")!;
    const finalHash = revisionContentHash({ ...unrendered, assets: rendered });
    expect(attach.args).toMatchObject({ p_owner: owner, p_revision: saved, p_expected_hash: save.args.p_hash, p_hash: finalHash, p_ready: true });
    expect(body).toMatchObject({ id: saved, ready: true, contentHash: finalHash, render: { status: "rendered", problems: [] } });
    expect(mocks.feedback).toHaveBeenCalledWith(expect.objectContaining({ revisionId: saved, revisionHash: finalHash, decision: "edited" }), expect.anything(), expect.anything());
  });

  it("keeps the rendered JPEGs for a caption- or time-only edit: no render, same sha256s, a new hash that needs a new approval (review-03)", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db); mocks.user.mockReturnValue(userDb(deckRevision(), {}, null, cleanReport));
    const when = scheduledAt();
    const response = await POST(request({ action: "edit", id: current, caption: "Jen nový caption.", scheduledAt: when }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.render.mock.results[0]!.value).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledWith(admin.db, owner, deckRevision().assets);
    const save = admin.calls.find((call) => call.name === "marketing_save_revision")!;
    expect(save.args).toMatchObject({ p_replace: current, p_ready: false, p_slides: [] });
    const attach = admin.calls.find((call) => call.name === "marketing_attach_revision_render")!;
    const content = attach.args.p_content as ContentRevision;
    expect(content.assets.map((asset) => asset.sha256)).toEqual(deckRevision().assets.map((asset) => asset.sha256));
    expect(content).toMatchObject({ caption: "Jen nový caption.", scheduledAt: when });
    expect(attach.args).toMatchObject({ p_ready: true, p_report: cleanReport, p_expected_hash: save.args.p_hash });
    expect(attach.args.p_hash).toBe(revisionContentHash(content));
    expect(attach.args.p_hash).not.toBe(revisionContentHash(deckRevision()));
    expect(body).toMatchObject({ id: saved, ready: true, contentHash: attach.args.p_hash, render: { status: "rendered", problems: [] } });
  });

  it("renders when the deck changed, the previous render was not clean or its stored bytes cannot be re-verified", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db);
    mocks.user.mockReturnValue(userDb(deckRevision(), {}, null, cleanReport));
    await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt(), deck: { slides: [{ from: 0, headline: "Jiný titulek" }, { from: 1 }, { from: 2 }] } }));
    mocks.user.mockReturnValue(userDb(deckRevision(), {}, null, { ...cleanReport, status: "refused" }));
    await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt() }));
    mocks.user.mockReturnValue(userDb(deckRevision(), {}, null, cleanReport));
    mocks.refresh.mockRejectedValueOnce(new Error("stored-asset-hash-or-mime-invalid"));
    await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt() }));
    // One renderer instance is wired for every request in this test: three edits, three renders.
    expect(mocks.render.mock.results[0]!.value).toHaveBeenCalledTimes(3);
  });

  it("refuses before writing when the renderer is unwired or an image is outside the brief's media", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db); mocks.user.mockReturnValue(userDb(deckRevision()));
    mocks.render.mockImplementationOnce(() => { throw new Error("renderer-unwired"); });
    let response = await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt() }));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "renderer-unwired" });
    mocks.lister.mockImplementationOnce(() => { throw new Error("media-unwired"); });
    response = await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt() }));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "media-unwired" });
    response = await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt(), deck: { slides: [{ from: 0, images: [{ slot: "image-1", assetSha256: "9".repeat(64) }] }, { from: 1 }] } }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "deck-asset-outside-brief" });
    response = await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt(), deck: { slides: [{ from: 0 }] } }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "deck-edit-slide-count" });
    // A DNESKAi caption carries at most 10 hashtags (owner rule, 22 October 2026).
    const tags = (count: number) => ["#dneskai", ...Array.from({ length: count - 1 }, (_, n) => `#tema${n + 1}`)].join(" ");
    response = await POST(request({ action: "edit", id: current, caption: `Upravený caption.\n\n${tags(11)}`, scheduledAt: scheduledAt() }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "caption-hashtags-over-limit" });
    expect(admin.calls).toEqual([]);
    response = await POST(request({ action: "edit", id: current, caption: `Upravený caption.\n\n${tags(10)}`, scheduledAt: scheduledAt() }));
    expect(response.status).not.toBe(409);
  });

  it("records a refused render on the new revision and keeps it unready", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db); mocks.user.mockReturnValue(userDb(deckRevision()));
    mocks.render.mockReturnValueOnce(vi.fn(async () => ({ status: "refused", assets: [], renderKeys: [], problems: [{ slide: 0, code: "image-too-small", blocking: true, message: "short side 640 px" }] })));
    const response = await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt() }));
    const body = await response.json();
    expect(body).toMatchObject({ id: saved, ready: false, render: { status: "refused", problems: [{ code: "image-too-small", blocking: true }] } });
    expect(admin.calls.find((call) => call.name === "marketing_attach_revision_render")!.args).toMatchObject({ p_ready: false });
  });

  it("switches the account only to a verified account of the same brand and platform", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db);
    mocks.user.mockReturnValue(userDb(deckRevision(), { [account]: { brand: "dneskai", platform: "instagram", remote_account_id: "17841499999999999", handle: "dneskai.cz", verified_at: "2026-10-20T08:00:00Z" } }));
    expect((await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt(), accountId: account }))).status).toBe(200);
    expect((admin.calls[0]!.args.p_revision as ContentRevision).account).toEqual({ id: "17841499999999999", platform: "instagram", handle: "dneskai.cz" });
    mocks.user.mockReturnValue(userDb(deckRevision(), { [account]: { brand: "devshark", platform: "instagram", remote_account_id: "1", handle: "devshark", verified_at: "2026-10-20T08:00:00Z" } }));
    const refused = await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt(), accountId: account }));
    expect(refused.status).toBe(409); expect(await refused.json()).toEqual({ error: "account-unavailable" });
  });

  it("explains a refused approval and rejects a deck edit on a legacy revision", async () => {
    mocks.user.mockReturnValue(userDb(deckRevision(), {}, { message: "render blocked" }));
    const approval = await POST(request({ action: "approve", id: current, expectedHash: revisionContentHash(deckRevision()) }));
    expect(approval.status).toBe(409); expect(await approval.json()).toEqual({ error: "approval-unavailable", reason: "render-blocked" });
    const legacy = { ...deckRevision(), schemaVersion: "marketing-content/1" as const, deck: undefined };
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db); mocks.user.mockReturnValue(userDb(legacy));
    const response = await POST(request({ action: "edit", id: current, caption: "x", scheduledAt: scheduledAt(), deck: { slides: [{ from: 0 }, { from: 1 }] } }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "deck-edit-unsupported" });
    expect(admin.calls).toEqual([]);
  });

  describe("approval posts to no retired n8n receiver (audit finding cost-07)", () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
    it("approves one post and the day without a single outbound request, even with the old webhook variables set", async () => {
      vi.stubEnv("MARKETING_N8N_APPROVAL_WEBHOOK_URL", "https://bambambaklawa.app.n8n.cloud/webhook/approval");
      vi.stubEnv("MARKETING_N8N_WEBHOOK_SECRET", "a".repeat(32));
      const transport = vi.fn(async () => new Response(null, { status: 200 })); vi.stubGlobal("fetch", transport);
      mocks.user.mockReturnValue(userDb(deckRevision()));
      const single = await POST(request({ action: "approve", id: current, expectedHash: revisionContentHash(deckRevision()) }));
      expect(single.status).toBe(200);
      expect(await single.json()).toEqual({ publicationId: "88888888-8888-4888-8888-888888888888", scheduling: "tick" });
      const many = await POST(request({ action: "approve-many", posts: [{ id: current, expectedHash: revisionContentHash(deckRevision()) }] }));
      expect(many.status).toBe(200);
      expect(await many.json()).toEqual({ results: [{ id: current, ok: true, publicationId: "88888888-8888-4888-8888-888888888888", error: null }] });
      expect(transport).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/marketing/revisions publish-now", () => {
  const live = { MARKETING_PUBLISH_ENABLED: "true", MARKETING_DNESKAI_PUBLISH_ENABLED: "true" };
  // An expired post: its saved time has passed, which is exactly when the owner reaches for Publish now.
  const expired = () => ({ ...deckRevision(), scheduledAt: "2026-10-22T15:00:00.000Z" }) as ContentRevision;
  function publishDb(revision: ContentRevision, options: { status?: string; ready?: boolean; enabled?: boolean; approveError?: { message: string } } = {}) {
    const rpc = vi.fn(async (name: string) => name === "marketing_approve_revision" ? (options.approveError ? { data: null, error: options.approveError } : { data: "88888888-8888-4888-8888-888888888888", error: null }) : { data: null, error: null });
    const from = vi.fn((table: string) => {
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => table === "marketing_accounts" ? { data: { verified_at: "2026-10-22T14:17:08Z", enabled: options.enabled ?? true }, error: null }
          : { data: { revision, render_report: cleanReport, content_hash: revisionContentHash(revision), status: options.status ?? "review", ready: options.ready ?? true }, error: null } };
      return query;
    });
    return { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, from, rpc };
  }
  afterEach(() => { vi.unstubAllEnvs(); });

  it("moves the reviewed version two minutes ahead without re-rendering and approves the new hash", async () => {
    for (const [key, value] of Object.entries(live)) vi.stubEnv(key, value);
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db);
    const db = publishDb(expired()); mocks.user.mockReturnValue(db);
    const before = Date.now();
    const response = await POST(request({ action: "publish-now", id: current, expectedHash: revisionContentHash(expired()) }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.render.mock.results[0]!.value).not.toHaveBeenCalled();
    const save = admin.calls.find((call) => call.name === "marketing_save_revision")!;
    const moved = save.args.p_revision as ContentRevision;
    expect(moved).toMatchObject({ caption: expired().caption, deck: expired().deck, account: expired().account });
    const lead = Date.parse(moved.scheduledAt) - before;
    expect(lead).toBeGreaterThanOrEqual(2 * 60_000 - 50); expect(lead).toBeLessThan(2 * 60_000 + 5_000);
    const attach = admin.calls.find((call) => call.name === "marketing_attach_revision_render")!;
    expect(db.rpc).toHaveBeenCalledWith("marketing_approve_revision", { p_revision_id: saved, p_expected_hash: attach.args.p_hash });
    expect(body).toMatchObject({ id: saved, publicationId: "88888888-8888-4888-8888-888888888888", scheduledAt: moved.scheduledAt, scheduling: "tick" });
    expect(mocks.feedback).toHaveBeenCalledWith(expect.objectContaining({ revisionId: saved, decision: "approved" }), expect.anything(), expect.anything());
  });

  it("refuses before writing when the hash changed, the post is not in review, or publishing is off", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db);
    for (const [key, value] of Object.entries(live)) vi.stubEnv(key, value);
    mocks.user.mockReturnValue(publishDb(expired()));
    let response = await POST(request({ action: "publish-now", id: current, expectedHash: "0".repeat(64) }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "approval-unavailable", reason: "revision-changed" });
    mocks.user.mockReturnValue(publishDb(expired(), { status: "approved" }));
    response = await POST(request({ action: "publish-now", id: current, expectedHash: revisionContentHash(expired()) }));
    expect(await response.json()).toEqual({ error: "approval-unavailable", reason: "revision-not-ready" });
    mocks.user.mockReturnValue(publishDb(expired(), { enabled: false }));
    response = await POST(request({ action: "publish-now", id: current, expectedHash: revisionContentHash(expired()) }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "publishing-disabled" });
    vi.stubEnv("MARKETING_DNESKAI_PUBLISH_ENABLED", "false");
    mocks.user.mockReturnValue(publishDb(expired()));
    response = await POST(request({ action: "publish-now", id: current, expectedHash: revisionContentHash(expired()) }));
    expect(await response.json()).toEqual({ error: "publishing-disabled" });
    expect(admin.calls).toEqual([]);
  });

  it("returns the saved version and the approval's reason when approval refuses", async () => {
    for (const [key, value] of Object.entries(live)) vi.stubEnv(key, value);
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db);
    mocks.user.mockReturnValue(publishDb(expired(), { approveError: { message: "account unverified" } }));
    const response = await POST(request({ action: "publish-now", id: current, expectedHash: revisionContentHash(expired()) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "approval-unavailable", reason: "account-unverified", id: saved });
  });
});

describe("POST /api/marketing/revisions approve-at (owner decision 6)", () => {
  const missed = () => ({ ...deckRevision(), scheduledAt: "2026-10-22T10:30:00.000Z" }) as ContentRevision;
  const slot = "2026-10-22T15:00:00.000Z";
  function moveDb(revision: ContentRevision, options: { status?: string } = {}) {
    const rpc = vi.fn(async (name: string) => name === "marketing_approve_revision" ? { data: "88888888-8888-4888-8888-888888888888", error: null } : { data: null, error: null });
    const from = vi.fn(() => {
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { revision, render_report: cleanReport, content_hash: revisionContentHash(revision), status: options.status ?? "review", ready: true, project_id: "99999999-9999-4999-8999-999999999999" }, error: null }) };
      return query;
    });
    return { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, from, rpc };
  }

  it("moves exactly the reviewed version to the server's free slot without re-rendering and approves the new hash", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db); mocks.freeSlot.mockResolvedValue(slot);
    const db = moveDb(missed()); mocks.user.mockReturnValue(db);
    const response = await POST(request({ action: "approve-at", id: current, expectedHash: revisionContentHash(missed()), scheduledAt: slot }));
    expect(response.status).toBe(200);
    expect(mocks.freeSlot).toHaveBeenCalledWith(admin.db, owner, "99999999-9999-4999-8999-999999999999", [missed().scheduledAt], expect.any(Date));
    expect(mocks.render.mock.results[0]!.value).not.toHaveBeenCalled();
    const moved = admin.calls.find((call) => call.name === "marketing_save_revision")!.args.p_revision as ContentRevision;
    expect(moved).toMatchObject({ scheduledAt: slot, caption: missed().caption, deck: missed().deck, account: missed().account });
    const attach = admin.calls.find((call) => call.name === "marketing_attach_revision_render")!;
    expect(db.rpc).toHaveBeenCalledWith("marketing_approve_revision", { p_revision_id: saved, p_expected_hash: attach.args.p_hash });
    expect(await response.json()).toMatchObject({ id: saved, scheduledAt: slot, scheduling: "tick" });
  });

  it("refuses before writing when the slot shown is no longer the free one, none is free, or the version changed", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db); mocks.user.mockReturnValue(moveDb(missed()));
    mocks.freeSlot.mockResolvedValue("2026-10-22T18:00:00.000Z");
    let response = await POST(request({ action: "approve-at", id: current, expectedHash: revisionContentHash(missed()), scheduledAt: slot }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "slot-unavailable", scheduledAt: "2026-10-22T18:00:00.000Z" });
    mocks.freeSlot.mockResolvedValue(null);
    response = await POST(request({ action: "approve-at", id: current, expectedHash: revisionContentHash(missed()), scheduledAt: slot }));
    expect(await response.json()).toEqual({ error: "slot-none-free" });
    response = await POST(request({ action: "approve-at", id: current, expectedHash: "0".repeat(64), scheduledAt: slot }));
    expect(await response.json()).toEqual({ error: "approval-unavailable", reason: "revision-changed" });
    mocks.user.mockReturnValue(moveDb(missed(), { status: "returned" }));
    response = await POST(request({ action: "approve-at", id: current, expectedHash: revisionContentHash(missed()), scheduledAt: slot }));
    expect(await response.json()).toEqual({ error: "approval-unavailable", reason: "revision-not-ready" });
    expect(admin.calls).toEqual([]);
  });
});

describe("POST /api/marketing/revisions regenerate (owner decision 8)", () => {
  it("hands the note to the paid action and answers 202 with the job, or its refusal code", async () => {
    const admin = adminDb(); mocks.admin.mockReturnValue(admin.db); mocks.user.mockReturnValue(userDb(deckRevision()));
    mocks.regenerate.mockResolvedValueOnce({ jobId: saved, status: "queued", scheduling: "tick", duplicate: false });
    let response = await POST(request({ action: "regenerate", id: current, expectedHash: revisionContentHash(deckRevision()), note: "  Kratší titulek.  " }));
    expect(response.status).toBe(202);
    expect(mocks.regenerate).toHaveBeenCalledWith(expect.objectContaining({ owner, id: current, note: "Kratší titulek.", expectedHash: revisionContentHash(deckRevision()) }));
    mocks.regenerate.mockRejectedValueOnce(new DneskaiPaidActionError("dneskai-daily-generation-budget-exhausted"));
    response = await POST(request({ action: "regenerate", id: current, expectedHash: revisionContentHash(deckRevision()), note: "x" }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "dneskai-daily-generation-budget-exhausted" });
    response = await POST(request({ action: "regenerate", id: current, expectedHash: revisionContentHash(deckRevision()), note: "   " }));
    expect(response.status).toBe(400);
    response = await POST(request({ action: "regenerate", id: current, expectedHash: revisionContentHash(deckRevision()), note: "x".repeat(1001) }));
    expect(response.status).toBe(400);
    expect(mocks.regenerate).toHaveBeenCalledTimes(2);
  });
});
