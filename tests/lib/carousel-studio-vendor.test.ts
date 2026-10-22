import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { DNESKAI_FIELD_FACES, DNESKAI_PLACED_FIELDS, DNESKAI_STUDIO, type DneskaiTextField } from "@/lib/marketing/dneskai-render";
import { DNESKAI_RENDERABLE_KIT_IDS, type DneskaiSlideType } from "@/lib/marketing/dneskai-slides";

const root = path.resolve(__dirname, "../..");
const vendor = path.join(root, "vendor/carousel-studio");
const upstream = readFileSync(path.join(vendor, "UPSTREAM.md"), "utf8");

/** The hash `scripts/vendor-carousel-studio.sh` records: sha256 of the sorted `sha256sum` lines of every file but UPSTREAM.md. */
function treeHash(directory: string): string {
  const files: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (next !== "./UPSTREAM.md") files.push(next);
    }
  };
  walk(".");
  files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const listing = files.map((file) => `${createHash("sha256").update(readFileSync(path.join(directory, file))).digest("hex")}  ${file}\n`).join("");
  return createHash("sha256").update(listing).digest("hex");
}

describe("vendored @boardlessai/carousel-studio", () => {
  it("is exactly the recorded build: tree hash, commit and version agree with UPSTREAM.md and the renderer pin", () => {
    const recorded = /^- Tree sha256: `([0-9a-f]{64})`$/m.exec(upstream)?.[1];
    const commit = /^- Commit: `([0-9a-f]{40})`$/m.exec(upstream)?.[1];
    expect(treeHash(vendor)).toBe(recorded);
    expect(DNESKAI_STUDIO.treeSha256).toBe(recorded);
    expect(DNESKAI_STUDIO.commit).toBe(commit);
    const manifest = JSON.parse(readFileSync(path.join(vendor, "package.json"), "utf8"));
    expect(Object.keys(manifest)).toEqual(["name", "version", "type", "exports", "dependencies"]);
    expect(manifest.name).toBe(DNESKAI_STUDIO.package);
    expect(manifest.version).toBe(DNESKAI_STUDIO.version);
  });

  it("resolves through node_modules to one copy of sharp, resvg and zod shared with OwnDashboard", () => {
    const fromProject = createRequire(path.join(root, "package.json"));
    const fromStudio = createRequire(path.join(vendor, "package.json"));
    const packageJson = realpathSync(path.join(root, "node_modules/@boardlessai/carousel-studio/package.json"));
    expect(packageJson).toBe(realpathSync(path.join(vendor, "package.json")));
    for (const dependency of ["sharp", "@resvg/resvg-js", "zod"]) {
      expect(realpathSync(fromStudio.resolve(dependency))).toBe(realpathSync(fromProject.resolve(dependency)));
    }
    const declared = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).dependencies;
    expect(declared["@boardlessai/carousel-studio"]).toBe("file:vendor/carousel-studio");
  });

  it("imports the way a route handler does and finds every font and the DNESKAi kit beside its own module", async () => {
    // Route handlers reach the studio through `await import(...)` in dneskai-render.ts; the
    // package resolves its fonts and kits from import.meta.url, so they must sit next to dist/.
    const studio = await import("@boardlessai/carousel-studio");
    expect(realpathSync(studio.FONTS_DIRECTORY)).toBe(realpathSync(path.join(vendor, "fonts")));
    expect(realpathSync(studio.BRAND_KITS_DIRECTORY)).toBe(realpathSync(path.join(vendor, "brand-kits")));
    const fonts = studio.fontFiles();
    expect(fonts.length).toBeGreaterThanOrEqual(40);
    expect(fonts.filter((file) => !existsSync(file))).toEqual([]);
    expect(studio.readBrandKit("caught-up").problems).toEqual([]);
    for (const family of ["Space Grotesk", "Source Serif 4", "IBM Plex Mono", "IBM Plex Sans"]) expect(studio.FONT_FAMILIES).toContain(family);
  });

  it("exports the DNESKAi slide API and the face metrics, which is all the renderer imports", async () => {
    const slide = await import("@boardlessai/carousel-studio/dneskai-slide");
    expect(typeof slide.renderDneskaiSlide).toBe("function");
    expect(typeof slide.validateDneskaiSlide).toBe("function");
    const fonts = await import("@boardlessai/carousel-studio/fonts");
    expect(fonts.missingCommittedGlyphs(fonts.resolveFace("Space Grotesk", 700), "Žluťoučký kůň 🦈")).toEqual(["🦈"]);
    const renderer = readFileSync(path.join(root, "src/lib/marketing/dneskai-render.ts"), "utf8");
    const specifiers = [...renderer.matchAll(/(?:from\s+|import\(\s*)"(@boardlessai\/carousel-studio[^"]*)"/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThanOrEqual(2);
    // Never the barrel: only the two subpaths the vendored manifest adds.
    expect(specifiers).toContain("@boardlessai/carousel-studio/dneskai-slide");
    expect(specifiers.filter((specifier) => !["@boardlessai/carousel-studio/dneskai-slide", "@boardlessai/carousel-studio/fonts"].includes(specifier))).toEqual([]);
  });

  it("draws each written field in the face, and on the slide types, that the renderer's text gate assumes", async () => {
    const studio = await import("@boardlessai/carousel-studio");
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

  it("offers exactly the kits the vendored studio registers, each placing every field a deck carries", async () => {
    const slide = await import("@boardlessai/carousel-studio/dneskai-slide");
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
    expect(config).toContain('const carouselStudioFiles = ["./vendor/carousel-studio/fonts/**/*", "./vendor/carousel-studio/brand-kits/**/*"];');
    expect(config).toContain('"/api/marketing/**": [...carouselStudioFiles, sharpLibvips],');
    const picomatch = createRequire(path.join(root, "package.json"))("next/dist/compiled/picomatch") as (glob: string) => (value: string) => boolean;
    for (const route of ["/api/marketing/jobs/[id]/execute", "/api/marketing/n8n", "/api/marketing/revisions"]) expect(picomatch("/api/marketing/**")(route)).toBe(true);
  });

  it("reproduces every pinned DNESKAi golden PNG with OwnDashboard's sharp and zod", async () => {
    const studio = await import("@boardlessai/carousel-studio");
    const golden = studio.DneskaiGoldenSchema.parse(JSON.parse(readFileSync(path.join(vendor, "golden/dneskai-photo.json"), "utf8")));
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
    const studio = await import("@boardlessai/carousel-studio");
    const cases = await studio.dneskaiGoldenCases();
    for (const kit of DNESKAI_RENDERABLE_KIT_IDS.filter((id) => id !== "editorial")) {
      const golden = studio.DneskaiGoldenSchema.parse(JSON.parse(readFileSync(path.join(vendor, `golden/dneskai-${kit}.json`), "utf8")));
      for (const { name, input } of cases) {
        const result = await studio.renderDneskaiSlide({ ...input, kit });
        expect({ kit, name, status: result.status, kitName: result.kit, truncated: result.truncatedSlots }).toEqual({ kit, name, status: "rendered", kitName: kit, truncated: [] });
        const pinned = golden.entries.find((entry) => entry.name === name);
        if (pinned) expect({ kit, name, pngHash: result.pngHash }).toEqual({ kit, name, pngHash: pinned.pngHash });
      }
    }
  }, 240000);
});
