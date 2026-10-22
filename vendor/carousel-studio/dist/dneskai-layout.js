import { MASTER_CANVAS } from "./canvas.js";
import { cropRegion } from "./images.js";
import { CarouselTemplateSchema } from "./schema.js";
/**
 * Where a DNESKAi slide's words and pictures stand, decided from what they measure.
 *
 * The photo kit's templates (`dneskai-photo.ts`) declare the largest frame each element may take,
 * and that is still what the words are fitted in and what the template checks pass on. Drawn at
 * those frames, a two-line headline over a frame sized for three left a band of paper above the
 * picture, a short caption under a contained chart left another, and a sources slide hung its
 * thumbnails at the foot with a hole above them. So each slide is laid out once more before it is
 * drawn: every text frame shrinks to the lines the fitter set, every contained picture to the
 * rectangle it is drawn in, and the elements stack in reading order with the kit's gaps between
 * them. What height is left over is then given back on purpose — around the picture on a figure,
 * above and below the whole group elsewhere — rather than wherever a frame happened to end.
 *
 * Nothing here draws or measures text itself. The heights come from the fitter through
 * `carouselTextFits`, the picture sizes from `cropRegion`, and the result is an ordinary
 * `carousel-template/2` slide that the renderer checks and draws like any other. A shrunk frame
 * never changes how its words are set: the fitter takes the largest size that fits, every larger
 * size already failed in the declared frame, and the shrunk frame is never shorter than the lines
 * it holds, so the same lines come back at the same size.
 *
 * Pure arithmetic on the measured numbers, rounded to whole master pixels, so equal input lays out
 * equal frames and renders equal bytes.
 */
const { width: W, height: H } = MASTER_CANVAS;
/** The kit's spacing unit in master pixels. Every gap the layout keeps is a whole number of them. */
export const DNESKAI_SPACE_UNIT = 8;
/**
 * The gaps between elements, in units, measured from ink to ink: a line of type is measured from
 * its cap line and its last baseline, not from the empty top and bottom of its line box. They are
 * minimums; height left over is added around them, never taken from them.
 */
export const DNESKAI_GAPS = {
    /** A kicker or the sources slide's image label above what it labels. */
    labelToText: 4,
    /** A headline above its picture. */
    headlineToPicture: 5,
    /** A picture above the words that explain it. */
    pictureToText: 4,
    /** A split slide's row of words and picture above the explanation under both. */
    rowToBody: 6,
    /** A headline above its explanation in the same column. */
    headlineToBody: 5,
    /** A statement, or a type-only announcement's display headline, above its quieter note. */
    headlineToNote: 8,
    /** Two stacked pictures, and the rows and columns of the sources slide's thumbnails. */
    pictureToPicture: 3,
    /** The single type slide's blue rule above its kicker. */
    ruleToLabel: 3,
    /** The sources slide's title above its first source. */
    titleToSources: 5,
    /** One source above the next: wider than a line of the same source, so each reads as one. */
    sourceToSource: 3,
    /** The last source above the image label, or above the disclosure when there are no images. */
    sourcesToColophon: 6,
    /** The image label above the thumbnails. */
    labelToPictures: 2,
    /** The thumbnails above the disclosure. */
    picturesToDisclosure: 4
};
/**
 * The sources slide's thumbnails: three to a row across the 936 px measure, 3:2, with the kit's
 * picture gap between them. The layout shrinks them evenly only when four long sources leave the
 * grid less height than two full rows need.
 */
export const DNESKAI_THUMBNAIL_GRID = { columns: 3, width: 296, height: 198, gap: 24 };
/**
 * The band every flowed slide is composed in: under the logotype row, above the credit line.
 * A slide whose words and pictures are shorter than it gives the rest back as described above.
 */
export const DNESKAI_AREA = { top: 166, bottom: 1_196 };
/**
 * The share of the leftover height set above a centred group. Under a half, so the group's centre
 * sits a little above the slide's middle, where a centred block reads as centred rather than low.
 */
