import type { CarouselLayerInput, CarouselTemplate } from "../schema.js";
import { DNESKAI_EDITORIAL_METRICS, type DneskaiFlow, type DneskaiLayoutMetrics } from "../dneskai-layout.js";
import { defineDneskaiKit, type DneskaiKitTemplate } from "./kit.js";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./contract.js";
import { box, text, logo, kicker, body, template, FLOWED, LEFT, MEASURE, RIGHT } from "./compose.js";

/**
 * The bold kit: one sentence per slide, set as large as the slide allows.
 *
 * For a day with one strong claim, a new rule, an attributed quote, and few or no pictures. The
 * headline is the slide. It is set in Barlow Condensed 700 in sentence case, white on blueprint
 * blue or ink and ink on white or paper, from 64 to 140 px across the full 936 px measure. A
 * condensed face fits a 110-character sentence into four or five lines at 80 px where Space
 * Grotesk would need six at 60, so the kit gets its scale from the face and not from capitals.
 * The note under a headline is Inter 400 at 26 to 36 px; the split's kicker and the sources' labels
 * keep IBM Plex Mono. The first slide of a post shows its headline and nothing else, and no slide
 * carries a folio or a picture credit (owner decision, 22 October 2026), so the type has the whole
 * slide under the logotype down to 86 px above the foot.
 *
 * Grid: the editorial margins (72 px, a 936 px measure) and the logotype top left. Two-column
 * slides split the measure 440 / 40 / 456. Spacing is the editorial 8 px unit, gap table and band
 * (166 to 1264); the layout reads each face's own cap height, because two of these faces sit
 * differently in their line boxes than the editorial three.
 *
 * Swipe device: the ground changes with the role, never inside a slide. The cover, the statement
 * and the type-only announcement stand on blueprint blue; the split slides and the single photo
 * on ink; the figure on white; the sources on paper. A deck therefore reads blue, white, ink,
 * blue, white, ink, paper as it is swiped, and the INK statement breaks a run of blue.
 *
 * Pictures never carry this kit, but the cover, the split slides and the single photo require one.
 * Each is drawn as a flat plate inside the margins, below or beside the type and never under it,
 * so no shade is needed and the headline keeps its full contrast. A contained chart on white keeps
 * the editorial hairline; a plate on blue or ink has none, since the ground already frames it.
 *
 * Roles:
 * - cover photo (blue): the headline from under the logotype, standing on the plate, the plate
 *   across the lower third down to the band's floor. Drawn as declared.
 * - figure (white): the headline at the top, the picture and its explanation centred under it.
 * - split and split pair (ink): kicker and headline in the left column, the pictures to the right,
 *   the explanation under both (split) or under the headline (pair).
 * - statement (blue, INK variant on ink): the sentence and a quiet note, centred as one block.
 * - sources (paper): the title in the display face, the sources, the thumbnails and the
 *   disclosure as one colophon from the top.
 * - single photo (ink): the plate and the headline under it, centred as a group.
 * - single type (blue): one headline at up to 160 px, centred: the whole post is the sentence.
 */

/** A picture drawn as a flat plate. `border` adds the 2 px hairline a contained chart gets on white. */
function plate(slot: string, x: number, y: number, width: number, height: number, options: { fit: "cover" | "contain"; border?: string }): CarouselLayerInput {
  return {
    type: "image",
    slot,
    optional: false,
    fit: options.fit,
    scrim: "none",
    treatment: "none",
    ...box(x, y, width, height),
    ...(options.border ? { border: { colorToken: options.border, width: 2 } } : {})
  };
}

/** The display headline: Barlow Condensed 700, sentence case. Only the frame and the sizes change. */
const headline = (frame: ReturnType<typeof box>, options: { colorToken: string; minFontSize: number; maxFontSize: number; maxChars: number; maxLines: number; valign?: "top" | "bottom" }): CarouselLayerInput =>
  text("headline", frame, { fontWeight: 700, ...options });

/** The two-column slides: words in 440 px on the left, pictures in 456 px on the right. */
const COLUMN = 440;
const PICTURE_X = LEFT + COLUMN + 40;
const PICTURE_WIDTH = RIGHT - PICTURE_X;

