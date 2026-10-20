import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { DNESKAI_STUDIO } from "@/lib/marketing/dneskai-render";

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

  it("exports the DNESKAi slide API alone, which is all the renderer imports", async () => {
    const slide = await import("@boardlessai/carousel-studio/dneskai-slide");
    expect(typeof slide.renderDneskaiSlide).toBe("function");
    expect(typeof slide.validateDneskaiSlide).toBe("function");
    const renderer = readFileSync(path.join(root, "src/lib/marketing/dneskai-render.ts"), "utf8");
    const specifiers = [...renderer.matchAll(/(?:from\s+|import\(\s*)"(@boardlessai\/carousel-studio[^"]*)"/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThanOrEqual(2);
    expect(new Set(specifiers)).toEqual(new Set(["@boardlessai/carousel-studio/dneskai-slide"]));
  });

  it("traces the fonts and the kit into every marketing function, at the path the bundled studio reads at run time", () => {
    const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(config).toContain('const carouselStudioFiles = ["./vendor/carousel-studio/fonts/**/*", "./vendor/carousel-studio/brand-kits/**/*"];');
    expect(config).toContain('"/api/marketing/**": carouselStudioFiles,');
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
});
