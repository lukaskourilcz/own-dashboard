import {
  BrandTokensSchema,
  CarouselTemplateSchema,
  type BrandTokens,
  type CarouselCanvas,
  type CarouselLayerInput,
  type CarouselPayload,
  type CarouselTemplate,
  type CarouselTemplateInput
} from "./schema.js";
import { CANVAS_ORDER, MASTER_FORMAT } from "./canvas.js";
import { MAX_RESOLVABLE_SLIDES, MIN_SLIDES } from "./slides.js";
import { declaredCanvases, fitsSafeArea } from "./validation.js";
import { familyDeckTemplate, familyDeckTemplates } from "./families.js";
import { DECK_STYLES, isDeckStyle, type DeckStyle } from "./designs.js";
import { parseRecipeTemplateId } from "./recipe.js";

export const deckFormats = {
  "instagram-square": { width: 1_080, height: 1_080, safeArea: { top: 0.06, right: 0.06, bottom: 0.08, left: 0.06 } },
  "instagram-portrait": { width: 1_080, height: 1_350, safeArea: { top: 0.06, right: 0.06, bottom: 0.08, left: 0.06 } },
  /*
   * The story, 9:16 (D14). Its safe area is the widest on the list and that is the format's
   * own doing rather than caution: a story is overlaid by the platform's chrome — the profile
   * row along the top and the reply bar along the bottom — so roughly a seventh of the canvas
   * at each end is never reliably visible. Everything that has to be read lives between.
   */
  "instagram-story": { width: 1_080, height: 1_920, safeArea: { top: 0.14, right: 0.07, bottom: 0.16, left: 0.07 } },
  threads: { width: 1_200, height: 1_200, safeArea: { top: 0.07, right: 0.07, bottom: 0.09, left: 0.07 } }
} as const;

/**
 * What every generated deck declares: 4:5 master, the other three by derivation.
 *
 * Honest rather than generous. These compositions place every text and logo frame inside the union
 * of the four safe areas — the story's, which is the widest — which is the constraint
 * `families.ts` describes and `SAFE_TOP`/`SAFE_BOTTOM` below enforce. A layout composed that way
 * really does hold at 1:1 and 9:16, so it may say so; one composed for 4:5 alone may not, and gets
 * the schema's default, which is the master and nothing else.
 */
export function deckCanvas(): { master: CarouselCanvas; derive: CarouselCanvas[] } {
  return { master: MASTER_FORMAT, derive: ["instagram-square", "instagram-story", "threads"] };
}

const text = (
  slot: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<Extract<CarouselLayerInput, { type: "text" }>> = {}
): CarouselLayerInput => ({
  type: "text",
  slot,
  x,
  y,
  width,
  height,
  colorToken: "foreground",
  fontToken: "body",
  fontWeight: 500,
  minFontSize: 24,
  maxFontSize: 48,
  maxChars: 180,
  maxLines: 5,
  align: "start",
  uppercase: false,
  ...options
});

/*
 * The safe band every canvas shares.
 *
 * A story is overlaid by the platform's own chrome — the profile row along the top and the reply
 * bar along the bottom — which is about a seventh of the canvas at each end and the widest safe
 * area of the four. Chrome placed inside it is not merely tight, it is covered up. These are the
 * bounds that make one composition honest at 1:1, 4:5, 9:16 and Threads at once, rather than
 * honest at 4:5 and quietly wrong at 9:16.
 */
export const SAFE_TOP = 0.145;
export const SAFE_BOTTOM = 0.835;

/**
 * The wordmark.
 *
 * Its default `y` of 0.07 was the single line that failed every deck template for the story
 * canvas: comfortably inside a 4:5 margin, squarely under a story's profile row. The default is
 * now the shared safe top, so a caller that does not care about placement gets a placement that
 * works everywhere; a caller that does — a cover dropping the mark below its photograph — still
 * passes its own.
 */
const logo = (y = SAFE_TOP, colorToken = "accent"): CarouselLayerInput => ({
  type: "logo",
  x: 0.08,
  y,
  width: 0.44,
  height: 0.06,
  colorToken,
  fontToken: "headline"
});

const rule = (x: number, y: number, width: number, colorToken = "accent"): CarouselLayerInput => ({
  type: "rule",
  x,
  y,
  width,
  height: 0.006,
  colorToken,
  thickness: 4
});

const shape = (
  x: number,
  y: number,
  width: number,
  height: number,
  fillToken = "surface",
  radius = 0.08
): CarouselLayerInput => ({
  type: "shape",
  x,
  y,
  width,
  height,
  fillToken,
  strokeWidth: 0,
  radius
});

const template = (input: Omit<CarouselTemplateInput, "schemaVersion" | "version" | "status" | "formats" | "citedObservationRefs"> & {
  citedObservationRefs?: string[];
}): CarouselTemplate => CarouselTemplateSchema.parse({
  schemaVersion: "carousel-template/1",
  version: "1.0.0",
  status: "live",
  formats: deckFormats,
  canvas: deckCanvas(),
  citedObservationRefs: input.citedObservationRefs ?? [],
  ...input
});

/**
 * The slot a deck's Nth slide fills. One-based, zero-padded, so slots sort the way slides read.
 */
export function articleSlideSlot(index: number): string {
  return `slide-${String(index + 1).padStart(2, "0")}`;
}

/** The slot the article's own hero occupies on the opening slide. */
export const ARTICLE_HERO_SLOT = "image";


const mesh = (
  blobs: Array<{ colorToken: string; cx: number; cy: number; radius: number; opacity: number }>,
  softness = 0.09
): CarouselLayerInput => ({
  type: "mesh",
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  blobs,
  softness
});

