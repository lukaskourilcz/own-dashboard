import { describe, expect, it } from "vitest";
import { DneskaiDeckSchema, DneskaiSlideSchema, DNESKAI_SLIDES_VERSION, dneskaiDeckAssetHashes } from "@/lib/marketing/dneskai-slides";

const a = "a".repeat(64);
const b = "b".repeat(64);

describe("DNESKAi slide contract", () => {
  it("accepts a carousel with images referenced by hash and crop", () => {
    const deck = DneskaiDeckSchema.parse({
      schemaVersion: DNESKAI_SLIDES_VERSION,
      format: "carousel",
      slides: [
        { type: "cover-photo", headline: "Titulek", kicker: "NÁSTROJ", images: [{ slot: "image-1", assetSha256: a, crop: { focal: { x: 0.5, y: 0.3 }, zoom: 1.2 } }], alt: "Fotka" },
        { type: "split", headline: "Dvě fotky", images: [{ slot: "image-1", assetSha256: b }, { slot: "image-2", assetSha256: a }], alt: "Dvě fotky" },
        { type: "sources", headline: "", sources: ["The Verge, 20. 10. 2026"], images: [], alt: "Zdroje" },
      ],
    });
    expect(dneskaiDeckAssetHashes(deck)).toEqual([a, b]);
  });

  it("rejects duplicate slots, URL-like image references and missing headlines", () => {
    expect(() => DneskaiSlideSchema.parse({ type: "split", headline: "x", images: [{ slot: "image-1", assetSha256: a }, { slot: "image-1", assetSha256: b }], alt: "x" })).toThrow();
    expect(() => DneskaiSlideSchema.parse({ type: "figure", headline: "x", images: [{ slot: "image-1", assetSha256: "https://example.com/a.jpg" }], alt: "x" })).toThrow();
    expect(() => DneskaiSlideSchema.parse({ type: "figure", headline: " ", images: [], alt: "x" })).toThrow();
  });

  it("keeps single-image posts and carousels apart", () => {
    const single = { type: "single", variant: "type", headline: "Oznámení", images: [], alt: "Oznámení" };
    expect(DneskaiDeckSchema.safeParse({ schemaVersion: DNESKAI_SLIDES_VERSION, format: "single-image", slides: [single] }).success).toBe(true);
    expect(DneskaiDeckSchema.safeParse({ schemaVersion: DNESKAI_SLIDES_VERSION, format: "carousel", slides: [single, single] }).success).toBe(false);
    expect(DneskaiDeckSchema.safeParse({ schemaVersion: DNESKAI_SLIDES_VERSION, format: "single-image", slides: [{ ...single, type: "figure", variant: undefined }] }).success).toBe(false);
  });
});
