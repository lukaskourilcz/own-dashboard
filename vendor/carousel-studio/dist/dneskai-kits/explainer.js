import { DNESKAI_EDITORIAL_METRICS } from "../dneskai-layout.js";
import { defineDneskaiKit } from "./kit.js";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./contract.js";
import { box, text, fill, logo, credit, kicker, body, template, FLOWED, LEFT, MEASURE, RIGHT } from "./compose.js";
/**
 * The explainer kit: research results, rules, "how it works", a number or a study.
 *
 * Direction. A post reads as a short document, after Our World in Data's insight cards, TLDR's
 * fixed furniture, @dokontextu and Growth.design's numbered beats. The cover states the finding.
 * Every inner slide is one labelled section: a mono label line, the headline as the section's
 * claim, the body as its explanation, the source in mono at the foot. It is calm on purpose: no
 * picture runs to the edge, and colour is spent on labels, rules and one statement ground.
 *
 * Grid. The 72 px margins and 936 px measure every kit shares. Every slide carries the same
 * header: the logotype top left, the folio top right in blueprint blue, and a 2 px blue rule
 * across the measure at y 136 that closes the header band. The content area runs from 176 to
 * 1166. Slides with a source line close on a pale blue foot rule at 1194 with the mono source
 * line under it at 1212. Everything that labels something (kicker, folio, image label, source
 * line) stands on the same left edge in the same mono face.
 *
 * Type. IBM Plex Sans 700 for the finding and each claim, IBM Plex Sans 400 for explanations and
 * the sources list, IBM Plex Mono 400 for labels, the folio and source lines. One superfamily
 * reads as one document voice and sets apart from editorial's Space Grotesk over Source Serif.
 * Scale: cover 52-80, single type 56-92, statement 52-84, section claims 34-56, explanations
 * 24-36, labels 20-22, source lines 18.
 *
 * Palette. Paper (#f7f7f5) grounds, white (#ffffff) figure plates, ink type, muted explanations,
 * blueprint blue for labels, the folio, the header rule and the statement ground; the INK variant
 * puts the statement on ink. One supporting colour, a pale blueprint tint (#d6def7), draws only
 * the plate edges and the foot rule, so a figure sits in drafting lines and never in grey.
 *
 * Roles.
 * - Cover photo: the label line under the header rule ("Výzkum · 6 slidů"), the finding as a
 *   large headline, then the photograph as a framed inset on a white plate that takes the height
 *   left over, the credit at the foot. Never full bleed, so a small source image still works.
 * - Figure: the claim at the top of the content area, one chart or picture contained on a white
 *   plate in the height under it, a short explanation under the plate, the source line at the foot.
 * - Split: the label and claim in the left column beside a framed inset, the explanation across
 *   the measure under both. Split pair: label, claim and explanation in the left column, two
 *   framed insets stacked on the right.
 * - Statement: one claim on blueprint blue (INK: on ink) standing on a white rule below the
 *   middle of the slide, its note under the rule, like a key finding set off in a report.
 * - Sources: the shared colophon under the same header, thumbnails framed in the pale rule.
 * - Single photo: the cover's composition with one explanatory line under the plate.
 * - Single type: label, a display headline and a paragraph stacked from the top of the area.
 *
 * Swipe device. The header never moves: logotype, numbered folio and the blue rule sit in the
 * same place on every slide, and each section opens on its mono label at the same height, so a
 * swipe reads as turning to the next numbered section of one document.
 *
 * Flows. The figure flow with a plate (`dneskai-layout.ts`, additive: `plate` and `top` on the
 * `figure` kind) draws cover, figure and single photo; split, split pair and sources reuse the
 * editorial flows with this kit's metrics; the statement is drawn as declared; single type is a
 * top-anchored stack. The metrics set no cap offset, so the cap line comes from Plex's own cap
 * height (0.698 em). The optical share is zero: every flowed group starts at the top of the
 * content area, as a document section does, and the leftover height falls to the foot.
 */