const heroImage = (y: number, height: number, scrim: "none" | "bottom" | "full"): CarouselLayerInput => ({
  type: "image",
  slot: ARTICLE_HERO_SLOT,
  optional: true,
  fit: "cover",
  scrim,
  x: 0,
  y,
  width: 1,
  height
});

/** Per-style background art. `phase` walks 0..1 across the deck so a gradient can travel. */
function styleBackdrop(style: DeckStyle, phase: number, cover: boolean): CarouselLayerInput[] {
  // Clamped to the schema's own bounds. A blob may sit a little off-canvas — that is how a
  // gradient reads as continuing past the edge — but not so far it is invisible, and the schema
  // is where that judgement lives rather than here.
  const drift = (base: number, amount: number) =>
    Math.max(-0.5, Math.min(1.5, base + (phase - 0.5) * amount));
  if (style === "mesh") {
    return [mesh([
      { colorToken: "accent", cx: drift(0.18, 0.5), cy: 0.22, radius: 0.62, opacity: cover ? 0.5 : 0.34 },
      { colorToken: "secondary", cx: drift(0.86, -0.5), cy: 0.74, radius: 0.58, opacity: cover ? 0.42 : 0.28 },
      { colorToken: "surface-strong", cx: 0.5, cy: drift(0.5, 0.3), radius: 0.7, opacity: 0.5 }
    ])];
  }
  if (style === "aurora") {
    // One continuous gradient the reader travels through: the field walks corner to corner.
    return [mesh([
      { colorToken: "accent", cx: drift(-0.1, 1.3), cy: drift(1.1, -1.3), radius: 0.8, opacity: 0.44 },
      { colorToken: "secondary", cx: drift(0.4, 0.8), cy: drift(-0.05, 1.0), radius: 0.66, opacity: 0.34 },
      { colorToken: "surface", cx: 0.5, cy: 0.5, radius: 0.9, opacity: 0.5 }
    ], 0.13)];
  }
  if (style === "spotlight") {
    return [mesh([
      { colorToken: "accent", cx: 0.5, cy: 0.44, radius: 0.42, opacity: cover ? 0.4 : 0.24 },
      { colorToken: "surface-strong", cx: 0.5, cy: 0.5, radius: 0.85, opacity: 0.55 }
    ], 0.11)];
  }
  if (style === "contrast") {
    // No gradient. A hard accent bar and a flat field, which is its own kind of loud.
    return [{ type: "shape", x: 0, y: 0, width: 0.055, height: 1, fillToken: "accent", strokeWidth: 0, radius: 0 }];
  }
  // editorial: a single restrained wash, mostly out of the way of the text.
  return [mesh([
    { colorToken: "surface", cx: 0.5, cy: 0.12, radius: 0.75, opacity: 0.6 },
    { colorToken: "accent", cx: 0.9, cy: 0.05, radius: 0.3, opacity: cover ? 0.3 : 0.14 }
  ], 0.12)];
}

/**
 * A deck template sized to the article and dressed in one of the five designs.
 *
 * Every other template in this file has a fixed slide array, which is right for a poster and wrong
 * for an article: how many slides a piece deserves is a property of the piece. The first slide
 * carries the article's own hero image; the rest carry its words.
 */
export function articleDeckTemplate(slideCount: number, style: DeckStyle = "mesh"): CarouselTemplate {
  const slots = Array.from({ length: slideCount }, (_, index) => articleSlideSlot(index));
  const textTop = style === "editorial" ? 0.24 : 0.3;
  return template({
    id: `deck-${style}-${slideCount}`,
    name: `Article deck · ${style} · ${slideCount} slides`,
    description: "A cover carrying the article's own image, the article's points one per slide, and a closing line.",
    requiredSlots: slots,
    slides: slots.map((slot, index) => {
      const cover = index === 0;
      const last = index === slideCount - 1;
      const phase = slideCount === 1 ? 0 : index / (slideCount - 1);
      // The hero sits differently in each design: a framed band, a tall bleed, or half the slide.
      const heroTop = style === "contrast" ? 0.06 : 0;
      const heroHeight = style === "contrast" ? 0.34 : style === "editorial" ? 0.46 : 0.52;
      const heroBottom = cover ? heroTop + heroHeight : 0;
      const heroLayers: CarouselLayerInput[] = !cover
        ? []
        : [heroImage(heroTop, heroHeight, style === "contrast" ? "none" : "bottom")];
      return {
        id: `slide-deck-${String(index + 1).padStart(2, "0")}`,
        backgroundToken: cover || last ? "surface" : "background",
        variants: [],
        layers: [
          ...styleBackdrop(style, phase, cover),
          ...heroLayers,
          // On a cover the wordmark drops below the photograph. Over the image it sat on
          // whatever the photograph happened to be, which for a bright frame is unreadable and
          // for a dark one is luck rather than design.
          // The wordmark is foreground on a deck, not accent. Measured: an accent wordmark over
          // an accent gradient blob only clears 4.5:1 once the blob drops to 0.12 opacity, which
          // is a gradient you cannot see. Foreground clears it at every opacity the design uses,
          // so the gradient keeps its strength and the mark stays readable. The accent is still
          // there, in the rule and the progress indicator.
          logo(cover ? heroBottom + 0.03 : SAFE_TOP, "foreground"),
          // On a cover the headline sits between the wordmark and the rule, so its height is
          // whatever is left rather than a constant — a fixed block ran the last line straight
          // through the accent rule on the taller heroes.
          text(
            slot,
            style === "contrast" ? 0.13 : 0.1,
            cover ? heroBottom + 0.12 : textTop,
            0.76,
            cover ? Math.max(0.12, 0.775 - (heroBottom + 0.12)) : 0.42,
            {
              fontToken: "headline",
              fontWeight: cover ? 900 : 800,
              minFontSize: 30,
              maxFontSize: cover ? 72 : 60,
              maxChars: 260,
              maxLines: 8,
              align: last ? "middle" : "start"
            }
          ),
          // Both were below the story's reply bar, which is to say invisible on a canvas the
          // template claimed to serve. Inside the shared safe band they are seen everywhere.
          shape(0.76, SAFE_BOTTOM - 0.04, 0.04 + phase * 0.16, 0.02, "muted", 0.5),
          rule(style === "contrast" ? 0.13 : 0.1, SAFE_BOTTOM - 0.01, last ? 0.6 : 0.24)
        ]
      };
    })
  });
}

