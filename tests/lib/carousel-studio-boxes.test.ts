import { describe, expect, it } from "vitest";
import { applyDneskaiBoxes, clampDneskaiBox, dneskaiAutoBoxes } from "@/lib/carousel-studio/dneskai-boxes";

describe("hand placement of DNESKAi words (Design Studio)", () => {
  it("draws a slide unchanged without boxes and moves only the placed field with them", async () => {
    const studio = await import("@/lib/carousel-studio");
    const cases = await studio.dneskaiGoldenCases();
    const statement = cases.find((entry) => entry.input.type === "statement")!;
    const input = { ...statement.input, kit: "spotlight" as const };
    const plain = await studio.renderDneskaiSlide(input);
    const empty = await studio.renderDneskaiSlide({ ...input, layout: {} });
    expect(plain.status).toBe("rendered");
    expect(empty.pngHash).toBe(plain.pngHash);
    const headline = plain.blocks.find((block) => block.field === "headline")!;
    expect(headline.box.w).toBeGreaterThan(0);

    const moved = await studio.renderDneskaiSlide({ ...input, layout: { headline: { ...headline.box, x: 72, y: 200, w: 700, size: 64, align: "left" } } });
    expect(moved.status).toBe("rendered");
    expect(moved.pngHash).not.toBe(plain.pngHash);
    expect(moved.blocks.find((block) => block.field === "headline")!.box).toEqual({ x: 72, y: 200, w: 700, size: 64, align: "left" });
    const body = (slide: typeof plain) => slide.blocks.find((block) => block.field === "body")?.box;
    expect(body(moved)).toEqual(body(plain));
  }, 60000);

  it("refuses a placed field its frame cuts, as clipped copy", async () => {
    const studio = await import("@/lib/carousel-studio");
    const statement = (await studio.dneskaiGoldenCases()).find((entry) => entry.input.type === "statement")!;
    const result = await studio.renderDneskaiSlide({ ...statement.input, kit: "spotlight", headline: "Velmi dlouhý titulek, který se do úzkého rámečku nevejde", layout: { headline: { x: 900, y: 1200, w: 80, size: 200, align: "left" } } });
    expect(result.problems.map((problem) => problem.code)).toContain("text-clipped");
  }, 60000);

  it("keeps a box on the canvas and leaves templates without the field alone", async () => {
    expect(clampDneskaiBox({ x: 2000, y: -40, w: 5000, size: 900, align: "center" })).toEqual({ x: 0, y: 0, w: 1080, size: 200, align: "center" });
    const studio = await import("@/lib/carousel-studio");
    const kit = studio.dneskaiKit("spotlight")!;
    const template = kit.resolve("statement", undefined, []);
    if (!("schemaVersion" in template)) throw new Error("no statement template");
    expect(applyDneskaiBoxes(template, { kicker: { x: 0, y: 0, w: 400, size: 30, align: "left" } }).slides[0]!.layers).toEqual(template.slides[0]!.layers.filter(() => true).map((layer) => layer.type === "text" && layer.slot === "kicker" ? expect.anything() : layer));
    expect(dneskaiAutoBoxes(template).map((block) => block.field)).toContain("headline");
  });
});

describe("placed words over a photograph", () => {
  it("draws a placed field after every other layer", async () => {
    const studio = await import("@/lib/carousel-studio");
    const kit = studio.dneskaiKit("editorial")!;
    const template = kit.resolve("figure", undefined, ["image-1"]);
    if (!("schemaVersion" in template)) throw new Error("no figure template");
    const layers = applyDneskaiBoxes(template, { headline: { x: 100, y: 600, w: 800, size: 60, align: "left" } }).slides[0]!.layers;
    const last = layers.at(-1)!;
    expect(last.type === "text" && last.slot).toBe("headline");
    expect(layers).toHaveLength(template.slides[0]!.layers.length);
  });
});
