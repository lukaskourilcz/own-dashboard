import type { CarouselLayerInput, CarouselTemplate } from "../schema.js";
import { DNESKAI_EDITORIAL_METRICS, type DneskaiFlow, type DneskaiLayoutMetrics } from "../dneskai-layout.js";
import { defineDneskaiKit, type DneskaiKitTemplate } from "./kit.js";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./contract.js";
import { box, text, fill, logo, kicker, body, template, FLOWED, LEFT, MEASURE } from "./compose.js";

/**
 * The explainer kit: research results, rules, "how it works", a number or a study.
 *
 * Direction. A post reads as a short document, after Our World in Data's insight cards, TLDR's
 * fixed furniture, @dokontextu and Growth.design's beats. The cover states the finding. Every
 * inner slide is one section: the headline as the section's claim, the body as its explanation,
 * and on the split slides a mono label line above the claim. It is calm on purpose: no picture
 * runs to the edge, and colour is spent on labels, rules and one statement ground.
 *
 * Owner decision, 22 October 2026: no slide carries a page count or a picture credit, and the
 * first slide of a post shows its headline alone. So the numbered folio, the cover's label line,
 * the pale foot rule and the mono source line are gone, and the content area runs on to 86 px
 * above the foot.
 *
 * Grid. The 72 px margins and 936 px measure every kit shares. Every slide carries the same
 * header: the logotype top left and a 2 px blue rule across the measure at y 136 that closes the
 * header band. The content area runs from 176 to 1264. The split's label and the sources' image
 * label stand on the same left edge in the same mono face.
 *
 * Type. IBM Plex Sans 700 for the finding and each claim, IBM Plex Sans 400 for explanations and
 * the sources list, IBM Plex Mono 400 for labels. One superfamily reads as one document voice and
 * sets apart from editorial's Space Grotesk over Source Serif. Scale: cover and single photo
 * 52-84, single type 56-120, statement 52-88, section claims 32-56, explanations 24-36, labels
 * 18-20.
 *
 * Palette. Paper (#f7f7f5) grounds, white (#ffffff) figure plates, ink type, muted explanations,
 * blueprint blue for labels, the header rule and the statement ground; the INK variant puts the
 * statement on ink. One supporting colour, a pale blueprint tint (#d6def7), draws only the plate
 * edges and the thumbnails' hairlines, so a figure sits in drafting lines and never in grey.
 *
 * Roles.
 * - Cover photo: the finding as a large headline from the top of the content area, the
 *   photograph as a framed inset on a white plate in the height left under it. Never full bleed,
 *   so a small source image still works.
 * - Figure: the claim at the top of the content area, one chart or picture contained on a white
 *   plate in the height under it, a short explanation under the plate.
 * - Split: the label and claim in the left column beside a framed inset, the explanation across
 *   the measure under both. Split pair: label, claim and explanation in the left column, two
 *   framed insets stacked on the right.
 * - Statement: one claim on blueprint blue (INK: on ink) standing on a white rule below the
 *   middle of the slide, its note under the rule, like a key finding set off in a report.
 * - Sources: the shared colophon under the same header, thumbnails framed in the pale rule.
 * - Single photo: the cover's composition, the one-slide post's headline over its plate.
 * - Single type: one display headline from the top of the content area, set as large as it fits.
 *
 * Swipe device. The header never moves: the logotype and the blue rule sit in the same place on
 * every slide, and every claim starts on the same line under it, so a swipe reads as turning to
 * the next section of one document.
 *
 * Flows. The figure flow with a plate (`dneskai-layout.ts`, additive: `plate` on the `figure`
 * kind) draws cover, figure and single photo; split, split pair and sources reuse the editorial
 * flows with this kit's metrics; the statement is drawn as declared; single type is a
 * top-anchored stack. The metrics set no cap offset, so the cap line comes from Plex's own cap
 * height (0.698 em). The optical share is zero: every flowed group starts at the top of the
 * content area, as a document section does, and the leftover height falls to the foot.
 */

/** The header rule and the content band every slide shares. */
const HEADER_RULE_Y = 136;
const AREA_TOP = 176;
const AREA_BOTTOM = 1_264;
/** White plate padding around a figure. */
const PLATE = 24;

const headerRule = (colorToken: string): CarouselLayerInput => fill(box(LEFT, HEADER_RULE_Y, MEASURE, 2), colorToken);
/** The section label: mono, uppercase, tracked, in blueprint blue. */
const label = (y: number, width: number, size: number, maxChars: number, slot = "kicker"): CarouselLayerInput => kicker("accent", box(LEFT, y, width, size + 8), size, maxChars, slot);
/** The header furniture every slide shares: the logotype and the rule under it. */
const header = (colorToken = "accent"): CarouselLayerInput[] => [logo, headerRule(colorToken)];

