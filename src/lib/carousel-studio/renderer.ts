import { createHash } from "node:crypto";
import {
  BrandTokensSchema,
  CarouselPayloadSchema,
  CarouselTemplateSchema,
  carouselCanvas,
  type BrandTokens,
  type CarouselFormat,
  type CarouselLayer,
  type CarouselPayload,
  type CarouselTemplate
} from "./schema.js";
import type { FaceMetrics } from "./font-metrics.generated.js";
import { fitText, type FittedText } from "./text.js";
import { isCutFor, prepareCarouselImages } from "./images.js";
import { fontFiles, measureEm, resolveFace } from "./fonts.js";
import { validateTemplateForBrand, type TemplateCheck } from "./validation.js";
import { groundsBehindLayer, type SlideRendering } from "./grounds.js";
import { LOGO_ID, chooseLogotypeVariant, logotypeForBrand, type KitLogotype } from "./brand-kit.js";
import {
  brandOnGround,
  dressBrand,
  groundAt,
  kitStyleFor,
  kitStyleWithLook,
  kitTemplate,
  logoAllowedAt,
  type DeckPosition,
  type KitCornerMark,
  type KitStyle
} from "./kit-style.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function px(value: number, total: number): number {
  return Math.round(value * total * 1_000) / 1_000;
}

/** Three decimal places, so the same arithmetic writes the same string on every machine. */
function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/** The wordmark's weight and letter-spacing. Fixed, because a wordmark is not a design axis. */
const LOGO_WEIGHT = 800;
const LOGO_TRACKING = 0.03;

function token(brand: BrandTokens, name: string): string {
  const value = brand.colors[name];
  if (!value) throw new Error(`Brand ${brand.id} does not define color token ${name}`);
  return value.toLowerCase();
}

