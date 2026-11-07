import type { CarouselLayerInput, CarouselTemplate } from "../schema.js";
import { DNESKAI_GAPS, DNESKAI_PANEL, type DneskaiFlow, type DneskaiGapName, type DneskaiLayoutMetrics } from "../dneskai-layout.js";
import { defineDneskaiKit, type DneskaiKitTemplate } from "./kit.js";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./contract.js";
import { box, text, logo, kicker, body, template, FLOWED, LEFT, MEASURE, W, H } from "./compose.js";

/**
 * Spotlight: the photo-led viral news kit, for a story with a face in it.
 *
 * Direction. The owner's reference is the celebrity-news carousel: a colour photograph to the
 * edges, the lower part fading into ink, and the words standing white and centred on the fade. The
 * cover sets a second photograph as a circular inset in the top right, ringed in white, the way
 * those accounts put "now" beside "then". The quote slides put two photographs side by side, edge
 * to edge, and set the sentence as a quote under a pair of quotation marks with the speaker under
 * it. The owner asked for this style for this kit only, so it is the one DNESKAi kit that centres
 * its words and draws a circle; the flat rules still hold everywhere else: square corners, no
 * glow, no blur, no ornament, colour photographs, and the only gradient is the shade over a
 * photograph.
 *
 * Grid. One centred column, the full 936 px measure between the 72 px margins. Every flowed group
 * stands on one floor, 100 px above the foot: its last baseline sits there whatever its length,
 * so a short quote leaves the photograph clear and a long one climbs into the fade. The fade
 * follows the words: its ramp is declared for the largest frames and moves down with the group
 * when the words are shorter (`follow` on the stack flow). The cover and the single photo bleed to
 * every edge; the figure and split photographs fill the width and the top 1 296 px, which keeps
 * them out of the full-bleed resolution rule, and their fade ends in the ink ground so the seam
 * does not show. Gaps are whole 8 px units, measured ink to ink.
 *
 * Type. Archivo 800 for every headline and quote, one face per field as the contract requires;
 * Inter 400 for the copy and Inter 700 uppercase for the speaker line; IBM Plex Mono only for the
 * sources slide's disclosure. The quotation marks are Archivo 800 at 160 px, written by the API.
 *
 * Palette. Ink #14161a is the ground and the shade; white type, #efefec copy. The accent statement
 * stands on blueprint blue; its INK variant, the type-only post and the sources slide on ink. The
 * logotype is the approved file on ink and the white mono file on a photograph or on blue.
 *
 * Owner decision, 22 October 2026: no folio, no credit, and the first or only slide of a post
 * carries its headline alone. The cover's second photograph is optional; without it the cover
 * draws no circle.
 *
 * Swipe device: the fade. Every photograph ends in the same ink at the same height, so the words
 * sit in the same place on every slide and the eye has nowhere else to go.
 */

/** The line every flowed group's last baseline stands on: 100 px above the foot. */
const FLOOR = 1_250;

/** The figure and split photographs' depth from the top edge; below it the ground is ink. */
const DEPTH = 1_296;

/** The headline face's case, one for the whole kit: a field keeps one face (`fieldFaces`). */
const UPPERCASE = false;

/** The quotation marks' size, and how far the headline under them is pulled up (see `DneskaiStackItem.pull`). */
const MARK = 160;
const MARK_PULL = 76;

/**
 * The shade over a photograph that bleeds: a touch of ink behind the logotype, clear through the
 * picture's upper half, then deep enough from the headline frame's top that white type clears
 * 4.5:1 over a white photograph (the contrast check reads the weakest point under the words).
 */
const BLEED_FADE = {
  colorToken: "background",
  stops: [
    { at: 0, opacity: 0.5 },
    { at: 0.14, opacity: 0 },
    { at: 0.36, opacity: 0 },
    { at: 0.56, opacity: 0.7 },
    { at: 0.78, opacity: 0.88 },
    { at: 1, opacity: 0.94 }
  ]
};

/** The shade over a figure or split photograph: it ends in solid ink, the ground under it. */
const DEPTH_FADE = {
  colorToken: "background",
  stops: [
    { at: 0, opacity: 0.5 },
    { at: 0.1, opacity: 0 },
    { at: 0.34, opacity: 0 },
    { at: 0.515, opacity: 0.72 },
    { at: 0.86, opacity: 0.94 },
    { at: 1, opacity: 1 }
  ]
};

type Frame = ReturnType<typeof box>;

/** A colour photograph in a rectangle from the top edge, covering it, under its shade. */
const photo = (slot: string, x: number, width: number, height: number, shade: typeof BLEED_FADE): CarouselLayerInput =>
  ({ type: "image", slot, optional: false, fit: "cover", scrim: "none", treatment: "none", ...box(x, 0, width, height), shade });

/** The cover's optional second photograph: a disc in the top right, ringed in white. */
const inset: CarouselLayerInput = {
  type: "image",
  slot: "image-2",
  optional: true,
  fit: "cover",
  scrim: "none",
  treatment: "none",
  clip: "circle",
  ...box(600, 160, 408, 408),
  border: { colorToken: "foreground", width: 6 }
};