export const SEED_TEMPLATES: readonly CarouselTemplate[] = [
  template({
    id: "quote-card",
    name: "Quote card",
    description: "One sourced line with a restrained attribution and a strong editorial margin.",
    requiredSlots: ["quote", "attribution"],
    slides: [{
      id: "slide-quote",
      backgroundToken: "background",
      variants: [{ id: "A" }, { id: "B", accentToken: "secondary" }],
      layers: [
        logo(),
        text("quote", 0.1, 0.25, 0.76, 0.43, { fontToken: "headline", fontWeight: 800, minFontSize: 34, maxFontSize: 74, maxChars: 190, maxLines: 6 }),
        rule(0.1, 0.75, 0.18),
        text("attribution", 0.1, 0.8, 0.72, 0.08, { colorToken: "muted", fontWeight: 700, minFontSize: 20, maxFontSize: 30, maxChars: 80, maxLines: 2 })
      ]
    }]
  }),
  /*
   * The story (D14). 9:16, and composed for it rather than adapted to it.
   *
   * Every other seed places its logo at y .07 and its closing line near y .80 — comfortable
   * inside a 4:5 canvas's .06/.08 margins and squarely under a story's platform chrome, which
   * covers roughly a seventh of the canvas at each end. So this one keeps everything between
   * y .18 and y .78: the story's safe area is the platform's reality and a template that
   * ignored it would put the attribution behind the reply bar.
   *
   * It validates at all four canvases, which is why it is a seed rather than a special case.
   */
  template({
    id: "story-quote",
    name: "Story quote",
    description: "One sourced line composed for a nine-by-sixteen story, clear of the platform's own chrome.",
    requiredSlots: ["quote", "attribution"],
    slides: [{
      id: "slide-story",
      backgroundToken: "background",
      variants: [{ id: "A" }, { id: "B", accentToken: "secondary" }],
      layers: [
        logo(0.18),
        text("quote", 0.1, 0.3, 0.76, 0.3, { fontToken: "headline", fontWeight: 800, minFontSize: 34, maxFontSize: 74, maxChars: 190, maxLines: 6 }),
        rule(0.1, 0.66, 0.18),
        text("attribution", 0.1, 0.7, 0.72, 0.07, { colorToken: "muted", fontWeight: 700, minFontSize: 20, maxFontSize: 30, maxChars: 80, maxLines: 2 })
      ]
    }]
  }),
  template({
    id: "listicle-steps",
    name: "Listicle steps",
    description: "A four-step sequence with fixed numbering and room for one specific action per slide.",
    requiredSlots: ["list-title", "step-one", "step-two", "step-three", "step-four"],
    slides: ["one", "two", "three", "four"].map((number, index) => ({
      id: `slide-${number}`,
      backgroundToken: index % 2 === 0 ? "background" : "surface",
      variants: [],
      layers: [
        logo(),
        text("list-title", 0.08, 0.18, 0.76, 0.09, { colorToken: "muted", fontWeight: 700, minFontSize: 20, maxFontSize: 32, maxChars: 72, maxLines: 2, uppercase: true }),
        shape(0.08, 0.39, 0.06, 0.06, index % 2 === 0 ? "accent" : "secondary", 0.5),
        text(`step-${number}`, 0.18, 0.39, 0.68, 0.3, { fontToken: "headline", fontWeight: 800, minFontSize: 34, maxFontSize: 70, maxChars: 150, maxLines: 5 }),
        rule(0.18, 0.76, 0.52)
      ]
    }))
  }),
  template({
    id: "stat-highlight",
    name: "Stat highlight",
    description: "A large verified figure paired with a plain-language explanation and source label.",
    requiredSlots: ["stat", "stat-label", "source"],
    slides: [{
      id: "slide-stat",
      backgroundToken: "background",
      variants: [{ id: "A" }, { id: "B", backgroundToken: "surface" }],
      layers: [
        logo(),
        shape(0.08, 0.23, 0.84, 0.5),
        text("stat", 0.13, 0.3, 0.74, 0.2, { colorToken: "accent", fontToken: "headline", fontWeight: 900, minFontSize: 52, maxFontSize: 120, maxChars: 18, maxLines: 1, align: "middle" }),
        text("stat-label", 0.16, 0.53, 0.68, 0.13, { fontWeight: 700, minFontSize: 24, maxFontSize: 40, maxChars: 100, maxLines: 3, align: "middle" }),
        text("source", 0.1, 0.82, 0.78, 0.07, { colorToken: "muted", fontToken: "mono", minFontSize: 18, maxFontSize: 25, maxChars: 100, maxLines: 2 })
      ]
    }]
  }),
  template({
    id: "before-after",
    name: "Before and after",
    description: "Two consecutive states that explain one concrete change without a decorative split screen.",
    requiredSlots: ["before-label", "before", "after-label", "after"],
    slides: [
      {
        id: "slide-before",
        backgroundToken: "background",
        variants: [],
        layers: [logo(), text("before-label", 0.09, 0.24, 0.5, 0.08, { colorToken: "muted", fontWeight: 800, minFontSize: 20, maxFontSize: 34, maxChars: 32, maxLines: 1, uppercase: true }), text("before", 0.09, 0.4, 0.78, 0.31, { fontToken: "headline", fontWeight: 800, minFontSize: 34, maxFontSize: 72, maxChars: 170, maxLines: 5 }), rule(0.09, 0.8, 0.26, "muted")]
      },
      {
        id: "slide-after",
        backgroundToken: "surface",
        variants: [],
        layers: [logo(), text("after-label", 0.09, 0.24, 0.5, 0.08, { colorToken: "accent", fontWeight: 800, minFontSize: 20, maxFontSize: 34, maxChars: 32, maxLines: 1, uppercase: true }), text("after", 0.09, 0.4, 0.78, 0.31, { fontToken: "headline", fontWeight: 800, minFontSize: 34, maxFontSize: 72, maxChars: 170, maxLines: 5 }), rule(0.09, 0.8, 0.54)]
      }
    ]
  }),
  template({
    id: "headline-three-bullets",
    name: "Headline and three points",
    description: "A compact cover followed by three evidence-sized points on a single reading slide.",
    requiredSlots: ["headline", "bullet-one", "bullet-two", "bullet-three"],
    slides: [
      {
        id: "slide-cover",
        backgroundToken: "background",
        variants: [],
        layers: [logo(), text("headline", 0.09, 0.34, 0.78, 0.33, { fontToken: "headline", fontWeight: 900, minFontSize: 36, maxFontSize: 78, maxChars: 170, maxLines: 5 }), rule(0.09, 0.75, 0.66)]
      },
      {
        id: "slide-points",
        backgroundToken: "surface",
        variants: [],
        layers: [
          logo(),
          text("bullet-one", 0.16, 0.26, 0.7, 0.13, { fontWeight: 700, minFontSize: 24, maxFontSize: 38, maxChars: 100, maxLines: 3 }),
          text("bullet-two", 0.16, 0.48, 0.7, 0.13, { fontWeight: 700, minFontSize: 24, maxFontSize: 38, maxChars: 100, maxLines: 3 }),
          text("bullet-three", 0.16, 0.7, 0.7, 0.13, { fontWeight: 700, minFontSize: 24, maxFontSize: 38, maxChars: 100, maxLines: 3 }),
          rule(0.09, 0.31, 0.04), rule(0.09, 0.53, 0.04), rule(0.09, 0.75, 0.04)
        ]
      }
    ]
  }),
  template({
    id: "timeline",
    name: "Timeline",
    description: "Three dated moments connected by repeated typography instead of an illustrated chronology.",
    requiredSlots: ["timeline-title", "time-one", "event-one", "time-two", "event-two", "time-three", "event-three"],
    slides: ["one", "two", "three"].map((number, index) => ({
      id: `slide-time-${number}`,
      backgroundToken: "background",
      variants: [],
      layers: [
        logo(),
        text("timeline-title", 0.09, 0.2, 0.74, 0.09, { colorToken: "muted", fontWeight: 700, minFontSize: 20, maxFontSize: 32, maxChars: 80, maxLines: 2 }),
        text(`time-${number}`, 0.09, 0.38, 0.24, 0.09, { colorToken: "accent", fontToken: "mono", fontWeight: 800, minFontSize: 24, maxFontSize: 38, maxChars: 18, maxLines: 1 }),
        text(`event-${number}`, 0.09, 0.51, 0.76, 0.26, { fontToken: "headline", fontWeight: 800, minFontSize: 32, maxFontSize: 64, maxChars: 150, maxLines: 5 }),
        rule(0.72, 0.85, 0.05 + index * 0.06, "muted")
      ]
    }))
  }),
  template({
    id: "comparison",
    name: "Comparison",
    description: "Two claims receive equal space, then one short conclusion states the useful distinction.",
    requiredSlots: ["left-title", "left-body", "right-title", "right-body", "comparison-note"],
    slides: [{
      id: "slide-comparison",
      backgroundToken: "background",
      variants: [],
      layers: [
        logo(),
        shape(0.07, 0.23, 0.4, 0.48),
        shape(0.53, 0.23, 0.4, 0.48, "surface-strong"),
        text("left-title", 0.11, 0.29, 0.31, 0.08, { colorToken: "accent", fontWeight: 800, minFontSize: 20, maxFontSize: 32, maxChars: 40, maxLines: 2 }),
        text("left-body", 0.11, 0.41, 0.31, 0.23, { fontWeight: 700, minFontSize: 22, maxFontSize: 38, maxChars: 120, maxLines: 5 }),
        text("right-title", 0.57, 0.29, 0.31, 0.08, { colorToken: "accent", fontWeight: 800, minFontSize: 20, maxFontSize: 32, maxChars: 40, maxLines: 2 }),
        text("right-body", 0.57, 0.41, 0.31, 0.23, { fontWeight: 700, minFontSize: 22, maxFontSize: 38, maxChars: 120, maxLines: 5 }),
        text("comparison-note", 0.1, 0.79, 0.8, 0.1, { colorToken: "muted", minFontSize: 19, maxFontSize: 28, maxChars: 120, maxLines: 3, align: "middle" })
      ]
    }]
  }),
  template({
    id: "cover-cta",
    name: "Cover and closing prompt",
    description: "An editorial cover and a separate closing slide with one bounded next action.",
    requiredSlots: ["cover-title", "cover-dek", "cta", "destination"],
    slides: [
      {
        id: "slide-cover",
        backgroundToken: "background",
        variants: [{ id: "A" }, { id: "B", accentToken: "secondary" }],
        layers: [logo(), text("cover-title", 0.09, 0.29, 0.79, 0.31, { fontToken: "headline", fontWeight: 900, minFontSize: 36, maxFontSize: 78, maxChars: 170, maxLines: 5 }), text("cover-dek", 0.09, 0.69, 0.75, 0.12, { colorToken: "muted", minFontSize: 22, maxFontSize: 34, maxChars: 120, maxLines: 3 }), rule(0.09, 0.86, 0.18)]
      },
      {
        id: "slide-closing",
        backgroundToken: "surface",
        variants: [{ id: "A" }, { id: "B", accentToken: "secondary" }],
        layers: [logo(), text("cta", 0.12, 0.34, 0.76, 0.25, { fontToken: "headline", fontWeight: 900, minFontSize: 36, maxFontSize: 72, maxChars: 130, maxLines: 4, align: "middle" }), text("destination", 0.14, 0.69, 0.72, 0.09, { colorToken: "accent", fontToken: "mono", fontWeight: 700, minFontSize: 18, maxFontSize: 30, maxChars: 100, maxLines: 2, align: "middle" })]
      }
    ]
  }),
  template({
    id: "five-slide-story",
    name: "Five-slide story",
    description: "A cover, three developments and one sober takeaway form a complete reading arc.",
    requiredSlots: ["story-title", "story-one", "story-two", "story-three", "story-takeaway"],
    slides: ["title", "one", "two", "three", "takeaway"].map((part, index) => ({
      id: `slide-story-${part}`,
      backgroundToken: index === 0 || index === 4 ? "surface" : "background",
      variants: [],
      layers: [
        logo(),
        text(part === "title" ? "story-title" : part === "takeaway" ? "story-takeaway" : `story-${part}`, 0.1, 0.34, 0.78, 0.34, { fontToken: "headline", fontWeight: 800, minFontSize: 34, maxFontSize: index === 0 ? 78 : 66, maxChars: 180, maxLines: 6, align: index === 4 ? "middle" : "start" }),
        shape(0.76, 0.83, 0.04 + index * 0.02, 0.025, "muted", 0.5),
        rule(0.1, 0.75, index === 4 ? 0.68 : 0.28)
      ]
    }))
  }),
  template({
    id: "quiz-question-context",
    name: "Quiz question and answers",
    description: "A non-code quiz question with four separately typeset answers and no empty code panel.",
    requiredSlots: ["question-line", "option-a", "option-b", "option-c", "option-d"],
    slides: [{
      id: "slide-quiz-question",
      backgroundToken: "background",
      variants: [],
      layers: [
        logo(),
        text("question-line", 0.08, 0.23, 0.84, 0.16, { fontToken: "headline", fontWeight: 800, minFontSize: 28, maxFontSize: 54, maxChars: 120, maxLines: 4 }),
        ...["a", "b", "c", "d"].map((letter, index) => text(`option-${letter}`, 0.1, 0.42 + index * 0.115, 0.8, 0.09, { fontWeight: 600, minFontSize: 24, maxFontSize: 42, maxChars: 100, maxLines: 3 }))
      ]
    }]
  }),
  template({
    id: "quiz-code-context",
    name: "Quiz code context",
    description: "A question, a monospaced code block at readable size, and its lettered answer options.",
    requiredSlots: ["question-line", "code-block", "options"],
    slides: [{
      id: "slide-quiz-code",
      backgroundToken: "background",
      variants: [{ id: "A" }, { id: "B", backgroundToken: "surface" }],
      layers: [
        logo(0.07),
        text("question-line", 0.08, 0.18, 0.84, 0.16, { fontToken: "headline", fontWeight: 800, minFontSize: 28, maxFontSize: 52, maxChars: 160, maxLines: 4 }),
        shape(0.08, 0.36, 0.84, 0.38, "surface-strong", 0.03),
        // The reason this template exists. Every other live layout tops out at a 100-character
        // mono slot over two lines -- a source label, not a program -- so a question carrying a
        // fenced block had nowhere to put it that kept the characters monospaced and legible.
        text("code-block", 0.11, 0.39, 0.78, 0.32, { fontToken: "mono", fontWeight: 500, minFontSize: 20, maxFontSize: 34, maxChars: 420, maxLines: 10 }),
        text("options", 0.08, 0.76, 0.84, 0.13, { colorToken: "muted", fontWeight: 600, minFontSize: 18, maxFontSize: 28, maxChars: 200, maxLines: 4 })
      ]
    }]
  }),
  template({
    id: "minimal-text-poster",
    name: "Minimal text poster",
    description: "A single short statement uses scale, empty space and one brand punctuation mark.",
    requiredSlots: ["poster-line", "poster-note"],
    slides: [{
      id: "slide-poster",
      backgroundToken: "background",
      variants: [{ id: "A" }, { id: "B", backgroundToken: "surface" }],
      layers: [
        logo(),
        shape(0.82, 0.2, 0.06, 0.06, "accent", 0.5),
        text("poster-line", 0.1, 0.34, 0.74, 0.29, { fontToken: "headline", fontWeight: 900, minFontSize: 42, maxFontSize: 90, maxChars: 100, maxLines: 4 }),
        text("poster-note", 0.1, 0.79, 0.7, 0.08, { colorToken: "muted", fontToken: "mono", minFontSize: 18, maxFontSize: 28, maxChars: 90, maxLines: 2 })
      ]
    }]
  })
] as const;