/**
 * A white plate with a pale blue edge, and the picture contained or covering inside it. The
 * figure flow moves the plate with the picture, so the plate always hugs what is drawn.
 */
function plate(y: number, height: number, fit: "cover" | "contain"): CarouselLayerInput[] {
  return [
    { type: "shape", ...box(LEFT, y, MEASURE, height), fillToken: "background", strokeToken: "surface-strong", strokeWidth: 2, radius: 0 },
    { type: "image", slot: "image-1", optional: false, fit, scrim: "none", treatment: "none", ...box(LEFT + PLATE, y + PLATE, MEASURE - 2 * PLATE, height - 2 * PLATE) }
  ];
}

/**
 * A framed inset beside the words: a 12 px white mat drawn round the picture as drawn, the split
 * columns' version of the figure plate. Thumbnails take the pale blue hairline instead.
 */
function inset(slot: string, x: number, y: number, width: number, height: number, fit: "cover" | "contain", mat = true): CarouselLayerInput {
  return { type: "image", slot, optional: false, fit, scrim: "none", treatment: "none", ...box(x, y, width, height), border: mat ? { colorToken: "background", width: 12 } : { colorToken: "surface-strong", width: 2 } };
}

const id = (role: string) => `dneskai-explainer-${role}`;
const name = (role: string) => `DNESKAi explainer · ${role}`;

const coverPhoto = template({
  id: id("cover-photo"),
  name: name("cover photo"),
  description: "The finding as a large headline under the header rule, the photograph as a framed inset on a white plate in the height under it.",
  backgroundToken: "surface",
  version: FLOWED,
  layers: [
    ...header(),
    text("headline", box(LEFT, AREA_TOP, MEASURE, 470), { minFontSize: 52, maxFontSize: 84, maxChars: 110, maxLines: 5 }),
    ...plate(686, 578, "cover")
  ]
});

const figure = template({
  id: id("figure"),
  name: name("figure"),
  description: "The section's claim at the top, one chart or picture contained on a white plate under it and a short explanation.",
  backgroundToken: "surface",
  version: FLOWED,
  layers: [
    ...header(),
    text("headline", box(LEFT, AREA_TOP, MEASURE, 200), { minFontSize: 40, maxFontSize: 56, maxChars: 110, maxLines: 3 }),
    ...plate(400, 680, "contain"),
    body(box(LEFT, 1_100, MEASURE, 164), { minFontSize: 26, maxFontSize: 30, maxChars: 260, maxLines: 5 })
  ]
});

const split = template({
  id: id("split"),
  name: name("split"),
  description: "The section label and claim in the left column beside a framed inset, the explanation across the measure under both.",
  backgroundToken: "surface",
  version: FLOWED,
  layers: [
    ...header(),
    label(AREA_TOP, 428, 20, 28),
    text("headline", box(LEFT, 216, 428, 560), { minFontSize: 34, maxFontSize: 48, maxChars: 110, maxLines: 9 }),
    inset("image-1", 552, 188, 444, 640, "contain"),
    body(box(LEFT, 880, MEASURE, 384), { minFontSize: 26, maxFontSize: 32, maxChars: 330, maxLines: 9 })
  ]
});

const splitPair = template({
  id: id("split-pair"),
  name: name("split, two images"),
  description: "The section label, claim and explanation in the left column, two framed insets stacked on the right.",
  backgroundToken: "surface",
  version: FLOWED,
  layers: [
    ...header(),
    label(AREA_TOP, 428, 20, 28),
    text("headline", box(LEFT, 216, 428, 330), { minFontSize: 32, maxFontSize: 44, maxChars: 110, maxLines: 7 }),
    body(box(LEFT, 576, 428, 688), { minFontSize: 24, maxFontSize: 28, maxChars: 320, maxLines: 12 }),
    inset("image-1", 552, 188, 444, 360, "contain"),
    inset("image-2", 552, 584, 444, 360, "contain")
  ]
});

const statement = template({
  id: id("statement"),
  name: name("statement"),
  description: "One claim on blueprint blue (INK: on ink) standing on a white rule, its note under the rule.",
  backgroundToken: "accent",
  version: FLOWED,
  variants: [{ id: "INK", backgroundToken: "foreground" }],
  layers: [
    ...header("background"),
    text("headline", box(LEFT, AREA_TOP, MEASURE, 712), { colorToken: "background", minFontSize: 52, maxFontSize: 88, maxChars: 170, maxLines: 10, valign: "bottom" }),
    body(box(LEFT, 964, MEASURE, 300), { colorToken: "surface", minFontSize: 28, maxFontSize: 34, maxChars: 240, maxLines: 6 }),
    fill(box(LEFT, 928, MEASURE, 2), "background")
  ]
});

