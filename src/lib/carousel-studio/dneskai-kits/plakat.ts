import type { CarouselLayerInput, CarouselTemplate } from "../schema";
import { DNESKAI_GAPS, DNESKAI_PANEL, type DneskaiFlow, type DneskaiGapName, type DneskaiLayoutMetrics } from "../dneskai-layout";
import { defineDneskaiKit, type DneskaiKitTemplate } from "./kit";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./contract";
import { box, text, logo, kicker, body, template, FLOWED, LEFT, MEASURE, W, H } from "./compose";

/**
 * Plakát: the owner's poster kit (8 November 2026), drawn after the mockup he approved.
 *
 * Direction. A colour photograph to the edges under a dark fade, and one tall condensed headline in
 * capitals standing on the floor at the left, with its key words in a lighter blue: the writer
 * marks them `[[like this]]` and only their colour changes, never a box behind them. Nothing sits
 * in the top-right corner: no page number, no label. The logotype is the only mark, top left.
 *
 * Grid. One left column, the full 936 px measure between the 72 px margins. Every flowed group
 * stands on one floor, 100 px above the foot. Headlines stand 1.24 em apart (the engine default is 1.12), so accents clear the line above, and the groups
 * keep whole 8 px gaps, so lines never touch. The cover and the single photo bleed to every edge;
 * the figure and split photographs fill the width and the top 1 296 px, as in Spotlight, which
 * keeps them out of the full-bleed resolution rule.
 *
 * Type. Anton (400, its only weight) in capitals for every headline; Inter 500 for the copy and
 * Inter 700 tracked capitals for the split label; IBM Plex Mono only on the legacy sources slide.
 *
 * Palette (`looks/plakat.json`). Ink #0e0f12 is the ground and the shade; white headlines,
 * #e6e7ea copy, key words #7c95ff. The text-only statement stands on blue #3b5bdb with its key
 * words in ink; its INK variant and the type-only post stand on ink.
 */

/** The line every flowed group's last baseline stands on: 100 px above the foot. */
const FLOOR = 1_250;

/** The figure and split photographs' depth from the top edge; below it the ground is ink. */
const DEPTH = 1_296;

/**
 * The headline's leading: Anton in capitals is tall, and a Czech caron or acute over a capital needs room above it, so
 * lines stand 1.24 em apart instead of the engine's 1.12 (the owner asked for clearly separate lines).
 */
const LEADING = 1.24;

/** A photograph's shade: ink behind the logotype, clear through the middle, deep under the words. */
const BLEED_FADE = {
  colorToken: "background",
  stops: [
    { at: 0, opacity: 0.45 },
    { at: 0.14, opacity: 0 },
    { at: 0.36, opacity: 0 },
    { at: 0.56, opacity: 0.72 },
    { at: 0.78, opacity: 0.9 },
    { at: 1, opacity: 0.95 }
  ]
};

/** The shade over a figure or split photograph: it ends in solid ink, the ground under it. */
const DEPTH_FADE = {
  colorToken: "background",
  stops: [
    { at: 0, opacity: 0.45 },
    { at: 0.1, opacity: 0 },
    { at: 0.34, opacity: 0 },
    { at: 0.515, opacity: 0.74 },
    { at: 0.86, opacity: 0.95 },
    { at: 1, opacity: 1 }
  ]
};

type Frame = ReturnType<typeof box>;

const photo = (slot: string, x: number, width: number, height: number, shade: typeof BLEED_FADE): CarouselLayerInput =>
  ({ type: "image", slot, optional: false, fit: "cover", scrim: "none", treatment: "none", ...box(x, 0, width, height), shade });

/** The poster headline: Anton in capitals, left, its marked words in the light blue. */
const headline = (frame: Frame, options: Parameters<typeof text>[2]): CarouselLayerInput =>
  text("headline", frame, { colorToken: "foreground", fontToken: "headline", fontWeight: 400, align: "start", uppercase: true, emphasisColorToken: "secondary", leading: LEADING, ...options });

const copy = (frame: Frame, options: Parameters<typeof body>[1]): CarouselLayerInput =>
  body(frame, { colorToken: "surface", fontWeight: 500, align: "start", ...options });

