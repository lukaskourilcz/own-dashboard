import { describe, expect, it } from "vitest";
import { MARKETING_CONTENT_VERSION, parseContentRevision, renderReportBlocks, revisionReadiness, type ContentRevision } from "@/lib/marketing/contracts";
import { contentHash, revisionContentHash, revisionHash, revisionWithoutDeliveryUrls } from "@/lib/marketing/hashes";
import { DNESKAI_SLIDES_VERSION, type DneskaiDeck } from "@/lib/marketing/dneskai-slides";
import { a, b, deck, deckRevision, signed } from "./marketing-dneskai-revision-fixture";

const legacy = (): ContentRevision => ({ ...deckRevision(), schemaVersion: MARKETING_CONTENT_VERSION, deck: undefined });

describe("approval identity without delivery URLs (#118)", () => {
  it("keeps the hash when only signed URLs are renewed", () => {
    const revision = deckRevision();
    const renewed = { ...revision, assets: revision.assets.map((asset, index) => ({ ...asset, url: signed(index + 1, "renewed-test-only-token") })) };
    expect(revisionContentHash(renewed)).toBe(revisionContentHash(revision));
    expect(contentHash(renewed)).not.toBe(contentHash(revision));
    expect(revisionHash).toBe(revisionContentHash);
    expect(JSON.stringify(revisionWithoutDeliveryUrls(revision))).not.toContain("token=");
  });
  it("changes the hash for a focal point, zoom, fit, image swap, slide order, text, asset bytes, alt, account and schedule", () => {
    const base = deckRevision(); const hash = revisionContentHash(base);
    const variants: Array<(r: ContentRevision) => void> = [
      (r) => { r.deck!.slides[0]!.images[0]!.crop = { focal: { x: 0.5, y: 0.41 } }; },
      (r) => { r.deck!.slides[1]!.images[1]!.crop!.zoom = 1.6; },
      (r) => { r.deck!.slides[1]!.images[1]!.crop!.fit = "contain"; },
      (r) => { r.deck!.slides[0]!.images[0]!.assetSha256 = b; },
      (r) => { r.deck!.slides.reverse(); },
      (r) => { r.deck!.slides[1]!.body = "Upravený text slidu."; },
      (r) => { r.assets[0]!.sha256 = a; },
      (r) => { r.assets[1]!.alt = "Jiný alt"; },
      (r) => { r.caption = "Jiný caption."; },
      (r) => { r.account.handle = "dneskai.cz"; },
      (r) => { r.scheduledAt = "2099-10-21T15:00:00Z"; },
      (r) => { r.collaborators = ["partner.account"]; },
    ];
    for (const mutate of variants) { const changed = structuredClone(base); mutate(changed); expect(revisionContentHash(changed)).not.toBe(hash); }
  });
});

describe("deck revision contract", () => {
  it("requires a matching deck on marketing-content/2 and none on marketing-content/1", () => {
    expect(parseContentRevision(deckRevision()).deck?.slides).toHaveLength(3);
    expect(parseContentRevision(legacy()).deck).toBeUndefined();
    expect(() => parseContentRevision({ ...legacy(), deck: deck() })).toThrow();
    expect(() => parseContentRevision({ ...deckRevision(), deck: undefined })).toThrow();
    expect(() => parseContentRevision({ ...deckRevision(), brand: "devshark" })).toThrow();
    expect(() => parseContentRevision({ ...deckRevision(), format: "post" })).toThrow();
    expect(() => parseContentRevision({ ...deckRevision(), format: "story" })).toThrow();
    // #165: a carousel deck may publish as a Reel; it keeps its carousel deck and slide JPEGs.
    expect(parseContentRevision({ ...deckRevision(), format: "reel" }).deck?.format).toBe("carousel");
    expect(() => parseContentRevision({ ...deckRevision(), account: { ...deckRevision().account, platform: "threads" } })).toThrow();
    const single: DneskaiDeck = { schemaVersion: DNESKAI_SLIDES_VERSION, format: "single-image", slides: [{ type: "single", variant: "photo", headline: "Oznámení", images: [{ slot: "image-1", assetSha256: a }], alt: "Oznámení" }] };
    const post = parseContentRevision({ ...deckRevision(), format: "post", deck: single, assets: [deckRevision().assets[0]] });
    expect(post.deck?.format).toBe("single-image");
    expect(revisionReadiness(post)).toEqual([]);
  });
  it("holds an unrendered or mismatched deck before approval", () => {
    expect(revisionReadiness(deckRevision())).toEqual([]);
    expect(revisionReadiness({ ...deckRevision(), assets: [] })).toEqual(["missing-assets", "carousel-needs-two-assets", "deck-render-required"]);
    expect(revisionReadiness({ ...deckRevision(), assets: deckRevision().assets.slice(0, 2) })).toEqual(["deck-assets-mismatch"]);
    expect(revisionReadiness(legacy())).toEqual([]);
  });
  it("treats blocking or unreadable render reports as blocking", () => {
    const report = { schemaVersion: "dneskai-render-report/1", status: "rendered", problems: [], renderKeys: [], renderedAt: "2026-10-20T10:00:00Z" };
    expect(renderReportBlocks(null)).toBe(false);
    expect(renderReportBlocks(report)).toBe(false);
    expect(renderReportBlocks({ ...report, problems: [{ slide: 0, code: "text-clipped", blocking: false, message: "advisory" }] })).toBe(false);
    expect(renderReportBlocks({ ...report, status: "refused", problems: [{ slide: 0, code: "image-too-small", blocking: true, message: "short side 640 px" }] })).toBe(true);
    expect(renderReportBlocks({ ...report, status: "refused" })).toBe(true);
    expect(renderReportBlocks({ status: "rendered" })).toBe(true);
  });
});
