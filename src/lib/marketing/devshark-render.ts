import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import metrics from "../../../templates/marketing/font-metrics.json";
import provenance from "../../../templates/marketing/provenance.json";
import devsharkDesign from "../../../templates/marketing/devshark/derived-layout.json";
import { MarketingRenderError, measureMarketingText } from "./render";

/**
 * devShark social slides (owner request, 7 November 2026): the look of the two posts already on @devshark.app, a pale
 * or ink ground, a topic kicker over a green waterline, large Manrope type with green highlights, an optional code
 * panel and the large brand fin rising from the bottom right. Unlike those two posts there is no small fin in the top
 * left corner, and no page counter.
 *
 * A slide's text marks its green words with double brackets: `A [[learning platform]] for web developers`.
 * Rendering is deterministic (pinned fonts and brand assets, resvg, sharp) and refuses text that would not fit rather
 * than cutting it.
 */
export const DEVSHARK_SOCIAL_RENDERER = "devshark-social/1";

export const DevsharkSlideSchema = z.strictObject({
  kind: z.enum(["cover", "text", "code", "answer", "closing"]),
  kicker: z.string().trim().min(1).max(40).optional(),
  headline: z.string().trim().min(1).max(140),
  body: z.string().trim().max(400).optional(),
  code: z.string().max(600).optional(),
});
export type DevsharkSlide = z.infer<typeof DevsharkSlideSchema>;
export const DevsharkDeckSchema = z.strictObject({
  schemaVersion: z.literal("devshark-deck/1"),
  /** The cover's ground; inner slides alternate from it, the answer is green and the closer is ink. */
  cover: z.enum(["light", "dark"]),
  slides: z.array(DevsharkSlideSchema).min(2).max(8),
});
export type DevsharkDeck = z.infer<typeof DevsharkDeckSchema>;

type Theme = "light" | "dark" | "green";
type Face = { file: string; rasterFamily: string; weight: number };
const faces = metrics as unknown as Record<string, Face>;
const themes = devsharkDesign.themes as Record<Theme, { background: string; foreground: string; muted: string; accent: string }>;
const WIDTH = 1080, HEIGHT = 1350, MARGIN = 80, TEXT_WIDTH = WIDTH - MARGIN * 2;
const KICKER = { face: "manrope-700", size: 36, tracking: 3.2, y: 168 };
const HEADLINE = { face: "manrope-800", size: 96, coverSize: 116, leading: 1.06 };
const BODY = { face: "manrope-700", size: 60, leading: 1.22 };
const CODE = { face: "jetbrains-mono-400", size: 30, leading: 1.5, background: "#1B2730", foreground: "#E8EEF0", radius: 16, pad: 36 };
/** The brand fin, bottom right; text must end above it. */
const FIN = { width: 560, x: 600 };
const FIN_HEIGHT = FIN.width * 15.9 / 19.2;
const TEXT_FLOOR = HEIGHT - FIN_HEIGHT - 24;

/** The ground of each slide: the cover's, then alternating, the answer green and the closer ink. */
export function devsharkSlideTheme(deck: Pick<DevsharkDeck, "cover" | "slides">, index: number): Theme {
  const slide = deck.slides[index]!;
  if (slide.kind === "closing") return "dark";
  if (slide.kind === "answer") return "green";
  const other = deck.cover === "light" ? "dark" : "light";
  return index % 2 === 0 ? deck.cover : other;
}

/** `glue`: the word follows the previous one without a space (a full stop after a green phrase). */
type Token = { text: string; green: boolean; glue?: boolean };
/** Splits `[[green]]` markup into words that remember their colour. */
export function devsharkTokens(value: string): Token[][] {
  return value.split("\n").map((paragraph) => {
    const tokens: Token[] = [];
    let green = false, previous = "";
    for (const part of paragraph.split(/(\[\[|\]\])/)) {
      if (part === "[[") { green = true; continue; }
      if (part === "]]") { green = false; continue; }
      const words = part.split(/\s+/).filter(Boolean);
      // Glue only when nothing separates this text from the previous text, e.g. the full stop after `[[phrase]].`.
      words.forEach((word, at) => tokens.push({ text: word, green, ...(at === 0 && tokens.length && !/^\s/.test(part) && !/\s$/.test(previous) ? { glue: true } : {}) }));
      if (part) previous = part;
    }
    return tokens;
  });
}
/** Plain text of a marked line, for alt text and measuring. */
export const devsharkPlain = (value: string) => value.replace(/\[\[|\]\]/g, "");

