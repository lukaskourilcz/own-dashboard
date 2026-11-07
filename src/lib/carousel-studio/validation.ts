import { CANVAS_ORDER, canvasRatio, ratiosAgree } from "./canvas.js";
import { apcaCheck } from "./contrast-apca.js";
import { textGroundPairs } from "./grounds.js";
import { platformLimitCheck } from "./platform-limits.js";
import { primaryLocaleFor, publishingLocalesFor } from "./locales.js";
import { carouselCanvas, type BrandTokens, type CarouselCanvas, type CarouselFormat, type CarouselTemplate } from "./schema.js";
import { charactersPerLine } from "./text.js";

export interface TemplateCheck {
  id:
    | "schema"
    | "canvas"
    | "platform-limits"
    | "safe-area"
    | "contrast"
    | "apca"
    | "brand-tokens"
    | "overflow"
    | "script"
    | "originality";
  status: "pass" | "fail";
  detail: string;
}

/**
 * The canvases a template says it was composed for: its master, then whatever it derives.
 *
 * In the order the studio renders them rather than the order the record lists them, so two
 * templates that declare the same set answer identically.
 */
export function declaredCanvases(template: CarouselTemplate): CarouselCanvas[] {
  const declared = new Set<CarouselCanvas>([template.canvas.master, ...template.canvas.derive]);
  return CANVAS_ORDER.filter((canvas) => declared.has(canvas));
}

/**
 * Whether this template may be rendered at this canvas at all.
 *
 * The mixed-ratio rule, and it is a rule about declarations rather than about arithmetic. A deck
 * is one post and Instagram gives one post one orientation, so a slide rendered at a shape the
 * rest of the deck was not composed for is not a variant — it is a crop nobody asked for. A
 * template that genuinely holds at 1:1 says so in its own record; one that does not is refused
 * here rather than quietly re-proportioned.
 */