export const DNESKAI_OPTICAL_SHARE = 0.42;
/**
 * Where the cap line sits under the top of a line box, in em, for the kit's three faces: Space
 * Grotesk and IBM Plex Mono have caps 0.70 em tall and Source Serif 4 0.67, under a baseline the
 * renderer sets one em below the frame's top.
 */
export const DNESKAI_CAP_OFFSET = 0.3;
/** The single photo's headline panel, as `dneskai-photo.ts` draws it at the foot. */
export const DNESKAI_PANEL = {
    /** The panel's top when the band stands at the top of the slide, under the logotype row. */
    top: 152,
    /** The panel's padding on each side of the hugged lines (the template's `padding`). */
    padding: 24,
    /** How far below the panel's top the headline frame starts: the cap line then sits about 40 px in. */
    inset: 17,
    /** Panel floor to the line under it, and that line's floor to the kicker row, as at the foot. */
    toBody: 22,
    toKicker: 28,
    /** Clearance the focal point keeps from the band before the band moves out of its way. */
    clearance: 48
};
export const DNESKAI_EDITORIAL_METRICS = {
    unit: DNESKAI_SPACE_UNIT, gaps: DNESKAI_GAPS, area: DNESKAI_AREA, opticalShare: DNESKAI_OPTICAL_SHARE,
    thumbnails: DNESKAI_THUMBNAIL_GRID, panel: DNESKAI_PANEL, capOffset: DNESKAI_CAP_OFFSET
};
export const DNESKAI_STACK_PRESETS = {
    statement: { kind: "stack", anchor: "centre", items: [{ key: "headline", gap: 0 }, { key: "body", gap: "headlineToNote" }] },
    singleType: { kind: "stack", anchor: "centre", items: [{ key: "rule", gap: 0 }, { key: "kicker", gap: "ruleToLabel" }, { key: "headline", gap: "labelToText" }, { key: "body", gap: "headlineToNote" }] }
};
const px = { x: (layer) => layer.x * W, y: (layer) => layer.y * H, width: (layer) => layer.width * W, height: (layer) => layer.height * H };
/**
 * The slide laid out for what it holds. The cover photo is returned as declared, and so is the
 * single photo unless its focal point would sit under the headline band.
 */
export function layoutDneskaiSlide(input) {
    switch (input.flow.kind) {
        case "cover-static": return input.template;
        case "figure": return figure(input);
        case "split": return split(input);
        case "split-pair": return splitPair(input);
        case "sources": return sources(input);
        case "single-photo": return singlePhoto(input);
        case "statement": return stacked(input, DNESKAI_STACK_PRESETS.statement);
        case "single-type": return stacked(input, DNESKAI_STACK_PRESETS.singleType);
        case "stack": return stacked(input, input.flow);
    }
}
function layersOf(template) {
    return template.slides[0].layers;
}
function textLayer(template, slot) {
    return layersOf(template).find((layer) => layer.type === "text" && layer.slot === slot);
}
function imageLayer(template, slot) {
    return layersOf(template).find((layer) => layer.type === "image" && layer.slot === slot);
}
/** The block a text slot occupies once its frame is shrunk to its lines, or null when it is empty. */
function textBlock(input, slot) {
    const measured = input.text[slot];
    const layer = textLayer(input.template, slot);
    if (!measured || !layer || measured.lines === 0)
        return null;
    // The renderer's own arithmetic for the height of a set block, in the same order.
    const drawn = measured.lines * measured.fontSize * 1.12;
    const height = Math.min(Math.round(px.height(layer)), Math.ceil(drawn));
    const lastBaseline = measured.fontSize + (measured.lines - 1) * measured.fontSize * 1.12;
    return { height, inkTop: measured.fontSize * (input.metrics.capOffset ?? 1 - (measured.capHeight ?? 0.7)), inkBottom: Math.max(0, height - lastBaseline) };
}
const box = (height) => ({ height, inkTop: 0, inkBottom: 0 });
/**
 * The height a picture is drawn at in a column: a covering photograph fills `cover` (at most
 * `max`); a contained one is the rectangle `cropRegion` resamples it to inside `width` × `max`.
 * A slot with no decoded picture is laid out as the whole frame, which is where the renderer
 * would have drawn it.
 */
