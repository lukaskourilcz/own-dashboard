import {
  BOTTOM,
  LEFT,
  MEASURE,
  TOP,
  bodyTop,
  drawnIndex,
  hero,
  hookMark,
  pagerDots,
  rule,
  shape,
  text,
  wordmark,
  type Composer,
  type Context,
  type FamilySpec
} from "./family-kit.js";
import { MASTER_RATIO } from "./canvas.js";
import type { CarouselLayerInput } from "./schema.js";
import type { DeckFamily } from "./designs.js";

/**
 * The launch collection: the five compositions the rotation deals from.
 *
 * Built from the 2026-08-29 viral-carousel research rather than from taste alone. Every study the
 * research walked agreed on the same anatomy — a cover that stops the scroll with one oversized
 * promise, one idea per slide behind it, a visible signal that there is more to swipe, and a
 * closing slide that asks for exactly one thing — and the founding families carried almost none
 * of it: no pager, no drawn position, no depth, a third of every canvas dead. These five encode
 * that anatomy as composition, one archetype each: the statement poster (`apex`), the numbered
 * list (`rail`), the photo cover story (`vista`), the split argument (`fault`) and the spotlight
 * (`halo`).
 *
 * They also spend the primitives the founding set never touched. A crisp mesh blob is a disc, a
 * two-stop gradient with equal offsets is a hard diagonal, `clip: "circle"` is a porthole, `glow`
 * holds a headline over art, `padText` wraps the closing ask in a card. None of that costs the
 * renderer anything new.
 *
 * The one rule that shapes everything here: a slide has exactly one string. Hierarchy inside a
 * slide is therefore drawn — numerals, discs, seams, rings — never written, which is also what
 * keeps a template unable to say anything the article did not.
 */

/** Ghost fills that survive the B variant's ground inversion: one step off whatever is painted. */
function ghostOn(ground: Context["ground"]): string {
  return ground === "surface" ? "surface-strong" : "surface";
}

/**
 * The brand mark set at the head of the slide, with a square accent tick it cannot lose.
 *
 * Muted by default — quiet chrome on a quiet ground. A slide that paints a mesh takes it in
 * `foreground` instead, because the check charges every blob against every logo at the blob's own
 * opacity over the ground, and on the light brand that composite drops muted ink below 4.5:1.
 */
function crest(colorToken = "muted", fontToken: "headline" | "mono" = "mono"): CarouselLayerInput[] {
  return [
    shape(LEFT, TOP + 0.004, 0.012, 0.012 * MASTER_RATIO, { fillToken: "accent", radius: 0.5 }),
    { type: "logo", x: LEFT + 0.026, y: TOP, width: 0.32, height: 0.022, colorToken, fontToken }
  ];
}

/** The closing ask as a card: an accent panel hugging the text, ink in the ground's own colour. */
function ctaCard(slot: string, y: number, height: number): CarouselLayerInput[] {
  return [
    shape(LEFT, y - 0.02, MEASURE, height + 0.04, { fillToken: "accent", radius: 0.035, padText: slot, padding: 0.045 }),
    text(slot, LEFT + 0.045, y, MEASURE - 0.09, height, {
      colorToken: "background",
      fontWeight: 800,
      minFontSize: 30,
      maxFontSize: 92,
      maxLines: 6
    })
  ];
}

/*
 * `apex` — the statement poster.
 *
 * The archetype every hook study opens with: one oversized promise on a ground with depth. The
 * cover's depth is a two-blob mesh in the venture's own accents; an article that brought a
 * photograph gets it as a scrimmed, mono-treated band above the fold instead. Body slides pair
 * the single statement with a ghost numeral set larger than the type, so position reads before
 * words do.
 */