/** The split label: Inter 700, tracked capitals. */
const label = (frame: Frame): CarouselLayerInput =>
  text("kicker", frame, { colorToken: "foreground", fontToken: "body", fontWeight: 700, minFontSize: 26, maxFontSize: 26, maxChars: 28, maxLines: 1, uppercase: true, tracking: 0.12, align: "start" });

/**
 * A series post's label and running number above the cover headline ("Slovník AI #3", owner decision, 8 November
 * 2026), in the kit's label face. Only series posts set it. Its frame waits at the foot, below every text the fade
 * or veil is checked against, so a cover without it renders exactly as before; the flow lifts it above the headline.
 */
const seriesLine = (frame: Frame): CarouselLayerInput =>
  text("series", frame, { colorToken: "foreground", fontToken: "body", fontWeight: 700, minFontSize: 24, maxFontSize: 24, maxChars: 48, maxLines: 1, uppercase: true, tracking: 0.08, align: "start" });

const coverPhoto = template({
  id: "dneskai-plakat-cover-photo",
  name: "DNESKAi plakát · cover photo",
  description: "A colour photograph to every edge under a dark fade and one tall headline in capitals on the floor at the left, its key words in light blue.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    photo("image-1", 0, W, H, BLEED_FADE),
    logo,
    headline(box(LEFT, 760, MEASURE, 510), { minFontSize: 64, maxFontSize: 112, maxChars: 110, maxLines: 5 }),
    seriesLine(box(LEFT, H - 140, MEASURE, 40))
  ]
});

const figure = template({
  id: "dneskai-plakat-figure",
  name: "DNESKAi plakát · figure",
  description: "A photograph across the top fading into ink, the headline in capitals and its explanation under it at the left, standing on the floor.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    photo("image-1", 0, W, DEPTH, DEPTH_FADE),
    logo,
    headline(box(LEFT, 668, MEASURE, 300), { minFontSize: 56, maxFontSize: 92, maxChars: 110, maxLines: 4 }),
    copy(box(LEFT, 1_000, MEASURE, 270), { minFontSize: 28, maxFontSize: 34, maxChars: 260, maxLines: 6 })
  ]
});

const splitGroup = (bodyChars: number): CarouselLayerInput[] => [
  label(box(LEFT, 620, MEASURE, 34)),
  headline(box(LEFT, 676, MEASURE, 300), { minFontSize: 56, maxFontSize: 92, maxChars: 110, maxLines: 4 }),
  copy(box(LEFT, 1_000, MEASURE, 270), { minFontSize: 26, maxFontSize: 32, maxChars: bodyChars, maxLines: 7 })
];

const split = template({
  id: "dneskai-plakat-split",
  name: "DNESKAi plakát · split",
  description: "A photograph across the top fading into ink, a tracked label, the headline in capitals and the explanation at the left.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [photo("image-1", 0, W, DEPTH, DEPTH_FADE), logo, ...splitGroup(330)]
});

const splitPair = template({
  id: "dneskai-plakat-split-pair",
  name: "DNESKAi plakát · split, two images",
  description: "Two photographs side by side, edge to edge, fading into ink, with the label, the headline in capitals and the explanation under them at the left.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [photo("image-1", 0, W / 2, DEPTH, DEPTH_FADE), photo("image-2", W / 2, W / 2, DEPTH, DEPTH_FADE), logo, ...splitGroup(320)]
});

const statement = template({
  id: "dneskai-plakat-statement",
  name: "DNESKAi plakát · statement",
  description: "One sentence in tall capitals on blue, its key words in ink, with a quieter note under it; on ink in the INK variant.",
  backgroundToken: "accent",
  version: FLOWED,
  variants: [{ id: "INK", backgroundToken: "background" }],
  layers: [
    logo,
    headline(box(LEFT, 260, MEASURE, 620), { minFontSize: 64, maxFontSize: 104, maxChars: 170, maxLines: 7, emphasisColorToken: "background" }),
    copy(box(LEFT, 920, MEASURE, 330), { colorToken: "foreground", minFontSize: 30, maxFontSize: 36, maxChars: 240, maxLines: 8 })
  ]
});

/** The legacy sources slide, kept so an older deck switched to this kit still renders. */
const PLAKAT_THUMBNAILS = { columns: 3, width: 296, height: 198, gap: 24 } as const;