function pictureHeight(input, slot, width, max, cover = max) {
    const layer = imageLayer(input.template, slot);
    const picture = input.pictures[slot];
    const ceiling = Math.max(1, Math.floor(max));
    const fit = picture?.crop.fit ?? layer?.fit ?? "cover";
    if (fit === "cover" || !picture)
        return Math.min(ceiling, Math.floor(cover));
    return cropRegion(picture, picture.crop, { width, height: ceiling }, "contain").outHeight;
}
/**
 * Elements one under another, each `gap` units of visual space under the one before it. Empty
 * elements (null) take no room and no gap, so an absent kicker does not leave its line behind.
 */
function stack(metrics, items) {
    const tops = new Map();
    let y = 0;
    let previous = null;
    let first = null;
    for (const { key, block, gap } of items) {
        if (!block)
            continue;
        if (previous)
            y += Math.max(0, gap * metrics.unit - previous.inkBottom - block.inkTop);
        tops.set(key, y);
        y += block.height;
        previous = block;
        first ??= block;
    }
    return { tops, height: y, inkTop: first?.inkTop ?? 0, inkBottom: previous?.inkBottom ?? 0 };
}
/** The top of a group of this height set at the optical centre of the area, never above its top. */
function centredTop(height, metrics) {
    const area = metrics.area;
    return area.top + Math.max(0, area.bottom - area.top - height) * metrics.opticalShare;
}
/** The template with the named layers moved. Text frames that move are top-anchored. */
function moved(template, places, extra = (layer) => layer) {
    const slide = template.slides[0];
    const layers = slide.layers.map((layer) => {
        const place = places.get(layer);
        if (!place)
            return extra(layer);
        const frame = {
            x: place.x === undefined ? layer.x : Math.round(place.x) / W,
            y: Math.round(place.y) / H,
            width: place.width === undefined ? layer.width : Math.round(place.width) / W,
            height: Math.round(place.height) / H
        };
        return extra(layer.type === "text" ? { ...layer, ...frame, valign: "top" } : { ...layer, ...frame });
    });
    return CarouselTemplateSchema.parse({ ...template, slides: [{ ...slide, layers }] });
}
/**
 * Places for the stacked elements of one column, offset to `top`. A key names a text or image
 * slot, or one of `others`; a key that names no layer (the sources slide's thumbnail row) is placed
 * by its caller.
 */
function placeStack(template, stacked, top, heights, places, others = new Map()) {
    for (const [key, offset] of stacked.tops) {
        const layer = textLayer(template, key) ?? imageLayer(template, key) ?? others.get(key);
        const height = heights.get(key);
        if (layer && height !== undefined)
            places.set(layer, { y: top + offset, height });
    }
}
/** Figure: the headline at the top, the picture and its caption centred in the height under it. */
function figure(input) {
    const { template } = input;
    const flow = input.flow.kind === "figure" ? input.flow : { kind: "figure" };
    const pad = flow.plate ?? 0;
    const areaTop = flow.top ?? input.metrics.area.top;
    const headline = textBlock(input, "headline");
    const body = textBlock(input, "body");
    const picture = imageLayer(template, "image-1");
    const above = (headline ? Math.max(0, input.metrics.gaps.headlineToPicture * input.metrics.unit - headline.inkBottom) : 0) + pad;
    const below = (body ? Math.max(0, input.metrics.gaps.pictureToText * input.metrics.unit - body.inkTop) : 0) + pad;
    const room = input.metrics.area.bottom - areaTop - (headline?.height ?? 0) - above - below - (body?.height ?? 0);
    const drawn = pictureHeight(input, "image-1", Math.round(px.width(picture)), room);
    const pictureTop = areaTop + (headline?.height ?? 0) + above + Math.floor((room - drawn) / 2);
    const places = new Map([[picture, { y: pictureTop, height: drawn }]]);
    if (pad) {
        const layers = layersOf(template);
        const plate = layers[layers.indexOf(picture) - 1];
        if (plate?.type !== "shape")
            throw new Error(`Flow plate names no shape before image-1 on ${template.id}`);
        places.set(plate, { y: pictureTop - pad, height: drawn + 2 * pad });
    }
    if (headline)
        places.set(textLayer(template, "headline"), { y: areaTop, height: headline.height });
    if (body)
        places.set(textLayer(template, "body"), { y: pictureTop + drawn + below, height: body.height });
    return moved(template, places);
}
/**
 * A row of two columns, the shorter centred against the taller by its ink. Returns each column's
 * top offset inside the row and the row's height.
 */
