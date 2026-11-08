import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import provenance from "../../../templates/marketing/provenance.json";
import devsharkDesign from "../../../templates/marketing/devshark/derived-layout.json";
import { MarketingRenderError } from "./render";
import { DevsharkDeckSchema, type DevsharkDeck } from "./devshark-deck";
import { STUDIO_FACES } from "@/lib/design-studio/metrics";
import { devsharkPlain, layoutDevsharkSlide, layoutDevsharkStory, STORY_HEIGHT, STORY_WIDTH, type StudioAssets, type StudioWarning } from "@/lib/design-studio/devshark-layout";
export { DevsharkDeckSchema, DevsharkSlideSchema, type DevsharkDeck, type DevsharkSlide } from "./devshark-deck";
export { devsharkPlain, devsharkSlideTheme, devsharkTokens } from "@/lib/design-studio/devshark-layout";

/**
 * devShark slides as published (owner request, 7 November 2026): the Design Studio's shared layout
 * (`layoutDevsharkSlide`) rasterised with the pinned fonts and brand pictures, so the JPEG matches what the owner
 * placed in the editor. The look follows the posts on @devshark.app without the small corner fin or a page counter.
 * Positions are never refused; warnings travel with each slide.
 */
export const DEVSHARK_SOCIAL_RENDERER = "devshark-social/2";

export type DevsharkRenderedSlide = { svg: string; jpeg: Buffer; sha256: string; width: 1080; height: 1350; alt: string; warnings: StudioWarning[] };
export type DevsharkRenderedStory = { svg: string; jpeg: Buffer; sha256: string; width: typeof STORY_WIDTH; height: typeof STORY_HEIGHT; alt: string; warnings: StudioWarning[] };

const FONT_IDS = ["manrope-700", "manrope-800", "jetbrains-mono-400"];
const themeBackground = (theme: "light" | "dark" | "green") => (theme === "green" ? "#2D7A2D" : theme === "dark" ? "#0B141B" : "#F3F6F1");

/** Loads the pinned fonts and brand pictures, verifying every hash. Shared by the slide and the story renderers. */
async function loadDevsharkRenderAssets(): Promise<{ fontFiles: string[]; assets: StudioAssets }> {
  const root = path.join(process.cwd(), "templates", "marketing");
  const fontFiles = await Promise.all(FONT_IDS.map(async (id) => {
    const face = STUDIO_FACES[id]!;
    const bytes = await readFile(path.join(root, "fonts", face.file));
    const expected = provenance.fonts.find((candidate) => candidate.file === face.file);
    if (!expected || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw new MarketingRenderError("font-hash-mismatch");
    return path.join(root, "fonts", face.file);
  }));
  const data: Record<string, string> = {};
  for (const [file, sha256] of Object.entries(devsharkDesign.assets as Record<string, string>)) {
    const bytes = await readFile(path.join(root, "devshark", file));
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new MarketingRenderError("design-asset-hash-mismatch");
    data[file] = `data:image/svg+xml;base64,${bytes.toString("base64")}`;
  }
  const assets: StudioAssets = { finGreen: data["devshark-fin-clean-green.svg"]!, finInk: data["devshark-fin-clean-ink.svg"]!, logoWhite: data["devshark-logo-horizontal-white.svg"]! };
  return { fontFiles, assets };
}

/** Rasterises a layout SVG to a JPEG on a flat theme ground (so no edge is left transparent or letterboxed). */
async function rasterise(svg: string, theme: "light" | "dark" | "green", fontFiles: string[]): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const { default: sharp } = await import("sharp");
  const png = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: "Manrope" } }).render().asPng();
  return sharp(Buffer.from(png)).flatten({ background: themeBackground(theme) }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}

/** Renders every slide of a deck to a 1080 × 1350 JPEG. */
export async function renderDevsharkDeck(value: DevsharkDeck): Promise<DevsharkRenderedSlide[]> {
  const deck = DevsharkDeckSchema.parse(value);
  const { fontFiles, assets } = await loadDevsharkRenderAssets();
  const rendered: DevsharkRenderedSlide[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    const layout = layoutDevsharkSlide(deck, index, assets);
    const jpeg = await rasterise(layout.svg, layout.theme, fontFiles);
    const alt = [devsharkPlain(slide.headline), slide.body ? devsharkPlain(slide.body) : "", slide.code ?? ""].filter(Boolean).join(". ").slice(0, 1000);
    rendered.push({ svg: layout.svg, jpeg, sha256: createHash("sha256").update(jpeg).digest("hex"), width: 1080, height: 1350, alt, warnings: layout.warnings });
  }
  return rendered;
}

/**
 * Renders a deck's cover as one native 1080 × 1920 Instagram story that fills the whole 9:16 frame — no letterbox and
 * no blurred bands (owner rule, 8 November 2026). The cover's design, kicker and headline are re-laid out inside the
 * story safe zone by `layoutDevsharkStory`, then rasterised exactly like a slide.
 */
export async function renderDevsharkStory(value: DevsharkDeck): Promise<DevsharkRenderedStory> {
  const deck = DevsharkDeckSchema.parse(value);
  const { fontFiles, assets } = await loadDevsharkRenderAssets();
  const layout = layoutDevsharkStory(deck, assets);
  const jpeg = await rasterise(layout.svg, layout.theme, fontFiles);
  const cover = deck.slides[0]!;
  const alt = [devsharkPlain(cover.headline), cover.body ? devsharkPlain(cover.body) : ""].filter(Boolean).join(". ").slice(0, 1000);
  return { svg: layout.svg, jpeg, sha256: createHash("sha256").update(jpeg).digest("hex"), width: STORY_WIDTH, height: STORY_HEIGHT, alt, warnings: layout.warnings };
}
