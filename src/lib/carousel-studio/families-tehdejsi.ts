import {
  CarouselTemplateSchema,
  type CarouselLayerInput,
  type CarouselTemplate,
  type CarouselTemplateInput
} from "./schema.js";
import { deckCanvas, deckFormats } from "./library.js";
import { BOTTOM, LEFT, MEASURE, RIGHT, TOP, rule, shape, text } from "./family-kit.js";

/**
 * The bilingual kit: two languages on one card, and neither of them a caption for the other.
 *
 * Its own builder rather than a `FamilySpec` in `DECK_FAMILIES`, because the deck-family contract
 * is one text slot per slide and the whole point of this venture is two. A composer there
 * receives `context.slot` and the template declares that one slot as required; a family here has
 * to declare a Czech slot and a Ukrainian one per slide and require both, so a package that lost
 * half of itself fails the render rather than drawing a card with a blank lower half.
 *
 * The slide law, in the order a reader meets it:
 *
 * - an **eyebrow** — the pillar, small and quiet, in the mono face;
 * - the **Czech line** at full size, which is the card's voice;
 * - a **hairline across 40% of the measure**, which is the whole separation device. Not a box,
 *   not a divider bar, not a flag: a rule short enough to read as punctuation. Two languages
 *   stacked with no mark between them read as one paragraph in a language nobody speaks;
 * - the **Ukrainian line** at 0.85 scale in muted ink. Smaller and lighter is a real editorial
 *   claim and worth being honest about — the feed's first audience is Czech, and the Ukrainian
 *   line is not a translation but is also not the lead. What it must never be is decoration, so
 *   it takes the same face, the same measure and the same left edge;
 * - a **footer** carrying the year·place chip and the attribution slot.
 */

/** The one device that separates the languages. Forty per cent of the measure, by the slide law. */
const HAIRLINE_SHARE = 0.4;

/** How much smaller the Ukrainian line sets. */
export const UA_SCALE = 0.85;

/** How much smaller it sets on the cover, where the Czech hook is doing more work. */
export const UA_COVER_SCALE = 0.8;

export type TehdejsiSlideKind = "cover" | "body" | "photo" | "outro";

/** The Czech slot for slide N, one-based and zero-padded so slots sort the way slides read. */
export function tehdejsiCsSlot(index: number): string {
  return `slide-${String(index + 1).padStart(2, "0")}`;
}

/** The Ukrainian slot beside it. Always derived, never typed by a caller. */
export function tehdejsiUaSlot(index: number): string {
  return `${tehdejsiCsSlot(index)}-ua`;
}

export const TEHDEJSI_EYEBROW_SLOT = "eyebrow";
export const TEHDEJSI_CHIP_SLOT = "year-place";
export const TEHDEJSI_ATTRIBUTION_SLOT = "attribution";
export const TEHDEJSI_PHOTO_SLOT = "image";

/**
 * The top bar, the coral tick and the registration crosshair.
 *
 * Three marks from the product's own share-image grammar, drawn as shapes and rules rather than
 * as artwork so they cost no bytes and cannot drift from the palette. The crosshair is a printer's
 * registration mark: the product uses it to say "this is a reproduction of something", which is
 * exactly what a card about 1975 is.
 */
function devices(kind: TehdejsiSlideKind): CarouselLayerInput[] {
  const tickToken = kind === "photo" ? "background" : "accent";
  return [
    // The top bar: a full-bleed band of green above the safe area, which is the product's masthead.
    shape(0, 0, 1, 0.028, { fillToken: "secondary" }),
    // The coral tick, hard against the left margin under the bar.
    shape(LEFT, 0.052, 0.038, 0.01, { fillToken: tickToken }),
    // The registration crosshair, bottom right: two hairlines crossing, never a glyph.
    rule(RIGHT - 0.035, BOTTOM + 0.052, 0.035, { thickness: 2, colorToken: "muted" }),
    {
      type: "shape",
      x: RIGHT - 0.0185,
      y: BOTTOM + 0.035,
      width: 0.002,
      height: 0.034,
      fillToken: "muted",
      strokeWidth: 0,
      radius: 0
    }
  ];
}

/** The footer: the year·place chip in coral, and the attribution beside it. */
function footer(): CarouselLayerInput[] {
  return [
    text(TEHDEJSI_CHIP_SLOT, LEFT, BOTTOM - 0.055, 0.34, 0.036, {
      colorToken: "accent",
      fontToken: "mono",
      fontWeight: 700,
      minFontSize: 18,
      maxFontSize: 24,
      maxChars: 28,
      maxLines: 1,
      uppercase: true
    }),
    text(TEHDEJSI_ATTRIBUTION_SLOT, LEFT + 0.36, BOTTOM - 0.052, MEASURE - 0.36, 0.032, {
      colorToken: "muted",
      fontToken: "mono",
      fontWeight: 400,
      minFontSize: 16,
      maxFontSize: 20,
      maxChars: 90,
      maxLines: 2
    })
  ];
}

