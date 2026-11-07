import { z } from "zod";
import { CANVAS_ORDER, CANVAS_RATIO_TOLERANCE, MASTER_FORMAT, MASTER_RATIO, canvasRatio, ratiosAgree } from "./canvas.js";

/** The four canvases a template is composed and checked for. `canvas.ts` owns the list. */
export const CarouselCanvasSchema = z.enum(CANVAS_ORDER);

export const CarouselFormatSchema = z.enum([
  ...CANVAS_ORDER,
  /*
   * LinkedIn's multi-image post, 1080 × 1080 (quorum#575). A publishing format, not a fifth
   * composition: it draws on the square canvas, so the four ratios every template is composed and
   * checked for stay four. See `carouselCanvas`.
   */
  "linkedin-square"
]);

export const TemplateStatusSchema = z.enum(["draft", "live", "deprecated"]);

/**
 * The languages this engine sets type in.
 *
 * Not the same enum as a payload's `locale`, which is the language of a *delivered record* and
 * has only ever been Czech or English. This one is the language of a *frame*: the bilingual
 * Tehdejší svět card sets Ukrainian in half of its slots while the record around it stays Czech.
 */
export const PublishingLocaleSchema = z.enum(["cs", "en", "uk"]);
export const PUBLISHING_LOCALES = PublishingLocaleSchema.options;
export type PublishingLocale = z.infer<typeof PublishingLocaleSchema>;

const UnitSchema = z.number().finite().min(0).max(1);
const TokenNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
const SlotNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

/** The first template language: one optional photograph per template, in the slot `image`. */
export const CAROUSEL_TEMPLATE_V1 = "carousel-template/1" as const;
/**
 * The second (quorum#603): several photographs per template and per slide, each in its own slot,
 * a required photograph that refuses to render without its bytes, a shade over a photograph and
 * bottom- or middle-anchored text. Everything it adds is refused in a v1 document, so a v1
 * template parses to exactly the object it always did and renders the bytes it always did.
 */
export const CAROUSEL_TEMPLATE_V2 = "carousel-template/2" as const;
export const CAROUSEL_TEMPLATE_VERSIONS = [CAROUSEL_TEMPLATE_V1, CAROUSEL_TEMPLATE_V2] as const;

/** An image slot: `image`, or `image-1` to `image-99`. v1 allows only `image`. */
export const IMAGE_SLOT_PATTERN = /^image(?:-[1-9][0-9]?)?$/;
export const ImageSlotSchema = z.string().regex(IMAGE_SLOT_PATTERN);

/** The most distinct photographs one v2 template may hold: Instagram's own per-post ceiling. */
export const MAX_IMAGE_SLOTS = 20;

const FrameSchema = z.object({
  x: UnitSchema,
  y: UnitSchema,
  width: UnitSchema.positive(),
  height: UnitSchema.positive()
}).superRefine((frame, context) => {
  if (frame.x + frame.width > 1 || frame.y + frame.height > 1) {
    context.addIssue({ code: "custom", message: "Layer frame must stay inside the canvas" });
  }
});

/*
 * Every field below this line is optional with a default that reproduces the old behaviour.
 *
 * That is the contract's "additive schema evolution" in practice, and it is not a nicety: stored
 * proposals, stored packs and the deck references inside them (`deck-spotlight-10` in
 * state/social/packs/2026-08-06.json) are parsed with safeParse and silently dropped when they
 * fail. A required field would not have surfaced an error, it would have made those documents
 * vanish. So a v1 document parses, and renders to the byte-identical SVG it always did.
 */