function row(left, right, align) {
    const height = Math.max(left.height, right.height);
    if (align === "top")
        return { left: 0, right: 0, height };
    const centre = (column) => column.height === height ? 0 : Math.max(0, (height - column.height) / 2 - (column.inkTop - column.inkBottom) / 2);
    return { left: centre(left), right: centre(right), height };
}
/** Split, one picture: words beside the picture, centred against it, the explanation under both. */
function split(input) {
    const { template } = input;
    const picture = imageLayer(template, "image-1");
    const words = stack(input.metrics, [
        { key: "kicker", block: textBlock(input, "kicker"), gap: 0 },
        { key: "headline", block: textBlock(input, "headline"), gap: input.metrics.gaps.labelToText }
    ]);
    const body = textBlock(input, "body");
    const under = body ? Math.max(0, input.metrics.gaps.rowToBody * input.metrics.unit - body.inkTop) : 0;
    const room = input.metrics.area.bottom - input.metrics.area.top - under - (body?.height ?? 0);
    const declared = Math.round(px.height(picture));
    const drawn = pictureHeight(input, "image-1", Math.round(px.width(picture)), Math.min(room, declared));
    const pictures = stack(input.metrics, [{ key: "image-1", block: box(drawn), gap: 0 }]);
    const laid = row(words, pictures, input.flow.kind === "split" ? input.flow.align : undefined);
    const top = centredTop(laid.height + under + (body?.height ?? 0), input.metrics);
    const places = new Map();
    placeStack(template, words, top + laid.left, heightsOf(input), places);
    places.set(picture, { y: top + laid.right, height: drawn });
    if (body)
        places.set(textLayer(template, "body"), { y: top + laid.height + under, height: body.height });
    return moved(template, places);
}
/** Split, two pictures: the words in the left column, the pictures stacked right, centred together. */
function splitPair(input) {
    const { template } = input;
    const first = imageLayer(template, "image-1");
    const second = imageLayer(template, "image-2");
    const words = stack(input.metrics, [
        { key: "kicker", block: textBlock(input, "kicker"), gap: 0 },
        { key: "headline", block: textBlock(input, "headline"), gap: input.metrics.gaps.labelToText },
        { key: "body", block: textBlock(input, "body"), gap: input.metrics.gaps.headlineToBody }
    ]);
    const gap = input.metrics.gaps.pictureToPicture * input.metrics.unit;
    // Each picture may grow past its declared frame while both still fit the band.
    const each = Math.floor((input.metrics.area.bottom - input.metrics.area.top - gap) / 2);
    const heightOf = (layer) => pictureHeight(input, layer.slot, Math.round(px.width(layer)), each, Math.round(px.height(layer)));
    const drawn = new Map([[first.slot, heightOf(first)], [second.slot, heightOf(second)]]);
    const pictures = stack(input.metrics, [
        { key: first.slot, block: box(drawn.get(first.slot)), gap: 0 },
        { key: second.slot, block: box(drawn.get(second.slot)), gap: input.metrics.gaps.pictureToPicture }
    ]);
    const laid = row(words, pictures, input.flow.kind === "split-pair" ? input.flow.align : undefined);
    const top = centredTop(laid.height, input.metrics);
    const places = new Map();
    placeStack(template, words, top + laid.left, heightsOf(input), places);
    placeStack(template, pictures, top + laid.right, drawn, places);
    return moved(template, places);
}
/** General stack; named statement and single-type flows expand to these same items. */
function stacked(input, flow) {
    const { template } = input, heights = new Map(), others = new Map();
    const items = flow.items.map(item => {
        const text = textLayer(template, item.key), image = imageLayer(template, item.key);
        let block;
        if (text)
            block = textBlock(input, item.key);
        else if (image)
            block = box(pictureHeight(input, item.key, Math.round(px.width(image)), Math.round(px.height(image))));
        else if (item.key === "rule") {
            const rule = layersOf(template).find(layer => layer.type === "rule");
            if (!rule)
                throw new Error(`Flow item ${item.key} names no layer on ${template.id}`);
            block = box(Math.round(px.height(rule)));
            others.set(item.key, rule);
        }
        else
            throw new Error(`Flow item ${item.key} names no layer on ${template.id}`);
        if (block)
            heights.set(item.key, block.height);
        return { key: item.key, block, gap: typeof item.gap === "number" ? item.gap : input.metrics.gaps[item.gap] };
    });
    const group = stack(input.metrics, items), places = new Map();
    placeStack(template, group, flow.anchor === "top" ? input.metrics.area.top : centredTop(group.height, input.metrics), heights, places, others);
    return moved(template, places);
}
/**
 * Sources: the title, the sources, then the thumbnails and the disclosure directly under them,
 * read top down as one colophon from the top of the band.
 */
