import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { DNESKAI_EMPHASIS_HEXES } from "@/lib/marketing/dneskai-palette";

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };

/**
 * Backlog "Klíčová slova na modrých slidech bez barvy" (owner default, 8 November 2026): none of the ten key-word
 * colours reads on the icy blue statement ground, so its key words stay dark like the words around them.
 */
describe("key words on the icy blue statement slide", () => {
  it("has no key-word colour that reads on icy blue as large text", () => {
    for (const hex of DNESKAI_EMPHASIS_HEXES) expect(contrast(hex, "#6ec1ff")).toBeLessThan(3);
  });

  it.each(["spotlight", "plakat"] as const)("draws marked words in %s exactly like unmarked ones, in every post colour", async (kit) => {
    const studio = await import("@/lib/carousel-studio");
    const input = (await studio.dneskaiGoldenCases()).find((entry) => entry.name === "statement")!.input;
    const plain = await studio.renderDneskaiSlide({ ...input, kit, headline: "Smyšlený výrok na modré ploše má jedno klíčové slovo." });
    expect(plain.status).toBe("rendered");
    const colours = kit === "spotlight" ? DNESKAI_EMPHASIS_HEXES : DNESKAI_EMPHASIS_HEXES.slice(0, 3);
    for (const emphasisColor of colours) {
      const marked = await studio.renderDneskaiSlide({ ...input, kit, emphasisColor, headline: "Smyšlený výrok na modré ploše má jedno [[klíčové slovo]]." });
      expect(marked.status).toBe("rendered");
      expect(marked.payload?.emphasis?.headline?.some(Boolean)).toBe(true);
      expect(marked.pngHash).toBe(plain.pngHash);
    }
  }, 180000);

  it("still colours the key words on the ink statement", async () => {
    const studio = await import("@/lib/carousel-studio");
    const input = (await studio.dneskaiGoldenCases()).find((entry) => entry.name === "statement-ink")!.input;
    const plain = await studio.renderDneskaiSlide({ ...input, kit: "spotlight", headline: "Tentýž výrok má jedno klíčové slovo." });
    const marked = await studio.renderDneskaiSlide({ ...input, kit: "spotlight", emphasisColor: "#f472b6", headline: "Tentýž výrok má jedno [[klíčové slovo]]." });
    expect(marked.pngHash).not.toBe(plain.pngHash);
  }, 60000);
});
