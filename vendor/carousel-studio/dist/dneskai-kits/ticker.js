import { DNESKAI_GAPS, DNESKAI_PANEL } from "../dneskai-layout.js";
import { defineDneskaiKit } from "./kit.js";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./contract.js";
import { box, fill, text, logo, folio, credit, kicker, body, template, FLOWED, LEFT, MEASURE, W, H } from "./compose.js";
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
 * carries the same frame: the logotype and the folio in the top row, a hairline under them at
 * 148 px with a short blueprint-blue tick at its left end, and at the foot a full-width blue band
 * from 1 232 px to the edge with the credit in white mono, like the crawl under a news screen.
 * The fact stands on the band: the optical share is 1, so every flowed group ends on the same
 * line 40 px above the band and the height it does not use is left open under the top rule. Gaps
 * are whole 8 px units, measured ink to ink.
 *
 * Type. Inter for the headline (700) and the copy (400), JetBrains Mono for every label: the
 * kicker uppercase and tracked like a wire slug, the credit, the folio and the sources. Sizes stay
 * in a narrow band: headlines 34 to 80 px by role, copy 25 to 35, mono labels 18 to 26.
 *
 * Palette. Ink #14161a is the ground of every slide but the accent statement, which stands on
 * blueprint blue; the statement's INK variant and the sources slide stay on ink. White type,
 * #efefec copy, one supporting grey (#8b919b) for labels and #3c4149 hairlines and frames. The
 * dark logotype is approved on ink; on blue the renderer picks the white mono file.
 *
 * Roles. The cover and the single photo put a 456 × 304 inset above the wire line and the
 * headline; the figure puts its chart or photograph, contained in the full measure and at most
 * 400 px tall, above its headline and copy. Split and split pair set the words in the left
 * columns beside one or two 456 × 304 insets. The statement is one sentence and a note on the
 * band's line, without the band. The sources slide reads top down as a mono list with small
 * thumbnails. Pictures never bleed and never stand behind type, so a 1200 × 630 og:image is
 * drawn smaller than it is and needs no shade.
 *
 * Swipe device: none. Consistency is the device: the same top rule, the same floor line, and the
 * blue band on every slide but the statement.
 */
/** The top of the ticker band at the foot. */
const BAND = 1_232;
const INSET = { width: 456, height: 304 };
const RIGHT_COLUMN = LEFT + MEASURE - INSET.width;
const WORDS = INSET.width - 24;
const rule = (x, y, width, thickness, colorToken) => ({ type: "rule", ...box(x, y, width, thickness), colorToken, thickness });
/** The head band: a hairline under the logotype row, led by a short blue tick. */
const head = (line = "surface-strong", tick = "accent") => [
    rule(LEFT, 148, MEASURE, 2, line),
    rule(LEFT, 146, 72, 6, tick)
];
/**
 * The ticker band: a full-width blueprint-blue strip at the foot carrying the credit in white
 * mono, the crawl under a news screen. Its floor stays clear of the 61 px bottom safe area.
 */