function layerSvg(input: {
  layer: CarouselLayer;
  payload: CarouselPayload;
  brand: BrandTokens;
  width: number;
  height: number;
  accentToken?: string;
  /** Collector for slots whose text had to be clipped to fit. */
  truncatedSlots?: string[];
  /** Decoded PNG bytes per image slot. Absent means the slide draws without a photograph. */
  images?: Readonly<Record<string, Buffer>>;
  /** Drawn text height per slot on this slide, so a `padText` panel can hug it. */
  hugged?: Readonly<Record<string, number>>;
  /** Unique per layer, so two gradients on one slide cannot share an SVG id. */
  uid: string;
  /** The slide and rendering this layer sits in, so a kit logotype can see what is behind it. */
  slide: { slide: CarouselTemplate["slides"][number]; layerIndex: number; rendering: SlideRendering };
  /** False on a slide where the brand's kit keeps the logotype off, such as all but a deck's last. */
  logoAllowed: boolean;
}): string {
  const { layer, payload, brand, width, height } = input;
  const x = px(layer.x, width);
  const y = px(layer.y, height);
  const w = px(layer.width, width);
  const h = px(layer.height, height);
  const color = (name: string) => token(brand, name === "accent" && input.accentToken ? input.accentToken : name);
  if (layer.type === "shape") {
    const fill = layer.fillToken === "accent" && input.accentToken ? input.accentToken : layer.fillToken;
    // Strokes follow the variant's accent remap exactly as fills and inks do. They did not until
    // the launch families ringed their portholes in the accent, and the B render kept variant A's
    // colour on the one element that frames the photograph.
    const stroke = layer.strokeToken ? ` stroke="${color(layer.strokeToken)}" stroke-width="${layer.strokeWidth}"` : "";
    // A panel that hugs its text is the declared frame trimmed to what the text actually needs.
    // The frame stays the maximum — it is what the contrast check measured — and the drawn
    // rectangle is never larger than it.
    const hug = layer.padText === undefined ? null : input.hugged?.[layer.padText];
    const padding = px(layer.padding, Math.min(width, height));
    const panelHeight = hug === undefined || hug === null ? h : Math.min(h, hug + padding * 2);
    // A panel hugging bottom- or middle-anchored words sits where the words do, not at its top.
    const anchor = layer.padText === undefined
      ? undefined
      : input.slide.slide.layers.find((candidate) => candidate.type === "text" && candidate.slot === layer.padText);
    const valign = anchor?.type === "text" ? anchor.valign : undefined;
    const panelY = valign === "bottom" ? round(y + h - panelHeight) : valign === "middle" ? round(y + (h - panelHeight) / 2) : y;
    return `<rect x="${x}" y="${panelY}" width="${w}" height="${panelHeight}" rx="${px(layer.radius, Math.min(w, panelHeight))}" fill="${token(brand, fill)}"${stroke}/>`;
  }
  if (layer.type === "rule") {
    const thickness = Math.max(layer.thickness, h);
    if (!layer.dash) {
      return `<rect x="${x}" y="${y}" width="${w}" height="${thickness}" fill="${color(layer.colorToken)}"/>`;
    }
    // Derived from the thickness so the dash scales with the rule rather than with the canvas.
    const on = Math.round(thickness * 3);
    const off = Math.round(thickness * 2);
    const centre = y + thickness / 2;
    return `<line x1="${x}" y1="${centre}" x2="${x + w}" y2="${centre}" stroke="${color(layer.colorToken)}"`
      + ` stroke-width="${thickness}" stroke-dasharray="${on} ${off}" stroke-linecap="butt"/>`;
  }
  if (layer.type === "linear-gradient") {
    const id = `grad-${input.uid}`;
    // The angle is clockwise from the top of the canvas, which is how a designer reads it; SVG
    // wants two points, so it becomes a unit vector across the layer's own box.
    const radians = (layer.angle - 90) * (Math.PI / 180);
    const dx = Math.cos(radians) / 2;
    const dy = Math.sin(radians) / 2;
    const round = (value: number) => Math.round(value * 10_000) / 10_000;
    const stops = layer.stops.map((stop) =>
      `<stop offset="${round(stop.offset)}" stop-color="${color(stop.colorToken)}"/>`
    ).join("");
    return `<defs><linearGradient id="${id}" x1="${round(0.5 - dx)}" y1="${round(0.5 - dy)}" x2="${round(0.5 + dx)}" y2="${round(0.5 + dy)}">${stops}</linearGradient></defs>`
      + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`;
  }
  if (layer.type === "logo") {
    if (!input.logoAllowed) return "";
    const logotype = logotypeForBrand(brand.id);
    if (logotype) {
      return kitLogoSvg({ layer, logotype, x, y, w, h, uid: input.uid, slide: input.slide, brand, images: input.images });
    }
    /*
     * Sized to the frame and to the mark, and now to the face as well.
     *
     * The old arithmetic guessed a wordmark's width from its character count, which is what a
     * renderer does when it has no metrics: `MMA FILES` and `TITTY TUESDAYS` were charged the
     * same per character in a condensed face and in a black one. The measured width is the
     * honest constraint, so the mark fills its frame in every family instead of in one.
     */
    const face = resolveFace(brand.fonts[layer.fontToken], LOGO_WEIGHT);
    const tracked = (size: number) => (measureEm(face, brand.logoText) + LOGO_TRACKING * [...brand.logoText].length) * size;
    const byHeight = h * 0.72;
    const size = Math.max(18, Math.min(byHeight, tracked(byHeight) > w ? (w / tracked(1)) : byHeight));
    return `<text x="${x}" y="${y + size}" fill="${color(layer.colorToken)}" font-family="${escapeXml(face.familyName)}" font-size="${round(size)}" font-weight="${LOGO_WEIGHT}" letter-spacing="${round(LOGO_TRACKING * size)}">${escapeXml(brand.logoText)}</text>`;
  }
  if (layer.type === "mesh") {
    // Several wide, blurred colour fields that overlap into a mesh. Built from radial gradients
    // rather than a bitmap so it renders offline and at any canvas size, and from token colours
    // so the same mesh reads as each venture's own palette.
    const id = `mesh-${input.uid}`;
    const blur = Math.max(1, Math.min(width, height) * layer.softness);
    const stops = layer.blobs.map((blob, index) => {
      const fill = color(blob.colorToken);
      return `<radialGradient id="${id}-${index}"><stop offset="0%" stop-color="${fill}" stop-opacity="${blob.opacity}"/><stop offset="100%" stop-color="${fill}" stop-opacity="0"/></radialGradient>`;
    }).join("");
    const circles = layer.blobs.map((blob, index) =>
      `<circle cx="${x + blob.cx * w}" cy="${y + blob.cy * h}" r="${blob.radius * Math.max(w, h)}" fill="url(#${id}-${index})"/>`
    ).join("");
    return `<defs>${stops}<filter id="${id}-soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${blur.toFixed(2)}"/></filter></defs><g filter="url(#${id}-soft)" clip-path="url(#${id}-clip)"><clipPath id="${id}-clip"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>${circles}</g>`;
  }
  if (layer.type === "image") {
    // The article's own hero. Supplied as decoded bytes rather than carried in the payload: the
    // payload is hashed into the pack and stored in git, and a 200 kB base64 photo does not
    // belong in either. Absent bytes draw nothing and the slide still renders, because a
    // missing photograph is not a reason to lose the words.
    const bytes = input.images?.[layer.slot];
    if (!bytes) return "";
    const id = `img-${input.uid}`;
    // librsvg does not decode WebP inside a data URI — it silently draws nothing — so callers
    // hand over PNG. Verified by rendering all three: only PNG and JPEG appear.
    const href = `data:image/png;base64,${bytes.toString("base64")}`;
    // The window the photograph is seen through. A circle takes the frame's inscribed disc; a
    // polygon's points are fractions of the frame, so the same shape holds at every canvas.
    const window = layer.clip === undefined
      ? `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`
      : layer.clip === "circle"
        ? `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 2}"/>`
        : `<polygon points="${layer.clip.map(([px_, py]) => `${x + px_ * w},${y + py * h}`).join(" ")}"/>`;
    const scrim = layer.scrim === "none" ? "" : layer.scrim === "full"
      ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${token(brand, "background")}" opacity="0.55"/>`
      : `<defs><linearGradient id="${id}-scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="55%" stop-color="${token(brand, "background")}" stop-opacity="0"/><stop offset="100%" stop-color="${token(brand, "background")}" stop-opacity="0.96"/></linearGradient></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}-scrim)"/>`;
    // One ink at varying opacity, inside the photograph's own window and only with a photograph.
    const shade = layer.shade
      ? `<defs><linearGradient id="${id}-shade" x1="0" y1="0" x2="0" y2="1">${layer.shade.stops.map((stop) =>
        `<stop offset="${round(stop.at)}" stop-color="${color(layer.shade!.colorToken)}" stop-opacity="${round(stop.opacity)}"/>`).join("")}</linearGradient></defs>`
        + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}-shade)" clip-path="url(#${id}-clip)"/>`
      : "";
    // A cropped photograph has been cut to the frame's shape (or, contained, kept whole) in sharp,
    // so `slice` and `meet` place it without cutting anything further.
    const fit = input.payload.images?.[layer.slot]?.fit ?? layer.fit;
    let border = "";
    if (layer.border && layer.clip === "circle") {
      // A circular window takes a ring on the disc's edge, drawn outside it like the frame's
      // hairline, so it never covers a pixel of the picture.
      const line = layer.border.width;
      border = `<circle cx="${round(x + w / 2)}" cy="${round(y + h / 2)}" r="${round(Math.min(w, h) / 2 + line / 2)}" fill="none" stroke="${color(layer.border.colorToken)}" stroke-width="${line}"/>`;
    } else if (layer.border) {
      const drawn = fit === "contain" ? containedRect(bytes, { x, y, w, h }) : { x, y, w, h };
      const line = layer.border.width;
      border = `<rect x="${round(drawn.x - line / 2)}" y="${round(drawn.y - line / 2)}" width="${round(drawn.w + line)}" height="${round(drawn.h + line)}" fill="none" stroke="${color(layer.border.colorToken)}" stroke-width="${line}"/>`;
    }
    return `<defs><clipPath id="${id}-clip">${window}</clipPath></defs>`
      + `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}" clip-path="url(#${id}-clip)"/>`
      + scrim
      + shade
      + border;
  }
  const fitted = fitTextLayer(layer, payload, brand, width, height);
  if (fitted.truncated) input.truncatedSlots?.push(layer.slot);
  const anchor = layer.align === "start" ? "start" : layer.align;
  const textX = layer.align === "start" ? x : layer.align === "middle" ? x + w / 2 : x + w;
  const lineHeight = fitted.fontSize * 1.12;
  // The block is the same height a hugging panel measures, so a panel and its words agree.
  const block = fitted.lines.length * lineHeight;
  const baseline = layer.valign === "bottom"
    ? round(y + h - block + fitted.fontSize)
    : layer.valign === "middle"
      ? round(y + (h - block) / 2 + fitted.fontSize)
      : y + fitted.fontSize;
  const tspans = fitted.lines.map((line, index) =>
    `<tspan x="${textX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
  ).join("");
  // Both optional and both default to off, so a v1 layer renders the string it always did.
  const tracking = layer.tracking === 0 ? "" : ` letter-spacing="${Math.round(layer.tracking * fitted.fontSize * 1_000) / 1_000}"`;
  const glowId = `glow-${input.uid}`;
  const glow = layer.glow
    ? `<defs><filter id="${glowId}" x="-25%" y="-25%" width="150%" height="150%">`
      + `<feDropShadow dx="0" dy="0" stdDeviation="${Math.round(fitted.fontSize * 0.18 * 100) / 100}"`
      + ` flood-color="${color("accent")}" flood-opacity="0.55"/></filter></defs>`
    : "";
  const filter = layer.glow ? ` filter="url(#${glowId})"` : "";
  const face = resolveFace(brand.fonts[layer.fontToken], layer.fontWeight);
  // A kitted brand names the face the way the rasteriser finds it. Every other brand keeps the
  // legacy name its recorded hashes were drawn with, until those are re-recorded on purpose.
  const family = brand.kit ? face.rasterFamily : face.familyName;
  return `${glow}<text x="${textX}" y="${baseline}" text-anchor="${anchor}" fill="${color(layer.colorToken)}" font-family="${escapeXml(family)}" font-size="${fitted.fontSize}" font-weight="${face.weight}"${tracking}${filter}>${tspans}</text>`;
}

/**
 * Where a contained picture lands inside its frame: centred, at the largest scale that fits.
 *
 * Read from the PNG's own header, which every caller hands over (`toRenderablePng` and the crop
 * both emit PNG). Bytes that are not PNG fall back to the whole frame, which frames the window
 * rather than the picture — a looser line, never a line through the picture.
 */
function containedRect(bytes: Buffer, frame: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const isPng = bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString("ascii", 12, 16) === "IHDR";
  if (!isPng) return frame;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height) return frame;
  const scale = Math.min(frame.w / width, frame.h / height);
  const w = width * scale;
  const h = height * scale;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h };
}

/**
 * The venture's own logotype, drawn from its brand kit as outlines.
 *
 * The file is nested as an `<svg>` with its own viewBox, so the paths are the approved paths and
 * nothing is set in a font. Which file is drawn follows `chooseLogotypeVariant` over the same
 * grounds the contrast gates measured, plus one thing only the renderer knows: whether a
 * photograph actually sits under the frame.
 *
 * Sized to fit the frame with the kit's clear space above and below, never wider than the frame
 * and never below the kit's minimum height unless the frame itself is narrower than that allows.
 * Left-aligned, because every family aligns its logo frame to the text column it heads.
 */
function kitLogoSvg(input: {
  layer: Extract<CarouselLayer, { type: "logo" }>;
  logotype: KitLogotype;
  x: number;
  y: number;
  w: number;
  h: number;
  uid: string;
  slide: { slide: CarouselTemplate["slides"][number]; layerIndex: number; rendering: SlideRendering };
  brand: BrandTokens;
  images?: Readonly<Record<string, Buffer>>;
}): string {
  const { layer, logotype, x, y, w, h } = input;
  const { slide, layerIndex, rendering } = input.slide;
  const grounds = groundsBehindLayer(slide, layerIndex, input.brand, rendering);
  const onPhoto = slide.layers.slice(0, layerIndex).some((under) =>
    under.type === "image"
    && input.images?.[under.slot] !== undefined
    && under.x <= layer.x && under.y <= layer.y
    && under.x + under.width >= layer.x + layer.width
    && under.y + under.height >= layer.y + layer.height
  );
  const chosen = chooseLogotypeVariant(logotype, grounds, onPhoto);
  if (!chosen) throw new Error(`Brand kit ${logotype.venture} has no logotype file for grounds ${grounds.join(", ")}`);
  const [, , boxWidth, boxHeight] = chosen.variant.viewBox;
  const aspect = boxWidth / boxHeight;
  const byWidth = w / aspect;
  const byHeight = h / (1 + 2 * logotype.clearSpace);
  const height = Math.min(byWidth, Math.max(byHeight, logotype.minimumHeightPx));
  const width = height * aspect;
  const top = y + (h - height) / 2;
  const id = `logo-${input.uid}-`;
  const markup = chosen.variant.markup.replaceAll(LOGO_ID, id);
  return `<svg x="${round(x)}" y="${round(top)}" width="${round(width)}" height="${round(height)}" viewBox="${chosen.variant.viewBox.join(" ")}" preserveAspectRatio="xMinYMid meet" overflow="visible" aria-label="${escapeXml(logotype.displayName)}" role="img">${markup}</svg>`;
}

/** One text layer, fitted for one canvas. Shared so a hugging panel measures what the text does. */
function fitTextLayer(
  layer: Extract<CarouselLayer, { type: "text" }>,
  payload: CarouselPayload,
  brand: BrandTokens,
  width: number,
  height: number
) {
  const raw = payload.strings[layer.slot] ?? "";
  const value = layer.uppercase ? raw.toLocaleUpperCase(payload.locale) : raw;
  return fitText({
    value,
    locale: payload.locale,
    widthPx: px(layer.width, width),
    heightPx: px(layer.height, height),
    minFontSize: layer.minFontSize * (width / 1_080),
    maxFontSize: layer.maxFontSize * (width / 1_080),
    maxLines: layer.maxLines,
    maxChars: layer.maxChars,
    tracking: layer.tracking,
    fontFamily: brand.fonts[layer.fontToken],
    fontWeight: layer.fontWeight,
    // Absent on every v1 layer (the schema refuses it there), so v1 lines break where they did.
    ...(layer.keepWithNext ? { keepWithNext: layer.keepWithNext } : {})
  });
}

/** One text slot as the renderer sets it: its lines, its size and whether anything was cut. */
export interface TextSlotFit {
  slideIndex: number;
  slideId: string;
  slot: string;
  fitted: FittedText;
  /** The committed face used for fitting, including cap height for layout. */
  face: FaceMetrics;
}

/**
 * Every text slot of a template fitted exactly as the renderer will fit it, without drawing.
 *
 * For a caller that has to say "this headline will be cut" before it has the photographs a render
 * needs. Same parse, same kit faces and the same canvas as `renderSlides`; the ground a slide
 * stands on changes colours, never faces, so it is not needed here.
 */
export function carouselTextFits(input: Pick<CarouselRenderInput, "template" | "payload" | "brand" | "format" | "look">): TextSlotFit[] {
  const parsed = CarouselTemplateSchema.parse(input.template);
  const payload = CarouselPayloadSchema.parse(input.payload);
  const declared = BrandTokensSchema.parse(input.brand);
  const style = kitStyleWithLook(kitStyleFor(declared), input.look);
  const brand = style ? dressBrand(declared, style) : declared;
  const template = style ? kitTemplate(parsed, style) : parsed;
  const canvas = template.formats[carouselCanvas(input.format)];
  return template.slides.flatMap((slide, slideIndex) => slide.layers.flatMap((layer) =>
    layer.type === "text"
      ? [{ slideIndex, slideId: slide.id, slot: layer.slot, fitted: fitTextLayer(layer, payload, brand, canvas.width, canvas.height), face: resolveFace(brand.fonts[layer.fontToken], layer.fontWeight) }]
      : []));
}

export interface RenderedSlide {
  slideId: string;
  index: number;
  format: CarouselFormat;
  svg: string;
  svgHash: string;
  /** Slots whose text did not fit and were clipped. Empty when the slide rendered whole. */
  truncatedSlots: string[];
}

export interface CarouselRenderInput {
  /** Named kit look; absent preserves the kit palette and faces. */
  look?: string;
  template: CarouselTemplate;
  payload: CarouselPayload;
  brand: BrandTokens;
  format: CarouselFormat;
  /** Decoded PNG bytes per image slot. WebP will not decode inside an SVG data URI. */
  images?: Readonly<Record<string, Buffer>>;
  /**
   * Where the template's first slide sits in the deck that ships, when the deck is assembled from
   * single-slide templates. Absent means the template is the deck. A kit that grounds slides by
   * position or keeps its logo to the last slide reads it.
   */
  deck?: DeckPosition;
}

/**
 * The corner mark a kit puts on every slide, in the file the ground behind it calls for.
 *
 * Measured the way a logo frame is: a frame at the corner joins the slide as a last layer, and
 * `groundsBehindLayer` says what sits under it, so a panel or a seam there counts.
 */
function cornerMarkSvg(input: {
  mark: KitCornerMark;
  slide: CarouselTemplate["slides"][number];
  brand: BrandTokens;
  rendering: SlideRendering;
  width: number;
  height: number;
  format: CarouselFormat;
  venture: string;
  uid: string;
}): string {
  const { mark, width, height } = input;
  const scale = width / 1_080;
  const [, , boxWidth, boxHeight] = mark.variants[0]!.viewBox;
  const w = mark.widthPx * scale;
  const h = w * (boxHeight / boxWidth);
  const x = width - mark.marginPx * scale - w;
  const y = carouselCanvas(input.format) === "instagram-story" ? mark.storyTopPx : mark.marginPx * scale;
  const frame = { type: "logo" as const, x: x / width, y: y / height, width: w / width, height: h / height, colorToken: "foreground", fontToken: "headline" as const };
  const grounds = groundsBehindLayer({ ...input.slide, layers: [...input.slide.layers, frame] }, input.slide.layers.length, input.brand, input.rendering);
  const chosen = chooseLogotypeVariant({ venture: input.venture, displayName: "", clearSpace: 0, minimumHeightPx: 0, variants: mark.variants }, grounds, false);
  if (!chosen) throw new Error(`Brand kit ${input.venture} has no corner mark for grounds ${grounds.join(", ")}`);
  const id = `mark-${input.uid}-`;
  return `<svg x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" viewBox="${chosen.variant.viewBox.join(" ")}" preserveAspectRatio="xMidYMid meet" overflow="visible" aria-hidden="true">${chosen.variant.markup.replaceAll(LOGO_ID, id)}</svg>`;
}