function sources(input) {
    const { template } = input;
    const thumbnails = layersOf(template).filter((layer) => layer.type === "image");
    const lines = layersOf(template).filter((layer) => layer.type === "text" && layer.slot.startsWith("source-"));
    const { columns, gap } = input.metrics.thumbnails;
    const rows = Math.ceil(thumbnails.length / columns);
    const gridHeight = (tile) => rows * tile + (rows - 1) * gap;
    const colophon = (tile) => stack(input.metrics, [
        { key: "title", block: textBlock(input, "title"), gap: 0 },
        ...lines.map((layer, index) => ({ key: layer.slot, block: textBlock(input, layer.slot), gap: index === 0 ? input.metrics.gaps.titleToSources : input.metrics.gaps.sourceToSource })),
        { key: "images-label", block: rows ? textBlock(input, "images-label") : null, gap: input.metrics.gaps.sourcesToColophon },
        { key: "thumbnails", block: rows ? box(gridHeight(tile)) : null, gap: input.metrics.gaps.labelToPictures },
        { key: "disclosure", block: textBlock(input, "disclosure"), gap: rows ? input.metrics.gaps.picturesToDisclosure : input.metrics.gaps.sourcesToColophon }
    ]);
    // Full-size tiles unless the sources leave the grid less room; then every tile shrinks alike.
    const full = colophon(input.metrics.thumbnails.height);
    const excess = Math.max(0, full.height - (input.metrics.area.bottom - input.metrics.area.top));
    const tileHeight = rows ? Math.floor((gridHeight(input.metrics.thumbnails.height) - excess - (rows - 1) * gap) / rows) : 0;
    const tileWidth = Math.round((tileHeight * input.metrics.thumbnails.width) / input.metrics.thumbnails.height);
    const block = excess ? colophon(tileHeight) : full;
    const top = input.metrics.area.top;
    const places = new Map();
    placeStack(template, block, top, heightsOf(input), places);
    const gridTop = block.tops.get("thumbnails");
    const left = thumbnails[0] ? px.x(thumbnails[0]) : 0;
    if (gridTop !== undefined) {
        thumbnails.forEach((layer, index) => places.set(layer, {
            x: left + (index % columns) * (tileWidth + gap),
            y: top + gridTop + Math.floor(index / columns) * (tileHeight + gap),
            width: tileWidth,
            height: tileHeight
        }));
    }
    // An empty source line keeps its frame where it was: it draws nothing either way.
    return moved(template, places);
}
/** The frame height of every non-empty text slot once shrunk to its lines. */
function heightsOf(input) {
    const heights = new Map();
    for (const slot of Object.keys(input.text)) {
        const block = textBlock(input, slot);
        if (block)
            heights.set(slot, block.height);
    }
    return heights;
}
/**
 * Single, photo: the band stays at the foot, as declared, unless the caller's focal point lands
 * under it. Then the whole lower group — band, line, kicker and credit — moves under the
 * logotype, and the shade follows it, so the subject the editor pointed at stays clear.
 *
 * Decided on where the focal point lands in the cropped frame, not on its place in the source: a
 * tall picture cropped around a low focal point can bring it to the middle of the slide.
 */
