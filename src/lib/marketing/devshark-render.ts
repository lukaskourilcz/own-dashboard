import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import provenance from "../../../templates/marketing/provenance.json";
import devsharkDesign from "../../../templates/marketing/devshark/derived-layout.json";
import { MarketingRenderError } from "./render";
import { DevsharkDeckSchema, type DevsharkDeck } from "./devshark-deck";
import { STUDIO_FACES } from "@/lib/design-studio/metrics";
import { devsharkPlain, layoutDevsharkSlide, type StudioWarning } from "@/lib/design-studio/devshark-layout";
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

const FONT_IDS = ["manrope-700", "manrope-800", "jetbrains-mono-400"];

/** Renders every slide of a deck to a 1080 × 1350 JPEG. */
export async function renderDevsharkDeck(value: DevsharkDeck): Promise<DevsharkRenderedSlide[]> {
  const deck = DevsharkDeckSchema.parse(value);
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
  const assets = { finGreen: data["devshark-fin-clean-green.svg"]!, finInk: data["devshark-fin-clean-ink.svg"]!, logoWhite: data["devshark-logo-horizontal-white.svg"]! };
  const { Resvg } = await import("@resvg/resvg-js");
  const { default: sharp } = await import("sharp");
  const rendered: DevsharkRenderedSlide[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    const layout = layoutDevsharkSlide(deck, index, assets);
    const png = new Resvg(layout.svg, { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: "Manrope" } }).render().asPng();
    const background = layout.theme === "green" ? "#2D7A2D" : layout.theme === "dark" ? "#0B141B" : "#F3F6F1";
    const jpeg = await sharp(Buffer.from(png)).flatten({ background }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    const alt = [devsharkPlain(slide.headline), slide.body ? devsharkPlain(slide.body) : "", slide.code ?? ""].filter(Boolean).join(". ").slice(0, 1000);
    rendered.push({ svg: layout.svg, jpeg, sha256: createHash("sha256").update(jpeg).digest("hex"), width: 1080, height: 1350, alt, warnings: layout.warnings });
  }
  return rendered;
}