const apex: Composer = ({ slot, index, slideCount, role, beat, ground }) => {
  if (role === "cover") {
    return [
      { type: "mesh", x: 0, y: 0, width: 1, height: 1, softness: 0.2, blobs: [
        { colorToken: "accent", cx: 1.08, cy: 0.06, radius: 0.62, opacity: 0.3 },
        { colorToken: "secondary", cx: -0.1, cy: 1.02, radius: 0.72, opacity: 0.22 }
      ] },
      // Full scrim, not bottom: the crest sits on this band, and a light photograph swallowed it.
      hero(0, 0, 1, 0.4, { treatment: "mono", scrim: "full" }),
      ...crest("foreground"),
      text(slot, LEFT, 0.42, MEASURE, 0.36, {
        fontWeight: 900,
        minFontSize: 40,
        maxFontSize: 168,
        maxChars: 140,
        maxLines: 5,
        uppercase: true,
        tracking: -0.02,
        glow: true
      }),
      rule(LEFT, 0.8, 0.2, { thickness: 14 }),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  if (role === "outro") {
    return [
      { type: "mesh", x: 0, y: 0, width: 1, height: 1, softness: 0.24, blobs: [
        { colorToken: "secondary", cx: 1.05, cy: -0.08, radius: 0.5, opacity: 0.24 },
        { colorToken: "accent", cx: -0.02, cy: 1.05, radius: 0.42, opacity: 0.2 }
      ] },
      ...crest("foreground"),
      ...ctaCard(slot, 0.34, 0.4),
      // Foreground for the same reason as the crest: the mesh is charged against every logo.
      wordmark("foreground", "mono"),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  return [
    ...drawnIndex(index + 1, 0.62, TOP, 0.15, 0.26, 0.038, beat.step === 2 ? "accent" : ghostOn(ground)),
    rule(LEFT, bodyTop(0.15) - 0.03, 0.09, { thickness: 10 }),
    text(slot, LEFT, bodyTop(0.16 + beat.step * 0.03), 0.72, 0.5, {
      fontWeight: 800,
      minFontSize: 34,
      maxFontSize: 104 - beat.step * 10,
      maxChars: 220,
      maxLines: 7
    }),
    ...pagerDots(index, slideCount, ground)
  ];
};

/*
 * `rail` — the numbered list.
 *
 * The educational spine, which is the highest-saving archetype in every study the research read.
 * The spine is literal: an accent rail on the left edge with one notch per slide, filled as far
 * as the reader has come, so the deck's own furniture answers "how much is left" without a
 * character of text. Each body slide is one numbered point. The spine is also this family's
 * pager — a dot row underneath said the same thing twice, and at ten slides the two rows
 * together broke the 24-layer cap.
 */
const rail: Composer = ({ slot, index, slideCount, role, beat, ground }) => {
  const spineNotches = Array.from({ length: slideCount }, (_, notch) =>
    shape(0.021, 0.2 + notch * 0.052, 0.018, 0.018 * MASTER_RATIO, {
      fillToken: notch <= index ? "accent" : ghostOn(ground),
      radius: 0.5
    }));
  const spine = [shape(0.026, 0, 0.008, 1, { fillToken: role === "outro" ? "accent" : ghostOn(ground) }), ...spineNotches];
  if (role === "cover") {
    return [
      ...spine,
      ...crest(),
      text(slot, LEFT + 0.02, 0.26, MEASURE - 0.02, 0.36, {
        fontWeight: 900,
        minFontSize: 40,
        maxFontSize: 148,
        maxChars: 140,
        maxLines: 5
      }),
      // Three foreshortened dashes: the promise of a list, drawn rather than claimed.
      rule(LEFT + 0.02, 0.7, 0.3, { thickness: 10, colorToken: "accent" }),
      rule(LEFT + 0.02, 0.74, 0.22, { thickness: 8, colorToken: "muted", dash: true })
    ];
  }
  if (role === "outro") {
    return [...spine, ...crest(), ...ctaCard(slot, 0.32, 0.42), wordmark("accent", "mono")];
  }
  if (role === "hook") {
    // The list's first point, set as an opening rather than as item one: the entry mark instead
    // of the numeral, the frame starting where the cover's headline does, and a ceiling between
    // the cover's and the body's. Same column, same floor, so the reading measure never moves.
    return [
      ...spine,
      ...hookMark(LEFT + 0.02, TOP + 0.02, ground),
      text(slot, LEFT + 0.06, bodyTop(0.14), MEASURE - 0.1, 0.44, {
        fontWeight: 700,
        minFontSize: 32,
        maxFontSize: 112,
        maxChars: 220,
        maxLines: 7
      })
    ];
  }
  return [
    ...spine,
    ...drawnIndex(index + 1, LEFT + 0.02, TOP, 0.062, 0.115, 0.017, "accent"),
    // Right under the numeral and clear of the text frame below — at 0.145 it struck the first
    // line's ascenders on the slides that carry no panel.
    rule(LEFT + 0.02, TOP + 0.128, 0.12, { thickness: 6 }),
    ...(beat.step === 1
      ? []
      : [shape(LEFT + 0.02, bodyTop(0.2) - 0.028, MEASURE - 0.02, 0.44, {
          fillToken: "surface",
          radius: 0.028,
          padText: slot,
          padding: 0.04
        })]),
    text(slot, LEFT + 0.06, bodyTop(0.22), MEASURE - 0.1, 0.4, {
      fontWeight: 700,
      minFontSize: 32,
      maxFontSize: 88,
      maxChars: 220,
      maxLines: 7
    })
  ];
};

/*
 * `vista` — the photo cover story.
 *
 * The magazine archetype, for the article that won a photograph: the picture is the slide and the
 * type stands on it. The photograph recurs through the deck — full-bleed and scrimmed on the
 * cover, mono and captioned mid-deck, portholed beside the closing ask — which is the seamless
 * thread the research kept finding in decks that hold a swipe. Without a photograph every image
 * layer skips and the family still stands as a dark editorial set.
 */
const vista: Composer = ({ slot, index, slideCount, role, beat, ground }) => {
  if (role === "cover") {
    return [
      // Full scrim, not bottom: the crest at the head of the frame needs the top protected too.
      hero(0, 0, 1, 1, { scrim: "full" }),
      ...crest(),
      rule(LEFT, 0.5, 0.16, { thickness: 12 }),
      text(slot, LEFT, 0.54, MEASURE, 0.28, {
        fontWeight: 900,
        minFontSize: 36,
        maxFontSize: 150,
        maxChars: 120,
        maxLines: 5,
        glow: true
      }),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  if (role === "outro") {
    return [
      shape(0.62, 0.16, 0.26, 0.26 * MASTER_RATIO, { fillToken: ghostOn(ground), radius: 0.5, strokeToken: "accent", strokeWidth: 5 }),
      hero(0.63, 0.168, 0.24, 0.24 * MASTER_RATIO, { clip: "circle", reprise: true, treatment: "mono", scrim: "none" }),
      ...crest(),
      ...ctaCard(slot, 0.44, 0.34),
      wordmark("accent", "mono"),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  if (beat.step === 0) {
    return [
      hero(0, 0, 1, 1, { treatment: "duotone", scrim: "full" }),
      text(slot, LEFT, 0.3, MEASURE, 0.34, {
        align: "middle",
        fontWeight: 900,
        minFontSize: 30,
        maxFontSize: 110,
        maxChars: 230,
        maxLines: 8,
        uppercase: true,
        glow: true
      }),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  if (beat.step === 1) {
    return [
      shape(0.5, 0.17, 0.4, 0.4 * MASTER_RATIO, { fillToken: ghostOn(ground), radius: 0.5, strokeToken: "accent", strokeWidth: 5 }),
      hero(0.512, 0.178, 0.376, 0.376 * MASTER_RATIO, { clip: "circle", treatment: "mono", scrim: "none" }),
      ...crest(),
      text(slot, LEFT, bodyTop(0.24), 0.4, 0.46, {
        fontWeight: 700,
        minFontSize: 26,
        maxFontSize: 72,
        maxChars: 150,
        maxLines: 9
      }),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  return [
    ...drawnIndex(index + 1, 0.72, TOP, 0.09, 0.16, 0.024, "accent"),
    text(slot, LEFT, bodyTop(0.2), MEASURE, 0.44, {
      fontWeight: 800,
      minFontSize: 34,
      maxFontSize: 96,
      maxChars: 220,
      maxLines: 7
    }),
    ...pagerDots(index, slideCount, ground)
  ];
};

/*
 * `fault` — the split argument.
 *
 * The versus archetype — myth against fact, before against after — as geometry: a hard diagonal
 * seam between two grounds, cut by a gradient whose two stops share an offset. The seam flips
 * side with the beat, so swiping the deck zigzags, and a single accent pivot dot walks the seam
 * with the deck's phase — the one continuous element the whole swipe follows.
 */
const fault: Composer = ({ slot, index, slideCount, role, beat, ground, phase }) => {
  const seam = (angle: number, offset: number): CarouselLayerInput => ({
    type: "linear-gradient",
    x: 0, y: 0, width: 1, height: 1,
    angle,
    stops: [
      { colorToken: "surface-strong", offset },
      { colorToken: "background", offset }
    ]
  });
  const pivot = shape(0.14 + phase * 0.66, 0.7 - phase * 0.42, 0.026, 0.026 * MASTER_RATIO, { fillToken: "accent", radius: 0.5 });
  if (role === "cover") {
    return [
      seam(206, 0.42),
      ...crest(),
      text(slot, LEFT, 0.2, 0.8, 0.34, {
        fontWeight: 900,
        minFontSize: 40,
        maxFontSize: 156,
        maxChars: 140,
        maxLines: 5,
        uppercase: true,
        tracking: -0.02,
        glow: true
      }),
      pivot,
      rule(LEFT, 0.79, 0.14, { thickness: 12 }),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  if (role === "outro") {
    return [seam(180, 0.46), ...crest(), ...ctaCard(slot, 0.48, 0.24), pivot, wordmark("muted", "mono"), ...pagerDots(index, slideCount, ground)];
  }
  if (role === "hook") {
    // A level seam rather than a diagonal: the zigzag is the body's rhythm and a re-served reader
    // has no previous slide to zigzag from. The mark takes the numeral's place at the head of the
    // column and the type ceiling rises toward the cover's.
    return [
      seam(180, 0.5),
      ...hookMark(LEFT, TOP + 0.02, ground),
      text(slot, LEFT, bodyTop(0.16), 0.66, 0.42, {
        fontWeight: 800,
        minFontSize: 32,
        maxFontSize: 116,
        maxChars: 220,
        maxLines: 7
      }),
      pivot,
      ...pagerDots(index, slideCount, ground)
    ];
  }
  const leftward = beat.side === "left";
  return [
    seam(leftward ? 206 : 154, 0.5),
    ...drawnIndex(index + 1, leftward ? 0.79 : LEFT, leftward ? 0.63 : TOP, 0.075, 0.13, 0.019, "muted"),
    text(slot, LEFT, leftward ? bodyTop(0.14) : 0.47, 0.66, 0.34, {
      fontWeight: 800,
      minFontSize: 32,
      maxFontSize: 92,
      maxChars: 220,
      maxLines: 7
    }),
    pivot,
    ...pagerDots(index, slideCount, ground)
  ];
};

/*
 * `halo` — the spotlight.
 *
 * The quote-card archetype without a quote glyph: one solid accent disc that moves around the
 * canvas as the deck advances, plus a thin ring that frames whatever matters on the slide. Discs
 * are shapes rather than crisp mesh blobs deliberately: the contrast check charges a mesh blob
 * against every text layer on the slide, while a shape is charged only against text it contains —
 * which is exactly the geometry a tangent disc respects. An article with a photograph gets it portholed inside the ring;
 * the closing ask sits ringed like a seal.
 */
const halo: Composer = ({ slot, index, slideCount, role, beat, ground }) => {
  const disc = (x: number, y: number, size: number, fillToken = "accent"): CarouselLayerInput =>
    shape(x, y, size, size * MASTER_RATIO, { fillToken, radius: 0.5 });
  const ring = (x: number, y: number, size: number): CarouselLayerInput =>
    shape(x, y, size, size * MASTER_RATIO, { fillToken: ghostOn(ground), radius: 0.5, strokeToken: "accent", strokeWidth: 4 });
  if (role === "cover") {
    return [
      disc(0.7, 0.755, 0.3),
      disc(0.63, 0.71, 0.06, "secondary"),
      ring(0.045, 0.05, 0.19),
      ...crest(),
      text(slot, LEFT, 0.26, 0.78, 0.4, {
        fontWeight: 900,
        minFontSize: 40,
        maxFontSize: 150,
        maxChars: 140,
        maxLines: 5
      }),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  if (role === "outro") {
    return [
      ring(0.17, 0.2, 0.66),
      disc(0.045, 0.05, 0.11),
      ...crest(),
      ...ctaCard(slot, 0.42, 0.3),
      wordmark("accent", "mono"),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  // The text keeps the left column to itself; every seat lives right of x 0.7, so the ring can
  // porthole a photograph without ever standing on a word. Movement is vertical: the ring slides
  // mid, top, low as the steps cycle, and the disc counter-moves.
  const seat = [
    { discX: 0.8, discY: 0.72, size: 0.16, ringX: 0.7, ringY: 0.32, ringSize: 0.28 },
    { discX: 0.72, discY: 0.7, size: 0.2, ringX: 0.72, ringY: 0.06, ringSize: 0.24 },
    { discX: 0.78, discY: 0.08, size: 0.14, ringX: 0.7, ringY: 0.56, ringSize: 0.3 }
  ][beat.step]!;
  if (role === "hook") {
    // The seat still moves with the beat, so the spotlight keeps travelling; what changes is the
    // head of the column — the entry mark rather than a position — and a taller frame with the
    // ceiling raised toward the cover's.
    return [
      disc(seat.discX, seat.discY, seat.size),
      ring(seat.ringX, seat.ringY, seat.ringSize),
      hero(seat.ringX + 0.012, seat.ringY + 0.008, seat.ringSize - 0.024, (seat.ringSize - 0.024) * MASTER_RATIO, { clip: "circle", treatment: "mono", scrim: "none" }),
      ...hookMark(LEFT, TOP + 0.02, ground),
      text(slot, LEFT, bodyTop(0.14), 0.6, 0.46, {
        fontWeight: 800,
        minFontSize: 28,
        maxFontSize: 116,
        maxChars: 200,
        maxLines: 9
      }),
      ...pagerDots(index, slideCount, ground)
    ];
  }
  return [
    disc(seat.discX, seat.discY, seat.size),
    ring(seat.ringX, seat.ringY, seat.ringSize),
    hero(seat.ringX + 0.012, seat.ringY + 0.008, seat.ringSize - 0.024, (seat.ringSize - 0.024) * MASTER_RATIO, { clip: "circle", treatment: "mono", scrim: "none" }),
    ...drawnIndex(index + 1, LEFT, TOP, 0.055, 0.1, 0.015, "accent"),
    text(slot, LEFT, bodyTop(0.22), 0.6, 0.42, {
      fontWeight: 800,
      minFontSize: 28,
      maxFontSize: 92,
      maxChars: 200,
      maxLines: 9
    }),
    ...pagerDots(index, slideCount, ground)
  ];
};

export const LAUNCH_FAMILY_SPECS: Readonly<Record<Extract<DeckFamily, "apex" | "rail" | "vista" | "fault" | "halo">, FamilySpec>> = {
  apex: { description: "Statement poster: one oversized promise on mesh depth, ghost numerals pacing the body.", compose: apex },
  rail: { description: "Numbered list on a literal spine: an accent rail whose notches fill as the reader advances.", compose: rail },
  vista: { description: "Photo cover story: the photograph full-bleed, mono and portholed as the deck's one thread.", compose: vista },
  fault: { description: "Split argument: a hard diagonal seam between two grounds that flips side with every beat.", compose: fault },
  halo: { description: "Spotlight: a solid accent disc and a thin ring that move around the canvas as the deck advances.", compose: halo }
};
