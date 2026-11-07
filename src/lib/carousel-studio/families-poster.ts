import {
  BOTTOM,
  LEFT,
  MEASURE,
  RIGHT,
  TOP,
  bodyTop,
  progress,
  rule,
  shape,
  text,
  wordmark,
  type FamilySpec
} from "./family-kit.js";
import type { CarouselLayerInput } from "./schema.js";
import type { DeckFamily } from "./designs.js";

/**
 * Which strokes each digit lights, in the seven-segment order a, b, c, d, e, f, g.
 *
 * A numeral has to be *drawn*, because a text layer can only set a string the article wrote. That
 * limit is the point rather than a workaround: the moment a template can print its own characters
 * it can print a statistic nobody measured, which is exactly what the content rules forbid. Seven
 * rectangles can only ever say which slide this is.
 */
const SEGMENTS: Readonly<Record<string, readonly string[]>> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"]
};

/** One digit as rectangles, in a box of the given size, at the given stroke weight. */
function digit(value: string, x: number, y: number, width: number, height: number, weight: number): CarouselLayerInput[] {
  const frames: Readonly<Record<string, [number, number, number, number]>> = {
    a: [x, y, width, weight],
    b: [x + width - weight, y, weight, height / 2],
    c: [x + width - weight, y + height / 2, weight, height / 2],
    d: [x, y + height - weight, width, weight],
    e: [x, y + height / 2, weight, height / 2],
    f: [x, y, weight, height / 2],
    g: [x, y + height / 2 - weight / 2, width, weight]
  };
  return (SEGMENTS[value] ?? []).map((segment) => {
    const [left, top, wide, tall] = frames[segment]!;
    return shape(left, top, wide, tall, { fillToken: "accent" });
  });
}

/** The deck position, two digits wide, so the sequence reads 01 … 10 rather than 1 … 10. */
function numeral(position: number, x: number, y: number, width: number, height: number, weight: number): CarouselLayerInput[] {
  return [...String(Math.min(99, position)).padStart(2, "0")].flatMap((character, place) =>
    digit(character, x + place * (width + width * 0.1), y, width, height, weight));
}

/**
 * Type as the whole image.
 *
 * The families here draw on the one finding every 2026 typography survey agreed on — that
 * typography-led minimalism is what a feed rewards, and that the hierarchy is the decoration.
 * They differ from each other in *which* typographic axis carries the composition: scale
 * (`billboard`), the grid and the void around it (`zurich`).
 *
 * A face is never named. `fontToken` resolves through the brand, so a family that expressed a
 * trend by asking for a condensed grotesque would be a family that only works for two of the five
 * ventures. What is portable is scale, weight, case, tracking and where the block sits.
 */

