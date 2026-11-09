import { CarouselTemplateSchema, type CarouselTemplate } from "./schema";
import { bleed, logo, text } from "./dneskai-kits/compose";

/**
 * DNESKAi Instagram story (owner rule, 8 November 2026): one native 1080 × 1920 image that fills the whole 9:16 frame
 * — the cover's photograph to every edge, no letterbox and no bars — with the headline on the story's floor and the
 * logo at its head, both inside the Instagram story safe area (the top and bottom bands Instagram draws its own
 * chrome over). It is composed *for* the story canvas, because a template's layer places are shared across canvases
 * and the 4:5 cover's headline would fall in the story's unsafe foot. The headline is balanced like every DNESKAi
 * block, so a story never ends on a lone word.
 */

/** 1080 × 1920 positions, as fractions of the story canvas. */
const sf = (x: number, y: number, w: number, h: number) => ({ x: x / 1080, y: y / 1920, width: w / 1080, height: h / 1920 });

/**
 * The story's own shade: the cover's gradient reaches full strength only below 0.56 of a 4:5 frame, which on the
 * taller story leaves the headline's first lines over bare photograph. This one is dark across the whole lower half
 * where the headline stands, so white type clears 4.5:1 over a pale picture, and a touch at the head carries the logo.
 * Near-black at the bottom edge since 9 November 2026 (owner request: a strong vignette like Complex's covers).
 */
export const DNESKAI_STORY_SHADE = {
  colorToken: "foreground",
  stops: [
    { at: 0, opacity: 0.45 },
    { at: 0.14, opacity: 0 },
    { at: 0.38, opacity: 0 },
    { at: 0.5, opacity: 0.8 },
    { at: 0.75, opacity: 0.92 },
    { at: 1, opacity: 0.96 }
  ]
} as const;

/** The story canvas sizes, matching `DNESKAI_FORMATS`; the story is composed at `instagram-story`. */
const STORY_FORMATS = {
  "instagram-square": { width: 1_080, height: 1_080, safeArea: { top: 0.045, right: 0.06, bottom: 0.045, left: 0.06 } },
  "instagram-portrait": { width: 1_080, height: 1_350, safeArea: { top: 0.045, right: 0.06, bottom: 0.045, left: 0.06 } },
  "instagram-story": { width: 1_080, height: 1_920, safeArea: { top: 0.14, right: 0.07, bottom: 0.16, left: 0.07 } },
  threads: { width: 1_200, height: 1_200, safeArea: { top: 0.07, right: 0.07, bottom: 0.09, left: 0.07 } }
};

/** The single story template: a full-bleed photograph, the logo at the head and the headline on the floor, all inside the safe area. */
export const DNESKAI_COVER_STORY_TEMPLATE: CarouselTemplate = CarouselTemplateSchema.parse({
  schemaVersion: "carousel-template/2",
  id: "dneskai-cover-story",
  name: "DNESKAi · cover story",
  version: "1.0.0",
  status: "live",
  description: "A colour photograph to every edge of a 9:16 story and one headline on its floor, inside the safe area.",
  citedObservationRefs: ["own-dashboard#110"],
  formats: STORY_FORMATS,
  canvas: { master: "instagram-story", derive: [] },
  requiredSlots: ["headline"],
  slides: [{
    id: "slide-dneskai-cover-story",
    backgroundToken: "foreground",
    variants: [],
    layers: [
      { ...bleed("image-1"), shade: DNESKAI_STORY_SHADE },
      { ...logo, ...sf(80, 300, 230, 52) },
      text("headline", sf(80, 1_010, 920, 540), { colorToken: "background", minFontSize: 50, maxFontSize: 96, maxChars: 110, maxLines: 6, valign: "bottom" })
    ]
  }]
});