function sources(thumbnails: number): CarouselTemplate {
  const { columns, width, height, gap } = PLAKAT_THUMBNAILS;
  return template({
    id: `dneskai-plakat-sources-${thumbnails}`,
    name: `DNESKAi plakát · sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`,
    description: "The sources on ink, read top down: the title, the sources, small copies of every picture the deck used, and how the text was made.",
    backgroundToken: "background",
    version: FLOWED,
    layers: [
      logo,
      text("title", box(LEFT, 184, MEASURE, 60), { colorToken: "foreground", fontWeight: 400, uppercase: true, minFontSize: 48, maxFontSize: 48, maxChars: 30, maxLines: 1 }),
      ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) =>
        body(box(LEFT, 264 + index * 116, MEASURE, 110), { slot: dneskaiSourceSlot(index), colorToken: "surface", minFontSize: 24, maxFontSize: 27, maxChars: 190, maxLines: 4 })),
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
  id: "dneskai-plakat-single-photo",
  name: "DNESKAi plakát · single, photo",
  description: "A one-image post drawn like the cover: the photograph to every edge under a dark fade and the headline in capitals on the floor.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    photo("image-1", 0, W, H, BLEED_FADE),
    logo,
    headline(box(LEFT, 760, MEASURE, 510), { minFontSize: 64, maxFontSize: 112, maxChars: 110, maxLines: 5 })
  ]
});

const singleType = template({
  id: "dneskai-plakat-single-type",
  name: "DNESKAi plakát · single, type",
  description: "A one-image post set in type alone: one tall white headline in capitals on ink.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    headline(box(LEFT, 196, MEASURE, 1_054), { minFontSize: 72, maxFontSize: 128, maxChars: 120, maxLines: 9 })
  ]
});

export const PLAKAT_METRICS: DneskaiLayoutMetrics = {
  unit: 8,
  gaps: { ...DNESKAI_GAPS, labelToText: 3, headlineToBody: 4, headlineToNote: 6, titleToSources: 5, sourceToSource: 3, sourcesToColophon: 5 },
  area: { top: 184, bottom: FLOOR },
  opticalShare: 0.42,
  thumbnails: PLAKAT_THUMBNAILS,
  panel: DNESKAI_PANEL
};

type Item = [string, DneskaiGapName | number];
const items = (list: Item[]) => list.map(([key, gap]) => ({ key, gap }));
/** A group standing on the floor under a photograph's fade; the fade's ramp follows the group down. */
const floor = (...list: Item[]): DneskaiFlow => ({ kind: "stack", anchor: "floor", items: items(list), follow: { from: 2, to: 5, under: 3 } });
/** A group centred on a plain ground. */
const centre = (...list: Item[]): DneskaiFlow => ({ kind: "stack", anchor: "centre", items: items(list) });

const SOURCES = Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => sources(count));
const SPLIT: Item[] = [["kicker", 0], ["headline", "labelToText"], ["body", "headlineToBody"]];

const TEMPLATES: DneskaiKitTemplate[] = [
  { role: "cover-photo", template: coverPhoto, flow: floor(["series", 0], ["headline", "headlineToNote"]) },
  { role: "figure", template: figure, flow: floor(["headline", 0], ["body", "headlineToBody"]) },
  { role: "split", template: split, flow: floor(...SPLIT) },
  { role: "split-pair", template: splitPair, flow: floor(...SPLIT) },
  { role: "statement", template: statement, flow: centre(["headline", 0], ["body", "headlineToNote"]) },
  ...SOURCES.map((entry, thumbnails) => ({ role: "sources" as const, thumbnails, template: entry, flow: { kind: "sources" } as const })),
  { role: "single-photo", template: singlePhoto, flow: floor(["headline", 0]) },
  { role: "single-type", template: singleType, flow: centre(["headline", 0]) }
];

export const PLAKAT_KIT = defineDneskaiKit({
  id: "plakat",
  label: "Plakát",
  purpose: "The owner's poster look: colour photographs to the edge under a dark fade, one tall condensed headline in capitals at the foot with its key words in light blue, and blue for the text-only slide.",
  look: "plakat",
  metrics: PLAKAT_METRICS,
  templates: TEMPLATES
});
