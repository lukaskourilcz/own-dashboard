import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), render: vi.fn(), media: vi.fn(), lister: vi.fn(), feedback: vi.fn(async () => false), notify: vi.fn(async () => ({ status: "skipped" })) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.user() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin() }));
vi.mock("@/lib/marketing/owner-feedback", () => ({ recordMarketingOwnerFeedback: mocks.feedback }));
vi.mock("@/lib/marketing/approval-notification", () => ({ notifyMarketingApproval: mocks.notify }));
vi.mock("@/lib/marketing/dneskai-wiring", () => ({ getRenderDneskaiDeck: () => mocks.render(), getDneskaiMediaLoader: (...args: unknown[]) => mocks.media(...args), getBriefAssetHashLister: (...args: unknown[]) => mocks.lister(...args), getBriefPoolLoader: () => async () => ({ media: [], primaryCandidateId: null }) }));
import { POST } from "@/app/api/marketing/revisions/route";
import { revisionContentHash } from "@/lib/marketing/hashes";
import type { ContentRevision } from "@/lib/marketing/contracts";
import { a, b, c, deckRevision } from "./marketing-dneskai-revision-fixture";

const owner = "11111111-1111-4111-8111-111111111111";
const current = "33333333-3333-4333-8333-333333333333";
const saved = "66666666-6666-4666-8666-666666666666";
const account = "77777777-7777-4777-8777-777777777777";
const scheduledAt = () => new Date(Date.now() + 86400000).toISOString();
const request = (body: unknown) => new Request("https://own.example/api/marketing/revisions", { method: "POST", headers: { Origin: "https://own.example", "Content-Type": "application/json" }, body: JSON.stringify(body) });
type Rpc = { name: string; args: Record<string, unknown> };
function userDb(revision: ContentRevision, accounts: Record<string, unknown> = {}, approveError: { message: string } | null = null) {
  const rpc = vi.fn(async (name: string) => name === "marketing_approve_revision" ? (approveError ? { data: null, error: approveError } : { data: "88888888-8888-4888-8888-888888888888", error: null }) : { data: null, error: null });
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const query = { select: () => query, eq: (column: string, value: unknown) => { filters[column] = value; return query; },
      maybeSingle: async () => table === "marketing_accounts" ? { data: accounts[String(filters.id)] ?? null, error: null } : { data: { revision, content_hash: revisionContentHash(revision) }, error: null },
      single: async () => ({ data: { revision, slides: [], offline_import_receipt: null }, error: null }) };
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
});

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
    expect(admin.calls).toEqual([]);
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
});
