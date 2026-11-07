import type { CarouselLayerInput, CarouselTemplate } from "../schema.js";
import { DNESKAI_GAPS, DNESKAI_PANEL, type DneskaiFlow, type DneskaiGapName, type DneskaiLayoutMetrics } from "../dneskai-layout.js";
import { defineDneskaiKit, type DneskaiKitTemplate } from "./kit.js";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./contract.js";
import { box, text, logo, kicker, body, template, FLOWED, LEFT, MEASURE } from "./compose.js";

/**
 * Ticker: the minimal news kit, for one fact, fast news and low-resolution or missing pictures.
 *
 * Direction. A wire screen, not a magazine page. The Rundown's two-slide product notes, TLDR's
 * fixed four-item template and metaglasses' terse fragments are the references: one fact per
 * slide, the same furniture on every slide, nothing that has to be read twice. It is the quietest
 * of the five kits and the densest: smaller headlines than editorial, more words per square inch,
 * and no picture larger than a framed inset.
 *
 * Grid. The 936 px measure is cut into six columns of 136 px with 24 px gutters, so an inset is
 * two or three columns wide (296 or 456 px) and the split's words take the left three. Every slide
 * carries the same frame: the logotype in the top row, a hairline under it at 148 px with a short
 * blueprint-blue tick at its left end, and at the foot a 6 px blueprint-blue floor rule across the
 * measure at 1 272 px, 72 px above the edge, the line a news screen's crawl runs on. The fact
 * stands on that floor: the optical share is 1, so every flowed group ends on the same line 40 px
 * above it and the height it does not use is left open under the top rule. Gaps are whole 8 px
 * units, measured ink to ink.
 *
 * Owner decision, 22 October 2026: no slide carries a page count or a picture credit, and the
 * first slide of a post shows its headline alone. The blue band at the foot carried the credit, so
 * it narrows to the floor rule: the same blue in the same place, with nothing in it to read.
 *
 * Type. Inter for the headline (700) and the copy (400), JetBrains Mono for every label: the
 * split's kicker uppercase and tracked like a wire slug, and the sources. Sizes stay in a narrow
 * band: headlines 34 to 92 px by role, copy 25 to 33, mono labels 18 to 26.
 *
 * Palette. Ink #14161a is the ground of every slide but the accent statement, which stands on
 * blueprint blue; the statement's INK variant and the sources slide stay on ink. White type,
 * #efefec copy, one supporting grey (#8b919b) for labels and #3c4149 hairlines and frames. The
 * dark logotype is approved on ink; on blue the renderer picks the white mono file.
 *
 * Roles. The cover and the single photo put a 456 × 304 inset above the headline, the single
 * type post sets the headline alone at up to 92 px; the figure puts its chart or photograph,
 * contained in the full measure and at most 400 px tall, above its headline and copy. Split and
 * split pair set the wire line and the words in the left columns beside one or two 456 × 304
 * insets. The statement is one sentence and a note on the floor's line, without the floor rule. The sources slide reads top down as a mono list with small
 * thumbnails. Pictures never bleed and never stand behind type, so a 1200 × 630 og:image is
 * drawn smaller than it is and needs no shade.
 *
 * Swipe device: none. Consistency is the device: the same top rule and the same blue floor rule
 * on every slide but the statement.
 */

/** The blue floor rule at the foot: its top, 72 px above the edge with its thickness. */
const FLOOR = 1_272;

const INSET = { width: 456, height: 304 } as const;
const RIGHT_COLUMN = LEFT + MEASURE - INSET.width;
const WORDS = INSET.width - 24;

const rule = (x: number, y: number, width: number, thickness: number, colorToken: string): CarouselLayerInput =>
  ({ type: "rule", ...box(x, y, width, thickness), colorToken, thickness });

/** The head band: a hairline under the logotype row, led by a short blue tick. */
const head = (line = "surface-strong", tick = "accent"): CarouselLayerInput[] => [
  rule(LEFT, 148, MEASURE, 2, line),
  rule(LEFT, 146, 72, 6, tick)
];

/** The floor rule: blueprint blue across the measure, the line the fact stands on. */
const foot = (): CarouselLayerInput[] => [rule(LEFT, FLOOR, MEASURE, 6, "accent")];

/** A picture as a framed inset: a hairline drawn around the picture as it lands. */
function inset(slot: string, x: number, y: number, width: number, height: number, fit: "cover" | "contain"): CarouselLayerInput {
  return { type: "image", slot, optional: false, fit, scrim: "none", treatment: "none", ...box(x, y, width, height), border: { colorToken: "surface-strong", width: 2 } };
}