function singlePhoto(input) {
    const { template } = input;
    const picture = input.pictures["image-1"];
    const measured = input.text.headline;
    if (!picture?.focalGiven || !measured || measured.lines === 0)
        return template;
    const image = imageLayer(template, "image-1");
    const region = cropRegion(picture, picture.crop, { width: W, height: H }, picture.crop.fit ?? image.fit);
    const focalY = ((picture.crop.focal.y * picture.height - region.top) / region.height) * H;
    const panel = layersOf(template).find((layer) => layer.type === "shape" && layer.padText === "headline");
    const block = measured.lines * measured.fontSize * 1.12;
    const band = block + input.metrics.panel.padding * 2;
    const footTop = px.y(panel) + px.height(panel) - band;
    const body = textLayer(template, "body");
    const kicker = textLayer(template, "kicker");
    const credit = textLayer(template, "credit");
    const hasBody = (input.text.body?.lines ?? 0) > 0;
    const bodyTop = input.metrics.panel.top + band + input.metrics.panel.toBody;
    const kickerTop = hasBody ? bodyTop + px.height(body) + input.metrics.panel.toKicker : bodyTop;
    // An empty line draws nothing, but its frame is still measured against the shade, so it waits
    // on the kicker row rather than below it in the clear part of the picture.
    const bodyPlace = hasBody ? { y: bodyTop, height: px.height(body) } : { y: kickerTop, height: px.height(kicker) };
    // Measured on the frames as `moved` rounds them, so the shade's hold reaches every one of them.
    const bottom = (y, height) => Math.round(y) + Math.round(height);
    const headEnd = Math.max(bottom(kickerTop, px.height(kicker)), bottom(kickerTop, px.height(credit)), bottom(bodyPlace.y, bodyPlace.height));
    const clearFoot = footTop - focalY;
    const clearHead = focalY - headEnd;
    if (clearFoot >= input.metrics.panel.clearance || clearHead <= clearFoot)
        return template;
    const headline = textLayer(template, "headline");
    const places = new Map([
        [panel, { y: input.metrics.panel.top, height: Math.ceil(band) }],
        [headline, { y: input.metrics.panel.top + input.metrics.panel.inset, height: Math.ceil(block) }],
        [body, bodyPlace],
        [kicker, { y: kickerTop, height: px.height(kicker) }],
        [credit, { y: kickerTop, height: px.height(credit) }]
    ]);
    // The foot's shade turned over: deep behind the logotype and the words, clear from just under
    // the kicker row to the floor. Every line still stands on at least 0.68 of the ink, which is
    // what the cover's shade promises its headline.
    const end = headEnd / H;
    const fade = Math.min(1, end + 0.2);
    const shade = {
        colorToken: image.shade?.colorToken ?? "foreground",
        stops: [{ at: 0, opacity: 0.9 }, { at: end, opacity: 0.68 }, { at: fade, opacity: 0 }, ...(fade < 1 ? [{ at: 1, opacity: 0 }] : [])]
    };
    return moved(template, places, (layer) => layer === image ? { ...layer, shade } : layer);
}
//# sourceMappingURL=dneskai-layout.js.map