function eyebrow(): CarouselLayerInput {
  return text(TEHDEJSI_EYEBROW_SLOT, LEFT, TOP, MEASURE, 0.036, {
    colorToken: "muted",
    fontToken: "mono",
    fontWeight: 600,
    minFontSize: 16,
    maxFontSize: 22,
    maxChars: 40,
    maxLines: 1,
    uppercase: true
  });
}

interface Band {
  top: number;
  csHeight: number;
  uaHeight: number;
  csMax: number;
  csMin: number;
  uaScale: number;
  csChars: number;
  uaChars: number;
  csLines: number;
  uaLines: number;
}

/**
 * The two type bands and the rule between them.
 *
 * The Ukrainian ceilings are the Czech ones scaled, rather than a second set of numbers, so the
 * relationship between the two languages is one constant and cannot drift as the bands are
 * tuned. Character budgets are scaled the other way — a smaller face fits more.
 */
function languagePair(index: number, band: Band): CarouselLayerInput[] {
  const ruleY = band.top + band.csHeight + 0.018;
  const uaTop = ruleY + 0.03;
  const scaleUp = (value: number) => Math.round(value / band.uaScale);
  return [
    text(tehdejsiCsSlot(index), LEFT, band.top, MEASURE, band.csHeight, {
      fontToken: "headline",
      fontWeight: 700,
      lang: "cs",
      minFontSize: band.csMin,
      maxFontSize: band.csMax,
      maxChars: band.csChars,
      maxLines: band.csLines
    }),
    rule(LEFT, ruleY, MEASURE * HAIRLINE_SHARE, { thickness: 2, colorToken: "accent" }),
    text(tehdejsiUaSlot(index), LEFT, uaTop, MEASURE, band.uaHeight, {
      fontToken: "headline",
      fontWeight: 400,
      // Declared, not inferred from the slot's `-ua` suffix: the capacity arithmetic charges
      // Cyrillic advances here, and a naming convention is a poor place to keep a measurement.
      lang: "uk",
      // Muted rather than foreground: the same ink at less weight, which is what "reduced
      // opacity" means in a token system that has no opacity on text.
      colorToken: "muted",
      minFontSize: Math.round(band.csMin * band.uaScale),
      maxFontSize: Math.round(band.csMax * band.uaScale),
      maxChars: scaleUp(band.uaChars),
      maxLines: band.uaLines
    })
  ];
}

const BANDS: Readonly<Record<TehdejsiSlideKind, Band>> = {
  // The cover gives the Czech hook the most room and drops the Ukrainian furthest below it.
  cover: {
    top: TOP + 0.075, csHeight: 0.26, uaHeight: 0.17,
    csMax: 78, csMin: 40, uaScale: UA_COVER_SCALE,
    csChars: 110, uaChars: 110, csLines: 4, uaLines: 4
  },
  body: {
    top: TOP + 0.085, csHeight: 0.21, uaHeight: 0.19,
    csMax: 54, csMin: 30, uaScale: UA_SCALE,
    csChars: 130, uaChars: 130, csLines: 5, uaLines: 5
  },
  // A photo slide gives the picture the top two-thirds, so both bands are short and sit low.
  photo: {
    top: 0.60, csHeight: 0.10, uaHeight: 0.075,
    csMax: 40, csMin: 26, uaScale: UA_SCALE,
    csChars: 70, uaChars: 70, csLines: 2, uaLines: 2
  },
  outro: {
    top: TOP + 0.1, csHeight: 0.20, uaHeight: 0.17,
    csMax: 58, csMin: 32, uaScale: UA_SCALE,
    csChars: 110, uaChars: 110, csLines: 4, uaLines: 4
  }
};

function slideLayers(index: number, kind: TehdejsiSlideKind): CarouselLayerInput[] {
  const layers: CarouselLayerInput[] = [...devices(kind)];
  if (kind === "photo") {
    layers.push({
      type: "image",
      slot: TEHDEJSI_PHOTO_SLOT,
      optional: true,
      fit: "cover",
      scrim: "bottom",
      x: 0,
      y: 0.028,
      width: 1,
      height: 0.56
    });
  } else {
    layers.push(eyebrow());
  }
  layers.push(...languagePair(index, BANDS[kind]), ...footer());
  return layers;
}

export function tehdejsiTemplateId(slideCount: number): string {
  return `tehdejsi-bilingual-${slideCount}`;
}

