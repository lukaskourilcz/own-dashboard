import { DNESKAI_EDITORIAL_METRICS } from "../dneskai-layout.js";
import { defineDneskaiKit } from "./kit.js";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./contract.js";
import { box, text, fill, logo, folio, credit, kicker, body, plated, template, FLOWED, LEFT, RIGHT } from "./compose.js";
/**
 * Magazine: the clipping kit, for a story several outlets reported and a roundup worth comparing.
 *
 * Direction. A flat print page, not a collage. Every inner slide is one white card on a paper
 * ground, with a thick ink bar along its top edge like a masthead, a hairline ink border and a
 * hairline rule over the credit line at its foot. Two more cards lie under it, offset by one step
 * each, so the slide reads as the top clipping of a small pile. Nothing is rotated, taped, torn or
 * shadowed, and no publisher's page is reproduced: the cards are rectangles drawn in code.
 *
 * Type. Headlines in Petrona ExtraBold, a display serif with a calligraphic stress that sets this
 * kit apart from the grotesque of the editorial kit. Body and sources in Literata, a text serif
 * drawn for long reading on screens. Labels, the kicker, the credit and the folio in IBM Plex Mono.
 * Blueprint blue is kept for the kicker and the one rule on the type-only post; everything else is
 * ink on white or paper.
 *
 * Palette. The editorial tokens, unchanged: the #f7f7f5 paper ground, white top cards, #efefec
 * cards under them, ink type and hairlines, the secondary grey for paragraphs and credits. No
 * warmer paper: the logotype's approved files name #f7f7f5, and a warmer tone would drop it to
 * the one-colour fallback on every slide.
 *
 * Pictures. Every photograph is a plate inside a card, the cover's too, so none is held to the
 * full-bleed resolution rule: a 1200 × 630 og:image that the editorial cover refuses sets here.
 *
 * Grid. The 72 px side margins hold. The card stack fits inside them: the top card is 908 px wide
 * and the two cards under it step 14 px each, so a pile that steps sideways spans the 936 px
 * measure exactly and one that steps straight down is centred on it. Text sits 44 px inside the
 * card, on an 820 px measure. The card's top edge is at 156 px, under the logotype row, and its
 * foot at 1258 px. Words and pictures are laid out in the band between the masthead bar and the
 * credit rule (208 to 1164 px), so the card never moves while its contents flow; the flows give
 * the height left over back above and below the group as in the editorial kit.
 *
 * Roles. The cover sets the kicker under a full-measure masthead rule, a large headline standing
 * on a pile of three cards, and the photograph framed as a plate on the top card with its credit
 * under it. A figure is a headline over a framed plate and a paragraph. A split puts the kicker and
 * headline beside the plate and the paragraph under both; a split pair keeps the words in one
 * column and stacks two plates beside them. The statement draws the same pile in white hairlines on
 * the blue or ink ground, the sentence inside the top card. Sources is the pile's index: the
 * sources, the thumbnails of every picture the deck used and the disclosure. The single photo is a
 * plate at the top of the card with the words under it; the single type post is the card alone.
 *
 * Swipe device. The pile under the top card shifts from role to role: down and right on a figure
 * and the single photo, down and left on a split, the statement and the type post, straight down
 * on a split pair and the sources, and the top card moves the other way to keep the pile inside
 * the margins. The cover fans its three cards wider. Swiping through a deck turns over clippings
 * rather than pages. The pile never steps upwards, where it would crowd the logotype row.
 */
const KIT = "magazine";
const id = (role) => `dneskai-${KIT}-${role}`;
const name = (role) => `DNESKAi magazine · ${role}`;
/** The pile: the top card's size, the step between cards and the band the contents flow in. */
const CARD = { width: 908, top: 156, height: 1_102, step: 14, inset: 44, bar: 10 };
const INNER = CARD.width - 2 * CARD.inset;
/** The band between the masthead bar and the credit rule, where the flows lay the words out. */
const AREA = { top: 208, bottom: 1_164 };
const CREDIT_RULE = 1_190;
/** The top card's left edge for a pile that steps this way: the pile always spans 72 to 1008. */
const cardLeft = ([dx]) => LEFT + (1 - dx) * CARD.step;
/** A flat card: one fill, a 2 px hairline, square corners. */
const card = (x, y, width, height, fillToken, strokeToken) => ({ type: "shape", ...box(x, y, width, height), fillToken, strokeToken, strokeWidth: 2, radius: 0 });
/**
 * The two cards under the top one, deepest first, then the top card and its masthead bar. Drawn
 * before anything that sits on the card, so the contrast check sees the card behind the words.
 */