const wire = (frame: ReturnType<typeof box>, maxChars: number) => ({ ...kicker("foreground", frame, 22, maxChars), tracking: 0.06 });
const headline = (frame: ReturnType<typeof box>, options: Parameters<typeof text>[2]) => text("headline", frame, { fontWeight: 700, ...options });
const copy = (frame: ReturnType<typeof box>, options: Parameters<typeof body>[1]) => body(frame, { colorToken: "surface", fontWeight: 400, ...options });

const coverPhoto = template({
  id: "dneskai-ticker-cover-photo",
  name: "DNESKAi ticker · cover photo",
  description: "The picture as a framed inset and a short white headline on ink standing on the floor rule under it.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    ...head(),
    headline(box(LEFT, 184, MEASURE, 680), { minFontSize: 56, maxFontSize: 84, maxChars: 110, maxLines: 7 }),
    inset("image-1", LEFT, 888, INSET.width, INSET.height, "cover"),
    ...foot()
  ]
});

const figure = template({
  id: "dneskai-ticker-figure",
  name: "DNESKAi ticker · figure",
  description: "One fact as a headline, the chart or photograph framed under it and the explanation below, all from the top line.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    ...head(),
    headline(box(LEFT, 184, MEASURE, 240), { minFontSize: 40, maxFontSize: 52, maxChars: 110, maxLines: 4 }),
    copy(box(LEFT, 920, MEASURE, 290), { minFontSize: 28, maxFontSize: 33, maxChars: 260, maxLines: 7 }),
    inset("image-1", LEFT, 456, MEASURE, 400, "contain"),
    ...foot()
  ]
});

const split = template({
  id: "dneskai-ticker-split",
  name: "DNESKAi ticker · split",
  description: "The wire line and the headline in the left three columns beside a framed inset, the explanation under both.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    ...head(),
    wire(box(LEFT, 184, WORDS, 30), 28),
    headline(box(LEFT, 230, WORDS, 420), { minFontSize: 36, maxFontSize: 48, maxChars: 110, maxLines: 8 }),
    copy(box(LEFT, 700, MEASURE, 500), { minFontSize: 28, maxFontSize: 32, maxChars: 330, maxLines: 10 }),
    inset("image-1", RIGHT_COLUMN, 184, INSET.width, INSET.height, "cover"),
    ...foot()
  ]
});

const splitPair = template({
  id: "dneskai-ticker-split-pair",
  name: "DNESKAi ticker · split, two images",
  description: "The wire line, headline and explanation in the left three columns, two framed insets stacked to the right.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    ...head(),
    wire(box(LEFT, 184, WORDS, 30), 28),
    headline(box(LEFT, 230, WORDS, 300), { minFontSize: 34, maxFontSize: 44, maxChars: 110, maxLines: 6 }),
    copy(box(LEFT, 560, WORDS, 640), { minFontSize: 25, maxFontSize: 29, maxChars: 320, maxLines: 12 }),
    inset("image-1", RIGHT_COLUMN, 184, INSET.width, INSET.height, "cover"),
    inset("image-2", RIGHT_COLUMN, 512, INSET.width, INSET.height, "cover"),
    ...foot()
  ]
});

const statement = template({
  id: "dneskai-ticker-statement",
  name: "DNESKAi ticker · statement",
  description: "One sentence from the top line on blueprint blue, or on ink in the INK variant, with a quieter note under it.",
  backgroundToken: "accent",
  version: FLOWED,
  variants: [{ id: "INK", backgroundToken: "background" }],
  layers: [
    logo,
    ...head("secondary", "foreground"),
    headline(box(LEFT, 184, MEASURE, 760), { colorToken: "foreground", minFontSize: 48, maxFontSize: 72, maxChars: 170, maxLines: 9 }),
    copy(box(LEFT, 980, MEASURE, 210), { minFontSize: 28, maxFontSize: 33, maxChars: 240, maxLines: 7 })
  ]
});