const headline = (frame: Frame, options: Parameters<typeof text>[2]): CarouselLayerInput =>
  text("headline", frame, { colorToken: "foreground", fontToken: "headline", fontWeight: 800, align: "middle", uppercase: UPPERCASE, ...options });

/** The pair of quotation marks above a quote; the API writes them. */
const mark = (frame: Frame): CarouselLayerInput =>
  text("quote-mark", frame, { colorToken: "foreground", fontToken: "headline", fontWeight: 800, align: "middle", minFontSize: MARK, maxFontSize: MARK, maxChars: 2, maxLines: 1 });

/** The speaker line under a quote: Inter 700, uppercase, centred. */
const speaker = (frame: Frame): CarouselLayerInput =>
  text("kicker", frame, { colorToken: "foreground", fontToken: "body", fontWeight: 700, minFontSize: 30, maxFontSize: 30, maxChars: 28, maxLines: 1, uppercase: true, tracking: 0.02, align: "middle" });

const copy = (frame: Frame, options: Parameters<typeof body>[1]): CarouselLayerInput =>
  body(frame, { colorToken: "surface", align: "middle", ...options });

const coverPhoto = template({
  id: "dneskai-spotlight-cover-photo",
  name: "DNESKAi spotlight · cover photo",
  description: "A colour photograph to every edge fading into ink, an optional second photograph as a ringed disc top right, and one white headline centred on the fade.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    photo("image-1", 0, W, H, BLEED_FADE),
    inset,
    logo,
    headline(box(LEFT, 772, MEASURE, 490), { minFontSize: 46, maxFontSize: 64, maxChars: 110, maxLines: 6 })
  ]
});

const figure = template({
  id: "dneskai-spotlight-figure",
  name: "DNESKAi spotlight · figure",
  description: "A photograph across the top fading into ink, the headline and its explanation centred on the fade, standing on the floor.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    photo("image-1", 0, W, DEPTH, DEPTH_FADE),
    logo,
    headline(box(LEFT, 668, MEASURE, 290), { minFontSize: 42, maxFontSize: 64, maxChars: 110, maxLines: 5 }),
    copy(box(LEFT, 1_000, MEASURE, 260), { minFontSize: 27, maxFontSize: 30, maxChars: 260, maxLines: 7 })
  ]
});

/** The quote group's declared frames, the largest each may take, stacked on the floor by the flow. */
const quote = (bodyChars: number): CarouselLayerInput[] => [
  mark(box(LEFT, 668, MEASURE, 180)),
  speaker(box(LEFT, 1_088, MEASURE, 34)),
  headline(box(LEFT, 850, MEASURE, 236), { minFontSize: 42, maxFontSize: 96, maxChars: 110, maxLines: 5 }),
  copy(box(LEFT, 1_126, MEASURE, 160), { minFontSize: 25, maxFontSize: 28, maxChars: bodyChars, maxLines: 6 })
];

const split = template({
  id: "dneskai-spotlight-split",
  name: "DNESKAi spotlight · split",
  description: "A photograph across the top fading into ink, a quote under a pair of quotation marks, the speaker in capitals under it and the explanation below.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [photo("image-1", 0, W, DEPTH, DEPTH_FADE), logo, ...quote(330)]
});

const splitPair = template({
  id: "dneskai-spotlight-split-pair",
  name: "DNESKAi spotlight · split, two images",
  description: "Two photographs side by side, each half the width and edge to edge, fading into ink, with the quote, the speaker and the explanation centred under them.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [photo("image-1", 0, W / 2, DEPTH, DEPTH_FADE), photo("image-2", W / 2, W / 2, DEPTH, DEPTH_FADE), logo, ...quote(320)]
});

const statement = template({
  id: "dneskai-spotlight-statement",
  name: "DNESKAi spotlight · statement",
  description: "One sentence set as a quote under a pair of quotation marks, centred on blueprint blue, or on ink in the INK variant, with a quieter note under it.",
  backgroundToken: "accent",
  version: FLOWED,
  variants: [{ id: "INK", backgroundToken: "background" }],
  layers: [
    logo,
    mark(box(LEFT, 256, MEASURE, 180)),
    headline(box(LEFT, 440, MEASURE, 500), { minFontSize: 50, maxFontSize: 104, maxChars: 170, maxLines: 8 }),
    copy(box(LEFT, 960, MEASURE, 290), { minFontSize: 28, maxFontSize: 32, maxChars: 240, maxLines: 8 })
  ]
});

/** The editorial thumbnail grid, framed in hairlines on ink. */
const SPOT_THUMBNAILS = { columns: 3, width: 296, height: 198, gap: 24 } as const;