/**
 * One template per deck length the article splitter can produce.
 *
 * Generated rather than authored, and held apart from SEED_TEMPLATES for that reason: the ten
 * seed layouts are design work someone made, and counting them is a real check. These are the
 * same layout at six lengths.
 */
/**
 * Built on first use rather than at import.
 *
 * A module-level constant that parses thirty templates makes any import of this file fail with a
 * validation error and no attribution — the stack points at Array.from, not at the template that
 * is wrong. Lazy keeps the failure where the caller can see it.
 */
let articleDeckCache: readonly CarouselTemplate[] | null = null;

export function articleDeckTemplates(): readonly CarouselTemplate[] {
  // MIN_SLIDES..MAX_RESOLVABLE_SLIDES, not MIN..MAX: selection is capped at eight slides, and a
  // pack committed before that cap still names deck-spotlight-10 and has to keep resolving.
  articleDeckCache ??= DECK_STYLES.flatMap((style) =>
    Array.from(
      { length: MAX_RESOLVABLE_SLIDES - MIN_SLIDES + 1 },
      (_, index) => articleDeckTemplate(index + MIN_SLIDES, style)
    )
  );
  return articleDeckCache;
}

/** Everything a reference may resolve to. */
export function liveTemplates(): readonly CarouselTemplate[] {
  return [...SEED_TEMPLATES, ...articleDeckTemplates(), ...familyDeckTemplates()];
}