const foot = () => [fill(box(0, BAND, W, H - BAND), "accent")];
const footCredit = (options = {}) => credit("foreground", box(LEFT, BAND + 28, MEASURE, 28), { minFontSize: 19, maxFontSize: 19, ...options });
/** A picture as a framed inset: a hairline drawn around the picture as it lands. */
function inset(slot, x, y, width, height, fit) {
    return { type: "image", slot, optional: false, fit, scrim: "none", treatment: "none", ...box(x, y, width, height), border: { colorToken: "surface-strong", width: 2 } };
}
const wire = (frame, maxChars) => ({ ...kicker("foreground", frame, 22, maxChars), tracking: 0.06 });
const headline = (frame, options) => text("headline", frame, { fontWeight: 700, ...options });
const copy = (frame, options) => body(frame, { colorToken: "surface", fontWeight: 400, ...options });
const coverPhoto = template({
    id: "dneskai-ticker-cover-photo",
    name: "DNESKAi ticker · cover photo",
    description: "A mono wire line, a short white headline on ink and the picture as a framed inset under it.",
    backgroundToken: "background",
    version: FLOWED,
    layers: [
        logo,
        ...head(),
        headline(box(LEFT, 238, MEASURE, 560), { minFontSize: 56, maxFontSize: 80, maxChars: 110, maxLines: 6 }),
        wire(box(LEFT, 184, MEASURE, 30), 56),
        inset("image-1", LEFT, 836, INSET.width, INSET.height, "cover"),
        ...foot(),
        footCredit()
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
        folio("muted"),
        ...head(),
        headline(box(LEFT, 184, MEASURE, 240), { minFontSize: 40, maxFontSize: 52, maxChars: 110, maxLines: 4 }),
        copy(box(LEFT, 880, MEASURE, 290), { minFontSize: 28, maxFontSize: 33, maxChars: 260, maxLines: 7 }),
        inset("image-1", LEFT, 456, MEASURE, 400, "contain"),
        ...foot(),
        footCredit()
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
        folio("muted"),
        ...head(),
        wire(box(LEFT, 184, WORDS, 30), 28),
        headline(box(LEFT, 230, WORDS, 420), { minFontSize: 36, maxFontSize: 48, maxChars: 110, maxLines: 8 }),
        copy(box(LEFT, 700, MEASURE, 460), { minFontSize: 28, maxFontSize: 32, maxChars: 330, maxLines: 10 }),
        inset("image-1", RIGHT_COLUMN, 184, INSET.width, INSET.height, "cover"),
        ...foot(),
        footCredit()
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
        folio("muted"),
        ...head(),
        wire(box(LEFT, 184, WORDS, 30), 28),
        headline(box(LEFT, 230, WORDS, 300), { minFontSize: 34, maxFontSize: 44, maxChars: 110, maxLines: 6 }),
        copy(box(LEFT, 560, WORDS, 600), { minFontSize: 25, maxFontSize: 29, maxChars: 320, maxLines: 12 }),
        inset("image-1", RIGHT_COLUMN, 184, INSET.width, INSET.height, "cover"),
        inset("image-2", RIGHT_COLUMN, 512, INSET.width, INSET.height, "cover"),
        ...foot(),
        footCredit()
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
        folio("surface"),
        ...head("secondary", "foreground"),
        headline(box(LEFT, 184, MEASURE, 760), { colorToken: "foreground", minFontSize: 48, maxFontSize: 72, maxChars: 170, maxLines: 9 }),
        copy(box(LEFT, 980, MEASURE, 210), { minFontSize: 28, maxFontSize: 33, maxChars: 240, maxLines: 7 })
    ]
});
function sources(thumbnails) {
    const { columns, width, height, gap } = TICKER_METRICS.thumbnails;
    return template({
        id: `dneskai-ticker-sources-${thumbnails}`,
        name: `DNESKAi ticker · sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`,
        description: "The sources as mono wire lines, small copies of every picture the deck used, and how the text was made.",
        backgroundToken: "background",
        version: FLOWED,
        layers: [
            logo,
            folio("muted"),
            ...head(),
            text("title", box(LEFT, 184, MEASURE, 48), { minFontSize: 40, maxFontSize: 40, maxChars: 30, maxLines: 1 }),
            ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) => text(dneskaiSourceSlot(index), box(LEFT, 252 + index * 128, MEASURE, 120), { colorToken: "surface", fontToken: "mono", fontWeight: 400, minFontSize: 22, maxFontSize: 26, maxChars: 190, maxLines: 4 })),
            ...(thumbnails > 0 ? [kicker("muted", box(LEFT, 772, MEASURE, 26), 18, 40, "images-label")] : []),
            ...Array.from({ length: thumbnails }, (_, index) => inset(`image-${index + 1}`, LEFT + (index % columns) * (width + gap), 808 + Math.floor(index / columns) * (height + gap), width, height, "cover")),
            text("disclosure", box(LEFT, 1_124, MEASURE, 90), { colorToken: "muted", fontToken: "mono", fontWeight: 400, minFontSize: 18, maxFontSize: 19, maxChars: 200, maxLines: 4 }),
            ...foot()
        ]
    });
}
const singlePhoto = template({
    id: "dneskai-ticker-single-photo",
    name: "DNESKAi ticker · single, photo",
    description: "A one-image announcement: the wire line, the headline, one line of copy and the picture as a framed inset under them.",
    backgroundToken: "background",
    version: FLOWED,
    layers: [
        logo,
        ...head(),
        headline(box(LEFT, 238, MEASURE, 470), { minFontSize: 52, maxFontSize: 72, maxChars: 110, maxLines: 6 }),
        copy(box(LEFT, 740, MEASURE, 80), { minFontSize: 28, maxFontSize: 31, maxChars: 100, maxLines: 2 }),
        wire(box(LEFT, 184, MEASURE, 30), 44),
        inset("image-1", LEFT, 856, INSET.width, INSET.height, "cover"),
        ...foot(),
        footCredit({ maxChars: 30 })
    ]
});
const singleType = template({
    id: "dneskai-ticker-single-type",
    name: "DNESKAi ticker · single, type",
    description: "A one-image announcement set in type alone: the wire line, a large headline and a paragraph, from the top line.",
    backgroundToken: "background",
    version: FLOWED,
    layers: [
        logo,
        ...head(),
        wire(box(LEFT, 184, MEASURE, 30), 56),
        headline(box(LEFT, 238, MEASURE, 600), { minFontSize: 56, maxFontSize: 76, maxChars: 120, maxLines: 7 }),
        copy(box(LEFT, 870, MEASURE, 300), { minFontSize: 30, maxFontSize: 35, maxChars: 280, maxLines: 7 }),
        ...foot(),
        footCredit()
    ]
});
/**
 * The editorial gaps with the ticker's tighter rhythm, the area between the top rule and the band,
 * and an optical share of one: every centred group stands on the area's floor, above the band.
 */
