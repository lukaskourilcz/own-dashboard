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

/**
 * The heights the line crosses each slide boundary at.
 *
 * Four values, walked by deck position: slide N leaves the frame at the height slide N+1 enters
 * it, so the line is continuous across the swipe rather than restarted on each slide. That is the
 * whole mechanic — a seamless carousel is one element that does not stop at the edge — and it is
 * why these come off the index and not off the rhythm, which rotates.
 */
const CROSSINGS = [0.3, 0.42, 0.36, 0.48] as const;

/** The line's dip: constant, so the descent to the passage reads as a dip and not as drift. */
const DIP = 0.62;

/** A vertical connector between two heights of the line. */
const connector = (x: number, from: number, to: number): CarouselLayerInput =>
  shape(x, Math.min(from, to), 0.005, Math.max(0.006, Math.abs(to - from)), { fillToken: "accent" });
import type { DeckFamily } from "./designs.js";

/**
 * A bracket, drawn as three rectangles.
 *
 * There is no rotation and no path primitive in `carousel-template/1`, and neither should be added
 * for an ornament. A stem and two arms is what a bracket is, and at 46 px tall it reads as one at
 * thumbnail size, which is the size a kicker is read at or not at all.
 */
const bracket = (x: number, y: number, facing: "left" | "right"): CarouselLayerInput[] => {
  const stem = facing === "left" ? x : x + 0.017;
  return [
    shape(stem, y, 0.005, 0.034, { fillToken: "accent" }),
    shape(x, y, 0.022, 0.005, { fillToken: "accent" }),
    shape(x, y + 0.029, 0.022, 0.005, { fillToken: "accent" })
  ];
};

/**
 * Structure as the message.
 *
 * Where the poster families let scale carry a slide and the print families borrow a page's
 * furniture, these build the slide out of blocks, rows and continuity — the composition is a
 * system the reader can see working, and the type sits inside it.
 *
 * All of them are type-only. That is not a shortfall: most editions arrive without a photograph,
 * and a family that cannot compose without one narrows the pool exactly when the pool is needed.
 */