export const CAROUSEL_BRANDS: Readonly<Record<BrandTokens["id"], BrandTokens>> = {
  /**
   * DNESKAi, dressed from its brand kit (`studio/brand-kits/caught-up/`).
   *
   * These seven values are the kit manifest's `carouselPalette`, and `brand-kits.test.ts` fails if
   * they drift apart. Each comes from DNESKAi's own design system: white reading surface, paper
   * page, the subtle panel, its two text inks, blueprint blue and the Ai blue of the logotype.
   * Until the kit arrived this brand wore BoardlessAI's obsidian and magenta, which was never
   * DNESKAi's.
   *
   * The ground ladder runs white, paper, subtle panel — downward, as on the other light brands —
   * and the first two are exactly the grounds the full-colour logotype is approved for. The
   * renderer draws the logo from the kit's outlines; `logoText` names it where only text fits.
   */
  "caught-up": BrandTokensSchema.parse({
    schemaVersion: "carousel-brand/1",
    id: "caught-up",
    name: "Caught Up",
    logoText: "DNESKAi",
    kit: "caught-up",
    colors: {
      background: "#ffffff",
      surface: "#f7f7f5",
      "surface-strong": "#efefec",
      foreground: "#14161a",
      muted: "#3c4149",
      accent: "#2f5ae6",
      secondary: "#1a3ab0"
    },
    fonts: { headline: "Space Grotesk", body: "Source Serif 4", mono: "IBM Plex Mono" }
  }),
  "mma-files": BrandTokensSchema.parse({
    schemaVersion: "carousel-brand/1",
    id: "mma-files",
    name: "MMA Files",
    logoText: "MMA FILES",
    colors: {
      background: "#111113",
      surface: "#1d1d22",
      "surface-strong": "#29292f",
      foreground: "#f5f1e8",
      muted: "#d5d0c7",
      accent: "#ef6c35",
      secondary: "#f2b84b"
    },
    fonts: { headline: "Anton", body: "Archivo", mono: "IBM Plex Mono" }
  }),
  "titty-tuesdays": BrandTokensSchema.parse({
    schemaVersion: "carousel-brand/1",
    id: "titty-tuesdays",
    name: "Titty Tuesdays",
    logoText: "TITTY TUESDAYS",
    colors: {
      background: "#140b12",
      surface: "#251421",
      "surface-strong": "#382033",
      foreground: "#fff7fb",
      muted: "#f2cfde",
      accent: "#ff6fae",
      secondary: "#ffc45e"
    },
    fonts: { headline: "Petrona", body: "Karla", mono: "IBM Plex Mono" }
  }),
  /**
   * devShark, dressed from its brand kit (`studio/brand-kits/marketingshark/`).
   *
   * These seven values are the kit's `carouselPalette`, the pale ground, and `brand-kits.test.ts`
   * fails if they drift apart. They are what a Templates preview shows; a deck the renderer places
   * slide by slide stands on the kit's ink, pale and green grounds instead, each a full set of
   * these seven tokens.
   */
  devshark: BrandTokensSchema.parse({
    schemaVersion: "carousel-brand/1",
    id: "devshark",
    name: "devShark",
    logoText: "devShark",
    kit: "marketingshark",
    colors: {
      background: "#f3f6f1",
      surface: "#e3efe1",
      "surface-strong": "#d6ded3",
      foreground: "#132019",
      muted: "#3c4f43",
      accent: "#236123",
      secondary: "#132019"
    },
    fonts: { headline: "Manrope", body: "Inter", mono: "JetBrains Mono" }
  }),
  // Both colour tokens stay on one highlighter-yellow axis: `secondary` is the paler
  // alternate required by existing A/B recipes, not a second political-brand hue.
  kvorum: BrandTokensSchema.parse({
    schemaVersion: "carousel-brand/1",
    id: "kvorum",
    name: "Kvórum",
    logoText: "KVÓRUM",
    colors: {
      background: "#11110d",
      surface: "#1f1e17",
      "surface-strong": "#2d2b20",
      foreground: "#fbf8ea",
      muted: "#d8d2b6",
      accent: "#a2cc20",
      secondary: "#c1ca3a"
    },
    fonts: { headline: "Barlow Condensed", body: "IBM Plex Sans", mono: "IBM Plex Mono" }
  }),
  booksofhistory: BrandTokensSchema.parse({
    schemaVersion: "carousel-brand/1",
    id: "booksofhistory",
    name: "BOOKSOFHISTORY",
    logoText: "BOOKSOFHISTORY",
    colors: {
      // A first-edition card: cream stock, oxblood type and a restrained foil-gold mark.
      // These are ink colours rather than effects, so the deterministic renderer needs no image.
      background: "#f4ecd8",
      surface: "#eadbbd",
      "surface-strong": "#dbc396",
      foreground: "#531b20",
      muted: "#664139",
      accent: "#684d08",
      secondary: "#315146"
    },
    // Petrona is the committed OFL serif display; the mono footer reads like a colophon line.
    fonts: { headline: "Petrona", body: "Karla", mono: "IBM Plex Mono" }
  }),
  "door-money": BrandTokensSchema.parse({
    schemaVersion: "carousel-brand/1",
    id: "door-money",
    name: "Door Money",
    logoText: "DOOR MONEY",
    colors: {
      background: "#08090b",
      surface: "#141114",
      "surface-strong": "#24191c",
      foreground: "#f8f2e8",
      muted: "#cfc5b8",
      accent: "#ff4d3d",
      secondary: "#d7c5a6"
    },
    fonts: { headline: "Barlow Condensed", body: "Barlow", mono: "IBM Plex Mono" }
  }),
  /**
   * The second light brand, and the only one that has to set Cyrillic.
   *
   * Paper with ink on it, from the product's own export palette, so a card and the thing it
   * markets look like the same object.
   *
   * Inverting the ground inverts the ladder, which is the one thing worth knowing here.
   * `background`, `surface` and `surface-strong` are three grounds a family may put the same
   * text over, so on the six dark brands they run near-black *upward* and on a light one they
   * run paper *downward* — paper, a tint of it, then the rule tone. Reaching for the deep green
   * as the strong surface is the intuitive move and it is wrong: it makes the darkest ground
   * darker than the text tokens, and every family setting muted type on a panel fails at once.
   * BOOKSOFHISTORY solved this first and this follows its shape.
   *
   * Two colours are nudged from the export palette so text clears 4.5:1 against the deepest of
   * those three grounds, which is what the product's own `coral-dark` does for the same reason.
   * The coral moves furthest — `#d9684f` reaches 3.1:1 on paper, fine for a two-pixel rule and
   * not for a sentence, and families here use `accent` for both. The green is untouched at
   * 10.3:1 and carries the identity where a large field of colour is wanted.
   *
   * The fonts are the venture's two identity faces plus the one the slot structurally requires,
   * which is a deviation from the founding brief's Literata/Literata/Inter and worth recording.
   * `mono` is a monospace slot rather than a third brand face: every shared template's chip is
   * calibrated to a 600-unit advance and every other brand binds IBM Plex Mono there, so Inter
   * at 625 cannot fit the timeline's time chip. And Literata is the widest face in the set at
   * 659, which overflows `comparison`'s body slots — so it takes the headline, where its measure
   * is generous, and Inter takes the body. Both identity faces ship and both are reachable.
   */
  "tehdejsi-svet": BrandTokensSchema.parse({
    schemaVersion: "carousel-brand/1",
    id: "tehdejsi-svet",
    name: "Tehdejší svět",
    logoText: "Tehdejší svět",
    colors: {
      background: "#f7f2e8",
      surface: "#e8e1d6",
      "surface-strong": "#d5cdbf",
      foreground: "#18201d",
      muted: "#4a5b55",
      accent: "#8b4333",
      secondary: "#1e3f39"
    },
    fonts: { headline: "Literata", body: "Inter", mono: "IBM Plex Mono" }
  }),
  "webdev-signal": BrandTokensSchema.parse({
    schemaVersion: "carousel-brand/1",
    id: "webdev-signal",
    name: "WebDev Signal",
    logoText: "WEBDEV SIGNAL",
    colors: {
      // Ink and paper first: the identity is a precise editorial change record, not a terminal.
      // The mint is #5ed3a8 and not lighter because the shared deck pool composites the accent
      // over `surface` at 0.5 opacity on a mesh cover, and the foreground must still clear the
      // 4.5:1 floor against that blend — the studio checks every brand against every template.
      background: "#0b1115",
      surface: "#131c22",
      "surface-strong": "#1d2931",
      foreground: "#f2f7f5",
      muted: "#b9c8c5",
      accent: "#5ed3a8",
      secondary: "#f7c66a",
      stable: "#5ed3a8",
      preview: "#f7c66a",
      security: "#ff9a9a",
      breaking: "#d8b4fe",
      insertion: "#5ed3a8",
      removal: "#ff9a9a"
    },
    fonts: { headline: "Figtree", body: "Public Sans", mono: "IBM Plex Mono" }
  })
};