const TextLayerSchema = FrameSchema.extend({
  type: z.literal("text"),
  slot: SlotNameSchema,
  colorToken: TokenNameSchema,
  fontToken: z.enum(["headline", "body", "mono"]),
  fontWeight: z.number().int().min(300).max(900),
  minFontSize: z.number().int().min(16).max(160),
  maxFontSize: z.number().int().min(16).max(200),
  maxChars: z.number().int().min(1).max(1_000),
  maxLines: z.number().int().min(1).max(12),
  align: z.enum(["start", "middle", "end"]).default("start"),
  uppercase: z.boolean().default(false),
  /**
   * Letter-spacing, in em.
   *
   * Uppercase Czech mono at 20 px with no tracking is a smear at thumbnail size, and a kicker is
   * read at thumbnail size or not at all. The fitter is told about it too — tracked text is wider
   * per character, and measuring it untracked is how a label runs off the canvas.
   */
  tracking: z.number().finite().min(-0.05).max(0.4).default(0),
  /** A soft shadow in the slide's accent, for text that has to hold over busy ground. */
  glow: z.boolean().default(false),
  /**
   * The language this frame is set in, where it is not the brand's primary.
   *
   * Optional and with no default, unlike everything else below the line above, because the
   * default is a property of the brand rather than of the template: one layout renders in ten
   * brands and each of them has its own primary language. Absent therefore means "whatever this
   * brand publishes in", and only a frame that deliberately sets something else — the Ukrainian
   * half of a bilingual card — names it.
   *
   * It is a layout input, not a rendering one. The fitter measures the real string against real
   * advance widths and needs no hint; the capacity arithmetic has no string to measure and would
   * otherwise charge a Cyrillic line the Latin average.
   */
  lang: PublishingLocaleSchema.optional(),
  /**
   * Where the fitted lines sit inside the frame. v2 only, and absent means top.
   *
   * The engine top-anchored every passage, so a cover whose headline has to stand on its kicker
   * line left a gap that grew with every word the headline did not have. A bottom-anchored frame
   * keeps the last line on the frame's floor whatever the line count.
   */
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  /**
   * Spaces a line may not break at. v2 only, and absent means any space, as in every v1 layer.
   *
   * `cs` keeps the Czech typesetting ties: a one-letter preposition or conjunction goes down with
   * the word after it instead of ending a line, the digit groups of one number stay together and a
   * number keeps its unit or percent sign (`KeepWithNext` in `text.ts`).
   */
  keepWithNext: z.enum(["cs"]).optional()
}).superRefine((layer, context) => {
  if (layer.minFontSize > layer.maxFontSize) {
    context.addIssue({ code: "custom", message: "minFontSize cannot exceed maxFontSize" });
  }
});

const ShapeLayerSchema = FrameSchema.extend({
  type: z.literal("shape"),
  fillToken: TokenNameSchema,
  strokeToken: TokenNameSchema.optional(),
  strokeWidth: z.number().finite().min(0).max(12).default(0),
  radius: z.number().finite().min(0).max(0.5).default(0),
  /**
   * A panel that hugs a named text slot instead of standing at a fixed height.
   *
   * The engine top-anchors text, so a 24-character passage in a frame sized for 240 leaves the
   * panel two-thirds empty — the shape says "this much text" and the text says otherwise. With
   * `padText` the frame is the panel's maximum and the drawn rectangle is the fitted text plus
   * `padding`. The declared frame still has to contain the text, because that is what the
   * contrast check measures against.
   */
  padText: SlotNameSchema.optional(),
  padding: z.number().finite().min(0).max(0.1).default(0.02)
});

const RuleLayerSchema = FrameSchema.extend({
  type: z.literal("rule"),
  colorToken: TokenNameSchema,
  thickness: z.number().finite().min(1).max(20),
  /** A dashed rule. The dash pattern is derived from the thickness, so it scales with the rule. */
  dash: z.boolean().default(false)
});

/**
 * Two token stops and an angle.
 *
 * Two rather than many, because a gradient is a transition and a list of colours is a palette;
 * and because every stop is a colour behind the text above it, so each one has to clear the
 * contrast floor. Both stops at the same offset give a hard edge — which is how a family cuts a
 * diagonal across the frame without a bitmap.
 */
const GradientLayerSchema = FrameSchema.extend({
  type: z.literal("linear-gradient"),
  /** Degrees clockwise from the top of the canvas. */
  angle: z.number().finite().min(0).max(360),
  stops: z.tuple([
    z.object({ colorToken: TokenNameSchema, offset: UnitSchema }),
    z.object({ colorToken: TokenNameSchema, offset: UnitSchema })
  ])
});

const LogoLayerSchema = FrameSchema.extend({
  type: z.literal("logo"),
  colorToken: TokenNameSchema,
  fontToken: z.enum(["headline", "body", "mono"]).default("headline")
});