export const POSTER_FAMILIES: Readonly<Record<Extract<DeckFamily, "billboard" | "zurich" | "tally" | "counterweight">, FamilySpec>> = {
  /*
   * Scale is the composition, and nothing else is.
   *
   * No band, no panel, no inversion — the three moves `slab` makes. The cover is one line given
   * the whole safe band and a 200 px ceiling, set at 900 with the tracking pulled in, so a short
   * hook is set enormous and a long one steps down to fill the same block. The only other marks
   * are one heavy rule and the wordmark in mono, tucked in the corner the way a poster credits
   * its printer.
   */
  billboard: {
    description: "Poster type at the size the words allow: one block filling the band, one rule, nothing else.",
    compose: ({ slot, role, beat, phase }) => {
      if (role === "cover") {
        return [
          text(slot, LEFT, TOP + 0.015, MEASURE, 0.5, {
            fontWeight: 900,
            maxFontSize: 200,
            minFontSize: 36,
            maxChars: 120,
            maxLines: 5,
            uppercase: true,
            tracking: -0.03
          }),
          rule(LEFT, BOTTOM - 0.077, MEASURE, { thickness: 16 }),
          wordmark("muted", "mono"),
          progress(phase)
        ];
      }
      if (role === "outro") {
        return [
          rule(LEFT, TOP + 0.01, MEASURE, { thickness: 16 }),
          text(slot, LEFT, TOP + 0.075, MEASURE, 0.46, {
            fontWeight: 900,
            maxFontSize: 150,
            minFontSize: 32,
            maxChars: 140,
            maxLines: 5,
            uppercase: true,
            tracking: -0.03
          }),
          wordmark("accent", "mono"),
          progress(phase)
        ];
      }
      return [
        // The rule is the poster's top edge and the only thing that moves: it lengthens with the
        // beat while the ceiling comes down, so a reader swiping sees the block breathe rather
        // than the same slab with new words.
        rule(LEFT, TOP + 0.01, 0.1 + beat.step * 0.14, { thickness: 16 }),
        text(slot, LEFT, bodyTop(0.16 + beat.step * 0.05), MEASURE, 0.44, {
          fontWeight: 900,
          maxFontSize: 132 - beat.step * 18,
          minFontSize: 30,
          maxChars: 210,
          maxLines: 6,
          tracking: -0.02
        }),
        wordmark("muted", "mono"),
        progress(phase)
      ];
    }
  },

  /*
   * The grid, and the void it leaves.
   *
   * Twelve columns across the measure, flush left, ragged right, and two of those columns kept
   * empty on the right at every beat — the emptiness is the composition, not what is left over
   * from it. The type block steps in one column at a time and the divider under it starts where
   * the type starts, so the alignment states the grid instead of a drawn one. One accent block,
   * on a column, moving against the type. That is the whole ornament.
   *
   * Distinct from `terrace`, which fills the frame with three stepping bands: here the empty
   * columns do as much work as the full ones, and the family is at its best when the passage is
   * short enough to leave them empty.
   */
  zurich: {
    description: "A twelve-column grid worked flush left, where what is left empty does as much as what is set.",
    compose: ({ slot, role, beat, phase }) => {
      const column = MEASURE / 12;
      const indent = role === "body" ? beat.step * 2 * column : 0;
      const divider = 0.7;
      const top = role === "cover" ? TOP + 0.07 : bodyTop(0.14 + beat.step * 0.06);
      return [
        // The one ornament, on a column, walking against the type block.
        shape(LEFT + (role === "body" ? 10 - beat.step : 10) * column, TOP, column, 0.05 + beat.step * 0.014, {
          fillToken: "accent"
        }),
        text(slot, LEFT + indent, top, MEASURE - indent - (role === "outro" ? 0 : column), divider - top - 0.03, {
          fontWeight: role === "cover" ? 800 : 700,
          maxFontSize: role === "cover" ? 92 : 62,
          minFontSize: role === "cover" ? 30 : 26,
          maxChars: role === "cover" ? 150 : 200,
          maxLines: role === "cover" ? 6 : 8
        }),
        rule(LEFT + indent, divider, MEASURE - indent, {
          thickness: role === "outro" ? 10 : 4,
          colorToken: role === "outro" ? "accent" : "muted"
        }),
        wordmark(),
        progress(phase)
      ];
    }
  },

  /*
   * One number, and it is the only number this family is allowed to know.
   *
   * The trend is a slide anchored by an oversized numeral, and the honest version of it is the
   * one `figure` already worked out: a deck payload carries the article's sentences and no
   * figures, so the number is the reader's position through the deck or the family invents one.
   * Here it is drawn at 175 px from seven rectangles per digit and hung beside the passage like a
   * printed index, which is where the family parts company with `figure` — that one draws a row of
   * blocks, this one draws a numeral.
   */
  tally: {
    description: "An oversized index numeral hung beside the passage, drawn from segments and counting nothing but the deck.",
    compose: ({ slot, role, index, slideCount, beat, phase }) => {
      if (role === "body") {
        const top = bodyTop(0.14 + beat.step * 0.05);
        return [
          ...numeral(index + 1, LEFT, top, 0.09, 0.13, 0.021),
          text(slot, LEFT + 0.24, top, RIGHT - LEFT - 0.24, BOTTOM - 0.1 - top, {
            maxFontSize: 58,
            minFontSize: 26,
            maxChars: 210,
            maxLines: 8
          }),
          rule(LEFT, BOTTOM - 0.075, 0.14 + beat.step * 0.06, { thickness: 6, colorToken: "muted" }),
          wordmark(),
          progress(phase)
        ];
      }
      // The cover opens on 01 and the closing slide lands on the deck's own length, both at
      // twice the size — the count stated, then completed.
      return [
        ...numeral(role === "cover" ? 1 : slideCount, LEFT, TOP + 0.01, 0.16, 0.26, 0.038),
        text(slot, LEFT, 0.46, MEASURE, BOTTOM - 0.1 - 0.46, {
          fontWeight: 800,
          maxFontSize: role === "cover" ? 82 : 70,
          minFontSize: 30,
          maxChars: 150,
          maxLines: 5
        }),
        rule(LEFT, BOTTOM - 0.075, role === "outro" ? MEASURE : 0.3, { thickness: 6, colorToken: "muted" }),
        wordmark(role === "outro" ? "accent" : "muted"),
        progress(phase)
      ];
    }
  },

  /*
   * Weight against weight, at one size.
   *
   * The trend is the variable-font lockup: ultra-bold set against light, the sizes near equal, the
   * weight doing all the work. One slot holds one string and one text layer sets it at one weight,
   * so the lockup cannot happen inside a passage — it happens across the deck. Heavy beat, light
   * beat, heavy beat, at the same ceiling, so what changes as a reader swipes is the weight and
   * nothing else.
   *
   * The mass in the corner is the counterweight and it trades with the type: a 900 passage gets a
   * small block, a 400 passage gets a wide one, so every slide balances at the same total. The
   * word-rule cutting into the block moves with the beat, which is the only other thing on the
   * slide that moves.
   */
  counterweight: {
    description: "Ultra-bold against light at one size, with a block in the corner that trades weight with the type.",
    compose: ({ slot, role, beat, phase }) => {
      const heavy = role === "cover" || (role === "body" && beat.step !== 1);
      const top = role === "cover" ? TOP + 0.085 : bodyTop(0.15 + beat.step * 0.05);
      return [
        shape(RIGHT - (heavy ? 0.07 : 0.28), TOP + 0.01, heavy ? 0.07 : 0.28, heavy ? 0.03 : 0.058, {
          fillToken: "accent"
        }),
        rule(LEFT + (role === "body" ? beat.step * 0.2 : 0), top - 0.034, 0.1, { thickness: 9 }),
        text(slot, LEFT, top, MEASURE, BOTTOM - 0.1 - top, {
          fontToken: heavy ? "headline" : "body",
          fontWeight: heavy ? 900 : 400,
          // Tracking is the second half of the contrast. On MMA Files the headline face has one
          // real weight and the body face starts at 600, so weight alone separates the beats less
          // there than anywhere else; tight against open separates them in every palette.
          tracking: heavy ? -0.015 : 0.02,
          maxFontSize: role === "cover" ? 76 : 58,
          minFontSize: 26,
          maxChars: role === "cover" ? 160 : 220,
          maxLines: role === "cover" ? 6 : 8
        }),
        rule(LEFT, BOTTOM - 0.075, MEASURE, { thickness: 2, colorToken: "muted" }),
        wordmark(role === "outro" ? "accent" : "muted"),
        progress(phase)
      ];
    }
  }
};