const joined = (tokens: Token[]) => tokens.map((token, at) => (at && !token.glue ? " " : "") + token.text).join("");
function wrap(value: string, face: string, size: number, maxLines: number): Token[][] {
  const lines: Token[][] = [];
  for (const paragraph of devsharkTokens(value)) {
    let line: Token[] = [];
    for (const token of paragraph) {
      if (measureMarketingText(token.text, face, size) > TEXT_WIDTH) throw new MarketingRenderError("word-overflow");
      const candidate = [...line, token];
      if (line.length && measureMarketingText(joined(candidate), face, size) > TEXT_WIDTH) {
        // A glued word moves to the next line with the word it belongs to.
        const last = token.glue ? line.pop() : undefined;
        lines.push(line); line = last ? [{ ...last, glue: false }, token] : [{ ...token, glue: false }];
      } else line = candidate;
    }
    lines.push(line);
  }
  if (lines.length > maxLines) throw new MarketingRenderError("text-overflow");
  return lines;
}
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
function linesSvg(lines: Token[][], face: string, size: number, leading: number, y: number, color: string, green: string): string {
  const f = faces[face]!;
  return lines.map((line, index) => {
    const spans = line.map((token, at) => `<tspan fill="${token.green ? green : color}">${escapeXml((at && !token.glue ? " " : "") + token.text)}</tspan>`).join("");
    return `<text xml:space="preserve" x="${MARGIN}" y="${y + index * size * leading}" font-family="${escapeXml(f.rasterFamily)}" font-size="${size}" font-weight="${f.weight}">${spans}</text>`;
  }).join("");
}

export type DevsharkRenderedSlide = { svg: string; jpeg: Buffer; sha256: string; width: 1080; height: 1350; alt: string };