/**
 * A single-ink opacity ramp drawn over a photograph, top to bottom of the image frame.
 *
 * A legibility device, not a surface: it is drawn only when the photograph is, inside the
 * photograph's window, in one token at varying opacity. That is why a flat kit keeps it while it
 * evens out a fading `scrim` — the flat rule governs grounds, and a shade is never a ground on its
 * own. The contrast check reads it: text inside the frame is measured against a white and a black
 * photograph each seen through the shade's weakest point under the text.
 */
const ShadeSchema = z.object({
  colorToken: TokenNameSchema,
  stops: z.array(z.object({ at: UnitSchema, opacity: UnitSchema })).min(2).max(6)
}).superRefine((shade, context) => {
  shade.stops.forEach((stop, index) => {
    if (index > 0 && stop.at < shade.stops[index - 1]!.at) {
      context.addIssue({ code: "custom", message: "Shade stops must run top to bottom", path: ["stops", index, "at"] });
    }
  });
});

const ImageLayerSchema = FrameSchema.extend({
  type: z.literal("image"),
  /** `image` in v1. In v2 any `image-N`, so one template can carry several photographs. */
  slot: ImageSlotSchema,
  /**
   * Whether the slide may draw without the photograph. Always true in v1. A v2 layer that sets it
   * false makes the renderer throw when the slot has no bytes, instead of drawing the slide bare.
   */
  optional: z.boolean(),
  fit: z.enum(["cover", "contain"]),
  /** A soft fade to the slide background, so text over the lower edge stays legible. */
  scrim: z.enum(["none", "bottom", "full"]).default("none"),
  /** A circular window, or a polygon in frame fractions. */
  clip: z.union([
    z.literal("circle"),
    z.array(z.tuple([UnitSchema, UnitSchema])).min(3).max(12)
  ]).optional(),
  /**
   * What is done to the photograph before it is embedded.
   *
   * Applied to the hero bytes with sharp, never as an SVG filter, so librsvg only ever sees a
   * finished PNG — the same reason a WebP hero is transcoded rather than handed over. `duotone`
   * multiplies the greyscale by the slide's accent.
   */
  treatment: z.enum(["none", "mono", "duotone"]).default("none"),
  /**
   * A second appearance of the same photograph, small, later in the deck.
   *
   * One slot used twice rather than a second picture, which is why the template check counts
   * distinct image slots and not image layers.
   */
  reprise: z.boolean().default(false),
  /** v2 only. See `ShadeSchema`. */
  shade: ShadeSchema.optional(),
  /**
   * v2 only: a hairline around the picture as drawn — the frame for `cover`, the contained
   * rectangle for `contain` — so a wide chart in a tall frame is framed where it is, not where its
   * frame is. Drawn outside the picture's edge, so it never covers a pixel of it. With
   * `clip: "circle"` it is a ring on the disc's edge instead.
   */
  border: z.object({ colorToken: TokenNameSchema, width: z.number().finite().min(0.5).max(12) }).optional()
});

/**
 * A mesh gradient: several wide, blurred colour fields overlapping.
 *
 * Built from blurred radial gradients rather than an image, so it renders offline, deterministically,
 * and at any canvas size. Colours are token names — a template may not invent a colour, and the same
 * mesh reads differently under each venture's palette because it is the venture's own colours.
 */
const MeshLayerSchema = FrameSchema.extend({
  type: z.literal("mesh"),
  blobs: z.array(z.object({
    colorToken: TokenNameSchema,
    /** Centre and radius, as a fraction of the layer frame. */
    cx: z.number().finite().min(-0.5).max(1.5),
    cy: z.number().finite().min(-0.5).max(1.5),
    radius: z.number().finite().min(0.05).max(1.5),
    opacity: z.number().finite().min(0.05).max(1)
  })).min(2).max(6),
  /** Blur radius as a fraction of the shorter canvas edge. */
  softness: z.number().finite().min(0).max(0.3).default(0.08)
});

export const CarouselLayerSchema = z.discriminatedUnion("type", [
  TextLayerSchema,
  ShapeLayerSchema,
  RuleLayerSchema,
  LogoLayerSchema,
  ImageLayerSchema,
  MeshLayerSchema,
  GradientLayerSchema
]);

const SlideVariantSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9-]*$/),
  backgroundToken: TokenNameSchema.optional(),
  accentToken: TokenNameSchema.optional()
});

