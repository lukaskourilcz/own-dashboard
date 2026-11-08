import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { dneskaiMarkedWords, dneskaiPlainText } from "@/lib/carousel-studio/dneskai-slide";
import { dneskaiClosingBytes, dneskaiClosingCardBytes, previewDneskaiSlide } from "@/lib/marketing/dneskai-render";
import { DNESKAI_CLOSING_CARD_SHA256, DNESKAI_CLOSING_SHA256, dneskaiClosingSlide, isDneskaiClosingSlide } from "@/lib/marketing/dneskai-closing";
import { createHash } from "node:crypto";

describe("key-word marks (Plakát, 8 November 2026)", () => {
  it("strips the marks and flags the marked words in order", () => {
    expect(dneskaiMarkedWords("Alexa umí [[100+]] nových [[nákupních funkcí]]")).toEqual({ plain: "Alexa umí 100+ nových nákupních funkcí", flags: [false, false, true, false, true, true] });
    expect(dneskaiMarkedWords("Bez značek")).toEqual({ plain: "Bez značek", flags: null });
    expect(dneskaiMarkedWords("[[OpenAI]], Anthropic")).toEqual({ plain: "OpenAI, Anthropic", flags: [true, false] });
    expect(dneskaiPlainText("Sleduj [[DNESKAi]]")).toBe("Sleduj DNESKAi");
  });

  it("colours only the marked words in Plakát and draws plain words in kits without an emphasis colour", async () => {
    const studio = await import("@/lib/carousel-studio");
    const input = (await studio.dneskaiGoldenCases()).find((entry) => entry.name === "cover-photo")!.input;
    const marked = { ...input, headline: "Alexa umí [[100+]] nových nákupních funkcí" };
    const plakat = await studio.renderDneskaiSlide({ ...marked, kit: "plakat" });
    expect(plakat.status).toBe("rendered");
    expect(plakat.payload?.strings.headline).toBe("Alexa umí 100+ nových nákupních funkcí");
    expect(plakat.payload?.emphasis).toEqual({ headline: [false, false, true, false, false, false] });
    const spotlight = await studio.renderDneskaiSlide({ ...marked, kit: "spotlight" });
    const plain = await studio.renderDneskaiSlide({ ...input, headline: "Alexa umí 100+ nových nákupních funkcí", kit: "spotlight" });
    expect(spotlight.payload?.emphasis).toBeUndefined();
    expect(spotlight.pngHash).toBe(plain.pngHash);
  }, 60000);
});

describe("the closing slide (8 November 2026)", () => {
  it("is a figure with the pinned Higgsfield picture and the follow line", async () => {
    const slide = dneskaiClosingSlide();
    expect(slide).toMatchObject({ type: "figure", headline: "Sleduj [[DNESKAi]]", body: "pro všechny novinky ze světa AI a technologií. @dneskai" });
    expect(isDneskaiClosingSlide(slide)).toBe(true);
    const bytes = await dneskaiClosingBytes();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(DNESKAI_CLOSING_SHA256);
  });

  it("draws the finished card in every generation kit, not a kit layout (owner, evening of 8 November 2026)", async () => {
    const card = await dneskaiClosingCardBytes();
    expect(createHash("sha256").update(card).digest("hex")).toBe(DNESKAI_CLOSING_CARD_SHA256);
    const sharp = (await import("sharp")).default;
    expect(await sharp(card).metadata()).toMatchObject({ width: 1080, height: 1350 });
    const cover = { type: "cover-photo" as const, headline: "Titulek", images: [{ slot: "image-1", assetSha256: "a".repeat(64) }], alt: "Fotka." };
    const keys = new Set<string>();
    for (const kit of ["spotlight", "plakat"] as const) {
      const deck = { schemaVersion: "dneskai-slides/1", format: "carousel", kit, slides: [cover, dneskaiClosingSlide()] } as never;
      const preview = await previewDneskaiSlide(deck, 1, () => Promise.reject(new Error("no media")));
      expect(preview.status).toBe("rendered");
      keys.add(createHash("sha256").update(preview.image!).digest("hex"));
    }
    expect(keys.size).toBe(1);
  }, 60000);
});