function pile(direction, tones) {
    const left = cardLeft(direction);
    const [dx, dy] = direction;
    const under = (depth) => card(left + dx * depth * CARD.step, CARD.top + dy * depth * CARD.step, CARD.width, CARD.height, tones.under, tones.edge);
    return [under(2), under(1), card(left, CARD.top, CARD.width, CARD.height, tones.top, tones.edge), fill(box(left, CARD.top, CARD.width, CARD.bar), tones.bar)];
}
const paperPile = (direction) => pile(direction, { under: "surface-strong", top: "background", edge: "foreground", bar: "foreground" });
/** The hairline over the credit and the credit itself, at the foot of the top card. */
function foot(left, maxChars = 80) {
    return [
        fill(box(left + CARD.inset, CREDIT_RULE, INNER, 2), "foreground"),
        credit("muted", box(left + CARD.inset, 1_208, INNER, 26), { maxChars, minFontSize: 16 })
    ];
}
const headline = (frame, options) => text("headline", frame, { fontWeight: 800, ...options });
const FIGURE = [1, 1];
const figure = (() => {
    const x = cardLeft(FIGURE) + CARD.inset;
    return template({
        id: id("figure"), name: name("figure"), version: FLOWED, backgroundToken: "surface",
        description: "A clipping: a serif headline under the card's masthead bar, the picture framed as a plate, a paragraph and the credit under a hairline.",
        layers: [
            ...paperPile(FIGURE), logo, folio("muted"),
            headline(box(x, AREA.top, INNER, 300), { minFontSize: 42, maxFontSize: 68, maxChars: 110, maxLines: 5 }),
            ...plated("image-1", x, 470, INNER, 520, { optional: false, fit: "contain" }),
            body(box(x, 1_000, INNER, 164), { minFontSize: 26, maxFontSize: 31, maxChars: 260, maxLines: 6 }),
            ...foot(cardLeft(FIGURE))
        ]
    });
})();
const WORDS = 380;
const SPLIT = [-1, 1];
const split = (() => {
    const x = cardLeft(SPLIT) + CARD.inset, picture = x + WORDS + 40;
    return template({
        id: id("split"), name: name("split"), version: FLOWED, backgroundToken: "surface",
        description: "A clipping in two columns: the kicker and serif headline beside a framed plate, the paragraph under both.",
        layers: [
            ...paperPile(SPLIT), logo, folio("muted"),
            kicker("accent", box(x, AREA.top, WORDS, 28), 19, 28),
            headline(box(x, AREA.top + 40, WORDS, 520), { minFontSize: 36, maxFontSize: 54, maxChars: 110, maxLines: 9 }),
            ...plated("image-1", picture, AREA.top, INNER - WORDS - 40, 560, { optional: false, fit: "contain" }),
            body(box(x, 830, INNER, 334), { minFontSize: 27, maxFontSize: 31, maxChars: 330, maxLines: 10 }),
            ...foot(cardLeft(SPLIT))
        ]
    });
})();
const PAIR_WORDS = 440;
const PAIR = [0, 1];
const splitPair = (() => {
    const x = cardLeft(PAIR) + CARD.inset, picture = x + PAIR_WORDS + 40, width = INNER - PAIR_WORDS - 40;
    return template({
        id: id("split-pair"), name: name("split-pair"), version: FLOWED, backgroundToken: "surface",
        description: "A clipping with one column of words, kicker, serif headline and paragraph, beside two framed plates stacked.",
        layers: [
            ...paperPile(PAIR), logo, folio("muted"),
            kicker("accent", box(x, AREA.top, PAIR_WORDS, 28), 20, 28),
            headline(box(x, AREA.top + 40, PAIR_WORDS, 300), { minFontSize: 34, maxFontSize: 50, maxChars: 110, maxLines: 7 }),
            body(box(x, 560, PAIR_WORDS, 600), { minFontSize: 25, maxFontSize: 29, maxChars: 320, maxLines: 12 }),
            ...plated("image-1", picture, AREA.top, width, 400, { optional: false, fit: "contain" }),
            ...plated("image-2", picture, AREA.top + 424, width, 400, { optional: false, fit: "contain" }),
            ...foot(cardLeft(PAIR))
        ]
    });
})();
const STATEMENT = [-1, 1];
const statement = (() => {
    const x = cardLeft(STATEMENT) + CARD.inset;
    return template({
        id: id("statement"), name: name("statement"), version: FLOWED, backgroundToken: "accent",
        description: "One sentence inside the top card of a pile drawn in white hairlines on the blueprint-blue or ink ground, a quieter serif note under it.",
        // The ink variant turns the accent into ink as well, so the cards stay the colour of the ground.
        variants: [{ id: "INK", backgroundToken: "foreground", accentToken: "foreground" }],
        layers: [
            ...pile(STATEMENT, { under: "accent", top: "accent", edge: "background", bar: "background" }), logo, folio("background"),
            headline(box(x, AREA.top, INNER, 640), { colorToken: "background", minFontSize: 48, maxFontSize: 88, maxChars: 170, maxLines: 9 }),
            body(box(x, 880, INNER, 284), { colorToken: "surface", minFontSize: 28, maxFontSize: 33, maxChars: 240, maxLines: 7 })
        ]
    });
})();
const SOURCES = [0, 1];
const THUMBS = { columns: 2, width: 400, height: 266, gap: 20 };
function sources(thumbnails) {
    const x = cardLeft(SOURCES) + CARD.inset;
    return template({
        id: id(`sources-${thumbnails}`), name: name(`sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`), version: FLOWED, backgroundToken: "surface",
        description: "The pile's index: the sources the slides were written from, small plates of every picture the deck used, and how the text was made.",
        layers: [
            ...paperPile(SOURCES), logo, folio("muted"),
            headline(box(x, AREA.top, INNER, 72), { slot: "title", minFontSize: 44, maxFontSize: 64, maxChars: 30, maxLines: 1 }),
            ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) => body(box(x, 290 + index * 120, INNER, 116), { slot: dneskaiSourceSlot(index), colorToken: "foreground", minFontSize: 24, maxFontSize: 30, maxChars: 190, maxLines: 4 })),
            ...(thumbnails > 0 ? [kicker("muted", box(x, 770, INNER, 26), 18, 40, "images-label")] : []),
            ...Array.from({ length: thumbnails }, (_, index) => 
            // Declared at half size so three rows fit the canvas; the layout draws them at THUMBS.
            plated(`image-${index + 1}`, x + (index % THUMBS.columns) * (THUMBS.width + THUMBS.gap), 806 + Math.floor(index / THUMBS.columns) * (THUMBS.height / 2 + THUMBS.gap), THUMBS.width, THUMBS.height / 2, { optional: false, fit: "cover" })).flat(),
            text("disclosure", box(x, 1_080, INNER, 100), { colorToken: "muted", fontToken: "mono", fontWeight: 400, minFontSize: 19, maxFontSize: 20, maxChars: 200, maxLines: 4 })
        ]
    });
}
const SINGLE_PHOTO = [1, 1];
const singlePhoto = (() => {
    const x = cardLeft(SINGLE_PHOTO) + CARD.inset;
    return template({
        id: id("single-photo"), name: name("single-photo"), version: FLOWED, backgroundToken: "surface",
        description: "A one-image announcement as one clipping: the photograph framed as a plate at the top of the card, the kicker, headline and one serif line under it.",
        layers: [
            ...paperPile(SINGLE_PHOTO), logo,
            ...plated("image-1", x, AREA.top, INNER, 480, { optional: false, fit: "cover" }),
            headline(box(x, 760, INNER, 300), { minFontSize: 40, maxFontSize: 62, maxChars: 110, maxLines: 5 }),
            body(box(x, 1_070, INNER, 94), { minFontSize: 27, maxFontSize: 31, maxChars: 100, maxLines: 3 }),
            kicker("accent", box(x, 720, INNER, 28), 20, 44),
            ...foot(cardLeft(SINGLE_PHOTO), 30)
        ]
    });
})();
const SINGLE_TYPE = [-1, 1];
const singleType = (() => {
    const x = cardLeft(SINGLE_TYPE) + CARD.inset;
    return template({
        id: id("single-type"), name: name("single-type"), version: FLOWED, backgroundToken: "surface",
        description: "A one-image announcement set in type on one clipping: a blue rule and kicker, a large serif headline and a paragraph, standing a little above the card's middle.",
        layers: [
            ...paperPile(SINGLE_TYPE), logo,
            { type: "rule", ...box(x, AREA.top, 80, 6), colorToken: "accent", thickness: 6 },
            kicker("accent", box(x, 236, INNER, 30), 21, 56),
            headline(box(x, 290, INNER, 560), { minFontSize: 52, maxFontSize: 84, maxChars: 120, maxLines: 8 }),
            body(box(x, 870, INNER, 294), { minFontSize: 28, maxFontSize: 33, maxChars: 280, maxLines: 8 }),
            ...foot(cardLeft(SINGLE_TYPE))
        ]
    });
})();
/**
 * The cover: a full-measure masthead rule, the kicker, a large headline standing on a pile of three
 * cards, and the photograph framed as a plate on the top card with its credit under it. Static: the
 * headline is bottom-anchored on the pile, so it stands on the same line whatever its length.
 */
