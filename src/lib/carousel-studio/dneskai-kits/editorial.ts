import type { CarouselTemplate } from "../schema.js";
import { DNESKAI_THUMBNAIL_GRID, DNESKAI_EDITORIAL_METRICS, type DneskaiFlow } from "../dneskai-layout.js";
import { defineDneskaiKit } from "./kit.js";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot, type DneskaiTemplateRole } from "./contract.js";
import { box, text, fill, logo, kicker, body, bleed, plated, template, FLOWED, LEFT, MEASURE, W, H } from "./compose.js";

/**
 * The editorial kit: the approved DNESKAi photographic compositions in Space Grotesk, Source Serif 4
 * and IBM Plex Mono on white, paper, blueprint blue and ink.
 *
 * Since the owner's decision of 22 October 2026 no slide carries a folio or a picture credit, and
 * the first slide of a post shows its headline alone: the cover is the photograph to every edge and
 * one headline standing on its floor, the single photo the headline on its blue panel, the single
 * type post a blue rule and one large headline. The kicker survives on the split slides only. The
 * band the flowed slides are composed in runs from under the logotype to 86 px above the foot
 * (`DNESKAI_AREA`), the height the credit line used to hold.
 */

const coverPhoto = template({
  id: "dneskai-cover-photo",
  name: "DNESKAi · cover photo",
  description: "A colour photograph to every edge and one headline standing on its floor, nothing else.",
  backgroundToken: "foreground",
  layers: [
    bleed("image-1"),
    logo,
    // Bottom-anchored on the band's floor, 86 px above the foot, where the kicker and credit stood.
    text("headline", box(LEFT, 770, MEASURE, 494), { colorToken: "background", minFontSize: 50, maxFontSize: 84, maxChars: 110, maxLines: 5, valign: "bottom" })
  ]
});

const figure = template({
  id: "dneskai-figure",
  name: "DNESKAi · figure",
  description: "A headline above a photograph or chart on a white plate and a serif explanation below.",
  backgroundToken: "surface",
  version: FLOWED,
  layers: [
    logo,
    text("headline", box(LEFT, 166, MEASURE, 200), { minFontSize: 40, maxFontSize: 58, maxChars: 110, maxLines: 3 }),
    ...plated("image-1", LEFT, 396, MEASURE, 640, { optional: false, fit: "contain" }),
    // The frame runs 6 px past the band: an empty caption then never reads as words standing on a
    // covering picture that grew into its place.
    body(box(LEFT, 1_070, MEASURE, 200), { minFontSize: 28, maxFontSize: 34, maxChars: 260, maxLines: 5 })
  ]
});

const spine = fill(box(0, 0, 12, H), "accent");

const split = template({
  id: "dneskai-split",
  name: "DNESKAi · split",
  description: "The words in the left column under a blue spine, one framed photograph or figure to the right, the explanation below both.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    spine,
    logo,
    kicker("accent", box(LEFT, 166, 420, 28), 20, 28),
    text("headline", box(LEFT, 206, 428, 600), { minFontSize: 38, maxFontSize: 52, maxChars: 110, maxLines: 8 }),
    ...plated("image-1", 540, 168, 468, 680, { optional: false, fit: "contain" }),
    body(box(LEFT, 896, MEASURE, 368), { minFontSize: 30, maxFontSize: 36, maxChars: 330, maxLines: 8 })
  ]
});

const splitPair = template({
  id: "dneskai-split-pair",
  name: "DNESKAi · split, two images",
  description: "The words in the left column under a blue spine, two framed photographs or figures stacked to the right.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    spine,
    logo,
    kicker("accent", box(LEFT, 166, 420, 28), 20, 28),
    text("headline", box(LEFT, 206, 428, 330), { minFontSize: 36, maxFontSize: 48, maxChars: 110, maxLines: 6 }),
    body(box(LEFT, 566, 428, 698), { minFontSize: 27, maxFontSize: 32, maxChars: 320, maxLines: 12 }),
    // Landscape-leaning frames: what sources publish is mostly 3:2, 16:9 and wider.
    ...plated("image-1", 540, 168, 468, 360, { optional: false, fit: "contain" }),
    ...plated("image-2", 540, 556, 468, 360, { optional: false, fit: "contain" })
  ]
});

const statement = template({
  id: "dneskai-statement",
  name: "DNESKAi · statement",
  description: "One sentence on a solid blueprint-blue or ink ground, with a quieter serif note under it.",
  backgroundToken: "accent",
  version: FLOWED,
  variants: [{ id: "INK", backgroundToken: "foreground" }],
  layers: [
    logo,
    text("headline", box(LEFT, 236, MEASURE, 620), { colorToken: "background", minFontSize: 52, maxFontSize: 80, maxChars: 170, maxLines: 7, valign: "bottom" }),
    body(box(LEFT, 902, MEASURE, 300), { colorToken: "surface", minFontSize: 30, maxFontSize: 36, maxChars: 240, maxLines: 6 })
  ]
});

const SOURCE_TOP = 250;
const SOURCE_ROW = 92;
/**
 * The declared frames: the largest each element may take, which the words are fitted in. The
 * render stacks them from the top as one colophon, the thumbnails directly under the sources
 * (`dneskai-layout.ts`).
 */