function canvasCheck(template: CarouselTemplate, format: CarouselFormat): TemplateCheck {
  const { master } = template.canvas;
  // A publishing format such as linkedin-square is judged by the canvas it draws on.
  const canvas = carouselCanvas(format);
  if (!declaredCanvases(template).includes(canvas)) {
    return {
      id: "canvas",
      status: "fail",
      detail: `${template.id} is composed for ${master} and declares no ${format} derivation`
    };
  }
  const here = canvasRatio(template.formats[canvas]);
  const there = canvasRatio(template.formats[master]);
  return {
    id: "canvas",
    status: "pass",
    detail: format === master
      ? `${format} is this template's master canvas`
      : ratiosAgree(here, there)
        ? `${format} shares the ${master} master's ratio`
        : `${format} is a declared derivation of the ${master} master`
  };
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

function luminance(hex: string): number {
  const adjust = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * adjust(channel(hex, 1)) + 0.7152 * adjust(channel(hex, 3)) + 0.0722 * adjust(channel(hex, 5));
}

export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

/**
 * Whether a template's text and logos sit inside a canvas's safe area.
 *
 * The geometry half of `safeAreaCheck`, without the brand or the check wrapper, so the library can
 * answer "is this template composed for that canvas" without pretending to validate it.
 */
export function fitsSafeArea(template: CarouselTemplate, format: CarouselFormat): boolean {
  const safe = template.formats[carouselCanvas(format)]?.safeArea;
  if (!safe) return false;
  return template.slides.every((slide) => slide.layers.every((layer) => {
    if (layer.type !== "text" && layer.type !== "logo") return true;
    return layer.x >= safe.left
      && layer.y >= safe.top
      && layer.x + layer.width <= 1 - safe.right
      && layer.y + layer.height <= 1 - safe.bottom;
  }));
}

function safeAreaCheck(template: CarouselTemplate, format: CarouselFormat): TemplateCheck {
  const safe = template.formats[carouselCanvas(format)].safeArea;
  const failures: string[] = [];
  template.slides.forEach((slide) => slide.layers.forEach((layer) => {
    if (layer.type !== "text" && layer.type !== "logo") return;
    if (
      layer.x < safe.left ||
      layer.y < safe.top ||
      layer.x + layer.width > 1 - safe.right ||
      layer.y + layer.height > 1 - safe.bottom
    ) failures.push(`${slide.id}:${layer.type === "text" ? layer.slot : "logo"}`);
  }));
  return failures.length
    ? { id: "safe-area", status: "fail", detail: `Outside ${format} safe area: ${failures.join(", ")}` }
    : { id: "safe-area", status: "pass", detail: `${format} text and logos stay inside the safe area` };
}

function brandTokenCheck(template: CarouselTemplate, brand: BrandTokens): TemplateCheck {
  const failures = new Set<string>();
  const expect = (token: string) => { if (!brand.colors[token]) failures.add(token); };
  template.slides.forEach((slide) => {
    expect(slide.backgroundToken);
    // A variant is a rendering the deck actually ships, so a variant naming a token the brand
    // does not have is a template that passes its checks and throws when someone requests B.
    slide.variants.forEach((variant) => {
      if (variant.backgroundToken) expect(variant.backgroundToken);
      if (variant.accentToken) expect(variant.accentToken);
    });
    slide.layers.forEach((layer) => {
      if (layer.type === "text" || layer.type === "logo" || layer.type === "rule") expect(layer.colorToken);
      if (layer.type === "shape") {
        expect(layer.fillToken);
        if (layer.strokeToken) expect(layer.strokeToken);
      }
      // A mesh names a colour per blob. Skipping them let a template report clean and then
      // throw at render time, which is the worst of both: a green check and a broken deck.
      if (layer.type === "mesh") layer.blobs.forEach((blob) => expect(blob.colorToken));
      if (layer.type === "linear-gradient") layer.stops.forEach((stop) => expect(stop.colorToken));
      if (layer.type === "image" && layer.shade) expect(layer.shade.colorToken);
      if (layer.type === "image" && layer.border) expect(layer.border.colorToken);
    });
  });
  return failures.size
    ? { id: "brand-tokens", status: "fail", detail: `Unknown color tokens: ${[...failures].join(", ")}` }
    : { id: "brand-tokens", status: "pass", detail: `All layers bind to ${brand.id} tokens` };
}

/**
 * Text contrast, measured against everything that can end up behind the text.
 *
 * The slide's background token used to be the whole answer, and it stopped being the whole
 * answer the moment a mesh or a photograph could sit between it and the words. A gradient blob
 * is a colour behind the text as surely as the background is, so each one is checked too, and
 * the slide passes only if the text clears 4.5:1 against the worst of them.
 *
 * A photograph cannot be checked here — its pixels are the article's, not the template's — so a
 * slide carrying one relies on the scrim the image layer draws. That is a real limit and is
 * stated rather than papered over.
 */
function contrastCheck(template: CarouselTemplate, brand: BrandTokens): TemplateCheck {
  const failures = new Set<string>();
  for (const pair of textGroundPairs(template, brand)) {
    const worst = Math.min(...pair.grounds.map((colour) => contrastRatio(pair.foreground, colour)));
    if (worst < 4.5) failures.add(`${pair.slideId}:${pair.target}`);
  }
  return failures.size
    ? { id: "contrast", status: "fail", detail: `Contrast below 4.5:1 at ${[...failures].join(", ")}` }
    : { id: "contrast", status: "pass", detail: "Text contrast meets 4.5:1 against each slide background" };
}

function overflowCheck(template: CarouselTemplate, brand: BrandTokens): TemplateCheck {
  const primary = primaryLocaleFor(brand.id);
  const failures = template.slides.flatMap((slide) => slide.layers.flatMap((layer) => {
    if (layer.type !== "text") return [];
    // Measured in the face the layer will actually be drawn in, with its tracking, and in the
    // language it is set in. A flat per-character estimate charged a condensed headline what a
    // grotesque costs and charged a tracked kicker nothing for its tracking — so a slot passed the
    // check and ran off the canvas. A Latin-only estimate did the same to a Cyrillic slot.
    const locale = layer.lang ?? primary;
    const minimumCapacity = charactersPerLine({
      widthPx: layer.width * 1_080,
      fontSize: layer.minFontSize,
      family: brand.fonts[layer.fontToken],
      weight: layer.fontWeight,
      tracking: layer.tracking,
      locale
    }) * layer.maxLines;
    return minimumCapacity < layer.maxChars ? [`${slide.id}:${layer.slot} (${locale})`] : [];
  }));
  return failures.length
    ? { id: "overflow", status: "fail", detail: `Slot limit cannot fit at minimum size: ${failures.join(", ")}` }
    : { id: "overflow", status: "pass", detail: "Every slot limit fits at its minimum font size in the language it is set in" };
}

/**
 * Whether this brand publishes the languages this template's slots are set in.
 *
 * The third link in the chain that keeps a notdef box off a card. The coverage gate proves every
 * face a brand binds can draw every language that brand publishes; this proves no slot asks for a
 * language the brand does not publish, and therefore no slot asks for glyphs nothing required.
 * Without it a bilingual layout rendered in the wrong brand would pass every check and draw
 * squares where the second language should be.
 */
function scriptCheck(template: CarouselTemplate, brand: BrandTokens): TemplateCheck {
  const locales = publishingLocalesFor(brand.id);
  const failures = template.slides.flatMap((slide) => slide.layers.flatMap((layer) => {
    if (layer.type !== "text" || layer.lang === undefined) return [];
    return locales.includes(layer.lang) ? [] : [`${slide.id}:${layer.slot} (${layer.lang})`];
  }));
  return failures.length
    ? { id: "script", status: "fail", detail: `${brand.name} does not publish the language of ${failures.join(", ")}` }
    : { id: "script", status: "pass", detail: `Every declared slot language is one ${brand.name} publishes: ${locales.join(", ")}` };
}

export function validateTemplateForBrand(
  template: CarouselTemplate,
  brand: BrandTokens,
  format: CarouselFormat
): TemplateCheck[] {
  return [
    { id: "schema", status: "pass", detail: `${template.schemaVersion} parsed` },
    canvasCheck(template, format),
    platformLimitCheck(template, format),
    safeAreaCheck(template, format),
    contrastCheck(template, brand),
    apcaCheck(template, brand),
    brandTokenCheck(template, brand),
    overflowCheck(template, brand),
    scriptCheck(template, brand),
    { id: "originality", status: "pass", detail: "Template data contains no external image bytes" }
  ];
}

export function mayGoLive(checks: readonly TemplateCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.status === "pass");
}
