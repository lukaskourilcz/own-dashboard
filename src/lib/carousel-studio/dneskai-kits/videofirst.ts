import type { CarouselLayerInput, CarouselTemplate } from "../schema";
import { DNESKAI_GAPS, DNESKAI_PANEL, type DneskaiFlow, type DneskaiGapName, type DneskaiLayoutMetrics } from "../dneskai-layout";
import { defineDneskaiKit, type DneskaiKitTemplate } from "./kit";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./contract";
import { box, text, logo, kicker, body, template, FLOWED, LEFT, MEASURE, W, H } from "./compose";

/**
 * Video-first: the owner's second approved mockup (8 November 2026), the still frame of a carousel whose photo slides
 * go out as short videos (`dneskai-slide-video.ts`).
 *
 * Direction. A colour photograph to the edges under an even dark veil, and a big caption in condensed capitals in the
 * middle of the slide, the way video captions stand, with one short supporting line under it. Key words marked
 * `[[like this]]` are light blue; nothing sits behind the words. The words keep out of the bottom fifth, where
 * Instagram lays its own controls over a video. The logotype is the only mark, top left; nothing top right.
 *
 * Type. Anton in capitals, centred, 1.2 em apart; Inter 600 for the supporting line; IBM Plex Mono only on the
 * legacy sources slide. Palette from `looks/plakat.json`: ink, white, light blue key words, blue text slide.
 */

/** Words stay above the bottom fifth of the slide (1 080 px), where a video shows Instagram's controls. */
const AREA = { top: 184, bottom: 1_060 } as const;
const LEADING = 1.2;
/** Figure and split photographs end 54 px above the foot, in ink, which keeps them out of the full-bleed resolution rule (a 600 px picture still fills them). */
const DEPTH = 1_296;

/** An even veil: a touch more behind the logotype, steady under the caption, so white words hold on any photo. */
const VEIL = {
  colorToken: "background",
  stops: [
    { at: 0, opacity: 0.6 },
    { at: 0.14, opacity: 0.5 },
    { at: 0.3, opacity: 0.66 },
    { at: 0.8, opacity: 0.66 },
    { at: 1, opacity: 0.55 }
  ]
};

type Frame = ReturnType<typeof box>;

const photo = (slot: string, x: number, width: number, height: number = DEPTH): CarouselLayerInput =>
  ({ type: "image", slot, optional: false, fit: "cover", scrim: "none", treatment: "none", ...box(x, 0, width, height), shade: VEIL });

const caption = (frame: Frame, options: Parameters<typeof text>[2]): CarouselLayerInput =>
  text("headline", frame, { colorToken: "foreground", fontToken: "headline", fontWeight: 400, align: "middle", uppercase: true, emphasisColorToken: "secondary", leading: LEADING, ...options });

const line = (frame: Frame, options: Parameters<typeof body>[1]): CarouselLayerInput =>
  body(frame, { colorToken: "foreground", fontWeight: 600, align: "middle", ...options });

const label = (frame: Frame): CarouselLayerInput =>
  text("kicker", frame, { colorToken: "foreground", fontToken: "body", fontWeight: 800, minFontSize: 24, maxFontSize: 24, maxChars: 28, maxLines: 1, uppercase: true, tracking: 0.14, align: "middle" });

/**
 * A series post's label and running number above the cover headline ("Slovník AI #3", owner decision, 8 November
 * 2026), in the kit's label face. Only series posts set it. Its frame waits at the foot, below every text the fade
 * or veil is checked against, so a cover without it renders exactly as before; the flow lifts it above the headline.
 */
const seriesLine = (frame: Frame): CarouselLayerInput =>
  text("series", frame, { colorToken: "foreground", fontToken: "body", fontWeight: 800, minFontSize: 24, maxFontSize: 24, maxChars: 48, maxLines: 1, uppercase: true, tracking: 0.1, align: "middle" });

const coverPhoto = template({
  id: "dneskai-videofirst-cover-photo",
  name: "DNESKAi video-first · cover photo",
  description: "A colour photograph to every edge under an even dark veil and one big caption in capitals in the middle, key words in light blue.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [photo("image-1", 0, W, H), logo, caption(box(LEFT, 330, MEASURE, 640), { minFontSize: 72, maxFontSize: 120, maxChars: 110, maxLines: 5 }), seriesLine(box(LEFT, H - 140, MEASURE, 40))]
});

const figure = template({
  id: "dneskai-videofirst-figure",
  name: "DNESKAi video-first · figure",
  description: "A photograph to every edge under a dark veil, the caption in capitals in the middle and one supporting line under it.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [
    photo("image-1", 0, W),
    logo,
    caption(box(LEFT, 300, MEASURE, 460), { minFontSize: 64, maxFontSize: 104, maxChars: 110, maxLines: 4 }),
    line(box(LEFT, 790, MEASURE, 260), { minFontSize: 30, maxFontSize: 34, maxChars: 260, maxLines: 6 })
  ]
});

const splitGroup = (bodyChars: number): CarouselLayerInput[] => [
  label(box(LEFT, 280, MEASURE, 32)),
  caption(box(LEFT, 330, MEASURE, 440), { minFontSize: 64, maxFontSize: 104, maxChars: 110, maxLines: 4 }),
  line(box(LEFT, 790, MEASURE, 260), { minFontSize: 28, maxFontSize: 32, maxChars: bodyChars, maxLines: 7 })
];