export const TICKER_METRICS = {
    unit: 8,
    gaps: { ...DNESKAI_GAPS, labelToText: 3, headlineToPicture: 5, pictureToText: 5, rowToBody: 5, headlineToBody: 5, headlineToNote: 6, titleToSources: 5, sourceToSource: 3, sourcesToColophon: 5 },
    area: { top: 184, bottom: 1_192 },
    opticalShare: 1,
    thumbnails: { columns: 3, width: 296, height: 198, gap: 24 },
    panel: DNESKAI_PANEL
};
/** A stack standing on the band's floor (the optical share is 1): each item with the gap above it. */
const floor = (...items) => ({ kind: "stack", anchor: "centre", items: items.map(([key, gap]) => ({ key, gap })) });
const SOURCES = Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => sources(count));
const TEMPLATES = [
    { role: "cover-photo", template: coverPhoto, flow: floor(["image-1", 0], ["kicker", "pictureToText"], ["headline", "labelToText"]) },
    { role: "figure", template: figure, flow: floor(["image-1", 0], ["headline", "pictureToText"], ["body", "headlineToBody"]) },
    { role: "split", template: split, flow: { kind: "split" } },
    { role: "split-pair", template: splitPair, flow: { kind: "split-pair" } },
    { role: "statement", template: statement, flow: floor(["headline", 0], ["body", "headlineToNote"]) },
    ...SOURCES.map((entry, thumbnails) => ({ role: "sources", thumbnails, template: entry, flow: { kind: "sources" } })),
    { role: "single-photo", template: singlePhoto, flow: floor(["image-1", 0], ["kicker", "pictureToText"], ["headline", "labelToText"], ["body", "headlineToBody"]) },
    { role: "single-type", template: singleType, flow: floor(["kicker", 0], ["headline", "labelToText"], ["body", "headlineToNote"]) }
];
export const TICKER_KIT = defineDneskaiKit({
    id: "ticker",
    label: "Ticker",
    purpose: "Minimal news ticker: one fact per slide on ink, a mono wire line, thin rules and small framed pictures, for fast news and low-resolution or missing pictures.",
    look: "ticker",
    metrics: TICKER_METRICS,
    templates: TEMPLATES
});
//# sourceMappingURL=ticker.js.map