const fixtures: Record<string, Record<string, string>> = {
  "quote-card": { quote: "The strongest claim is the one the source can carry.", attribution: "AUDIT · fixture room" },
  "story-quote": { quote: "The strongest claim is the one the source can carry.", attribution: "AUDIT · fixture room" },
  "listicle-steps": { "list-title": "Four checks before a story ships", "step-one": "Name the new fact.", "step-two": "Open the primary source.", "step-three": "State the uncertainty.", "step-four": "Link the full record." },
  "stat-highlight": { stat: "10/10", "stat-label": "seed layouts passed the deterministic checks", source: "Design Lab fixture · 2026-08-02" },
  "before-after": { "before-label": "Before", before: "Three renderers produced three visual languages.", "after-label": "After", after: "One template contract serves every brand skin." },
  "headline-three-bullets": { headline: "A carousel should earn every slide", "bullet-one": "One fact per frame", "bullet-two": "Readable at phone size", "bullet-three": "A source stays close" },
  timeline: { "timeline-title": "From observation to live template", "time-one": "09:10", "event-one": "MOTIF records a cited layout pattern.", "time-two": "10:25", "event-two": "EASEL writes an original DSL proposal.", "time-three": "13:00", "event-three": "Checks pass and the version goes live." },
  comparison: { "left-title": "FREEFORM", "left-body": "A new visual spec for every post.", "right-title": "TEMPLATE", "right-body": "One checked layout with brand tokens.", "comparison-note": "The template path is cheaper to review and reproduce." },
  "cover-cta": { "cover-title": "One layout, three distinct brands", "cover-dek": "Tokens change the voice. The reading order stays dependable.", cta: "Read the sourced story", destination: "boardless-ai.vercel.app" },
  "five-slide-story": { "story-title": "Why the studio lives inside the pipeline", "story-one": "The content packet selects a live template.", "story-two": "Brand tokens skin the layout at render time.", "story-three": "The same bytes can be reproduced from saved inputs.", "story-takeaway": "No image model and no extra service are required." },
  "minimal-text-poster": { "poster-line": "DESIGN THE SYSTEM ONCE.", "poster-note": "Original layout · deterministic render" },
  "quiz-question-context": { "question-line": "When does cleanup run?", "option-a": "A. Only on mount", "option-b": "B. Before the next effect and on unmount", "option-c": "C. Only on unmount", "option-d": "D. Never" },
  "quiz-code-context": { "question-line": "What does this hook return?", "code-block": "const [value, setValue] = useState(0);\n// two elements, always in this order", options: "A. A single value\nB. An array with value and setter\nC. An object\nD. A promise" }
};

