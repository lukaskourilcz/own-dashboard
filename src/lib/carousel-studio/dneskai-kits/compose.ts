import { CarouselTemplateSchema, type CarouselLayerInput, type CarouselTemplate, type CarouselTemplateInput } from "../schema.js";
import { MASTER_CANVAS, MASTER_FORMAT } from "../canvas.js";
import { DNESKAI_THUMBNAIL_GRID } from "../dneskai-layout.js";

/**
 * DNESKAi's photographic slides for Instagram (quorum#603), one single-slide template per type.
 *
 * Single-slide templates for the reason the post decks use them: a carousel here is assembled from
 * whatever the day's story has — one photograph or four, a chart, a quote — so each slide is
 * chosen on its own and the deck is the sequence. No slide prints its place in the deck, and none
 * prints a picture credit: since the owner's decision of 22 October 2026 the credits travel in the
 * Instagram caption, and the first slide of a post carries its headline and nothing else.
 *
 * Composed for the 4:5 master alone. These are photographic compositions: a cover's headline
 * stands on the floor of a full-bleed picture and the figure plates are sized to the 1080 × 1350
 * frame, so none of them is honest at 1:1 or 9:16 and none claims to be.
 *
 * The kit's rules hold here as everywhere: square corners, no glow, no blur, no ornament, no
 * emoji. Photographs are drawn in colour (treatment `none`); a mono or duotone DNESKAi photograph
 * is refused by the tests. The one gradient is the cover's shade, a single ink at varying opacity
 * drawn only over a photograph, which the flat rule keeps (see `ShadeSchema`).
 *
 * Geometry is written in master pixels and converted once, so a reader can check it against the
 * 1080 × 1350 renders without dividing.
 *
 * The frames below are the largest each element may take: the words are fitted in them and the
 * template checks pass on them. Every template but the cover is drawn laid out for its content
 * (`dneskai-layout.ts`): frames shrink to the lines and pictures they hold and stack in reading
 * order with the kit's gaps, and the height left over is set around them on purpose.
 */

export const { width: W, height: H } = MASTER_CANVAS;

/** The version of a template the render lays out for its content (`dneskai-layout.ts`). */
export const FLOWED = "1.1.0";

/** Margins: 72 px clears the 3:4 profile-grid crop of a 4:5 post (34 px a side) with room left. */
export const LEFT = 72;
export const MEASURE = 936;
export const RIGHT = LEFT + MEASURE;

type Box = { x: number; y: number; width: number; height: number };
export const box = (x: number, y: number, width: number, height: number): Box => ({ x: x / W, y: y / H, width: width / W, height: height / H });

type TextOptions = Partial<Extract<CarouselLayerInput, { type: "text" }>>;
export const text = (slot: string, frame: Box, options: TextOptions): CarouselLayerInput => ({
  type: "text",
  slot,
  ...frame,
  colorToken: "foreground",
  fontToken: "headline",
  fontWeight: 700,
  minFontSize: 28,
  maxFontSize: 48,
  maxChars: 120,
  maxLines: 3,
  // Every kit slot keeps the Czech ties: no line ends on v, k, s, z, o, u, a or i, and a number
  // keeps its digit groups and its unit.
  keepWithNext: "cs",
  ...options
});

export const fill = (frame: Box, fillToken: string): CarouselLayerInput => ({ type: "shape", ...frame, fillToken, strokeWidth: 0, radius: 0 });

/** The DNESKAi logotype, top left, drawn from the kit's outlines at about 34 px high. */
export const logo: CarouselLayerInput = { type: "logo", ...box(LEFT, 64, 230, 52), colorToken: "foreground", fontToken: "headline" };

/** An uppercase, tracked label in the mono face: a kicker, or the sources slide's image label. */
export const kicker = (colorToken: string, frame: Box, size = 22, maxChars = 56, slot = "kicker"): CarouselLayerInput =>
  text(slot, frame, { colorToken, fontToken: "mono", fontWeight: 400, minFontSize: size, maxFontSize: size, maxChars, maxLines: 1, uppercase: true, tracking: 0.08 });

export const body = (frame: Box, options: TextOptions): CarouselLayerInput =>
  text("body", frame, { colorToken: "muted", fontToken: "body", fontWeight: 400, ...options });

/**
 * A photograph or figure with a 2 px hairline around the picture as drawn. A contained chart keeps
 * its own shape and its own margins; a covering photograph fills the frame.
 */
export function plated(slot: string, x: number, y: number, width: number, height: number, options: { optional: boolean; fit: "cover" | "contain" }): CarouselLayerInput[] {
  return [{
    type: "image",
    slot,
    optional: options.optional,
    fit: options.fit,
    scrim: "none",
    treatment: "none",
    ...box(x, y, width, height),
    border: { colorToken: "muted", width: 2 }
  }];
}

/**
 * The cover's shade: a touch of ink behind the logotype, clear through the picture's middle, then
 * deep enough under the headline that white type clears 4.5:1 over a white photograph.
 */
export const COVER_SHADE = {
  colorToken: "foreground",
  stops: [
    { at: 0, opacity: 0.5 },
    { at: 0.16, opacity: 0 },
    { at: 0.36, opacity: 0 },
    { at: 0.56, opacity: 0.68 },
    { at: 1, opacity: 0.9 }
  ]
};

export const bleed = (slot: string): CarouselLayerInput => ({
  type: "image",
  slot,
  optional: false,
  fit: "cover",
  scrim: "none",
  treatment: "none",
  ...box(0, 0, W, H),
  shade: COVER_SHADE
});

const DNESKAI_FORMATS = {
  "instagram-square": { width: 1_080, height: 1_080, safeArea: { top: 0.045, right: 0.06, bottom: 0.045, left: 0.06 } },
  [MASTER_FORMAT]: { width: W, height: H, safeArea: { top: 0.045, right: 0.06, bottom: 0.045, left: 0.06 } },
  "instagram-story": { width: 1_080, height: 1_920, safeArea: { top: 0.14, right: 0.07, bottom: 0.16, left: 0.07 } },
  threads: { width: 1_200, height: 1_200, safeArea: { top: 0.07, right: 0.07, bottom: 0.09, left: 0.07 } }
};

export function template(input: {
  id: string;
  name: string;
  description: string;
  backgroundToken: string;
  layers: CarouselLayerInput[];
  variants?: CarouselTemplateInput["slides"][number]["variants"];
  /** 1.0.0 is the first composition; a template the render lays out for its content is 1.1.0. */
  version?: string;
}): CarouselTemplate {
  const slots = [...new Set(input.layers.flatMap((layer) => layer.type === "text" ? [layer.slot] : []))];
  return CarouselTemplateSchema.parse({
    schemaVersion: "carousel-template/2",
    id: input.id,
    name: input.name,
    version: input.version ?? "1.0.0",
    status: "live",
    description: input.description,
    citedObservationRefs: ["quorum#603", "own-dashboard#110"],
    formats: DNESKAI_FORMATS,
    canvas: { master: MASTER_FORMAT, derive: [] },
    requiredSlots: slots,
    slides: [{ id: `slide-${input.id}`, backgroundToken: input.backgroundToken, layers: input.layers, variants: input.variants ?? [] }]
  });
}