/** The header rule and the content band every slide shares. */
const HEADER_RULE_Y = 136;
const AREA_TOP = 176;
const AREA_BOTTOM = 1_166;
/** The foot rule above the source line, and the source line itself. */
const FOOT_RULE_Y = 1_194;
const SOURCE_LINE_Y = 1_212;
/** White plate padding around a figure. */
const PLATE = 24;
const headerRule = (colorToken) => fill(box(LEFT, HEADER_RULE_Y, MEASURE, 2), colorToken);
const footRule = fill(box(LEFT, FOOT_RULE_Y, MEASURE, 2), "surface-strong");
const sourceLine = (maxChars = 80) => credit("muted", box(LEFT, SOURCE_LINE_Y, MEASURE, 26), { maxChars });
/** The section label: mono, uppercase, tracked, in blueprint blue. */
const label = (y, width, size, maxChars, slot = "kicker") => kicker("accent", box(LEFT, y, width, size + 8), size, maxChars, slot);
/** The section number, "02 / 07", top right in the header band: the editorial folio set a size up, in blue. */
const sectionNumber = (colorToken) => text("folio", box(RIGHT - 228, 74, 228, 30), { colorToken, fontToken: "mono", fontWeight: 400, minFontSize: 22, maxFontSize: 22, maxChars: 9, maxLines: 1, align: "end", tracking: 0.04 });
/** The header furniture of an inner slide. */
const header = (colorToken = "accent") => [logo, sectionNumber(colorToken), headerRule(colorToken)];
/**
 * A white plate with a pale blue edge, and the picture contained or covering inside it. The
 * figure flow moves the plate with the picture, so the plate always hugs what is drawn.
 */
function plate(y, height, fit) {
    return [
        { type: "shape", ...box(LEFT, y, MEASURE, height), fillToken: "background", strokeToken: "surface-strong", strokeWidth: 2, radius: 0 },
        { type: "image", slot: "image-1", optional: false, fit, scrim: "none", treatment: "none", ...box(LEFT + PLATE, y + PLATE, MEASURE - 2 * PLATE, height - 2 * PLATE) }
    ];
}
/**
 * A framed inset beside the words: a 12 px white mat drawn round the picture as drawn, the split
 * columns' version of the figure plate. Thumbnails take the pale blue hairline instead.
 */