/**
 * The template checks as the renderer will apply them to this brand.
 *
 * `validateTemplateForBrand` judges the tokens it is handed. A kitted brand is not drawn in those:
 * it is drawn in its kit's palette and faces, with the template flattened as the kit asks, on any
 * of the kit's grounds a slide can stand on. The Design Lab's check column reads this, so a
 * template it shows as passing is one the renderer will draw. A brand whose kit cannot be used
 * fails every template, with the kit's reason.
 */
export function validateTemplateAsRendered(template: CarouselTemplate, brand: BrandTokens, format: CarouselFormat, look?: string): TemplateCheck[] {
  let style: KitStyle | null;
  try {
    style = kitStyleWithLook(kitStyleFor(brand), look);
  } catch (error) {
    return [{ id: "brand-tokens", status: "fail", detail: error instanceof Error ? error.message : String(error) }];
  }
  if (!style) return validateTemplateForBrand(template, brand, format);
  const dressed = dressBrand(brand, style);
  const drawn = kitTemplate(template, style);
  const grounds = [...style.grounds.keys()];
  if (grounds.length === 0) return validateTemplateForBrand(drawn, dressed, format);
  const perGround = grounds.map((ground) => ({ ground, checks: validateTemplateForBrand(drawn, brandOnGround(dressed, style, ground), format) }));
  return perGround[0]!.checks.map((first, index) => {
    const failing = perGround.filter(({ checks }) => checks[index]!.status === "fail");
    return failing.length === 0
      ? first
      : { ...first, status: "fail" as const, detail: failing.map(({ ground, checks }) => `${ground}: ${checks[index]!.detail}`).join("; ") };
  });
}