const split = template({
  id: "dneskai-videofirst-split",
  name: "DNESKAi video-first · split",
  description: "A photograph to every edge under a dark veil, a tracked label, the caption in capitals and the supporting line, centred.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [photo("image-1", 0, W), logo, ...splitGroup(330)]
});

const splitPair = template({
  id: "dneskai-videofirst-split-pair",
  name: "DNESKAi video-first · split, two images",
  description: "Two photographs side by side to every edge under a dark veil, with the label, the caption in capitals and the supporting line centred over them.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [photo("image-1", 0, W / 2), photo("image-2", W / 2, W / 2), logo, ...splitGroup(320)]
});

const statement = template({
  id: "dneskai-videofirst-statement",
  name: "DNESKAi video-first · statement",
  description: "Short words in big capitals on blue, key words in ink, with a quieter line under them; on ink in the INK variant.",
  backgroundToken: "accent",
  version: FLOWED,
  // On the light blue ground (#6ec1ff since 8 November 2026) the words are ink; the INK variant draws them white.
  variants: [{ id: "INK", backgroundToken: "background", inkToken: "foreground" }],
  layers: [
    logo,
    caption(box(LEFT, 240, MEASURE, 620), { colorToken: "background", minFontSize: 72, maxFontSize: 140, maxChars: 170, maxLines: 7, emphasisColorToken: "background" }),
    line(box(LEFT, 880, MEASURE, 300), { colorToken: "background", minFontSize: 30, maxFontSize: 36, maxChars: 240, maxLines: 7 })
  ]
});

const VF_THUMBNAILS = { columns: 3, width: 296, height: 198, gap: 24 } as const;

/** The legacy sources slide, kept so an older deck switched to this kit still renders. */
function sources(thumbnails: number): CarouselTemplate {
  const { columns, width, height, gap } = VF_THUMBNAILS;
  return template({
    id: `dneskai-videofirst-sources-${thumbnails}`,
    name: `DNESKAi video-first · sources, ${thumbnails} ${thumbnails === 1 ? "image" : "images"}`,
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
  id: "dneskai-videofirst-single-photo",
  name: "DNESKAi video-first · single, photo",
  description: "A one-image post drawn like the cover: the photograph to every edge under a dark veil and the caption in capitals in the middle.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [photo("image-1", 0, W, H), logo, caption(box(LEFT, 330, MEASURE, 640), { minFontSize: 72, maxFontSize: 120, maxChars: 110, maxLines: 5 })]
});

const singleType = template({
  id: "dneskai-videofirst-single-type",
  name: "DNESKAi video-first · single, type",
  description: "A one-image post set in type alone: big white capitals centred on ink.",
  backgroundToken: "background",
  version: FLOWED,
  layers: [logo, caption(box(LEFT, 196, MEASURE, 860), { minFontSize: 72, maxFontSize: 140, maxChars: 120, maxLines: 8 })]
});

export const VIDEOFIRST_METRICS: DneskaiLayoutMetrics = {
  unit: 8,
  gaps: { ...DNESKAI_GAPS, labelToText: 3, headlineToBody: 4, headlineToNote: 5, titleToSources: 5, sourceToSource: 3, sourcesToColophon: 5 },
  area: { ...AREA },
  opticalShare: 0.5,
  thumbnails: VF_THUMBNAILS,
  panel: DNESKAI_PANEL
};

type Item = [string, DneskaiGapName | number];
const centre = (...list: Item[]): DneskaiFlow => ({ kind: "stack", anchor: "centre", items: list.map(([key, gap]) => ({ key, gap })) });
const SOURCES = Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, count) => sources(count));
const SPLIT: Item[] = [["kicker", 0], ["headline", "labelToText"], ["body", "headlineToBody"]];

const TEMPLATES: DneskaiKitTemplate[] = [
  { role: "cover-photo", template: coverPhoto, flow: centre(["series", 0], ["headline", "headlineToNote"]) },
  { role: "figure", template: figure, flow: centre(["headline", 0], ["body", "headlineToBody"]) },
  { role: "split", template: split, flow: centre(...SPLIT) },
  { role: "split-pair", template: splitPair, flow: centre(...SPLIT) },
  { role: "statement", template: statement, flow: centre(["headline", 0], ["body", "headlineToNote"]) },
  ...SOURCES.map((entry, thumbnails) => ({ role: "sources" as const, thumbnails, template: entry, flow: { kind: "sources" } as const })),
  { role: "single-photo", template: singlePhoto, flow: centre(["headline", 0]) },
  { role: "single-type", template: singleType, flow: centre(["headline", 0]) }
];

export const VIDEOFIRST_KIT = defineDneskaiKit({
  id: "videofirst",
  label: "Video-first",
  purpose: "The owner's video-first look: colour photographs to the edge under a dark veil and big centred captions in capitals, key words in light blue, words kept out of the bottom fifth; photo slides go out as short videos.",
  look: "plakat",
  metrics: VIDEOFIRST_METRICS,
  templates: TEMPLATES
});
