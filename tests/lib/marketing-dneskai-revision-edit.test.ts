import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { applyDneskaiDeckEdit, prepareDneskaiRevisionEdit, renderAndAttachDneskaiRevision, reusableDneskaiRender, DneskaiRevisionEditError } from "@/lib/marketing/dneskai-revision-edit";
import { DNESKAI_RENDER_REPORT_VERSION, MARKETING_CONTENT_VERSION, type ContentRevision, type DneskaiRenderReport } from "@/lib/marketing/contracts";
import type { RenderDneskaiDeck } from "@/lib/marketing/dneskai-ports";
import { revisionContentHash } from "@/lib/marketing/hashes";
import { a, b, c, deck, deckRevision } from "./marketing-dneskai-revision-fixture";

const owner = "11111111-1111-4111-8111-111111111111";
const revisionId = "55555555-5555-4555-8555-555555555555";
const code = async (run: () => unknown) => { try { await run(); } catch (error) { return error instanceof DneskaiRevisionEditError ? error.code : String(error); } return null; };
const pool = (hashes = [a, b, c]) => vi.fn(async () => hashes);
const rendered = deckRevision().assets;

describe("owner deck edits", () => {
  it("edits text, swaps an image from the pool, changes a crop, reorders and removes a slide", () => {
    const next = applyDneskaiDeckEdit(deck(), { slides: [
      { from: 1, headline: "Nový titulek", body: null, images: [{ slot: "image-2", assetSha256: c, crop: { focal: { x: 0.1, y: 0.9 } } }, { slot: "image-1", assetSha256: b }] },
      { from: 0, kicker: "NÁSTROJ", images: [{ slot: "image-1", assetSha256: a, crop: { focal: { x: 0.3, y: 0.3 }, zoom: 2 } }] },
    ] });
    expect(next.slides.map((slide) => slide.type)).toEqual(["split", "cover-photo"]);
    expect(next.slides[0]).toMatchObject({ headline: "Nový titulek", images: [{ slot: "image-1", assetSha256: b }, { slot: "image-2", assetSha256: c, crop: { focal: { x: 0.1, y: 0.9 } } }] });
    expect(next.slides[0]!.body).toBeUndefined();
    expect(next.slides[1]).toMatchObject({ kicker: "NÁSTROJ", headline: deck().slides[0]!.headline, images: [{ crop: { focal: { x: 0.3, y: 0.3 }, zoom: 2 } }] });
  });
  it("refuses duplicated or unknown slides, changed slots, a one-slide carousel and an invalid crop", async () => {
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0 }, { from: 0 }] }))).toBe("deck-edit-slide-invalid");
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0 }, { from: 5 }] }))).toBe("deck-edit-slide-invalid");
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0, images: [] }, { from: 1 }] }))).toBe("deck-edit-slots-changed");
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0, images: [{ slot: "image-2", assetSha256: a }] }, { from: 1 }] }))).toBe("deck-edit-slots-changed");
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 1, images: [{ slot: "image-1", assetSha256: a }, { slot: "image-1", assetSha256: b }] }, { from: 0 }] }))).toBe("deck-edit-slots-changed");
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0 }] }))).toBe("deck-edit-slide-count");
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0, images: [{ slot: "image-1", assetSha256: a, crop: { focal: { x: 2, y: 0 } } }] }, { from: 1 }] }))).toBe("deck-edit-invalid");
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0, headline: " " }, { from: 1 }] }))).toBe("deck-edit-invalid");
  });
  it("prepares an unrendered revision whose images all come from the brief's media", async () => {
    const list = pool();
    const next = await prepareDneskaiRevisionEdit(deckRevision(), { caption: "Nový caption.", scheduledAt: "2099-10-22T06:00:00Z", deck: { slides: [{ from: 2 }, { from: 0 }] } }, list);
    expect(list).toHaveBeenCalledWith(deckRevision());
    expect(next).toMatchObject({ caption: "Nový caption.", scheduledAt: "2099-10-22T06:00:00Z", assets: [], sources: deckRevision().sources, traceId: deckRevision().traceId });
    expect(next.deck!.slides.map((slide) => slide.type)).toEqual(["statement", "cover-photo"]);
    expect(await code(() => prepareDneskaiRevisionEdit(deckRevision(), { caption: "x", scheduledAt: "2099-10-22T06:00:00Z" }, pool([a])))).toBe("deck-asset-outside-brief");
    expect(await code(() => prepareDneskaiRevisionEdit(deckRevision(), { caption: "x", scheduledAt: "2099-10-22T06:00:00Z", deck: { slides: [{ from: 0, images: [{ slot: "image-1", assetSha256: "9".repeat(64) }] }, { from: 1 }] } }, pool()))).toBe("deck-asset-outside-brief");
    expect(await code(() => prepareDneskaiRevisionEdit(deckRevision(), { caption: "x", scheduledAt: "2099-10-22T06:00:00Z", account: { id: "1", platform: "threads", handle: "dneskai" } }, pool()))).toBe("account-platform-changed");
    expect(await code(() => prepareDneskaiRevisionEdit({ ...deckRevision(), schemaVersion: MARKETING_CONTENT_VERSION, deck: undefined }, { caption: "x", scheduledAt: "2099-10-22T06:00:00Z" }, pool()))).toBe("deck-edit-unsupported");
  });
  it("brings a deck saved before the 22 October 2026 rules into line on every edit", async () => {
    const legacy = { ...deck(), slides: [
      { ...deck().slides[0]!, kicker: "MODEL", credit: "Foto: The Verge" },
      { ...deck().slides[1]!, credit: "Foto: The Verge · Obrázek: OpenAI" },
      { type: "sources" as const, headline: "", sources: ["The Verge, 20. 10. 2026"], images: [], alt: "Zdroje" },
    ] };
    const next = await prepareDneskaiRevisionEdit({ ...deckRevision(), deck: legacy }, { caption: "x", scheduledAt: "2099-10-22T06:00:00Z" }, pool());
    // No sources slide, no credit, and the cover keeps its headline alone; nothing else changes.
    expect(next.deck!.slides).toEqual([deck().slides[0], deck().slides[1]]);
    expect(next.assets).toEqual([]);
  });
});