const coverPhoto = template({
  id: "dneskai-bold-cover-photo",
  name: "DNESKAi bold · cover photo",
  description: "One sentence at display size in white on blueprint blue, standing on a photograph drawn as a plate across the lower third.",
  backgroundToken: "accent",
  layers: [
    logo,
    headline(box(LEFT, 166, MEASURE, 640), { colorToken: "background", minFontSize: 60, maxFontSize: 132, maxChars: 110, maxLines: 7, valign: "bottom" }),
    plate("image-1", LEFT, 846, MEASURE, 418, { fit: "cover" })
  ]
});

const figure = template({
  id: "dneskai-bold-figure",
  name: "DNESKAi bold · figure",
  description: "A large headline on white, the picture or chart under it with a hairline and a short explanation.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    headline(box(LEFT, 166, MEASURE, 330), { colorToken: "foreground", minFontSize: 52, maxFontSize: 92, maxChars: 110, maxLines: 5 }),
    plate("image-1", LEFT, 530, MEASURE, 500, { fit: "contain", border: "muted" }),
    // The frame runs 6 px past the band, as the editorial figure's does: an empty note then never
    // reads as words standing on a picture that grew into its place.
    body(box(LEFT, 1_070, MEASURE, 200), { minFontSize: 26, maxFontSize: 32, maxChars: 260, maxLines: 6 })
  ]
});

const split = template({
  id: "dneskai-bold-split",
  name: "DNESKAi bold · split",
  description: "On ink: the kicker and a large headline in the left column, one picture to the right, the explanation under both.",
  backgroundToken: "foreground",
  version: FLOWED,
  layers: [
    logo,
    kicker("surface-strong", box(LEFT, 166, COLUMN, 28), 20, 28),
    headline(box(LEFT, 206, COLUMN, 600), { colorToken: "background", minFontSize: 48, maxFontSize: 88, maxChars: 110, maxLines: 10 }),
    plate("image-1", PICTURE_X, 168, PICTURE_WIDTH, 680, { fit: "contain" }),
    body(box(LEFT, 896, MEASURE, 368), { colorToken: "surface", minFontSize: 28, maxFontSize: 34, maxChars: 330, maxLines: 9 })
  ]
});

const splitPair = template({
  id: "dneskai-bold-split-pair",
  name: "DNESKAi bold · split, two images",
  description: "On ink: the kicker, a large headline and the explanation in the left column, two pictures stacked to the right.",
  backgroundToken: "foreground",
  version: FLOWED,
  layers: [
    logo,
    kicker("surface-strong", box(LEFT, 166, COLUMN, 28), 20, 28),
    headline(box(LEFT, 206, COLUMN, 340), { colorToken: "background", minFontSize: 40, maxFontSize: 68, maxChars: 110, maxLines: 7 }),
    body(box(LEFT, 576, COLUMN, 688), { colorToken: "surface", minFontSize: 24, maxFontSize: 30, maxChars: 320, maxLines: 12 }),
    plate("image-1", PICTURE_X, 168, PICTURE_WIDTH, 360, { fit: "contain" }),
    plate("image-2", PICTURE_X, 552, PICTURE_WIDTH, 360, { fit: "contain" })
  ]
});

const statement = template({
  id: "dneskai-bold-statement",
  name: "DNESKAi bold · statement",
  description: "One sentence at display size in white on blueprint blue, or on ink for the INK variant, with a quiet note under it.",
  backgroundToken: "accent",
  version: FLOWED,
  variants: [{ id: "INK", backgroundToken: "foreground" }],
  layers: [
    logo,
    headline(box(LEFT, 170, MEASURE, 740), { colorToken: "background", minFontSize: 60, maxFontSize: 132, maxChars: 170, maxLines: 10 }),
    body(box(LEFT, 950, MEASURE, 246), { colorToken: "surface", minFontSize: 30, maxFontSize: 36, maxChars: 240, maxLines: 6 })
  ]
});

const SOURCE_TOP = 274;
const SOURCE_ROW = 120;
const THUMB_TOP = 810;
/** Declared thumbnail frames only; the layout draws the grid at the metrics' tile size. */
const THUMB_DECLARED = { width: 296, height: 130, gap: 24, columns: 3 };