function inset(slot, x, y, width, height, fit, mat = true) {
    return { type: "image", slot, optional: false, fit, scrim: "none", treatment: "none", ...box(x, y, width, height), border: mat ? { colorToken: "background", width: 12 } : { colorToken: "surface-strong", width: 2 } };
}
const id = (role) => `dneskai-explainer-${role}`;
const name = (role) => `DNESKAi explainer · ${role}`;
const coverPhoto = template({
    id: id("cover-photo"),
    name: name("cover photo"),
    description: "The finding as a large headline under a mono label line, the photograph as a framed inset on a white plate below it, the credit at the foot.",
    backgroundToken: "surface",
    version: FLOWED,
    layers: [
        logo,
        headerRule("accent"),
        text("headline", box(LEFT, 228, MEASURE, 450), { minFontSize: 52, maxFontSize: 80, maxChars: 110, maxLines: 5 }),
        label(AREA_TOP, MEASURE, 22, 56),
        ...plate(712, 454, "cover"),
        footRule,
        sourceLine()
    ]
});
const figure = template({
    id: id("figure"),
    name: name("figure"),
    description: "The section's claim at the top, one chart or picture contained on a white plate under it, a short explanation and the mono source line at the foot.",
    backgroundToken: "surface",
    version: FLOWED,
    layers: [
        ...header(),
        text("headline", box(LEFT, AREA_TOP, MEASURE, 200), { minFontSize: 40, maxFontSize: 56, maxChars: 110, maxLines: 3 }),
        ...plate(400, 600, "contain"),
        body(box(LEFT, 1_016, MEASURE, 150), { minFontSize: 26, maxFontSize: 30, maxChars: 260, maxLines: 5 }),
        footRule,
        sourceLine()
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
        inset("image-1", 552, 188, 444, 600, "contain"),
        body(box(LEFT, 840, MEASURE, 326), { minFontSize: 26, maxFontSize: 32, maxChars: 330, maxLines: 9 }),
        footRule,
        sourceLine()
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
        body(box(LEFT, 576, 428, 590), { minFontSize: 24, maxFontSize: 28, maxChars: 320, maxLines: 12 }),
        inset("image-1", 552, 188, 444, 360, "contain"),
        inset("image-2", 552, 584, 444, 360, "contain"),
        footRule,
        sourceLine()
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
        text("headline", box(LEFT, AREA_TOP, MEASURE, 672), { colorToken: "background", minFontSize: 52, maxFontSize: 88, maxChars: 170, maxLines: 10, valign: "bottom" }),
        body(box(LEFT, 924, MEASURE, 242), { colorToken: "surface", minFontSize: 28, maxFontSize: 34, maxChars: 240, maxLines: 6 }),
        fill(box(LEFT, 888, MEASURE, 2), "background")
    ]
});
const SOURCE_TOP = 256;
const SOURCE_ROW = 92;
const THUMB_TOP = 676;
function sources(thumbnails, metrics) {
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
            ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) => body(box(LEFT, SOURCE_TOP + index * SOURCE_ROW, MEASURE, 86), { slot: dneskaiSourceSlot(index), colorToken: "foreground", minFontSize: 24, maxFontSize: 26, maxChars: 190, maxLines: 3 })),
            ...(thumbnails > 0 ? [label(THUMB_TOP - 40, MEASURE, 18, 40, "images-label")] : []),
            ...Array.from({ length: thumbnails }, (_, index) => inset(`image-${index + 1}`, LEFT + (index % columns) * (width + gap), THUMB_TOP + Math.floor(index / columns) * (height + gap), width, height, "cover", false)),
            text("disclosure", box(LEFT, 1_076, MEASURE, 90), { colorToken: "muted", fontToken: "mono", fontWeight: 400, minFontSize: 19, maxFontSize: 20, maxChars: 200, maxLines: 4 })
        ]
    });
}
const singlePhoto = template({
    id: id("single-photo"),
    name: name("single, photo"),
    description: "A one-image post as a short document: label line, headline, the photograph as a framed inset on a white plate, one explanatory line under it and the credit at the foot.",
    backgroundToken: "surface",
    version: FLOWED,
    layers: [
        logo,
        headerRule("accent"),
        text("headline", box(LEFT, 228, MEASURE, 410), { minFontSize: 48, maxFontSize: 72, maxChars: 110, maxLines: 5 }),
        body(box(LEFT, 1_084, MEASURE, 82), { minFontSize: 28, maxFontSize: 32, maxChars: 100, maxLines: 2 }),
        label(AREA_TOP, MEASURE, 22, 44),
        ...plate(664, 400, "cover"),
        footRule,
        sourceLine(30)
    ]
});
const singleType = template({
    id: id("single-type"),
    name: name("single, type"),
    description: "A one-image post set in type alone: the label line, a display headline and a paragraph stacked from the top of the content area, the source line at the foot.",
    backgroundToken: "surface",
    version: FLOWED,
    layers: [
        logo,
        headerRule("accent"),
        label(AREA_TOP, MEASURE, 22, 56),
        text("headline", box(LEFT, 228, MEASURE, 620), { minFontSize: 56, maxFontSize: 92, maxChars: 120, maxLines: 7 }),
        body(box(LEFT, 880, MEASURE, 286), { minFontSize: 30, maxFontSize: 36, maxChars: 280, maxLines: 7 }),
        footRule,
        sourceLine()
    ]
});
/** The editorial gaps and grid, with this kit's band, a wider gap between matted pictures, no optical lift and the faces' own cap heights. */
export const EXPLAINER_METRICS = {
    unit: DNESKAI_EDITORIAL_METRICS.unit,
    // Two stacked insets each carry a 12 px mat, so the gap between pictures doubles to keep 24 px of paper between the mats.
    gaps: { ...DNESKAI_EDITORIAL_METRICS.gaps, pictureToPicture: 6 },
    area: { top: AREA_TOP, bottom: AREA_BOTTOM },
    opticalShare: 0,
    thumbnails: DNESKAI_EDITORIAL_METRICS.thumbnails,
    panel: DNESKAI_EDITORIAL_METRICS.panel
};
/** The label line sits at the top of the area; the headline under it starts here. */
const UNDER_LABEL = 228;
const FLOWS = {
    cover: { kind: "figure", plate: PLATE, top: UNDER_LABEL },
    figure: { kind: "figure", plate: PLATE },
    singleType: { kind: "stack", anchor: "top", items: [{ key: "kicker", gap: 0 }, { key: "headline", gap: "labelToText" }, { key: "body", gap: "headlineToNote" }] }
};
export const EXPLAINER_TEMPLATES = [
    { role: "cover-photo", template: coverPhoto, flow: FLOWS.cover },
    { role: "figure", template: figure, flow: FLOWS.figure },
    { role: "split", template: split, flow: { kind: "split", align: "top" } },
    { role: "split-pair", template: splitPair, flow: { kind: "split-pair", align: "top" } },
    { role: "statement", template: statement, flow: { kind: "cover-static" } },
    ...Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => ({ role: "sources", thumbnails: count, template: sources(count, EXPLAINER_METRICS), flow: { kind: "sources" } })),
    { role: "single-photo", template: singlePhoto, flow: FLOWS.cover },
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
//# sourceMappingURL=explainer.js.map