describe("render and attach", () => {
  const unrendered = (): ContentRevision => ({ ...deckRevision(), assets: [] });
  function database(error: unknown = null) {
    const rpc = vi.fn(async () => ({ data: null, error }));
    return { db: { rpc } as unknown as Parameters<typeof renderAndAttachDneskaiRevision>[0], rpc };
  }
  const loadMedia = vi.fn(async () => Buffer.from("test-only"));
  const now = () => new Date("2026-10-20T10:00:00Z");
  it("attaches one JPEG per slide and the rendered hash", async () => {
    const render = vi.fn<RenderDneskaiDeck>(async () => ({ status: "rendered", assets: rendered, renderKeys: ["k1", "k2", "k3"], problems: [{ slide: 1, code: "text-tight", blocking: false, message: "advisory" }] }));
    const { db, rpc } = database();
    const result = await renderAndAttachDneskaiRevision(db, owner, { revisionId, revision: unrendered() }, { render, loadMedia, now });
    expect(render).toHaveBeenCalledWith({ owner, revisionId, deck: deck(), loadMedia, signal: undefined });
    expect(result).toMatchObject({ ready: true, contentHash: revisionContentHash({ ...unrendered(), assets: rendered }), report: { status: "rendered", renderKeys: ["k1", "k2", "k3"] } });
    expect(rpc).toHaveBeenCalledWith("marketing_attach_revision_render", expect.objectContaining({ p_owner: owner, p_revision: revisionId, p_expected_hash: revisionContentHash(unrendered()),
      p_content: { ...unrendered(), assets: rendered }, p_hash: result.contentHash, p_ready: true }));
  });
  it("keeps a refused, failed or incomplete render unready with its problems recorded", async () => {
    const cases: Array<[RenderDneskaiDeck, string]> = [
      [async () => ({ status: "refused", assets: [], renderKeys: [], problems: [{ slide: 0, code: "image_too_small", blocking: true, message: "short side 640 px" }] }), "image-too-small"],
      [async () => { throw new Error("private renderer detail"); }, "render-unavailable"],
      [async () => ({ status: "rendered", assets: rendered.slice(0, 2), renderKeys: [], problems: [] }), "deck-assets-mismatch"],
      [async () => ({ status: "rendered", assets: [{ ...rendered[0]!, url: "http://insecure.example/a.jpg" }, ...rendered.slice(1)], renderKeys: [], problems: [] }), "render-assets-invalid"],
      [async () => ({ status: "rendered", assets: rendered, renderKeys: [], problems: [{ slide: 0, code: "clipped", message: "no flag" } as never] }), "clipped"],
    ];
    for (const [render, problem] of cases) {
      const { db, rpc } = database();
      const result = await renderAndAttachDneskaiRevision(db, owner, { revisionId, revision: unrendered() }, { render, loadMedia, now });
      expect(result.ready, problem).toBe(false);
      expect(result.contentHash).toBe(revisionContentHash(unrendered()));
      expect(result.report.problems.map((p) => p.code), problem).toContain(problem);
      expect(result.report.problems.some((p) => p.blocking)).toBe(true);
      expect(JSON.stringify(result.report)).not.toContain("private renderer detail");
      expect(rpc).toHaveBeenCalledWith("marketing_attach_revision_render", expect.objectContaining({ p_content: unrendered(), p_ready: false }));
    }
  });
  it("reports a refused attachment and never renders a revision that already has assets", async () => {
    const render = vi.fn<RenderDneskaiDeck>(async () => ({ status: "rendered", assets: rendered, renderKeys: [], problems: [] }));
    expect(await code(() => renderAndAttachDneskaiRevision(database({ message: "revision not renderable" }).db, owner, { revisionId, revision: unrendered() }, { render, loadMedia, now }))).toBe("render-attach-failed");
    render.mockClear();
    expect(await code(() => renderAndAttachDneskaiRevision(database().db, owner, { revisionId, revision: deckRevision() }, { render, loadMedia, now }))).toBe("revision-not-renderable");
    expect(render).not.toHaveBeenCalled();
  });
});