function sources(thumbnails: number): CarouselTemplate {
  const { columns, width, height, gap } = TICKER_METRICS.thumbnails;
  return template({
    id: `dneskai-ticker-sources-${thumbnails}`,
    name: `DNESKAi ticker · sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`,
    description: "The sources as mono wire lines, small copies of every picture the deck used, and how the text was made.",
    backgroundToken: "background",
    version: FLOWED,
    layers: [
      logo,
      ...head(),
      text("title", box(LEFT, 184, MEASURE, 48), { minFontSize: 40, maxFontSize: 40, maxChars: 30, maxLines: 1 }),
      ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) =>
        text(dneskaiSourceSlot(index), box(LEFT, 252 + index * 128, MEASURE, 120), { colorToken: "surface", fontToken: "mono", fontWeight: 400, minFontSize: 22, maxFontSize: 26, maxChars: 190, maxLines: 4 })),
      ...(thumbnails > 0 ? [kicker("muted", box(LEFT, 772, MEASURE, 26), 18, 40, "images-label")] : []),
      ...Array.from({ length: thumbnails }, (_, index) =>
        inset(`image-${index + 1}`, LEFT + (index % columns) * (width + gap), 808 + Math.floor(index / columns) * (height + gap), width, height, "cover")),
      text("disclosure", box(LEFT, 1_124, MEASURE, 90), { colorToken: "muted", fontToken: "mono", fontWeight: 400, minFontSize: 18, maxFontSize: 19, maxChars: 200, maxLines: 4 }),
      ...foot()
    ]
  });
}

const singlePhoto = template({
  id: "dneskai-ticker-single-photo",
  name: "DNESKAi ticker · single, photo",
  description: "A one-image post: the picture as a framed inset and the headline under it, standing on the floor rule.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    ...head(),
    headline(box(LEFT, 184, MEASURE, 680), { minFontSize: 52, maxFontSize: 80, maxChars: 110, maxLines: 7 }),
    inset("image-1", LEFT, 888, INSET.width, INSET.height, "cover"),
    ...foot()
  ]
});

const singleType = template({
  id: "dneskai-ticker-single-type",
  name: "DNESKAi ticker · single, type",
  description: "A one-image post set in type alone: one large headline standing on the floor rule.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    ...head(),
    headline(box(LEFT, 184, MEASURE, 1_048), { minFontSize: 60, maxFontSize: 92, maxChars: 120, maxLines: 10 }),
    ...foot()
  ]
});

/**
 * The editorial gaps with the ticker's tighter rhythm, the area between the top rule and 40 px
 * above the floor rule, and an optical share of one: every centred group stands on the area's floor.
 */
export const TICKER_METRICS: DneskaiLayoutMetrics = {
  unit: 8,
  gaps: { ...DNESKAI_GAPS, labelToText: 3, headlineToPicture: 5, pictureToText: 5, rowToBody: 5, headlineToBody: 5, headlineToNote: 6, titleToSources: 5, sourceToSource: 3, sourcesToColophon: 5 },
  area: { top: 184, bottom: FLOOR - 40 },
  opticalShare: 1,
  thumbnails: { columns: 3, width: 296, height: 198, gap: 24 },
  panel: DNESKAI_PANEL
};

/** A stack standing on the band's floor (the optical share is 1): each item with the gap above it. */
const floor = (...items: Array<[string, DneskaiGapName | number]>): DneskaiFlow =>
  ({ kind: "stack", anchor: "centre", items: items.map(([key, gap]) => ({ key, gap })) });

const SOURCES = Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => sources(count));

const TEMPLATES: DneskaiKitTemplate[] = [
  { role: "cover-photo", template: coverPhoto, flow: floor(["image-1", 0], ["headline", "pictureToText"]) },
  { role: "figure", template: figure, flow: floor(["image-1", 0], ["headline", "pictureToText"], ["body", "headlineToBody"]) },
  { role: "split", template: split, flow: { kind: "split" } },
  { role: "split-pair", template: splitPair, flow: { kind: "split-pair" } },
  { role: "statement", template: statement, flow: floor(["headline", 0], ["body", "headlineToNote"]) },
  ...SOURCES.map((entry, thumbnails) => ({ role: "sources" as const, thumbnails, template: entry, flow: { kind: "sources" } as const })),
  { role: "single-photo", template: singlePhoto, flow: floor(["image-1", 0], ["headline", "pictureToText"]) },
  { role: "single-type", template: singleType, flow: floor(["headline", 0]) }
];

export const TICKER_KIT = defineDneskaiKit({
  id: "ticker",
  label: "Ticker",
  purpose: "Minimal news ticker: one fact per slide on ink, a mono wire line, thin rules and small framed pictures, for fast news and low-resolution or missing pictures.",
  look: "ticker",
  metrics: TICKER_METRICS,
  templates: TEMPLATES
});