export const SYSTEM_FAMILIES: Readonly<Record<Extract<DeckFamily, "concrete" | "terminal" | "versus" | "throughline" | "quiet">, FamilySpec>> = {
  /*
   * Neo-brutalism with the volume down.
   *
   * A panel with a hard stroke and zero radius, and a token-coloured duplicate of it sitting a few
   * thousandths behind — the offset-block shadow the style is built on, drawn as an actual second
   * rectangle because there is no shadow primitive and there should not be one. The side the block
   * falls to flips with the beat, so the friction moves as the reader swipes rather than sitting
   * in one corner for ten slides.
   *
   * The stroke is doing structural work, not decorative. Several palettes put their three grounds
   * close in luminance, so a panel that relied on its fill to be seen would disappear on those
   * ventures; an edge remains legible on every current skin.
   *
   * Distinct from `pull`, whose panel is soft-cornered, hugs its text and centres it, and from
   * `memo`, whose sheet is a hairline around reading-weight body type.
   */
  concrete: {
    description: "A hard-edged panel with its own block sitting behind it, and the block changes corners on the beat.",
    compose: ({ slot, role, beat, phase }) => {
      const drop = beat.side === "left" ? 0.012 : -0.012;
      const panelTop = role === "cover" ? TOP + 0.05 : bodyTop(0.095 + beat.step * 0.045) - 0.035;
      const panelHeight = BOTTOM - 0.085 - panelTop;
      // The closing slide inverts the lockup: the block the deck has been casting becomes the
      // panel, and the panel becomes its shadow.
      const closing = role === "outro";
      return [
        // Both rectangles hug the text. The declared frame stays the maximum — it is what the
        // contrast check measured the words against — and the drawn card is the fitted passage
        // plus its padding, so a short slide is a card and not a panel two-thirds empty.
        shape(LEFT + drop, panelTop + 0.012, MEASURE, panelHeight, {
          fillToken: closing ? "surface" : "accent",
          padText: slot,
          padding: 0.045
        }),
        shape(LEFT, panelTop, MEASURE, panelHeight, {
          fillToken: closing ? "accent" : "surface",
          strokeToken: closing ? "background" : "foreground",
          strokeWidth: 6,
          padText: slot,
          padding: 0.045
        }),
        text(slot, LEFT + 0.03, panelTop + 0.035, MEASURE - 0.06, panelHeight - 0.07, {
          colorToken: closing ? "background" : "foreground",
          fontWeight: 900,
          maxFontSize: role === "cover" ? 84 : 60,
          minFontSize: role === "cover" ? 30 : 26,
          maxChars: role === "cover" ? 140 : 230,
          maxLines: role === "cover" ? 5 : 8,
          uppercase: role === "cover"
        }),
        wordmark("muted", "mono"),
        progress(phase)
      ];
    }
  },

  /*
   * Rows, brackets and a cursor.
   *
   * Mono everywhere — the one face all nine brand skins share — so the family reads as the same
   * instrument in every palette and the colour carries the identity. The header is a bracketed
   * field spanning the measure with the venture's mark set inside it, which is what a bracket
   * means in this register: a field with something in it. A block cursor opens every passage and
   * walks down the frame with the beat, and the footer rule is dashed and grows as the deck runs.
   *
   * Distinct from `dossier`, which is body-font quiet under two hairlines, and from `memo`, which
   * is prose on a sheet. Terminal has no prose posture at all: it has rows.
   */
  terminal: {
    description: "Mono from end to end: a bracketed header field, a block cursor opening each passage, dashed rules.",
    compose: ({ slot, role, beat, phase }) => {
      const top = role === "cover" ? TOP + 0.09 : bodyTop(0.17 + beat.step * 0.045);
      return [
        ...bracket(LEFT, TOP, "left"),
        ...bracket(RIGHT - 0.022, TOP, "right"),
        {
          type: "logo",
          x: LEFT + 0.034,
          y: TOP + 0.006,
          width: 0.3,
          height: 0.022,
          colorToken: role === "outro" ? "accent" : "muted",
          fontToken: "mono"
        },
        rule(LEFT, TOP + 0.052, MEASURE, { thickness: 3, dash: true, colorToken: "muted" }),
        shape(LEFT, top + 0.006, 0.017, 0.026, { fillToken: "accent" }),
        text(slot, LEFT + 0.028, top, RIGHT - LEFT - 0.028, BOTTOM - 0.1 - top, {
          fontToken: "mono",
          fontWeight: role === "cover" ? 700 : 400,
          maxFontSize: role === "cover" ? 64 : 46,
          minFontSize: 24,
          maxChars: role === "cover" ? 140 : 230,
          maxLines: role === "cover" ? 6 : 9
        }),
        rule(LEFT, BOTTOM - 0.075, role === "outro" ? MEASURE : 0.2 + beat.step * 0.16, {
          thickness: 3,
          dash: true,
          colorToken: role === "outro" ? "accent" : "muted"
        }),
        progress(phase)
      ];
    }
  },

  /*
   * Two fields, and the contrast is legible before a word is read.
   *
   * The canvas is cut in two at a hard seam and both halves are filled — one loud, one quiet — so
   * the split is a composition rather than a panel floating on a ground. Which half is loud flips
   * with the beat and the seam itself walks, so swiping the deck flips the whole frame: words on
   * colour, then words on quiet, then words on colour.
   *
   * The passage always sits in the upper field. That is not timidity about the lower one — it is
   * TOKENS.md's rule that a body passage starts between 0.14 and 0.26 of the safe height in, which
   * a passage anchored below a mid-canvas seam cannot do. What alternates is the ground under the
   * words, which is the whole of what "versus" was ever about.
   *
   * Distinct from `gutter`, which splits vertically around a photograph, and from `slab`, which
   * inverts a whole slide and lays a band over it.
   */
  versus: {
    description: "The canvas cut in two at a hard seam, with the loud half and the quiet one trading places on the beat.",
    compose: ({ slot, role, beat, phase }) => {
      const loud = role === "cover" || (role === "body" && beat.step !== 1);
      const split = role === "cover" ? 0.62 : role === "outro" ? 0.52 : 0.56 + beat.step * 0.04;
      const top = role === "cover" ? TOP + 0.06 : role === "outro" ? TOP + 0.07 : bodyTop(0.14 + beat.step * 0.05);
      return [
        shape(0, 0, 1, split, { fillToken: loud ? "accent" : "surface" }),
        shape(0, split, 1, 1 - split, { fillToken: loud ? "surface" : "accent" }),
        // The seam, drawn in the ground colour so the two fields read as cut apart rather than
        // stacked. A rule is not measured by the contrast check, so it can be the one mark on the
        // slide that is neither ink nor field.
        rule(0, split - 0.005, 1, { thickness: 10, colorToken: "background" }),
        text(slot, LEFT, top, MEASURE, split - top - 0.04, {
          colorToken: loud ? "background" : "foreground",
          fontWeight: role === "cover" ? 800 : 700,
          maxFontSize: role === "cover" ? 82 : 58,
          minFontSize: 26,
          maxChars: role === "cover" ? 150 : 220,
          maxLines: role === "cover" ? 5 : 7
        }),
        // Both sit in the lower field, so both take their colour from whatever it is filled with.
        wordmark(loud ? "muted" : "background"),
        progress(phase, loud ? "muted" : "background")
      ];
    }
  },

  /*
   * One line, and it does not stop at the edge of the slide.
   *
   * It enters at the left at the height the slide before it left off, drops to run under the
   * passage, and rises to leave at the height the next slide will enter on. The cover starts it
   * from a block and the closing slide ends it in one, so the deck has a beginning and an end
   * rather than ten slides that each happen to have a rule.
   *
   * Horizontal continuity, which is what separates it from `tower`: that one climbs a chapter bar
   * up the left edge and the bar is a progress mark, whereas this line is a path. Nothing else is
   * on the slide, because a path with furniture around it is not a path.
   */
  throughline: {
    description: "A single line that enters, dips under the passage and leaves at the height the next slide begins on.",
    compose: ({ slot, role, index, beat, phase }) => {
      const enters = CROSSINGS[index % CROSSINGS.length]!;
      const leaves = CROSSINGS[(index + 1) % CROSSINGS.length]!;
      const top = role === "cover" ? TOP + 0.05 : bodyTop(0.14 + beat.step * 0.05);
      const words = text(slot, LEFT, top, MEASURE, DIP - top - 0.05, {
        fontWeight: role === "cover" ? 800 : 700,
        maxFontSize: role === "cover" ? 84 : 58,
        minFontSize: 26,
        maxChars: role === "cover" ? 150 : 210,
        maxLines: role === "cover" ? 5 : 7
      });
      if (role === "cover") {
        return [
          shape(LEFT, DIP - 0.012, 0.028, 0.03, { fillToken: "accent" }),
          rule(LEFT + 0.028, DIP, 0.86 - LEFT - 0.028, { thickness: 9 }),
          connector(0.86, DIP, leaves),
          rule(0.86, leaves, 0.14, { thickness: 9 }),
          words,
          wordmark(),
          progress(phase)
        ];
      }
      if (role === "outro") {
        return [
          rule(0, enters, 0.14, { thickness: 9 }),
          connector(0.14, enters, DIP),
          rule(0.14, DIP, RIGHT - 0.14, { thickness: 9 }),
          shape(RIGHT, DIP - 0.012, 0.03, 0.03, { fillToken: "accent" }),
          words,
          wordmark("accent"),
          progress(phase)
        ];
      }
      return [
        rule(0, enters, 0.14, { thickness: 9 }),
        connector(0.14, enters, DIP),
        rule(0.14, DIP, 0.72, { thickness: 9 }),
        connector(0.86, DIP, leaves),
        rule(0.86, leaves, 0.14, { thickness: 9 }),
        words,
        wordmark(),
        progress(phase)
      ];
    }
  },

  /*
   * The discipline is what reads as expensive.
   *
   * Pared-back searches were up 54% in Canva's 2026 report and the finding underneath it is that
   * restraint is legible: a reader can tell the difference between a slide with room and a slide
   * with nothing to say. So this family gets one text block, a short measure, a mark the width of
   * a fingernail, and a footer set small in mono. It is the only family in the library with no
   * progress mark — everything else carries one, and carrying one here would be the eleventh
   * element on a slide that is arguing for three.
   *
   * The block breathes rather than sits: it steps in and down together as the beat runs, so the
   * void changes shape across the deck without anything being added to it.
   *
   * Distinct from `dossier` and `memo`, which are quiet families with furniture — hairlines across
   * the measure, a sheet, a letterhead. This one has none.
   */
  quiet: {
    description: "One short block of type in a great deal of room, a mark the width of a fingernail, nothing else.",
    compose: ({ slot, role, beat }) => {
      const indent = role === "body" ? beat.step * 0.09 : 0;
      const top = role === "cover" ? TOP + 0.1 : bodyTop(0.16 + beat.step * 0.05);
      return [
        rule(LEFT + indent, top - 0.038, role === "outro" ? 0.12 : 0.045, { thickness: 4 }),
        text(slot, LEFT + indent, top, role === "cover" ? 0.62 : 0.52, BOTTOM - 0.09 - top, {
          fontToken: "body",
          fontWeight: 400,
          maxFontSize: role === "cover" ? 60 : 46,
          minFontSize: 22,
          maxChars: role === "cover" ? 160 : 190,
          maxLines: role === "cover" ? 6 : 7
        }),
        wordmark(role === "outro" ? "accent" : "muted", "mono")
      ];
    }
  }
};