function sources(thumbnails: number): CarouselTemplate {
  const { columns, width, height, gap } = SPOT_THUMBNAILS;
  return template({
    id: `dneskai-spotlight-sources-${thumbnails}`,
    name: `DNESKAi spotlight · sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`,
    description: "The sources on ink, read top down: the title, the sources, small copies of every picture the deck used, and how the text was made.",
    backgroundToken: "background",
    version: FLOWED,
    layers: [
      logo,
      text("title", box(LEFT, 184, MEASURE, 52), { colorToken: "foreground", fontWeight: 800, minFontSize: 44, maxFontSize: 44, maxChars: 30, maxLines: 1 }),
      ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) =>
        body(box(LEFT, 256 + index * 116, MEASURE, 110), { slot: dneskaiSourceSlot(index), colorToken: "surface", minFontSize: 24, maxFontSize: 27, maxChars: 190, maxLines: 4 })),
      ...(thumbnails > 0 ? [kicker("muted", box(LEFT, 736, MEASURE, 26), 18, 40, "images-label")] : []),
      ...Array.from({ length: thumbnails }, (_, index): CarouselLayerInput => ({
        type: "image", slot: `image-${index + 1}`, optional: false, fit: "cover", scrim: "none", treatment: "none",
        ...box(LEFT + (index % columns) * (width + gap), 776 + Math.floor(index / columns) * (height + gap), width, height),
        border: { colorToken: "surface-strong", width: 2 }
      })),
      text("disclosure", box(LEFT, 1_140, MEASURE, 90), { colorToken: "muted", fontToken: "mono", fontWeight: 400, minFontSize: 18, maxFontSize: 19, maxChars: 200, maxLines: 4 })
    ]
  });
}

const singlePhoto = template({
  id: "dneskai-spotlight-single-photo",
  name: "DNESKAi spotlight · single, photo",
  description: "A one-image post drawn like the cover without its inset: the photograph to every edge fading into ink and the headline centred on the fade.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    photo("image-1", 0, W, H, BLEED_FADE),
    logo,
    headline(box(LEFT, 772, MEASURE, 490), { minFontSize: 46, maxFontSize: 64, maxChars: 110, maxLines: 6 })
  ]
});

const singleType = template({
  id: "dneskai-spotlight-single-type",
  name: "DNESKAi spotlight · single, type",
  description: "A one-image post set in type alone: one heavy white headline centred on ink.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    headline(box(LEFT, 196, MEASURE, 1_054), { minFontSize: 60, maxFontSize: 104, maxChars: 120, maxLines: 10 })
  ]
});

/**
 * The editorial gaps with a tighter quote group, the area from under the logotype row to the
 * floor, and a near-even optical share for the groups centred on a plain ground (the statement
 * and the type-only post). The photograph slides stand on the floor instead (`anchor: "floor"`).
 */
export const SPOTLIGHT_METRICS: DneskaiLayoutMetrics = {
  unit: 8,
  gaps: { ...DNESKAI_GAPS, labelToText: 4, headlineToBody: 4, headlineToNote: 6, titleToSources: 5, sourceToSource: 3, sourcesToColophon: 5 },
  area: { top: 184, bottom: FLOOR },
  opticalShare: 0.45,
  thumbnails: SPOT_THUMBNAILS,
  panel: DNESKAI_PANEL
};

type Item = [string, DneskaiGapName | number, number?];
const items = (list: Item[]) => list.map(([key, gap, pull]) => ({ key, gap, ...(pull ? { pull } : {}) }));
/**
 * A group standing on the floor, under a photograph's fade. The fade's ramp (every stop from the
 * last clear point on, but the one at the foot) follows the group down, so a short headline leaves
 * the picture clear above it and the fade still ends at the foot; the fourth stop, the one the
 * words were checked on, stays above the highest text frame.
 */
const floor = (...list: Item[]): DneskaiFlow => ({ kind: "stack", anchor: "floor", items: items(list), follow: { from: 2, to: 5, under: 3 } });
/** A group centred on a plain ground. */
const centre = (...list: Item[]): DneskaiFlow => ({ kind: "stack", anchor: "centre", items: items(list) });

const QUOTE: Item[] = [["quote-mark", 0], ["headline", 2, MARK_PULL], ["kicker", "labelToText"], ["body", "headlineToBody"]];

const SOURCES = Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => sources(count));

const TEMPLATES: DneskaiKitTemplate[] = [
  { role: "cover-photo", template: coverPhoto, flow: floor(["headline", 0]) },
  { role: "figure", template: figure, flow: floor(["headline", 0], ["body", "headlineToBody"]) },
  { role: "split", template: split, flow: floor(...QUOTE) },
  { role: "split-pair", template: splitPair, flow: floor(...QUOTE) },
  { role: "statement", template: statement, flow: centre(["quote-mark", 0], ["headline", 2, MARK_PULL], ["body", "headlineToNote"]) },
  ...SOURCES.map((entry, thumbnails) => ({ role: "sources" as const, thumbnails, template: entry, flow: { kind: "sources" } as const })),
  { role: "single-photo", template: singlePhoto, flow: floor(["headline", 0]) },
  { role: "single-type", template: singleType, flow: centre(["headline", 0]) }
];

export const SPOTLIGHT_KIT = defineDneskaiKit({
  id: "spotlight",
  label: "Spotlight",
  purpose: "Photo-led viral news: colour photographs to the edge fading into ink, white words centred on the fade, a ringed circular inset on the cover and quotes under a pair of quotation marks.",
  look: "spotlight",
  metrics: SPOTLIGHT_METRICS,
  templates: TEMPLATES
});