const SlideSchema = z.object({
  id: z.string().regex(/^slide-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  backgroundToken: TokenNameSchema,
  layers: z.array(CarouselLayerSchema).min(1).max(24),
  variants: z.array(SlideVariantSchema).max(4).default([])
});

const FormatSpecSchema = z.object({
  width: z.number().int().min(320).max(4_096),
  height: z.number().int().min(320).max(4_096),
  safeArea: z.object({
    top: UnitSchema.max(0.25),
    right: UnitSchema.max(0.25),
    bottom: UnitSchema.max(0.25),
    left: UnitSchema.max(0.25)
  })
});

/**
 * Which canvas this layout is drawn for, and which others it declares itself derivable to.
 *
 * `formats` says what each canvas measures; this says which of them the composition was actually
 * made for. They are different questions and conflating them is how a 4:5 deck came to be offered
 * as a square: every template carried four canvas declarations because the record had nowhere to
 * say "this one, and these by derivation".
 *
 * Defaulted, and the default is the master alone. A stored document written before this field
 * existed still parses and still renders the byte-identical slides it always did — what it no
 * longer does is claim three canvases nobody composed it for. Narrowing is the safe direction:
 * `resolveLifecycleStatus` reads the checks run over the offered formats, so offering fewer can
 * never demote a template, while offering more is exactly what demoted the gallery when the story
 * canvas arrived.
 */
const CanvasSchema = z.object({
  master: CarouselCanvasSchema.default(MASTER_FORMAT),
  /** Other canvases this composition is honest at. The master is implied and may not repeat here. */
  derive: z.array(CarouselCanvasSchema).max(3).default([])
}).superRefine((canvas, context) => {
  if (canvas.derive.includes(canvas.master)) {
    context.addIssue({ code: "custom", message: "The master canvas is implied and may not be repeated in derive", path: ["derive"] });
  }
  if (new Set(canvas.derive).size !== canvas.derive.length) {
    context.addIssue({ code: "custom", message: "A derived canvas may be declared only once", path: ["derive"] });
  }
});

export const CarouselTemplateSchema = z.object({
  schemaVersion: z.enum(CAROUSEL_TEMPLATE_VERSIONS),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: TemplateStatusSchema,
  description: z.string().trim().min(10).max(240),
  citedObservationRefs: z.array(z.string().trim().min(1).max(240)).max(12),
  formats: z.object({
    "instagram-square": FormatSpecSchema,
    "instagram-portrait": FormatSpecSchema,
    /*
     * The story canvas carries a default, and that is deliberate rather than lax.
     *
     * A template proposed and stored before this format existed has only three canvases, and the
     * site reads stored proposals with `safeParse` and silently drops whatever fails — so making
     * this required would not have surfaced an error, it would have made those templates vanish
     * from the gallery. Defaulting parses them unchanged and hands them the story canvas, which
     * is what "extend the contract, do not break its readers" means here.
     */
    "instagram-story": FormatSpecSchema.default({
      width: 1_080,
      height: 1_920,
      safeArea: { top: 0.14, right: 0.07, bottom: 0.16, left: 0.07 }
    }),
    threads: FormatSpecSchema
  }),
  canvas: CanvasSchema.default({ master: MASTER_FORMAT, derive: [] }),
  requiredSlots: z.array(SlotNameSchema).min(1).max(30),
  slides: z.array(SlideSchema).min(1).max(10)
}).superRefine((template, context) => {
  /*
   * The master canvas has to be the shape it claims.
   *
   * 4:5 is not a preference here, it is the frame Meta's carousel guidance recommends and the
   * one every delivered deck is rendered at. A template whose portrait canvas is some other
   * shape would render at a size the feed crops, and nothing downstream would say so — the
   * renderer reads `formats[format]` and draws whatever it finds.
   */
  const portrait = template.formats["instagram-portrait"];
  if (!ratiosAgree(canvasRatio(portrait), MASTER_RATIO)) {
    context.addIssue({
      code: "custom",
      message: `The portrait canvas must hold the ${MASTER_RATIO.toFixed(2)} master ratio within ${CANVAS_RATIO_TOLERANCE * 100}%`,
      path: ["formats", "instagram-portrait"]
    });
  }
  const slideIds = template.slides.map((slide) => slide.id);
  if (new Set(slideIds).size !== slideIds.length) {
    context.addIssue({ code: "custom", message: "Slide ids must be unique", path: ["slides"] });
  }
  const slots = new Set(template.requiredSlots);
  const referencedSlots = new Set<string>();
  const v2 = template.schemaVersion === CAROUSEL_TEMPLATE_V2;
  // Distinct slots, not layers. A photograph returning small on the outro is the same picture
  // used twice — one slot, two layers — and counting layers made that impossible to express.
  const imageSlots = new Set<string>();
  const optionalBySlot = new Map<string, boolean>();
  template.slides.forEach((slide, slideIndex) => {
    const textSlotsHere = new Set(slide.layers.flatMap((layer) => layer.type === "text" ? [layer.slot] : []));
    slide.layers.forEach((layer, layerIndex) => {
      const at = (field: string) => ["slides", slideIndex, "layers", layerIndex, field];
      if (layer.type === "text") referencedSlots.add(layer.slot);
      if (layer.type === "text" && layer.valign !== undefined && !v2) {
        context.addIssue({ code: "custom", message: `valign is a ${CAROUSEL_TEMPLATE_V2} field`, path: at("valign") });
      }
      if (layer.type === "text" && layer.keepWithNext !== undefined && !v2) {
        context.addIssue({ code: "custom", message: `keepWithNext is a ${CAROUSEL_TEMPLATE_V2} field`, path: at("keepWithNext") });
      }
      if (layer.type === "image") {
        imageSlots.add(layer.slot);
        if (!v2 && layer.slot !== "image") {
          context.addIssue({ code: "custom", message: `${CAROUSEL_TEMPLATE_V1} has one image slot, named image`, path: at("slot") });
        }
        if (!v2 && !layer.optional) {
          context.addIssue({ code: "custom", message: `Every ${CAROUSEL_TEMPLATE_V1} image is optional`, path: at("optional") });
        }
        if (!v2 && layer.shade !== undefined) {
          context.addIssue({ code: "custom", message: `shade is a ${CAROUSEL_TEMPLATE_V2} field`, path: at("shade") });
        }
        if (!v2 && layer.border !== undefined) {
          context.addIssue({ code: "custom", message: `border is a ${CAROUSEL_TEMPLATE_V2} field`, path: at("border") });
        }
        // One slot is one photograph. Required on one slide and optional on another would make
        // the same missing bytes a refusal or a bare slide depending on which slide was asked for.
        const declared = optionalBySlot.get(layer.slot);
        if (declared !== undefined && declared !== layer.optional) {
          context.addIssue({ code: "custom", message: `Image slot ${layer.slot} is both optional and required`, path: at("optional") });
        }
        optionalBySlot.set(layer.slot, layer.optional);
      }
      if (layer.type === "text" && !slots.has(layer.slot)) {
        context.addIssue({
          code: "custom",
          message: `Text slot ${layer.slot} is missing from requiredSlots`,
          path: ["slides", slideIndex, "layers", layerIndex, "slot"]
        });
      }
      // A panel that hugs a slot that is not on this slide has nothing to hug, and would draw at
      // its declared frame instead — a silently wrong panel rather than a rejected template.
      if (layer.type === "shape" && layer.padText !== undefined && !textSlotsHere.has(layer.padText)) {
        context.addIssue({
          code: "custom",
          message: `Panel hugs text slot ${layer.padText}, which this slide does not carry`,
          path: ["slides", slideIndex, "layers", layerIndex, "padText"]
        });
      }
    });
  });
  if (!v2 && imageSlots.size > 1) {
    context.addIssue({ code: "custom", message: "A template may contain at most one optional image slot", path: ["slides"] });
  }
  if (v2 && imageSlots.size > MAX_IMAGE_SLOTS) {
    context.addIssue({ code: "custom", message: `A template may hold at most ${MAX_IMAGE_SLOTS} image slots`, path: ["slides"] });
  }
  for (const slot of slots) {
    if (!referencedSlots.has(slot)) {
      context.addIssue({ code: "custom", message: `Required slot ${slot} is unused`, path: ["requiredSlots"] });
    }
  }
});

export const BrandTokensSchema = z.object({
  schemaVersion: z.literal("carousel-brand/1"),
  id: z.enum(["caught-up", "mma-files", "titty-tuesdays", "devshark", "kvorum", "booksofhistory", "door-money", "tehdejsi-svet", "webdev-signal"]),
  name: z.string().trim().min(2).max(80),
  logoText: z.string().trim().min(2).max(40),
  /**
   * The venture whose brand kit (`studio/brand-kits/<kit>/`) this brand is drawn from. A kitted
   * brand renders in the kit's palette, faces and marks, and refuses to render without the kit.
   */
  kit: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  colors: z.record(TokenNameSchema, z.string().regex(/^#[0-9a-f]{6}$/i)),
  fonts: z.object({
    headline: z.string().trim().min(2).max(100),
    body: z.string().trim().min(2).max(100),
    mono: z.string().trim().min(2).max(100)
  })
});

/**
 * How one photograph is framed in its slot: the point to keep in view, how far to zoom in, and
 * whether the frame is filled or the whole picture shown.
 *
 * Part of the payload, so it is hashed with the words: an approval covers the crop that was seen.
 * The bytes are not — they travel beside the payload, and `assetSha256` names which ones the crop
 * was set on, so a reader holding the original file can prove it is the same picture.
 */
export const ImageCropSchema = z.strictObject({
  assetSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** The point that stays in view, as fractions of the source image. */
  focal: z.strictObject({ x: UnitSchema, y: UnitSchema }),
  /** 1 shows the largest region the frame allows; 2 shows half of it, around the focal point. */
  zoom: z.number().finite().min(1).max(8).optional(),
  /** Overrides the layer's own fit for this photograph. */
  fit: z.enum(["cover", "contain"]).optional()
});

// Strict at the final render boundary: metadata from upstream records must be selected into
// strings deliberately. In particular, an admin-only BOOKSOFHISTORY coverRef cannot hitch a ride
// into a payload and become artwork merely because a caller spread a seed record here. The one
// non-string key, `images`, holds crop records only — a focal point, a zoom, a fit and an asset
// hash — never bytes, a URL or a reference a photograph could be fetched from.
export const CarouselPayloadSchema = z.strictObject({
  locale: z.enum(["en", "cs"]),
  strings: z.record(SlotNameSchema, z.string().max(2_000)),
  variant: z.string().regex(/^[A-Z][A-Z0-9-]*$/).optional(),
  /** Per image slot, how its photograph is cropped. Absent: drawn as the layer's fit draws it. */
  images: z.record(ImageSlotSchema, ImageCropSchema).optional()
});

export const TemplateReferenceSchema = z.object({
  template_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  content: CarouselPayloadSchema
});

export type CarouselFormat = z.infer<typeof CarouselFormatSchema>;

/** The four canvases a template is composed for; its `formats` object has exactly these keys. */
export type CarouselCanvas = z.infer<typeof CarouselCanvasSchema>;

const FORMAT_CANVAS: Readonly<Record<CarouselFormat, CarouselCanvas>> = {
  "instagram-square": "instagram-square",
  "instagram-portrait": "instagram-portrait",
  "instagram-story": "instagram-story",
  threads: "threads",
  // Same pixels and the same safe band as the Instagram square; only the destination differs.
  "linkedin-square": "instagram-square"
};

/** The canvas a format draws on. Every read of `template.formats` goes through this. */
export function carouselCanvas(format: CarouselFormat): CarouselCanvas {
  return FORMAT_CANVAS[format];
}
export type CarouselLayer = z.infer<typeof CarouselLayerSchema>;
/**
 * A layer as an author writes one, before defaults are filled in.
 *
 * Every capability added to this schema is optional with a default, so the parsed type gains a
 * required field for each. Generators build the *input* shape and let the parse complete it,
 * which is what keeps adding a capability from being a rewrite of every template in the library.
 */
export type CarouselLayerInput = z.input<typeof CarouselLayerSchema>;
export type CarouselTemplate = z.infer<typeof CarouselTemplateSchema>;
/** A template as an author writes one: every defaulted capability may be left out. */
export type CarouselTemplateInput = z.input<typeof CarouselTemplateSchema>;
export type BrandTokens = z.infer<typeof BrandTokensSchema>;
export type CarouselPayload = z.infer<typeof CarouselPayloadSchema>;
export type ImageCrop = z.infer<typeof ImageCropSchema>;
export type TemplateReference = z.infer<typeof TemplateReferenceSchema>;