const czechFixtureOverrides: Partial<Record<string, Record<string, string>>> = {
  "quote-card": { quote: "Nejsilnější tvrzení unese zdroj, ne efektní formulace.", attribution: "AUDIT · testovací meeting" },
  "headline-three-bullets": { headline: "Carousel musí obhájit každý slide", "bullet-one": "Jeden fakt na obrazovku", "bullet-two": "Čitelné i na telefonu", "bullet-three": "Zdroj zůstává nablízku" },
  "minimal-text-poster": { "poster-line": "NEJNEOBHOSPODAŘOVÁVATELNĚJŠÍ SLOVO SE VEJDE.", "poster-note": "Česká diakritika · automatické zmenšení" },
  "quiz-question-context": { "question-line": "Kdy se spouští cleanup?", "option-a": "A. Jen při mountu", "option-b": "B. Před dalším efektem a při unmountu", "option-c": "C. Jen při unmountu", "option-d": "D. Nikdy" },
  "quiz-code-context": { "question-line": "Co vrací tenhle hook?", "code-block": "const [value, setValue] = useState(0);\n// dva prvky, vždy v tomhle pořadí", options: "A. Jednu hodnotu\nB. Pole s hodnotou a setterem\nC. Objekt\nD. Promise" }
};

export function templateByReference(templateId: string, version: string): CarouselTemplate | null {
  const eager = liveTemplates().find((template) => template.id === templateId && template.version === version);
  if (eager) return eager;
  /*
   * A recipe's non-canonical rendering, rebuilt from its own id.
   *
   * Type scale and rhythm rotation multiply out to seven hundred templates per version, which is
   * not a library — it is a lookup table nobody could read. The id carries both axes, so the
   * reference still names exactly one byte stream and the template is built when it is asked for.
   */
  if (version !== "1.0.0") return null;
  const parsed = parseRecipeTemplateId(templateId);
  if (!parsed || parsed.slideCount < MIN_SLIDES || parsed.slideCount > MAX_RESOLVABLE_SLIDES) return null;
  if (isDeckStyle(parsed.design)) return articleDeckTemplate(parsed.slideCount, parsed.design);
  return familyDeckTemplate(parsed.design, parsed.slideCount, { typeScale: parsed.typeScale, phaseSeed: parsed.phaseSeed });
}