const SOURCE_TOP = 256;
const SOURCE_ROW = 92;
const THUMB_TOP = 676;

function sources(thumbnails: number, metrics: DneskaiLayoutMetrics): CarouselTemplate {
  const { columns, width, height, gap } = metrics.thumbnails;
  return template({
    id: id(`sources-${thumbnails}`),
    name: name(`sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`),
    description: "The sources the slides were written from, small framed copies of every picture the deck used, and how the text was made.",
    backgroundToken: "surface",
    version: FLOWED,
    layers: [
      ...header(),
      text("title", box(LEFT, AREA_TOP, MEASURE, 56), { minFontSize: 44, maxFontSize: 44, maxChars: 30, maxLines: 1 }),
      ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) =>
        body(box(LEFT, SOURCE_TOP + index * SOURCE_ROW, MEASURE, 86), { slot: dneskaiSourceSlot(index), colorToken: "foreground", minFontSize: 24, maxFontSize: 26, maxChars: 190, maxLines: 3 })),
      ...(thumbnails > 0 ? [label(THUMB_TOP - 40, MEASURE, 18, 40, "images-label")] : []),
      ...Array.from({ length: thumbnails }, (_, index) =>
        inset(`image-${index + 1}`, LEFT + (index % columns) * (width + gap), THUMB_TOP + Math.floor(index / columns) * (height + gap), width, height, "cover", false)),
      text("disclosure", box(LEFT, 1_076, MEASURE, 90), { colorToken: "muted", fontToken: "mono", fontWeight: 400, minFontSize: 19, maxFontSize: 20, maxChars: 200, maxLines: 4 })
    ]
  });
}

const singlePhoto = template({
  id: id("single-photo"),
  name: name("single, photo"),
  description: "A one-image post as a short document: the headline under the header rule and the photograph as a framed inset on a white plate under it.",
  backgroundToken: "surface",
  version: FLOWED,
  layers: [
    ...header(),
    text("headline", box(LEFT, AREA_TOP, MEASURE, 470), { minFontSize: 52, maxFontSize: 84, maxChars: 110, maxLines: 5 }),
    ...plate(686, 578, "cover")
  ]
});

const singleType = template({
  id: id("single-type"),
  name: name("single, type"),
  description: "A one-image post set in type alone: one display headline from the top of the content area under the header rule.",
  backgroundToken: "surface",
  version: FLOWED,
  layers: [
    ...header(),
    text("headline", box(LEFT, AREA_TOP, MEASURE, AREA_BOTTOM - AREA_TOP), { minFontSize: 56, maxFontSize: 120, maxChars: 120, maxLines: 9 })
  ]
});

/** The editorial gaps and grid, with this kit's band, a wider gap between matted pictures, no optical lift and the faces' own cap heights. */
export const EXPLAINER_METRICS: DneskaiLayoutMetrics = {
  unit: DNESKAI_EDITORIAL_METRICS.unit,
  // Two stacked insets each carry a 12 px mat, so the gap between pictures doubles to keep 24 px of paper between the mats.
  gaps: { ...DNESKAI_EDITORIAL_METRICS.gaps, pictureToPicture: 6 },
  area: { top: AREA_TOP, bottom: AREA_BOTTOM },
  opticalShare: 0,
  thumbnails: DNESKAI_EDITORIAL_METRICS.thumbnails,
  panel: DNESKAI_EDITORIAL_METRICS.panel
};

const FLOWS = {
  figure: { kind: "figure", plate: PLATE },
  singleType: { kind: "stack", anchor: "top", items: [{ key: "headline", gap: 0 }] }
} as const satisfies Record<string, DneskaiFlow>;

export const EXPLAINER_TEMPLATES: readonly DneskaiKitTemplate[] = [
  { role: "cover-photo", template: coverPhoto, flow: FLOWS.figure },
  { role: "figure", template: figure, flow: FLOWS.figure },
  { role: "split", template: split, flow: { kind: "split", align: "top" } },
  { role: "split-pair", template: splitPair, flow: { kind: "split-pair", align: "top" } },
  { role: "statement", template: statement, flow: { kind: "cover-static" } },
  ...Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => ({ role: "sources" as const, thumbnails: count, template: sources(count, EXPLAINER_METRICS), flow: { kind: "sources" as const } })),
  { role: "single-photo", template: singlePhoto, flow: FLOWS.figure },
  { role: "single-type", template: singleType, flow: FLOWS.singleType }
];

export const EXPLAINER_KIT = defineDneskaiKit({
  id: "explainer",
  label: "Explainer",
  purpose: "Research results, rules and how-it-works posts as a short numbered document: the finding on the cover, one labelled section per slide, figures on white plates, the source line at every foot.",
  look: "explainer",
  metrics: EXPLAINER_METRICS,
  templates: EXPLAINER_TEMPLATES
});
