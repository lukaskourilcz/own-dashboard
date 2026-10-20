import { CarouselTemplateSchema } from "./schema.js";
import { MASTER_CANVAS, MASTER_FORMAT } from "./canvas.js";
/**
 * DNESKAi's photographic slides for Instagram (quorum#603), one single-slide template per type.
 *
 * Single-slide templates for the reason the post decks use them: a carousel here is assembled from
 * whatever the day's story has — one photograph or four, a chart, a quote — so each slide is
 * chosen on its own and the deck is the sequence. The slide's place travels in the render's `deck`
 * position, which the folio reads.
 *
 * Composed for the 4:5 master alone. These are photographic compositions: a cover's headline
 * stands on the floor of a full-bleed picture and the figure plates are sized to the 1080 × 1350
 * frame, so none of them is honest at 1:1 or 9:16 and none claims to be.
 *
 * The kit's rules hold here as everywhere: square corners, no glow, no blur, no ornament, no
 * emoji. Photographs are drawn in colour (treatment `none`); a mono or duotone DNESKAi photograph
 * is refused by the tests. The one gradient is the cover's shade, a single ink at varying opacity
 * drawn only over a photograph, which the flat rule keeps (see `ShadeSchema`).
 *
 * Geometry is written in master pixels and converted once, so a reader can check it against the
 * 1080 × 1350 renders without dividing.
 */
const { width: W, height: H } = MASTER_CANVAS;
/** Margins: 72 px clears the 3:4 profile-grid crop of a 4:5 post (34 px a side) with room left. */
const LEFT = 72;
const MEASURE = 936;
const RIGHT = LEFT + MEASURE;
const box = (x, y, width, height) => ({ x: x / W, y: y / H, width: width / W, height: height / H });
const text = (slot, frame, options) => ({
    type: "text",
    slot,
    ...frame,
    colorToken: "foreground",
    fontToken: "headline",
    fontWeight: 700,
    minFontSize: 28,
    maxFontSize: 48,
    maxChars: 120,
    maxLines: 3,
    ...options
});
const fill = (frame, fillToken) => ({ type: "shape", ...frame, fillToken, strokeWidth: 0, radius: 0 });
/** The DNESKAi logotype, top left, drawn from the kit's outlines at about 34 px high. */
const logo = { type: "logo", ...box(LEFT, 64, 230, 52), colorToken: "foreground", fontToken: "headline" };
/** "02 / 07", top right, in the mono label face. Code writes it from the deck position. */
const folio = (colorToken) => text("folio", box(RIGHT - 228, 76, 228, 26), { colorToken, fontToken: "mono", fontWeight: 400, minFontSize: 20, maxFontSize: 20, maxChars: 9, maxLines: 1, align: "end", tracking: 0.04 });
/** The photograph's source, in the mono label face, at the foot of the slide. */
const credit = (colorToken, frame = box(LEFT, 1_224, MEASURE, 26), options = {}) => text("credit", frame, { colorToken, fontToken: "mono", fontWeight: 400, minFontSize: 18, maxFontSize: 18, maxChars: 80, maxLines: 1, ...options });
/** An uppercase, tracked label in the mono face: a kicker, or the sources slide's image label. */
const kicker = (colorToken, frame, size = 22, maxChars = 56, slot = "kicker") => text(slot, frame, { colorToken, fontToken: "mono", fontWeight: 400, minFontSize: size, maxFontSize: size, maxChars, maxLines: 1, uppercase: true, tracking: 0.08 });
const body = (frame, options) => text("body", frame, { colorToken: "muted", fontToken: "body", fontWeight: 400, ...options });
/**
 * A photograph or figure with a 2 px hairline around the picture as drawn. A contained chart keeps
 * its own shape and its own margins; a covering photograph fills the frame.
 */
function plated(slot, x, y, width, height, options) {
    return [{
            type: "image",
            slot,
            optional: options.optional,
            fit: options.fit,
            scrim: "none",
            treatment: "none",
            ...box(x, y, width, height),
            border: { colorToken: "muted", width: 2 }
        }];
}
/**
 * The cover's shade: a touch of ink behind the logotype, clear through the picture's middle, then
 * deep enough under the headline that white type clears 4.5:1 over a white photograph.
 */