const COVER = { top: 610, width: 896, height: 600, step: 20, pad: 24 };
const coverPhoto = (() => {
    const plateWidth = COVER.width - 2 * COVER.pad, plateHeight = COVER.height - 2 * COVER.pad - 52;
    const under = (depth) => card(LEFT + depth * COVER.step, COVER.top + depth * COVER.step, COVER.width, COVER.height, "surface-strong", "foreground");
    return template({
        id: id("cover-photo"), name: name("cover-photo"), backgroundToken: "surface",
        description: "A masthead rule and kicker, a large serif headline standing on a pile of three cards, the photograph framed as a plate on the top card with its credit under it.",
        layers: [
            logo,
            fill(box(LEFT, 140, RIGHT - LEFT, 8), "foreground"),
            under(2), under(1),
            card(LEFT, COVER.top, COVER.width, COVER.height, "background", "foreground"),
            headline(box(LEFT, 222, RIGHT - LEFT, 356), { minFontSize: 52, maxFontSize: 78, maxChars: 110, maxLines: 6, valign: "bottom" }),
            kicker("accent", box(LEFT, 170, RIGHT - LEFT, 30)),
            ...plated("image-1", LEFT + COVER.pad, COVER.top + COVER.pad, plateWidth, plateHeight, { optional: false, fit: "cover" }),
            credit("muted", box(LEFT + COVER.pad, COVER.top + COVER.height - 50, plateWidth, 26), { minFontSize: 16 })
        ]
    });
})();
/** The kit's spacing: the editorial gaps, the band inside the card, thumbnails sized to its measure. */
/** No pinned cap offset: Petrona's caps are 0.64 em, so each face's own cap height is read. */
export const MAGAZINE_METRICS = {
    unit: DNESKAI_EDITORIAL_METRICS.unit,
    gaps: DNESKAI_EDITORIAL_METRICS.gaps,
    area: AREA,
    opticalShare: DNESKAI_EDITORIAL_METRICS.opticalShare,
    thumbnails: THUMBS,
    panel: DNESKAI_EDITORIAL_METRICS.panel
};
const flows = {
    [coverPhoto.id]: { kind: "cover-static" },
    [figure.id]: { kind: "figure" },
    [split.id]: { kind: "split" },
    [splitPair.id]: { kind: "split-pair" },
    [statement.id]: { kind: "statement" },
    [singlePhoto.id]: { kind: "stack", anchor: "top", items: [{ key: "image-1", gap: 0 }, { key: "kicker", gap: "pictureToText" }, { key: "headline", gap: "labelToText" }, { key: "body", gap: "headlineToNote" }] },
    [singleType.id]: { kind: "single-type" },
    // Without thumbnails the index stands at the card's optical centre rather than hanging from its top.
    [id("sources-0")]: { kind: "stack", anchor: "centre", items: [
            { key: "title", gap: 0 },
            ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) => ({ key: dneskaiSourceSlot(index), gap: index === 0 ? "titleToSources" : "sourceToSource" })),
            { key: "disclosure", gap: "sourcesToColophon" }
        ] }
};
const rows = [
    { role: "cover-photo", template: coverPhoto },
    { role: "figure", template: figure },
    { role: "split", template: split },
    { role: "split-pair", template: splitPair },
    { role: "statement", template: statement },
    ...Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => ({ role: "sources", template: sources(count), thumbnails: count })),
    { role: "single-photo", template: singlePhoto },
    { role: "single-type", template: singleType }
];
export const MAGAZINE_KIT = defineDneskaiKit({
    id: "magazine",
    label: "Magazine",
    purpose: "Clippings: one card per slide on a paper ground, for a story several outlets reported or a roundup worth comparing.",
    look: "magazine",
    metrics: MAGAZINE_METRICS,
    templates: rows.map((row) => ({ ...row, flow: flows[row.template.id] ?? { kind: "sources" } }))
});
//# sourceMappingURL=magazine.js.map