/** The slide's place in the deck, from the caller's deck or from the template itself. */
function positionOf(input: CarouselRenderInput, index: number, slides: number): DeckPosition {
  return input.deck ? { index: input.deck.index + index, count: input.deck.count } : { index, count: slides };
}

/** The brand a slide is drawn in: the kit's palette, on the ground its position calls for. */
function slideBrand(brand: BrandTokens, style: KitStyle | null, position: DeckPosition): { brand: BrandTokens; ground: string | null } {
  const ground = style ? groundAt(style, position) : null;
  return { brand: ground ? brandOnGround(brand, style!, ground) : brand, ground };
}

/**
 * Build the deck's slides — or, given `wanted`, only that one.
 *
 * `wanted` narrows which slides get built, never how one is built. The slide keeps its real deck
 * index, and the index is the only thing about a slide that its neighbours contribute: it seeds
 * the per-layer SVG ids and it numbers the title. So slide four rendered alone is the same string
 * as slide four rendered fourth, which is what lets a preview serve one slide and still be the
 * bytes the pipeline would ship.
 *
 * Everything that judges the whole template — required slots, brand checks — still runs over the
 * whole template. A deck that would fail on slide nine must not quietly pass because the caller
 * only asked for slide one.
 */
function renderSlides(input: CarouselRenderInput, wanted?: number): RenderedSlide[] {
  const parsed = CarouselTemplateSchema.parse(input.template);
  const payload = CarouselPayloadSchema.parse(input.payload);
  const declared = BrandTokensSchema.parse(input.brand);
  // A kitted brand is drawn from its kit or not at all: `kitStyleFor` throws for a missing or
  // damaged kit, and so does a kit that gives the logo slot nothing to draw.
  const style = kitStyleWithLook(kitStyleFor(declared), input.look);
  if (style && !logotypeForBrand(declared.id)) throw new Error(`Brand kit ${style.venture} marks no logotype file for the logo slot`);
  const brand = style ? dressBrand(declared, style) : declared;
  const template = style ? kitTemplate(parsed, style) : parsed;
  const missing = template.requiredSlots.filter((slot) => payload.strings[slot] === undefined);
  if (missing.length) throw new Error(`Carousel payload is missing slots: ${missing.join(", ")}`);
  checkImages(template, payload, input);
  // Every ground the deck's slides stand on is checked, whichever slide was asked for.
  const grounded = template.slides.map((_, index) => slideBrand(brand, style, positionOf(input, index, template.slides.length)));
  const checked = new Set<string | null>();
  for (const { brand: onGround, ground } of grounded) {
    if (checked.has(ground)) continue;
    checked.add(ground);
    const failed = validateTemplateForBrand(template, onGround, input.format).filter((check) => check.status === "fail");
    if (failed.length) throw new Error(`Template checks failed${ground ? ` on the ${ground} ground` : ""}: ${failed.map((check) => check.detail).join("; ")}`);
  }
  const canvas = template.formats[carouselCanvas(input.format)];
  const build = (slide: CarouselTemplate["slides"][number], index: number): RenderedSlide => {
    const variant = payload.variant ? slide.variants.find((candidate) => candidate.id === payload.variant) : undefined;
    const { brand: slideTokens, ground } = grounded[index]!;
    const position = positionOf(input, index, template.slides.length);
    // A grounded slide stands on its ground; a variant may still swap the accent, never the ground.
    const backgroundToken = ground ? "background" : variant?.backgroundToken ?? slide.backgroundToken;
    // Which slots did not fit, per slide. fitText has always known; the renderer discarded the
    // answer, so an over-long slide clipped to an ellipsis and nothing said so. A word limit
    // that the renderer silently enforces by cutting is not a limit, it is a surprise.
    const truncatedSlots: string[] = [];
    // Measured before anything is drawn, because a panel is drawn under the text it hugs and so
    // has to know the text's height before the text exists in the output.
    const hugged = Object.fromEntries(slide.layers.flatMap((layer) => {
      if (layer.type !== "text") return [];
      const fitted = fitTextLayer(layer, payload, slideTokens, canvas.width, canvas.height);
      return [[layer.slot, fitted.lines.length * fitted.fontSize * 1.12] as const];
    }));
    const rendering = { background: backgroundToken, accent: variant?.accentToken ?? "accent" };
    const content = slide.layers.map((layer, layerIndex) => layerSvg({
      layer,
      payload,
      brand: slideTokens,
      width: canvas.width,
      height: canvas.height,
      accentToken: variant?.accentToken,
      truncatedSlots,
      images: input.images,
      hugged,
      // Slide and layer, so two gradients on one deck cannot collide on an SVG id.
      uid: `${index}-${layerIndex}`,
      slide: { slide, layerIndex, rendering },
      logoAllowed: logoAllowedAt(style, position)
    })).join("") + (style?.cornerMark
      ? cornerMarkSvg({ mark: style.cornerMark, slide, brand: slideTokens, rendering, width: canvas.width, height: canvas.height, format: input.format, venture: style.venture, uid: `${index}` })
      : "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(template.name)} ${index + 1}</title><desc id="desc">Original ${escapeXml(brand.name)} carousel layout rendered by the Design Lab.</desc><rect width="${canvas.width}" height="${canvas.height}" fill="${token(slideTokens, backgroundToken)}"/>${content}</svg>`;
    return {
      slideId: slide.id,
      index,
      format: input.format,
      svg,
      svgHash: createHash("sha256").update(svg).digest("hex"),
      truncatedSlots
    };
  };
  if (wanted === undefined) return template.slides.map(build);
  const slide = template.slides[wanted];
  return slide ? [build(slide, wanted)] : [];
}

/**
 * The photographs a render was handed, judged against what the template asks for.
 *
 * Whole-template, like the slot and brand checks: slide one of a deck whose slide five lacks its
 * required photograph is refused, because a preview that passes and a deck that throws are one
 * deck answering two ways. A crop for a slot the template does not carry is refused too — it can
 * only be a payload written for some other template. And a crop is applied in sharp, which the
 * synchronous SVG path cannot do, so bytes that `prepareCarouselImages` did not cut for this very
 * crop and frame are refused rather than drawn uncropped or cut for another crop.
 */
function checkImages(template: CarouselTemplate, payload: CarouselPayload, input: CarouselRenderInput): void {
  const images = input.images;
  const layers = template.slides.flatMap((slide) => slide.layers.flatMap((layer) => layer.type === "image" ? [layer] : []));
  const slots = new Set(layers.map((layer) => layer.slot));
  const required = [...new Set(layers.filter((layer) => !layer.optional).map((layer) => layer.slot))];
  const absent = required.filter((slot) => !images?.[slot]);
  if (absent.length) throw new Error(`Carousel images are missing required slots: ${absent.join(", ")}`);
  const crops = Object.keys(payload.images ?? {});
  const stray = crops.filter((slot) => !slots.has(slot));
  if (stray.length) throw new Error(`Carousel payload crops image slots the template does not carry: ${stray.join(", ")}`);
  const uncut = crops.filter((slot) => images?.[slot] !== undefined && !isCutFor(input, slot, payload.images![slot]!, images[slot]!));
  if (uncut.length) throw new Error(`Image slots ${uncut.join(", ")} carry a crop their bytes were not cut for; pass the original images through prepareCarouselImages first`);
}

// The photograph pipeline lives in images.ts; its two long-standing entry points stay importable here.
export { prepareCarouselImages, treatImage } from "./images.js";

export function renderCarouselSvg(input: CarouselRenderInput): RenderedSlide[] {
  return renderSlides(input);
}

/**
 * One slide of the deck, identical to `renderCarouselSvg(input)[index]`.
 *
 * Null when the deck has no such slide, which is a 404 and not an error.
 */
export function renderCarouselSlideSvg(input: CarouselRenderInput & { index: number }): RenderedSlide | null {
  return renderSlides(input, input.index)[0] ?? null;
}

/*
 * Rasterised by resvg with the repository's own fonts, and with the operating system's shut out.
 *
 * The alternative was to keep sharp's librsvg and bundle a fontconfig file for it. Both were
 * evaluated in place. librsvg resolves faces through fontconfig, which means the answer depends
 * on an environment variable, on the fontconfig build inside a prebuilt sharp binary, and on
 * whichever system fonts happen to sit alongside ours — and when it cannot find a face it
 * substitutes one without saying so, which is the exact failure this task exists to end. resvg
 * takes the font files as an explicit list and `loadSystemFonts: false` removes the machine from
 * the question entirely: the only faces in the database are the thirty committed here. That is
 * what makes the CI run a real second machine rather than a second guess.
 *
 * sharp stays for what it is good at — decoding a WebP hero and applying a photo treatment before
 * the bytes reach the SVG.
 */
async function rasterise(
  slides: readonly RenderedSlide[]
): Promise<Array<RenderedSlide & { png: Buffer; pngHash: string }>> {
  const { Resvg } = await import("@resvg/resvg-js");
  const font = { loadSystemFonts: false, fontFiles: fontFiles(), defaultFontFamily: "IBM Plex Sans" };
  return slides.map((slide) => {
    const png = Buffer.from(new Resvg(slide.svg, { font }).render().asPng());
    return { ...slide, png, pngHash: createHash("sha256").update(png).digest("hex") };
  });
}

export async function renderCarouselPng(
  input: CarouselRenderInput
): Promise<Array<RenderedSlide & { png: Buffer; pngHash: string }>> {
  return rasterise(renderSlides({ ...input, images: await prepareCarouselImages(input) }));
}

/**
 * One slide's PNG, identical to `(await renderCarouselPng(input))[index]`.
 *
 * A preview that shows a reader one slide should cost one rasterisation. Going through
 * `renderCarouselPng` and discarding the rest cost a whole deck per slide, so opening a ten-slide
 * deck rasterised a hundred images to show ten.
 */
export async function renderCarouselSlidePng(
  input: CarouselRenderInput & { index: number }
): Promise<(RenderedSlide & { png: Buffer; pngHash: string }) | null> {
  const [rendered] = await rasterise(renderSlides({ ...input, images: await prepareCarouselImages(input) }, input.index));
  return rendered ?? null;
}

/**
 * Decode any stored image into the PNG bytes an image layer can embed.
 *
 * librsvg draws nothing at all for a WebP data URI — no error, no image, just the background —
 * and heroes are stored as WebP. Verified by rendering all three encodings and sampling pixels.
 * This lives beside the renderer because it is the renderer's requirement, not the caller's
 * problem, and it keeps sharp out of every package that wants a slide.
 *
 * Returns null rather than throwing: a hero that will not decode is a slide without a
 * photograph, which is a worse slide and not a failed render.
 */
export async function toRenderablePng(bytes: Buffer | Uint8Array): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(Buffer.from(bytes)).png().toBuffer();
  } catch {
    return null;
  }
}