const COVER_SHADE = {
    colorToken: "foreground",
    stops: [
        { at: 0, opacity: 0.5 },
        { at: 0.16, opacity: 0 },
        { at: 0.36, opacity: 0 },
        { at: 0.56, opacity: 0.68 },
        { at: 1, opacity: 0.9 }
    ]
};
const bleed = (slot) => ({
    type: "image",
    slot,
    optional: false,
    fit: "cover",
    scrim: "none",
    treatment: "none",
    ...box(0, 0, W, H),
    shade: COVER_SHADE
});
const DNESKAI_FORMATS = {
    "instagram-square": { width: 1_080, height: 1_080, safeArea: { top: 0.045, right: 0.06, bottom: 0.045, left: 0.06 } },
    [MASTER_FORMAT]: { width: W, height: H, safeArea: { top: 0.045, right: 0.06, bottom: 0.045, left: 0.06 } },
    "instagram-story": { width: 1_080, height: 1_920, safeArea: { top: 0.14, right: 0.07, bottom: 0.16, left: 0.07 } },
    threads: { width: 1_200, height: 1_200, safeArea: { top: 0.07, right: 0.07, bottom: 0.09, left: 0.07 } }
};
function template(input) {
    const slots = [...new Set(input.layers.flatMap((layer) => layer.type === "text" ? [layer.slot] : []))];
    return CarouselTemplateSchema.parse({
        schemaVersion: "carousel-template/2",
        id: input.id,
        name: input.name,
        version: "1.0.0",
        status: "live",
        description: input.description,
        citedObservationRefs: ["quorum#603", "own-dashboard#110"],
        formats: DNESKAI_FORMATS,
        canvas: { master: MASTER_FORMAT, derive: [] },
        requiredSlots: slots,
        slides: [{ id: `slide-${input.id}`, backgroundToken: input.backgroundToken, layers: input.layers, variants: input.variants ?? [] }]
    });
}
const coverPhoto = template({
    id: "dneskai-cover-photo",
    name: "DNESKAi · cover photo",
    description: "A colour photograph to every edge, one headline standing on its floor, a blue rule, then the kicker and the credit.",
    backgroundToken: "foreground",
    layers: [
        bleed("image-1"),
        logo,
        text("headline", box(LEFT, 778, MEASURE, 372), { colorToken: "background", minFontSize: 50, maxFontSize: 84, maxChars: 110, maxLines: 4, valign: "bottom" }),
        { type: "rule", ...box(LEFT, 1_176, 64, 6), colorToken: "accent", thickness: 6 },
        kicker("background", box(LEFT, 1_204, MEASURE, 28)),
        credit("surface-strong", box(LEFT, 1_246, MEASURE, 26))
    ]
});
const figure = template({
    id: "dneskai-figure",
    name: "DNESKAi · figure",
    description: "A headline above a photograph or chart on a white plate, a serif explanation below and the source's credit at the foot.",
    backgroundToken: "surface",
    layers: [
        logo,
        folio("muted"),
        text("headline", box(LEFT, 166, MEASURE, 200), { minFontSize: 40, maxFontSize: 58, maxChars: 110, maxLines: 3 }),
        ...plated("image-1", LEFT, 396, MEASURE, 600, { optional: false, fit: "contain" }),
        body(box(LEFT, 1_030, MEASURE, 172), { minFontSize: 28, maxFontSize: 34, maxChars: 260, maxLines: 5 }),
        credit("muted")
    ]
});
const spine = fill(box(0, 0, 12, H), "accent");
const split = template({
    id: "dneskai-split",
    name: "DNESKAi · split",
    description: "The words in the left column under a blue spine, one framed photograph or figure to the right, the explanation below both.",
    backgroundToken: "background",
    layers: [
        spine,
        logo,
        folio("muted"),
        kicker("accent", box(LEFT, 166, 420, 28), 20, 28),
        text("headline", box(LEFT, 206, 428, 600), { minFontSize: 38, maxFontSize: 52, maxChars: 110, maxLines: 8 }),
        ...plated("image-1", 540, 168, 468, 640, { optional: false, fit: "contain" }),
        body(box(LEFT, 856, MEASURE, 336), { minFontSize: 30, maxFontSize: 36, maxChars: 330, maxLines: 8 }),
        credit("muted")
    ]
});
const splitPair = template({
    id: "dneskai-split-pair",
    name: "DNESKAi · split, two images",
    description: "The words in the left column under a blue spine, two framed photographs or figures stacked to the right.",
    backgroundToken: "background",
    layers: [
        spine,
        logo,
        folio("muted"),
        kicker("accent", box(LEFT, 166, 420, 28), 20, 28),
        text("headline", box(LEFT, 206, 428, 330), { minFontSize: 36, maxFontSize: 48, maxChars: 110, maxLines: 6 }),
        body(box(LEFT, 566, 428, 620), { minFontSize: 27, maxFontSize: 32, maxChars: 320, maxLines: 12 }),
        // Landscape-leaning frames: what sources publish is mostly 3:2, 16:9 and wider.
        ...plated("image-1", 540, 168, 468, 360, { optional: false, fit: "contain" }),
        ...plated("image-2", 540, 556, 468, 360, { optional: false, fit: "contain" }),
        credit("muted")
    ]
});
const statement = template({
    id: "dneskai-statement",
    name: "DNESKAi · statement",
    description: "One sentence on a solid blueprint-blue or ink ground, with a quieter serif note under it.",
    backgroundToken: "accent",
    variants: [{ id: "INK", backgroundToken: "foreground" }],
    layers: [
        logo,
        folio("background"),
        text("headline", box(LEFT, 236, MEASURE, 620), { colorToken: "background", minFontSize: 52, maxFontSize: 80, maxChars: 170, maxLines: 7, valign: "bottom" }),
        body(box(LEFT, 902, MEASURE, 300), { colorToken: "surface", minFontSize: 30, maxFontSize: 36, maxChars: 240, maxLines: 6 })
    ]
});
/** The most source lines and thumbnails a sources slide carries. */
export const DNESKAI_MAX_SOURCES = 4;
export const DNESKAI_MAX_THUMBNAILS = 6;
/** The slot of the Nth source line, one-based. */
export const dneskaiSourceSlot = (index) => `source-${index + 1}`;
const SOURCE_TOP = 250;
const SOURCE_ROW = 92;
/** The pictures and the disclosure stand at the foot as one colophon; the sources hang from the top. */
const THUMB_TOP = 882;
const THUMB_HEIGHT = 150;
function sources(thumbnails) {
    const gap = 16;
    const width = Math.min(220, Math.floor((MEASURE - gap * Math.max(0, thumbnails - 1)) / Math.max(1, thumbnails)));
    return template({
        id: `dneskai-sources-${thumbnails}`,
        name: `DNESKAi · sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`,
        description: "The sources the slides were written from, small copies of every picture the deck used, and how the text was made.",
        backgroundToken: "surface",
        layers: [
            logo,
            folio("muted"),
            text("title", box(LEFT, 166, MEASURE, 56), { minFontSize: 44, maxFontSize: 44, maxChars: 30, maxLines: 1 }),
            ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) => body(box(LEFT, SOURCE_TOP + index * SOURCE_ROW, MEASURE, 86), { slot: dneskaiSourceSlot(index), minFontSize: 25, maxFontSize: 27, maxChars: 190, maxLines: 3 })),
            ...(thumbnails > 0 ? [kicker("muted", box(LEFT, THUMB_TOP - 40, MEASURE, 26), 18, 40, "images-label")] : []),
            ...Array.from({ length: thumbnails }, (_, index) => plated(`image-${index + 1}`, LEFT + index * (width + gap), THUMB_TOP, width, THUMB_HEIGHT, { optional: false, fit: "cover" })).flat(),
            text("disclosure", box(LEFT, 1_068, MEASURE, 124), { colorToken: "muted", fontToken: "mono", fontWeight: 400, minFontSize: 19, maxFontSize: 20, maxChars: 200, maxLines: 4 })
        ]
    });
}
const singlePhoto = template({
    id: "dneskai-single-photo",
    name: "DNESKAi · single, photo",
    description: "A one-image announcement: a colour photograph to every edge, the headline on a solid blue panel and one serif line under it.",
    backgroundToken: "foreground",
    layers: [
        bleed("image-1"),
        logo,
        { type: "shape", ...box(48, 640, 984, 456), fillToken: "accent", strokeWidth: 0, radius: 0, padText: "headline", padding: 24 / W },
        // 31 px above the panel's floor against 24 px of padding: the cap line and the baseline then
        // sit the same 40 px from the panel's edges, which equal padding around the line box does not.
        text("headline", box(LEFT, 664, MEASURE, 401), { colorToken: "background", minFontSize: 48, maxFontSize: 76, maxChars: 110, maxLines: 5, valign: "bottom" }),
        body(box(LEFT, 1_118, MEASURE, 76), { colorToken: "background", minFontSize: 28, maxFontSize: 32, maxChars: 100, maxLines: 2 }),
        kicker("background", box(LEFT, 1_222, 540, 26), 18, 44),
        credit("surface-strong", box(632, 1_222, RIGHT - 632, 26), { align: "end", maxChars: 30 })
    ]
});
const singleType = template({
    id: "dneskai-single-type",
    name: "DNESKAi · single, type",
    description: "A one-image announcement set in type alone: a blue rule and kicker, one large headline and a serif paragraph at the foot.",
    backgroundToken: "background",
    layers: [
        logo,
        { type: "rule", ...box(LEFT, 172, 96, 8), colorToken: "accent", thickness: 8 },
        kicker("accent", box(LEFT, 204, MEASURE, 30), 22, 56),
        text("headline", box(LEFT, 262, MEASURE, 600), { minFontSize: 60, maxFontSize: 100, maxChars: 120, maxLines: 6 }),
        body(box(LEFT, 892, MEASURE, 300), { minFontSize: 32, maxFontSize: 38, maxChars: 280, maxLines: 6, valign: "bottom" }),
        credit("muted")
    ]
});
const SOURCES = Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => sources(count));
/** Every DNESKAi photo-kit template, by id. */
export const DNESKAI_PHOTO_TEMPLATES = new Map([coverPhoto, figure, split, splitPair, statement, ...SOURCES, singlePhoto, singleType].map((entry) => [entry.id, entry]));
/** The sources template that carries exactly this many thumbnails. */
export function dneskaiSourcesTemplate(thumbnails) {
    const found = SOURCES[thumbnails];
    if (!found)
        throw new Error(`A DNESKAi sources slide carries 0 to ${DNESKAI_MAX_THUMBNAILS} thumbnails, not ${thumbnails}`);
    return found;
}
//# sourceMappingURL=dneskai-photo.js.map