describe("an edit that leaves the deck unchanged (review-03)", () => {
  const clean: DneskaiRenderReport = { schemaVersion: DNESKAI_RENDER_REPORT_VERSION, status: "rendered", renderKeys: ["k1", "k2", "k3"], renderedAt: "2026-10-20T09:00:00.000Z",
    problems: [{ slide: 1, code: "text-tight", blocking: false, message: "advisory" }] };
  const edited = async (input: Parameters<typeof prepareDneskaiRevisionEdit>[1]) => prepareDneskaiRevisionEdit(deckRevision(), input, pool());
  function database() {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    return { db: { rpc } as unknown as Parameters<typeof renderAndAttachDneskaiRevision>[0], rpc };
  }
  const loadMedia = vi.fn(async () => Buffer.from("test-only"));

  it("reuses the previous JPEGs for a caption-, time- or account-only edit, never for a changed deck or an unclean render", async () => {
    const captionOnly = await edited({ caption: "Jen nový caption.", scheduledAt: "2099-10-21T06:00:00Z" });
    const timeOnly = await edited({ caption: deckRevision().caption, scheduledAt: "2099-10-22T07:30:00Z" });
    const accountOnly = await edited({ caption: deckRevision().caption, scheduledAt: deckRevision().scheduledAt, account: { id: "17841499999999999", platform: "instagram", handle: "dneskai.cz" } });
    const sameDeckResent = await edited({ caption: "x", scheduledAt: "2099-10-21T06:00:00Z", deck: { slides: [{ from: 0 }, { from: 1 }, { from: 2 }] } });
    for (const next of [captionOnly, timeOnly, accountOnly, sameDeckResent]) expect(reusableDneskaiRender(deckRevision(), clean, next)).toEqual({ assets: deckRevision().assets, report: clean });
    const reordered = await edited({ caption: "x", scheduledAt: "2099-10-21T06:00:00Z", deck: { slides: [{ from: 1 }, { from: 0 }, { from: 2 }] } });
    const retext = await edited({ caption: "x", scheduledAt: "2099-10-21T06:00:00Z", deck: { slides: [{ from: 0, headline: "Jiný titulek" }, { from: 1 }, { from: 2 }] } });
    const recrop = await edited({ caption: "x", scheduledAt: "2099-10-21T06:00:00Z", deck: { slides: [{ from: 0, images: [{ slot: "image-1", assetSha256: a, crop: { focal: { x: 0.1, y: 0.1 } } }] }, { from: 1 }, { from: 2 }] } });
    for (const next of [reordered, retext, recrop]) expect(reusableDneskaiRender(deckRevision(), clean, next)).toBeNull();
    for (const report of [null, undefined, { ...clean, status: "refused" }, { ...clean, problems: [{ slide: 0, code: "clipped", blocking: true, message: "x" }] }, { status: "rendered" }])
      expect(reusableDneskaiRender(deckRevision(), report, captionOnly)).toBeNull();
    expect(reusableDneskaiRender({ ...deckRevision(), assets: [] }, clean, captionOnly)).toBeNull();
    expect(reusableDneskaiRender({ ...deckRevision(), assets: deckRevision().assets.slice(0, 2) }, clean, captionOnly)).toBeNull();
  });

  it("attaches the same sha256s under a new content hash without calling the renderer", async () => {
    const next = await edited({ caption: "Jen nový caption.", scheduledAt: "2099-10-22T07:30:00Z" });
    expect(next.assets).toEqual([]);
    const reuse = reusableDneskaiRender(deckRevision(), clean, next)!;
    const render = vi.fn<RenderDneskaiDeck>();
    const { db, rpc } = database();
    const result = await renderAndAttachDneskaiRevision(db, owner, { revisionId, revision: next }, { render, loadMedia, now: () => new Date("2026-10-22T12:00:00Z"), reuse });
    expect(render).not.toHaveBeenCalled();
    const attached = (rpc.mock.calls[0] as unknown as [string, { p_content: ContentRevision; p_hash: string; p_ready: boolean; p_report: DneskaiRenderReport }])[1];
    expect(attached.p_content.assets.map((asset) => asset.sha256)).toEqual(deckRevision().assets.map((asset) => asset.sha256));
    expect(attached.p_ready).toBe(true);
    expect(attached.p_report).toEqual(clean);
    expect(result).toMatchObject({ ready: true, reused: true, report: clean });
    expect(result.contentHash).toBe(revisionContentHash({ ...next, assets: deckRevision().assets }));
    expect(result.contentHash).not.toBe(revisionContentHash(deckRevision()));
  });

  it("still renders a changed deck", async () => {
    const next = await edited({ caption: "x", scheduledAt: "2099-10-21T06:00:00Z", deck: { slides: [{ from: 1 }, { from: 0 }, { from: 2 }] } });
    const render = vi.fn<RenderDneskaiDeck>(async () => ({ status: "rendered", assets: rendered, renderKeys: [], problems: [] }));
    const result = await renderAndAttachDneskaiRevision(database().db, owner, { revisionId, revision: next }, { render, loadMedia, reuse: reusableDneskaiRender(deckRevision(), clean, next) });
    expect(render).toHaveBeenCalledTimes(1);
    expect(result.reused).toBe(false);
  });
});
