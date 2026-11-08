import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { DNESKAI_FIELD_FACES, DNESKAI_PLACED_FIELDS, type DneskaiTextField } from "@/lib/marketing/dneskai-render";
import { DNESKAI_RENDERABLE_KIT_IDS, type DneskaiSlideType } from "@/lib/marketing/dneskai-slides";

const root = path.resolve(__dirname, "../..");
const assets = path.join(root, "templates/carousel-studio");

describe("OwnDashboard's slide engine (src/lib/carousel-studio, owned since 7 November 2026)", () => {
  it("finds every font and the DNESKAi kit under templates/carousel-studio from the project root", async () => {
    // Next bundles the engine, so it reads its assets from the project root, never from its own file location.
    const studio = await import("@/lib/carousel-studio");
    expect(realpathSync(studio.FONTS_DIRECTORY)).toBe(realpathSync(path.join(assets, "fonts")));
    expect(realpathSync(studio.BRAND_KITS_DIRECTORY)).toBe(realpathSync(path.join(assets, "brand-kits")));
    const fonts = studio.fontFiles();
    expect(fonts.length).toBeGreaterThanOrEqual(40);
    expect(fonts.filter((file) => !existsSync(file))).toEqual([]);
    expect(studio.readBrandKit("caught-up").problems).toEqual([]);
    for (const family of ["Space Grotesk", "Source Serif 4", "IBM Plex Mono", "IBM Plex Sans"]) expect(studio.FONT_FAMILIES).toContain(family);
  });

  it("exports the DNESKAi slide API and the face metrics, which is all the renderer imports", async () => {
    const slide = await import("@/lib/carousel-studio/dneskai-slide");
    expect(typeof slide.renderDneskaiSlide).toBe("function");
    expect(typeof slide.validateDneskaiSlide).toBe("function");
    const fonts = await import("@/lib/carousel-studio/fonts");
    expect(fonts.missingCommittedGlyphs(fonts.resolveFace("Space Grotesk", 700), "Žluťoučký kůň 🦈")).toEqual(["🦈"]);
    const renderer = readFileSync(path.join(root, "src/lib/marketing/dneskai-render.ts"), "utf8");
    const specifiers = [...renderer.matchAll(/(?:from\s+|import\(\s*)"(@\/lib\/carousel-studio[^"]*)"/g)].map((match) => match[1]);
    // Never the barrel: only the slide and font modules, so the route bundles stay small.
    expect(specifiers).toContain("@/lib/carousel-studio/dneskai-slide");
    expect(specifiers.filter((specifier) => !["@/lib/carousel-studio/dneskai-slide", "@/lib/carousel-studio/fonts"].includes(specifier))).toEqual([]);
    expect(readFileSync(path.join(root, "package.json"), "utf8")).not.toContain("@boardlessai/carousel-studio");
  });

  it("draws each written field in the face, and on the slide types, that the renderer's text gate assumes", async () => {
    const studio = await import("@/lib/carousel-studio");
    const brand = studio.CAROUSEL_BRANDS["caught-up"];
    const style = studio.kitStyleFor(brand);
    if (!style) throw new Error("the caught-up kit is missing");
    const dressed = studio.dressBrand(brand, style);
    const typeOf: Record<string, DneskaiSlideType> = {
      "dneskai-cover-photo": "cover-photo", "dneskai-figure": "figure", "dneskai-split": "split", "dneskai-split-pair": "split",
      "dneskai-statement": "statement", "dneskai-single-photo": "single", "dneskai-single-type": "single",
      ...Object.fromEntries(Array.from({ length: studio.DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => [`dneskai-sources-${count}`, "sources" as const])),
    };
    // A new template is a new place for copy: it fails here until the gate knows about it.
    expect([...studio.DNESKAI_PHOTO_TEMPLATES.keys()].sort()).toEqual(Object.keys(typeOf).sort());
    const codeOwned = new Set(["folio", "title", "images-label", "disclosure"]);
    for (const [id, type] of Object.entries(typeOf)) {
      const template = studio.kitTemplate(studio.DNESKAI_PHOTO_TEMPLATES.get(id)!, style);
      const drawn = new Set<string>();
      for (const layer of template.slides[0]!.layers) {
        if (layer.type !== "text" || codeOwned.has(layer.slot)) continue;
        const field = (layer.slot.startsWith("source-") ? "sources" : layer.slot) as DneskaiTextField;
        const family = dressed.fonts[layer.fontToken];
        expect({ id, field, family, weight: studio.resolveFace(family, layer.fontWeight).weight, uppercase: layer.uppercase })
          .toEqual({ id, field, ...(DNESKAI_FIELD_FACES as Record<string, object>)[field] });
        drawn.add(field);
      }
      expect({ id, fields: [...drawn].sort() }).toEqual({ id, fields: [...DNESKAI_PLACED_FIELDS[type]].sort() });
    }
  });

  it("offers exactly the kits the engine registers, each placing every field a deck carries", async () => {
    const slide = await import("@/lib/carousel-studio/dneskai-slide");
    expect([...slide.DNESKAI_KITS.keys()]).toEqual([...DNESKAI_RENDERABLE_KIT_IDS]);
    expect(DNESKAI_RENDERABLE_KIT_IDS[0]).toBe("editorial");
    // One copy deck sets in every kit, so a kit switch can never strand text the new kit does not draw.
    for (const kit of slide.DNESKAI_KITS.values()) {
      for (const type of Object.keys(DNESKAI_PLACED_FIELDS) as DneskaiSlideType[]) {
        expect({ kit: kit.id, type, fields: [...kit.placedFields[type]].sort() }).toEqual({ kit: kit.id, type, fields: [...DNESKAI_PLACED_FIELDS[type]].sort() });
      }
    }
    expect(slide.dneskaiKit("editorial")!.fieldFaces).toEqual(DNESKAI_FIELD_FACES);
  });

  it("traces the fonts and the kit into every marketing function, at the path the bundled studio reads at run time", () => {
    const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(config).toContain('const carouselStudioFiles = ["./templates/carousel-studio/fonts/**/*", "./templates/carousel-studio/brand-kits/**/*"];');
    expect(config).toContain('"/api/marketing/**": [...carouselStudioFiles, sharpLibvips],');
    const picomatch = createRequire(path.join(root, "package.json"))("next/dist/compiled/picomatch") as (glob: string) => (value: string) => boolean;
    for (const route of ["/api/marketing/jobs/[id]/execute", "/api/marketing/n8n", "/api/marketing/revisions"]) expect(picomatch("/api/marketing/**")(route)).toBe(true);
  });

  it("reproduces every pinned DNESKAi golden PNG with OwnDashboard's sharp and zod", async () => {
    const studio = await import("@/lib/carousel-studio");
    const golden = studio.DneskaiGoldenSchema.parse(JSON.parse(readFileSync(path.join(assets, "golden/dneskai-photo.json"), "utf8")));
    const cases = await studio.dneskaiGoldenCases();
    expect(cases.map((entry) => entry.name)).toEqual(golden.entries.map((entry) => entry.name));
    for (const { name, input } of cases) {
      const result = await studio.renderDneskaiSlide(input);
      const pinned = golden.entries.find((entry) => entry.name === name)!;
      expect({ name, status: result.status, template: result.template, pngHash: result.pngHash })
        .toEqual({ name, status: "rendered", template: { id: pinned.templateId, version: pinned.version }, pngHash: pinned.pngHash });
    }
  }, 60000);

  it("renders the golden cases in every other kit, byte for byte where the kit pins that case", async () => {
    const studio = await import("@/lib/carousel-studio");
    const cases = await studio.dneskaiGoldenCases();
    for (const kit of DNESKAI_RENDERABLE_KIT_IDS.filter((id) => id !== "editorial")) {
      const golden = studio.DneskaiGoldenSchema.parse(JSON.parse(readFileSync(path.join(assets, `golden/dneskai-${kit}.json`), "utf8")));
      for (const { name, input } of cases) {
        const result = await studio.renderDneskaiSlide({ ...input, kit });
        expect({ kit, name, status: result.status, kitName: result.kit, truncated: result.truncatedSlots }).toEqual({ kit, name, status: "rendered", kitName: kit, truncated: [] });
        const pinned = golden.entries.find((entry) => entry.name === name);
        if (pinned) expect({ kit, name, pngHash: result.pngHash }).toEqual({ kit, name, pngHash: pinned.pngHash });
      }
    }
  }, 240000);
});

describe('uppercase layers keep brand case (owner, 8 November 2026)', () => {
  it('sets DNESKAi as written inside capitals', async () => {
    const { uppercaseKeepingBrands } = await import('@/lib/carousel-studio/renderer');
    expect(uppercaseKeepingBrands('Sleduj DNESKAi', 'cs')).toBe('SLEDUJ DNESKAi');
    expect(uppercaseKeepingBrands('Změní adresu', 'cs')).toBe('ZMĚNÍ ADRESU');
  });

  it("sets a series post's label above the cover headline in the photo-led kits, and ignores it elsewhere (8 November 2026)", async () => {
    const studio = await import("@/lib/carousel-studio");
    const cover = (await studio.dneskaiGoldenCases()).find((entry) => entry.name === "cover-photo")!.input;
    for (const kit of ["spotlight", "plakat", "videofirst"] as const) {
      const plain = await studio.renderDneskaiSlide({ ...cover, kit });
      const series = await studio.renderDneskaiSlide({ ...cover, kit, series: "Tipy od tvůrce Claude Code Borise Chernyho #16" });
      expect({ kit, status: series.status, truncated: series.truncatedSlots, blocking: series.problems.filter((problem) => problem.blocking) }).toEqual({ kit, status: "rendered", truncated: [], blocking: [] });
      expect(series.pngHash).not.toBe(plain.pngHash);
    }
    const editorial = await studio.renderDneskaiSlide({ ...cover, kit: "editorial" });
    expect((await studio.renderDneskaiSlide({ ...cover, kit: "editorial", series: "Slovník AI #1" })).pngHash).toBe(editorial.pngHash);
  }, 60000);
});