const THUMB_TOP = 676;

function sources(thumbnails: number): CarouselTemplate {
  const { columns, width, height, gap } = DNESKAI_THUMBNAIL_GRID;
  return template({
    id: `dneskai-sources-${thumbnails}`,
    name: `DNESKAi · sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`,
    description: "The sources the slides were written from, small copies of every picture the deck used, and how the text was made.",
    backgroundToken: "surface",
    version: FLOWED,
    layers: [
      logo,
      text("title", box(LEFT, 166, MEASURE, 56), { minFontSize: 44, maxFontSize: 44, maxChars: 30, maxLines: 1 }),
      ...Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) =>
        body(box(LEFT, SOURCE_TOP + index * SOURCE_ROW, MEASURE, 86), { slot: dneskaiSourceSlot(index), minFontSize: 25, maxFontSize: 27, maxChars: 190, maxLines: 3 })),
      ...(thumbnails > 0 ? [kicker("muted", box(LEFT, THUMB_TOP - 40, MEASURE, 26), 18, 40, "images-label")] : []),
      ...Array.from({ length: thumbnails }, (_, index) =>
        plated(`image-${index + 1}`, LEFT + (index % columns) * (width + gap), THUMB_TOP + Math.floor(index / columns) * (height + gap), width, height, { optional: false, fit: "cover" })).flat(),
      text("disclosure", box(LEFT, 1_106, MEASURE, 90), { colorToken: "muted", fontToken: "mono", fontWeight: 400, minFontSize: 19, maxFontSize: 20, maxChars: 200, maxLines: 4 })
    ]
  });
}

const singlePhoto = template({
  id: "dneskai-single-photo",
  name: "DNESKAi · single, photo",
  description: "A one-image post: a colour photograph to every edge and the headline alone on a solid blue panel at its foot.",
  backgroundToken: "foreground",
  version: FLOWED,
  layers: [
    bleed("image-1"),
    logo,
    // The panel's floor sits on the band's floor, 86 px above the foot, as the cover's headline does.
    { type: "shape", ...box(48, 724, 984, 540), fillToken: "accent", strokeWidth: 0, radius: 0, padText: "headline", padding: 24 / W },
    // 31 px above the panel's floor against 24 px of padding: the cap line and the baseline then
    // sit the same 40 px from the panel's edges, which equal padding around the line box does not.
    text("headline", box(LEFT, 748, MEASURE, 485), { colorToken: "background", minFontSize: 48, maxFontSize: 80, maxChars: 110, maxLines: 5, valign: "bottom" })
  ]
});

const singleType = template({
  id: "dneskai-single-type",
  name: "DNESKAi · single, type",
  description: "A one-image post set in type alone: a blue rule and one large headline under it, standing as one block a little above the middle.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    logo,
    { type: "rule", ...box(LEFT, 172, 96, 8), colorToken: "accent", thickness: 8 },
    text("headline", box(LEFT, 212, MEASURE, 1_052), { minFontSize: 64, maxFontSize: 116, maxChars: 120, maxLines: 8 })
  ]
});

const SOURCES = Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => sources(count));

/** Every DNESKAi photo-kit template, by id. */
export const DNESKAI_PHOTO_TEMPLATES: ReadonlyMap<string, CarouselTemplate> = new Map(
  [coverPhoto, figure, split, splitPair, statement, ...SOURCES, singlePhoto, singleType].map((entry) => [entry.id, entry] as const)
);

/** The sources template that carries exactly this many thumbnails. */
export function dneskaiSourcesTemplate(thumbnails: number): CarouselTemplate {
  const found = SOURCES[thumbnails];
  if (!found) throw new Error(`A DNESKAi sources slide carries 0 to ${DNESKAI_MAX_THUMBNAILS} thumbnails, not ${thumbnails}`);
  return found;
}

export const DNESKAI_EDITORIAL_FLOWS: Readonly<Record<string,DneskaiFlow>> = {
  "dneskai-cover-photo":{kind:"cover-static"},"dneskai-figure":{kind:"figure"},
  "dneskai-split":{kind:"split"},"dneskai-split-pair":{kind:"split-pair"},"dneskai-statement":{kind:"statement"},
  "dneskai-single-photo":{kind:"single-photo"},"dneskai-single-type":{kind:"single-type"},
  ...Object.fromEntries(Array.from({length:DNESKAI_MAX_THUMBNAILS+1},(_,n)=>[`dneskai-sources-${n}`,{kind:"sources" as const}]))
};
export const EDITORIAL_KIT=defineDneskaiKit({id:"editorial",label:"Editorial",purpose:"The approved DNESKAi photographic compositions.",look:"editorial",metrics:DNESKAI_EDITORIAL_METRICS,
  templates:[...DNESKAI_PHOTO_TEMPLATES.values()].map(template=>({template,role:(template.id.startsWith("dneskai-sources-")?"sources":template.id.slice("dneskai-".length)) as DneskaiTemplateRole,
    ...(template.id.startsWith("dneskai-sources-")?{thumbnails:Number(template.id.split("-").at(-1))}:{}),flow:DNESKAI_EDITORIAL_FLOWS[template.id]!}))
});