/**
 * The deck, sized to the feature.
 *
 * Slide two is the photo slide whenever the deck is long enough to have one, which is where a
 * licensed photograph goes and therefore the one slide whose attribution is not optional. The
 * attribution slot is required on *every* slide rather than only that one: a footer that appears
 * and disappears is a layout that jumps, and a slide with no photograph puts the source of its
 * fact there instead.
 */
export function tehdejsiDeckTemplate(slideCount: number): CarouselTemplate {
  const kinds: TehdejsiSlideKind[] = Array.from({ length: slideCount }, (_, index) =>
    index === 0 ? "cover" : index === slideCount - 1 ? "outro" : index === 1 ? "photo" : "body");
  const input: CarouselTemplateInput = {
    schemaVersion: "carousel-template/1",
    id: tehdejsiTemplateId(slideCount),
    name: `Tehdejší svět · ${slideCount} slides`,
    version: "1.0.0",
    status: "live",
    description:
      "Two languages on one card: a Czech line at full size, a 40% hairline, and a Ukrainian line "
      + "at 0.85 in muted ink. Top bar, coral tick and registration crosshair from the product's "
      + "share-image grammar.",
    citedObservationRefs: [],
    formats: deckFormats,
    canvas: deckCanvas(),
    // Both languages of every slide, plus the chrome. A package that lost half of itself fails
    // the render rather than drawing a card with a blank lower half.
    requiredSlots: [
      TEHDEJSI_EYEBROW_SLOT,
      TEHDEJSI_CHIP_SLOT,
      TEHDEJSI_ATTRIBUTION_SLOT,
      ...kinds.flatMap((_, index) => [tehdejsiCsSlot(index), tehdejsiUaSlot(index)])
    ],
    slides: kinds.map((kind, index) => ({
      id: `slide-tehdejsi-${String(index + 1).padStart(2, "0")}`,
      // Paper throughout. A rhythm that alternates grounds is what keeps a five-slide deck from
      // reading as one long card; here the photograph does that work, and a card about a paper
      // archive that changes colour every slide stops looking like paper.
      backgroundToken: "background",
      variants: [],
      layers: slideLayers(index, kind)
    }))
  };
  return CarouselTemplateSchema.parse(input);
}

export const TEHDEJSI_MIN_SLIDES = 3;
export const TEHDEJSI_MAX_SLIDES = 8;

let cache: readonly CarouselTemplate[] | null = null;

export function tehdejsiDeckTemplates(): readonly CarouselTemplate[] {
  cache ??= Array.from(
    { length: TEHDEJSI_MAX_SLIDES - TEHDEJSI_MIN_SLIDES + 1 },
    (_, index) => tehdejsiDeckTemplate(index + TEHDEJSI_MIN_SLIDES)
  );
  return cache;
}

export interface TehdejsiPhotoIssue {
  rule: string;
  detail: string;
}

/**
 * A photograph renders with its attribution or it does not render.
 *
 * The contract already refuses a media record whose licence needs an attribution string and does
 * not carry one. This is the other half of the same rule, at the boundary where it can actually
 * be broken: a record can be perfect and the payload can still reach the renderer with the
 * attribution slot empty, and what ships then is a licensed photograph credited to nobody.
 *
 * The check is deliberately two-sided. An attribution with no photograph is also refused — not
 * because it is unsafe, but because it means a slide is claiming a source for a picture it does
 * not have, and a credit under an empty frame is its own kind of false statement.
 */
export function tehdejsiPhotoIssues(input: {
  /** The payload's strings, as they will reach the renderer. */
  strings: Readonly<Record<string, string>>;
  /** True when a photograph is bound to the image slot. */
  hasPhoto: boolean;
  /** The licence the photograph ships under, or null for the venture's own render. */
  licence?: string | null;
}): TehdejsiPhotoIssue[] {
  const attribution = (input.strings[TEHDEJSI_ATTRIBUTION_SLOT] ?? "").trim();
  const issues: TehdejsiPhotoIssue[] = [];
  if (input.hasPhoto && input.licence !== "own-render" && attribution.length === 0) {
    issues.push({
      rule: "photo:missing-attribution",
      detail: "A licensed photograph renders only with its attribution string on the card."
    });
  }
  if (!input.hasPhoto && attribution.length > 0 && input.licence != null) {
    issues.push({
      rule: "photo:attribution-without-photo",
      detail: "The slide credits a photograph it does not carry."
    });
  }
  return issues;
}

/** Whether a payload may be rendered as a photo slide. */
export function tehdejsiPhotoAllowed(issues: readonly TehdejsiPhotoIssue[]): boolean {
  return issues.length === 0;
}