/** Renders every slide of a deck to a 1080 × 1350 JPEG. */
export async function renderDevsharkDeck(value: DevsharkDeck): Promise<DevsharkRenderedSlide[]> {
  const deck = DevsharkDeckSchema.parse(value);
  const root = path.join(process.cwd(), "templates", "marketing");
  const fontIds = [KICKER.face, HEADLINE.face, BODY.face, CODE.face];
  const fontFiles = await Promise.all(fontIds.map(async (id) => {
    const face = faces[id]!;
    const bytes = await readFile(path.join(root, "fonts", face.file));
    const expected = provenance.fonts.find((candidate) => candidate.file === face.file);
    if (!expected || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw new MarketingRenderError("font-hash-mismatch");
    return path.join(root, "fonts", face.file);
  }));
  const assets: Record<string, Buffer> = {};
  for (const [file, sha256] of Object.entries(devsharkDesign.assets as Record<string, string>)) {
    const bytes = await readFile(path.join(root, "devshark", file));
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new MarketingRenderError("design-asset-hash-mismatch");
    assets[file] = bytes;
  }
  const { Resvg } = await import("@resvg/resvg-js");
  const { default: sharp } = await import("sharp");
  const rendered: DevsharkRenderedSlide[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    const theme = devsharkSlideTheme(deck, index);
    const palette = themes[theme];
    const green = theme === "green" ? "#132019" : palette.accent;
    let parts = "";
    let y: number;
    if (slide.kind === "closing") {
      parts += `<image x="${MARGIN}" y="104" width="400" height="64" xlink:href="data:image/svg+xml;base64,${assets["devshark-logo-horizontal-white.svg"]!.toString("base64")}"/>`;
      y = 330;
    } else {
      const kicker = (slide.kicker ?? "devShark").toUpperCase();
      const width = measureMarketingText(kicker, KICKER.face, KICKER.size) + kicker.length * KICKER.tracking;
      if (width > TEXT_WIDTH) throw new MarketingRenderError("text-overflow");
      const wave = devsharkDesign.waves[index % devsharkDesign.waves.length];
      const kickerColor = theme === "green" ? palette.foreground : palette.accent;
      parts += `<text x="${MARGIN}" y="${KICKER.y}" letter-spacing="${KICKER.tracking}" fill="${kickerColor}" font-family="Manrope" font-size="${KICKER.size}" font-weight="700">${escapeXml(kicker)}</text>`;
      parts += `<defs><pattern id="wave${index}" x="${MARGIN}" y="190" width="48" height="12" patternUnits="userSpaceOnUse"><path d="${wave}" fill="none" stroke="${kickerColor}" stroke-width="3.2" stroke-linecap="round"/></pattern></defs><rect x="${MARGIN}" y="190" width="${Math.ceil(width)}" height="12" fill="url(#wave${index})"/>`;
      y = 300;
    }
    const headlineSize = slide.kind === "cover" ? HEADLINE.coverSize : HEADLINE.size;
    const headline = wrap(slide.headline, HEADLINE.face, headlineSize, 4);
    parts += linesSvg(headline, HEADLINE.face, headlineSize, HEADLINE.leading, y, palette.foreground, green);
    y += (headline.length - 1) * headlineSize * HEADLINE.leading + 44;
    if (slide.body) {
      const body = wrap(slide.body, BODY.face, BODY.size, 8);
      y += BODY.size;
      parts += linesSvg(body, BODY.face, BODY.size, BODY.leading, y, palette.foreground, green);
      y += (body.length - 1) * BODY.size * BODY.leading + 24;
    }
    if (slide.code) {
      const lines = slide.code.replace(/\t/g, "  ").split("\n");
      for (const line of lines) if (measureMarketingText(line, CODE.face, CODE.size, false) > TEXT_WIDTH - CODE.pad * 2) throw new MarketingRenderError("code-line-overflow");
      const top = y + 24, height = lines.length * CODE.size * CODE.leading + CODE.pad * 1.4;
      parts += `<rect x="${MARGIN}" y="${top}" width="${TEXT_WIDTH}" height="${height}" rx="${CODE.radius}" fill="${CODE.background}"/>`;
      parts += `<text xml:space="preserve" x="${MARGIN + CODE.pad}" y="${top + CODE.pad + CODE.size * 0.8}" fill="${CODE.foreground}" font-family="JetBrains Mono" font-size="${CODE.size}" font-weight="400" style="font-variant-ligatures:none">${lines.map((line, at) => `<tspan x="${MARGIN + CODE.pad}" dy="${at ? CODE.size * CODE.leading : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
      y = top + height;
    }
    if (slide.kind === "closing") {
      parts += `<text x="${MARGIN}" y="${Math.max(y + 40, 760)}" fill="${palette.accent}" font-family="Manrope" font-size="52" font-weight="800">devshark.app</text>`;
      y = Math.max(y + 40, 760);
    }
    if (y > TEXT_FLOOR) throw new MarketingRenderError("fin-content-overflow");
    const fin = assets[theme === "green" ? "devshark-fin-clean-ink.svg" : "devshark-fin-clean-green.svg"]!;
    const decorations = `<image x="${FIN.x}" y="${HEIGHT - FIN_HEIGHT}" width="${FIN.width}" height="${FIN_HEIGHT}" xlink:href="data:image/svg+xml;base64,${fin.toString("base64")}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="${palette.background}"/>${decorations}${parts}</svg>`;
    const png = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: "Manrope" } }).render().asPng();
    const jpeg = await sharp(Buffer.from(png)).flatten({ background: palette.background }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    const alt = [devsharkPlain(slide.headline), slide.body ? devsharkPlain(slide.body) : "", slide.code ?? ""].filter(Boolean).join(". ").slice(0, 1000);
    rendered.push({ svg, jpeg, sha256: createHash("sha256").update(jpeg).digest("hex"), width: 1080, height: 1350, alt });
  }
  return rendered;
}
