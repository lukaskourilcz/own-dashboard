import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import metrics from "../../../templates/marketing/font-metrics.json";
import provenance from "../../../templates/marketing/provenance.json";
import dneskai from "../../../templates/marketing/dneskai/brand.json";
import devshark from "../../../templates/marketing/devshark/brand.json";
import dneskaiDesign from "../../../templates/marketing/dneskai/derived-layout.json";
import devsharkDesign from "../../../templates/marketing/devshark/derived-layout.json";
import dneskaiTemplate from "../../../templates/marketing/dneskai/template.json";
import devsharkTemplate from "../../../templates/marketing/devshark/template.json";
import { AssetSchema, parseContentRevision, type ContentRevision } from "./contracts";
import { contentHash } from "./hashes";
import { MarketingSlideSchema, type GeneratedMarketingDraft, type MarketingSlide } from "./generation";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const MarketingTemplateSchema = z.strictObject({
  schemaVersion: z.literal("marketing-template/1"), version: z.string().min(1).max(200),
  brand: z.enum(["dneskai", "devshark"]), rendererVersion: z.literal("design-editorial-svg/2"),
  width: z.literal(1080), height: z.literal(1350), templateSha256: sha,
  authoring: z.enum(["repository-deterministic", "claude-design"]), approved: z.boolean(),
  approval: z.strictObject({ approvedBy: z.uuid(), approvedAt: z.iso.datetime({ offset: true }), designExportSha256: sha, templateSha256: sha }).nullable(),
});
export type MarketingTemplate = z.infer<typeof MarketingTemplateSchema>;
export type ApprovedMarketingTemplate = MarketingTemplate;
export type MarketingRenderInput = { draft: Pick<GeneratedMarketingDraft, "revision" | "slides">; template: MarketingTemplate; revisionId: string; templateRoot?: string };
export interface MarketingAssetStorage {
  /** Adapter uses an owner-scoped bucket; the URL must resolve immutable exact JPEG bytes. */
  put(input: { key: string; bytes: Buffer; sha256: string; contentType: "image/jpeg"; metadata: Record<string, string> }): Promise<{ url: string; sha256: string }>;
}
export class MarketingRenderError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MarketingRenderError"; }
}
type Face = { familyName: string; rasterFamily: string; weight: number; file: string; widths: Record<string, string> };
const faces: Record<string, Face> = metrics;
const style = {
  dneskai: { kit: dneskai, headline: "space-grotesk-700", body: "source-serif-4-400", code: "ibm-plex-mono-400", secondary: "source-serif-4-600", kicker: "space-grotesk-700", design: dneskaiDesign },
  devshark: { kit: devshark, headline: "manrope-800", body: "inter-400", code: "jetbrains-mono-400", secondary: "manrope-800", kicker: "manrope-700", design: devsharkDesign },
};
export function marketingTemplateDefinition(brand: MarketingTemplate["brand"]) {
  return { schemaVersion: "marketing-template/1", brand, rendererVersion: "design-editorial-svg/2", width: 1080, height: 1350, style: style[brand], metrics, fonts: provenance.fonts };
}
export function marketingTemplateDigest(brand: MarketingTemplate["brand"]): string {
  return contentHash(marketingTemplateDefinition(brand));
}
export function currentMarketingTemplate(brand: MarketingTemplate["brand"]): MarketingTemplate {
  return MarketingTemplateSchema.parse(brand === "dneskai" ? dneskaiTemplate : devsharkTemplate);
}
export function pendingMarketingTemplate(brand: MarketingTemplate["brand"]): MarketingTemplate {
  return { schemaVersion: "marketing-template/1", version: `${brand}-editorial/2`, brand, rendererVersion: "design-editorial-svg/2", width: 1080, height: 1350, templateSha256: marketingTemplateDigest(brand), authoring: "claude-design", approved: false, approval: null };
}
export function validateMarketingTemplate(value: MarketingTemplate, production: boolean): MarketingTemplate {
  const template = MarketingTemplateSchema.parse(value);
  if (template.templateSha256 !== marketingTemplateDigest(template.brand)) throw new MarketingRenderError("template-hash-mismatch");
  if (production && (!template.approved || template.authoring !== "claude-design" || !template.approval || template.approval.templateSha256 !== template.templateSha256 || template.approval.designExportSha256 !== style[template.brand].design.archiveSha256)) throw new MarketingRenderError("claude-design-approval-required");
  return template;
}
const tables = new Map<string, Map<string, number>>();
function advances(faceId: string): Map<string, number> {
  const previous = tables.get(faceId);
  if (previous) return previous;
  const table = new Map<string, number>();
  for (const [width, chars] of Object.entries(faces[faceId].widths)) for (const character of chars) table.set(character, Number(width) / 1000);
  tables.set(faceId, table);
  return table;
}
export function measureMarketingText(value: string, faceId: string, fontSize: number, normalize = true): number {
  const table = advances(faceId);
  let width = 0;
  for (const character of normalize ? value.normalize("NFC") : value) {
    const advance = table.get(character);
    if (advance === undefined) throw new MarketingRenderError("unsupported-glyph");
    width += advance * fontSize;
  }
  return width;
}
/** Fail rather than truncate a Czech word, wrap code, or render a missing glyph. */
export function fitMarketingText(input: { value: string; faceId: string; fontSize: number; width: number; maxLines: number; code?: boolean }): string[] {
  const value = (input.code ? input.value : input.value.normalize("NFC")).replace(/\r\n/g, "\n");
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    if (input.code) {
      const line = paragraph.replace(/\t/g, "    ");
      if (measureMarketingText(line, input.faceId, input.fontSize, false) > input.width) throw new MarketingRenderError("code-line-overflow");
      lines.push(line);
      continue;
    }
    if (!paragraph.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      if (measureMarketingText(word, input.faceId, input.fontSize) > input.width) throw new MarketingRenderError("word-overflow");
      const candidate = line ? `${line} ${word}` : word;
      if (measureMarketingText(candidate, input.faceId, input.fontSize) > input.width) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  if (lines.length > input.maxLines) throw new MarketingRenderError("text-overflow");
  return lines;
}
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}
function textSvg(lines: string[], faceId: string, size: number, x: number, y: number, color: string, leading = 1.3, tracking = 0): string {
  const face = faces[faceId];
  return `<text letter-spacing="${tracking}" xml:space="preserve" x="${x}" y="${y}" fill="${color}" font-family="${escapeXml(face.rasterFamily)}" font-size="${size}" font-weight="${face.weight}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? size * leading : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}
export type MarketingRenderedSlide = { svg: string; svgSha256: string; jpeg: Buffer; sha256: string; width: 1080; height: 1350; alt: string };
async function render(input: MarketingRenderInput, production: boolean): Promise<MarketingRenderedSlide[]> {
  const template = validateMarketingTemplate(input.template, production);
  z.uuid().parse(input.revisionId);
  const revision = parseContentRevision(input.draft.revision);
  if (revision.brand !== template.brand || revision.templateVersion !== template.version) throw new MarketingRenderError("template-revision-mismatch");
  if (revision.account.platform !== "instagram" || revision.format !== "carousel") throw new MarketingRenderError("unsupported-render-format");
  const slides = z.array(MarketingSlideSchema).min(2).max(5).parse(input.draft.slides);
  const selected = style[template.brand];
  const root = input.templateRoot ?? path.resolve(process.cwd(), "templates/marketing");
  const logo = await readFile(path.join(root, template.brand, "logo.svg"));
  if (createHash("sha256").update(logo).digest("hex") !== selected.kit.logo.sha256) throw new MarketingRenderError("brand-asset-hash-mismatch");
  const fontIds = [...new Set([selected.headline, selected.body, selected.code, selected.secondary, selected.kicker])];
  const fontFiles = await Promise.all(fontIds.map(async (id) => {
    const font = faces[id];
    const bytes = await readFile(path.join(root, "fonts", font.file));
    const expected = provenance.fonts.find((candidate) => candidate.file === font.file);
    if (!expected || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw new MarketingRenderError("font-hash-mismatch");
    return path.join(root, "fonts", font.file);
  }));
  const { Resvg } = await import("@resvg/resvg-js");
  const { default: sharp } = await import("sharp");
  const rendered: MarketingRenderedSlide[] = [];
  const design = selected.design;
  const designAssets: Record<string, Buffer> = {};
  for (const [file, sha256] of Object.entries(design.assets)) {
    const bytes = await readFile(path.join(root, template.brand, file));
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new MarketingRenderError("design-asset-hash-mismatch");
    designAssets[file] = bytes;
  }
  for (const [index, slide] of slides.entries()) {
    const isDev = template.brand === "devshark";
    const closing = index === slides.length - 1;
    // Direction B premium sequence P/I/G/I; longer authored decks extend with P before the I closer.
    const theme = isDev ? (closing ? "dark" : ["light", "dark", "green", "light"][index]) : "light";
    const palette = design.themes[theme as keyof typeof design.themes] as { background: string; foreground: string; muted: string; accent: string; surface: string };
    const margin = design.layout.margin;
    const width = 1080 - margin * 2;
    const headlineFace = !isDev && index > 0 ? selected.secondary : selected.headline;
    const headlineSize = !isDev && index > 0 ? dneskaiDesign.layout.secondaryHeadlineFontSize : design.layout.headlineFontSize;
    const headlineLeading = design.layout.headlineLineHeight;
    const bodySize = design.layout.bodyFontSize;
    const bodyLeading = design.layout.bodyLineHeight;
    const headings = fitMarketingText({ value: slide.headline, faceId: headlineFace, fontSize: headlineSize, width, maxLines: 3 });
    const bodies = fitMarketingText({ value: slide.body, faceId: selected.body, fontSize: bodySize, width, maxLines: slide.code ? 5 : 12 });
    const headingY = isDev ? 304 : design.layout.contentTop;
    const bodyY = headingY + (headings.length - 1) * headlineSize * headlineLeading + headlineSize + design.layout.gapHeadlineBody;
    const bodyBottom = bodyY + (bodies.length - 1) * bodySize * bodyLeading;
    let decorations = "";
    if (isDev) {
      const asset = designAssets[theme === "green" ? "devshark-fin-clean-ink.svg" : "devshark-fin-clean-green.svg"];
      const finWidth = closing ? 560 : index === 1 ? 340 : 620;
      const finX = closing ? 260 : index === 1 ? 600 : 550;
      const finHeight = finWidth * 15.9 / 19.2;
      if (index !== 2) decorations += `<image x="${finX}" y="${1350 - finHeight}" width="${finWidth}" height="${finHeight}" xlink:href="data:image/svg+xml;base64,${asset.toString("base64")}"/>`;
      const wave = devsharkDesign.waves[(index * 3) % devsharkDesign.waves.length];
      decorations += `<defs><pattern id="waterline" x="${margin}" y="212" width="48" height="12" patternUnits="userSpaceOnUse"><path d="${wave}" fill="none" stroke="${palette.accent}" stroke-width="3.2" stroke-linecap="round"/></pattern></defs><rect x="${margin}" y="212" width="${closing ? 400 : Math.ceil(measureMarketingText("DEVSHARK", selected.kicker, 40) + 8 * 3.6)}" height="12" fill="url(#waterline)"/>`;
      if (closing) decorations += `<image x="${margin}" y="92" width="400" height="64" xlink:href="data:image/svg+xml;base64,${designAssets["devshark-logo-horizontal-white.svg"].toString("base64")}"/>`;
      else decorations += textSvg(["DEVSHARK"], selected.kicker, 40, margin, 168, palette.accent, 1, 3.6);
      // Keep each text line clear of the fin's conservative bounding box, including descenders.
      if (index !== 2 && bodies.some((line, lineIndex) => {
        const lineBottom = bodyY + lineIndex * bodySize * bodyLeading + bodySize * 0.3;
        return lineBottom >= 1350 - finHeight && margin + measureMarketingText(line, selected.body, bodySize) > finX;
      })) throw new MarketingRenderError("fin-content-overflow");
    } else {
      decorations += `<image x="88" y="88" width="300" height="50" xlink:href="data:image/svg+xml;base64,${logo.toString("base64")}"/><rect x="88" y="184" width="904" height="3" fill="${palette.foreground}"/>`;
    }
    let codeSvg = "";
    if (slide.code) {
      const codeY = bodyBottom + 84;
      const codeSize = design.code.fontSize;
      const codeLeading = design.code.lineHeight;
      const maxLines = Math.floor((1180 - codeY) / (codeSize * codeLeading));
      if (maxLines < 1) throw new MarketingRenderError("code-height-overflow");
      const code = fitMarketingText({ value: slide.code, faceId: selected.code, fontSize: codeSize, width: width - 72, maxLines, code: true });
      codeSvg = `<rect x="${margin}" y="${codeY - 48}" width="${width}" height="${code.length * codeSize * codeLeading + 56}" rx="${design.code.radius}" fill="${design.code.background}"/>${textSvg(code, selected.code, codeSize, margin + 36, codeY, design.code.foreground, codeLeading)}`;
    }
    if (bodyBottom > 1172) throw new MarketingRenderError("body-height-overflow");
    const footerSize = design.layout.footerFontSize;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${palette.background}"/>${decorations}${textSvg(headings, headlineFace, headlineSize, margin, headingY, palette.foreground, headlineLeading)}${textSvg(bodies, selected.body, bodySize, margin, bodyY, palette.foreground, bodyLeading)}${codeSvg}${textSvg([`${index + 1} / ${slides.length}`], isDev ? selected.body : selected.code, footerSize, margin, 1260, palette.muted)}</svg>`;
    const png = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: faces[selected.body].rasterFamily } }).render().asPng();
    const jpeg = await sharp(Buffer.from(png)).flatten({ background: palette.background }).jpeg({ quality: 92, chromaSubsampling: "4:4:4", progressive: false }).toBuffer();
    if (jpeg.length > 8 * 1024 * 1024) throw new MarketingRenderError("asset-too-large");
    const info = await sharp(jpeg).metadata();
    if (info.format !== "jpeg" || info.width !== 1080 || info.height !== 1350) throw new MarketingRenderError("asset-dimensions-invalid");
    rendered.push({ svg, svgSha256: createHash("sha256").update(svg).digest("hex"), jpeg, sha256: createHash("sha256").update(jpeg).digest("hex"), width: 1080, height: 1350, alt: `${slide.headline}. ${slide.body}${slide.code ? `\n${slide.code}` : ""}`.slice(0, 1000) });
  }
  return rendered;
}
/** A local review preview cannot authorize production publishing. */
export async function renderMarketingPreview(input: MarketingRenderInput): Promise<MarketingRenderedSlide[]> {
  if (process.env.NODE_ENV === "production") throw new MarketingRenderError("preview-disabled-in-production");
  return render(input, false);
}
export async function renderMarketingAssets(input: MarketingRenderInput, storage: MarketingAssetStorage): Promise<ContentRevision["assets"]> {
  const slides = await render(input, true);
  const assets: ContentRevision["assets"] = [];
  for (const [index, slide] of slides.entries()) {
    const stored = await storage.put({ key: `marketing/${input.template.brand}/${input.revisionId}/${input.template.templateSha256}/${index + 1}-${slide.sha256}.jpg`, bytes: slide.jpeg, sha256: slide.sha256, contentType: "image/jpeg", metadata: { revisionId: input.revisionId, templateSha256: input.template.templateSha256, designExportSha256: input.template.approval!.designExportSha256, svgSha256: slide.svgSha256, rendererVersion: input.template.rendererVersion } });
    if (stored.sha256 !== slide.sha256) throw new MarketingRenderError("stored-asset-hash-mismatch");
    assets.push(AssetSchema.parse({ url: stored.url, sha256: slide.sha256, mimeType: "image/jpeg", width: 1080, height: 1350, alt: slide.alt }));
  }
  return assets;
}
export function marketingRenderQa(slides: MarketingSlide[]): { code: string; slide: number }[] {
  return slides.flatMap((slide, index) => {
    const issues: { code: string; slide: number }[] = [];
    if (slide.headline.length > 160 || slide.body.length > 1200) issues.push({ code: "copy-overflow", slide: index });
    if (slide.code && slide.code.split("\n").some((line) => line.length > 48)) issues.push({ code: "code-width-review", slide: index });
    return issues;
  });
}