export function liveTemplateByReference(templateId: string, version: string): CarouselTemplate {
  const template = templateByReference(templateId, version);
  if (!template) throw new Error(`Unknown carousel template ${templateId}@${version}`);
  if (template.status !== "live") throw new Error(`Carousel template ${templateId}@${version} is ${template.status}, not live`);
  return template;
}

export function fixturePayload(template: CarouselTemplate, locale: "en" | "cs" = "en", variant?: string): CarouselPayload {
  const base = fixtures[template.id];
  if (!base) throw new Error(`No fixture payload for ${template.id}`);
  return {
    locale,
    strings: { ...base, ...(locale === "cs" ? czechFixtureOverrides[template.id] : {}) },
    ...(variant ? { variant } : {})
  };
}

/**
 * Every canvas a template is composed for. `linkedin-square` is not listed: it draws on the
 * Instagram square (`carouselCanvas`), so checking it would check the same pixels twice.
 */
const ALL_FORMATS: readonly CarouselCanvas[] = CANVAS_ORDER;

/**
 * The canvases a template should be offered in.
 *
 * Called with no template this is every canvas the studio renders — what the preview route
 * accepts. Called with one it is the canvases that template is *composed for*, which is not the
 * same thing: the 9:16 story reserves roughly a seventh of the canvas at each end for the
 * platform's own chrome, and a layout designed for 4:5 places its logo and its closing line
 * squarely inside those bands.
 *
 * Two gates now, in this order. The template's own `canvas` declaration decides what it is willing
 * to be derived to — a template that declares nothing is offered its master alone — and the story
 * keeps its geometric check on top, because declaring 9:16 and composing for it are still two
 * different claims and only the second can be measured.
 *
 * That distinction is load-bearing rather than cosmetic. The lifecycle's checks run over these
 * formats and `resolveLifecycleStatus` reads the result, so offering every template the story
 * would have demoted every existing live template to draft the moment the format was added —
 * a new canvas quietly retiring the gallery is exactly the kind of break the render contract's
 * consumers are promised against.
 */
export function previewFormats(template?: CarouselTemplate): CarouselCanvas[] {
  if (!template) return [...ALL_FORMATS];
  const declared = new Set(declaredCanvases(template));
  return ALL_FORMATS.filter((format) =>
    declared.has(format) && (format !== "instagram-story" || fitsSafeArea(template, format)));
}