function sources(thumbnails: number): CarouselTemplate {
  const { columns, width, height, gap } = THUMB_DECLARED;
  return template({
    id: `dneskai-bold-sources-${thumbnails}`,
    name: `DNESKAi bold · sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`,
    description: "On paper: the sources the slides were written from, small copies of every picture the deck used, and how the text was made.",
    backgroundToken: "surface",
    version: FLOWED,
    layers: [
      logo,
      text("title", box(LEFT, 166, MEASURE, 84), { fontWeight: 700, minFontSize: 64, maxFontSize: 72, maxChars: 30, maxLines: 1 }),
      ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) =>
        body(box(LEFT, SOURCE_TOP + index * SOURCE_ROW, MEASURE, 112), { slot: dneskaiSourceSlot(index), colorToken: "foreground", minFontSize: 23, maxFontSize: 30, maxChars: 190, maxLines: 4 })),
      ...(thumbnails > 0 ? [kicker("secondary", box(LEFT, THUMB_TOP - 40, MEASURE, 26), 18, 40, "images-label")] : []),
      ...Array.from({ length: thumbnails }, (_, index) =>
        plate(`image-${index + 1}`, LEFT + (index % columns) * (width + gap), THUMB_TOP + Math.floor(index / columns) * (height + gap), width, height, { fit: "cover" })),
      text("disclosure", box(LEFT, 1_100, MEASURE, 96), { colorToken: "muted", fontToken: "mono", fontWeight: 400, minFontSize: 19, maxFontSize: 20, maxChars: 200, maxLines: 4 })
    ]
  });
}

const singlePhoto = template({
  id: "dneskai-bold-single-photo",
  name: "DNESKAi bold · single, photo",
  description: "A one-image post on ink: the photograph as a plate and a large white headline under it, centred as one group.",
  backgroundToken: "foreground",
  version: FLOWED,
  layers: [
    logo,
    plate("image-1", LEFT, 166, MEASURE, 480, { fit: "cover" }),
    headline(box(LEFT, 686, MEASURE, 578), { colorToken: "background", minFontSize: 56, maxFontSize: 120, maxChars: 110, maxLines: 6 })
  ]
});

const singleType = template({
  id: "dneskai-bold-single-type",
  name: "DNESKAi bold · single, type",
  description: "A one-image post in type alone on blueprint blue: one headline as large as the slide allows, centred.",
  backgroundToken: "accent",
  version: FLOWED,
  layers: [
    logo,
    headline(box(LEFT, 166, MEASURE, 1_098), { colorToken: "background", minFontSize: 64, maxFontSize: 160, maxChars: 120, maxLines: 9 })
  ]
});

/**
 * The editorial table with each face's own cap height (no pinned offset) and a little more air
 * between a display headline and the words under it.
 */
export const BOLD_METRICS: DneskaiLayoutMetrics = {
  unit: DNESKAI_EDITORIAL_METRICS.unit,
  gaps: { ...DNESKAI_EDITORIAL_METRICS.gaps, headlineToBody: 6, headlineToNote: 9, labelToText: 4 },
  area: DNESKAI_EDITORIAL_METRICS.area,
  opticalShare: DNESKAI_EDITORIAL_METRICS.opticalShare,
  thumbnails: DNESKAI_EDITORIAL_METRICS.thumbnails,
  panel: DNESKAI_EDITORIAL_METRICS.panel
};

const STATEMENT: DneskaiFlow = { kind: "stack", anchor: "centre", items: [{ key: "headline", gap: 0 }, { key: "body", gap: "headlineToNote" }] };
const SINGLE_PHOTO: DneskaiFlow = { kind: "stack", anchor: "centre", items: [{ key: "image-1", gap: 0 }, { key: "headline", gap: "headlineToPicture" }] };
const SINGLE_TYPE: DneskaiFlow = { kind: "stack", anchor: "centre", items: [{ key: "headline", gap: 0 }] };

export const BOLD_TEMPLATES: readonly DneskaiKitTemplate[] = [
  { role: "cover-photo", template: coverPhoto, flow: { kind: "cover-static" } },
  { role: "figure", template: figure, flow: { kind: "figure" } },
  { role: "split", template: split, flow: { kind: "split" } },
  { role: "split-pair", template: splitPair, flow: { kind: "split-pair" } },
  { role: "statement", template: statement, flow: STATEMENT },
  ...Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, thumbnails) => ({ role: "sources" as const, thumbnails, template: sources(thumbnails), flow: { kind: "sources" as const } })),
  { role: "single-photo", template: singlePhoto, flow: SINGLE_PHOTO },
  { role: "single-type", template: singleType, flow: SINGLE_TYPE }
];

export const BOLD_KIT = defineDneskaiKit({
  id: "bold",
  label: "Bold",
  purpose: "Big type and one statement per slide, for a day with one strong claim and few pictures.",
  look: "bold",
  metrics: BOLD_METRICS,
  templates: BOLD_TEMPLATES
});

