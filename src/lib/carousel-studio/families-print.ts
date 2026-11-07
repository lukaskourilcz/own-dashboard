import {
  BOTTOM,
  LEFT,
  MEASURE,
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
 * Print grammar, and the hand over the top of it.
 *
 * The 2026 surveys read editorial furniture — mastheads, datelines, rules, folios, marginal marks
 * — as the signal an AI-era audience takes for authorship: somebody laid this out. These families
 * borrow that grammar rather than the look of any one publication.
 *
 * The furniture is real furniture and never invented text. A dateline is the venture's own
 * wordmark set small in mono; a folio is the progress mark; a hanging index is a bar in the
 * margin. Every string on a slide comes from the article, because a template that could print its
 * own numerals is a template that can print a statistic nobody wrote.
 */

/** The running head: the venture's mark, set small and in mono, where a page prints its title. */
const dateline = (y: number, colorToken = "muted"): CarouselLayerInput => ({
  type: "logo",
  x: LEFT,
  y,
  width: 0.32,
  height: 0.025,
  colorToken,
  fontToken: "mono"
});

export const PRINT_FAMILIES: Readonly<Record<Extract<DeckFamily, "broadsheet" | "marginalia" | "memo" | "offset">, FamilySpec>> = {
  /*
   * The inside page, not the front one.
   *
   * `masthead` is a front page and needs a photograph to be one; `dossier` is a bare record with
   * two hairlines. Broadsheet is the page between them — all furniture and no picture: a rule pair
   * under a running head, a measured column that never reaches the right margin, and an index bar
   * hanging in the gutter beside it. What walks with the beat is the column's own measure, which
   * is how a printed page varies from spread to spread without changing its grid.
   */
  broadsheet: {
    description: "An inside page: running head, rule pair, a measured column and an index hanging in its margin.",
    compose: ({ slot, role, beat, phase }) => {
      if (role === "cover") {
        return [
          rule(LEFT, TOP, MEASURE, { thickness: 3, colorToken: "muted" }),
          rule(LEFT, TOP + 0.014, MEASURE, { thickness: 12 }),
          dateline(TOP + 0.032),
          text(slot, LEFT, TOP + 0.085, MEASURE, 0.4, {
            fontWeight: 800,
            maxFontSize: 96,
            minFontSize: 32,
            maxChars: 150,
            maxLines: 5
          }),
          rule(LEFT, BOTTOM - 0.055, MEASURE, { thickness: 2, colorToken: "muted" }),
          progress(phase)
        ];
      }
      // The column narrows and widens on the beat; the index bar in the gutter grows with it.
      const column = 0.6 + beat.step * 0.045;
      return [
        rule(LEFT, TOP, MEASURE, { thickness: 2, colorToken: "muted" }),
        dateline(TOP + 0.016, role === "outro" ? "accent" : "muted"),
        shape(LEFT, TOP + 0.055, 0.01, role === "outro" ? 0.1 : 0.05 + beat.step * 0.022, { fillToken: "accent" }),
        text(slot, LEFT + 0.042, bodyTop(0.15 + beat.step * 0.05), role === "outro" ? MEASURE - 0.042 : column, 0.4, {
          fontToken: "body",
          fontWeight: 400,
          maxFontSize: role === "outro" ? 56 : 48,
          minFontSize: 24,
          maxChars: 230,
          maxLines: 9
        }),
        rule(LEFT, BOTTOM - 0.055, MEASURE, { thickness: role === "outro" ? 8 : 2, colorToken: role === "outro" ? "accent" : "muted" }),
        progress(phase)
      ];
    }
  },

  /*
   * A marker over clean type, and a hand in the margin.
   *
   * The mechanic already exists: a `shape` with `padText` hugs a text slot, so the highlight is
   * the fitted passage plus its padding rather than a band standing over a short line. Marked
   * beats set the passage in the ground colour on an accent swipe; the beat between them takes the
   * marker away and leaves a dashed stroke leading into the passage instead. Highlight, note,
   * highlight — a reader swiping sees somebody working through the piece.
   *
   * Every stroke is fixed per beat. "Imperfect by design" is a look, not a licence: a random
   * offset would make the same deck render differently on a replay, and byte-identical replay is
   * what the receipt beside a delivery is worth anything for.
   */
  marginalia: {
    description: "Clean type with a marker over it: a highlight that hugs the passage, and a hand working the margin.",
    compose: ({ slot, role, beat, phase }) => {
      // The cover is always marked — the swipe over the title is the hook — and the closing slide
      // never is, so the deck opens loud and lands quiet.
      const marked = role === "cover" || (role === "body" && beat.step !== 1);
      const top = role === "cover" ? TOP + 0.075 : bodyTop(0.16 + beat.step * 0.05);
      const height = BOTTOM - 0.105 - top;
      return [
        // The margin tick, walking down the gutter with the beat. Graphite rather than marker:
        // beside an accent swipe an accent tick reads as part of the block, and the point of the
        // mark is that a second hand made it.
        shape(LEFT - 0.046, top + 0.01 + beat.step * 0.05, 0.018, 0.04, { fillToken: "muted" }),
        ...(marked
          ? [shape(LEFT - 0.02, top - 0.028, MEASURE + 0.03, height + 0.056, {
              fillToken: "accent",
              padText: slot,
              padding: 0.04
            })]
          : [rule(LEFT, top - 0.03, 0.1 + beat.step * 0.06, { thickness: 7, dash: true })]),
        text(slot, LEFT, top, MEASURE, height, {
          colorToken: marked ? "background" : "foreground",
          fontWeight: role === "cover" ? 800 : 700,
          maxFontSize: role === "cover" ? 78 : 56,
          minFontSize: 26,
          maxChars: role === "cover" ? 150 : 230,
          maxLines: role === "cover" ? 5 : 8
        }),
        wordmark(role === "outro" ? "accent" : "muted"),
        progress(phase)
      ];
    }
  },

  /*
   * A note somebody typed.
   *
   * The notes-app aesthetic without the notes app: fake interface chrome is banned outright, and a
   * drawn status bar would be a lie about where the words came from. What survives the ban is what
   * the trend was actually reaching for — radical plainness. Body face at reading weight, a
   * measure short enough to leave a ragged right, a mono letterhead, and one accent mark at the
   * foot where a footnote would be.
   *
   * The sheet is defined by its edge rather than its fill. Three palettes put `surface` within 3%
   * of `background`, and the A/B inversion swaps the ground under it, so a sheet trusting its fill
   * to be seen would appear on some renderings and vanish on others; a hairline is legible on all
   * of them.
   *
   * Distinct from `dossier`, which is a filed record — hairlines across the full measure, no sheet
   * at all — and from `concrete`, whose card is a 900-weight lockup behind a thick stroke.
   */
  memo: {
    description: "A typed note on a bordered sheet: reading-weight body type, a short ragged measure, a mono letterhead.",
    compose: ({ slot, role, beat, phase }) => {
      const top = role === "cover" ? TOP + 0.09 : bodyTop(0.15 + beat.step * 0.05);
      // The measure is short on purpose and moves a little, the way a typed page does when it is
      // typed rather than set.
      const measure = 0.56 + beat.step * 0.04;
      return [
        shape(LEFT - 0.025, TOP - 0.02, MEASURE + 0.05, 0.635, {
          fillToken: "surface",
          strokeToken: role === "outro" ? "accent" : "muted",
          strokeWidth: 2
        }),
        dateline(TOP + 0.005, role === "outro" ? "accent" : "muted"),
        rule(LEFT, TOP + 0.042, 0.09 + beat.step * 0.03, { thickness: 2, colorToken: "muted" }),
        text(slot, LEFT, top, role === "cover" ? MEASURE - 0.06 : measure, 0.72 - top, {
          fontToken: "body",
          fontWeight: 400,
          maxFontSize: role === "cover" ? 64 : 44,
          minFontSize: 24,
          maxChars: role === "cover" ? 160 : 230,
          maxLines: role === "cover" ? 6 : 9
        }),
        // The foot of the page: a footnote mark and the rule beside it. Without them the sheet's
        // lower half reads as a passage that stopped rather than as page left deliberately empty.
        shape(LEFT, 0.735, 0.016, 0.014, { fillToken: "accent" }),
        rule(LEFT + 0.03, 0.7405, 0.1 + beat.step * 0.04, { thickness: 2, colorToken: "muted" }),
        progress(phase)
      ];
    }
  },

  /*
   * A plate a hair out of true.
   *
   * Misregistration is the imperfection the 2026 reports keep naming, and it is one of the few
   * that can be built honestly here: the slot is set twice, once in the accent and once in the
   * foreground over it, with the accent pass moved a few thousandths. The schema allows two text
   * layers naming one slot — `requiredSlots` is checked as a set — and both are measured by the
   * overflow check and both by the contrast check, so the echo is a rendering the engine knows
   * about rather than a trick played on it.
   *
   * Both passes carry identical metrics. The fitter chooses a size from the frame and the string,
   * so a wider echo frame would fit at a different size and the two plates would not be the same
   * words at the same scale — they would be two settings, which is a mistake and not a
   * misregistration.
   *
   * The offset is inset from the safe band rather than hanging over it. A text layer outside the
   * band fails the safe-area check at 9:16, and an echo is meaningful content: it is the same
   * sentence.
   */
  offset: {
    description: "The passage printed twice, the accent plate a few thousandths out of true under the foreground one.",
    compose: ({ slot, role, beat, phase }) => {
      // Inset far enough that the widest shift still lands inside the union safe band.
      const inset = 0.01;
      const left = LEFT + inset;
      const measure = MEASURE - 2 * inset;
      const slip = (beat.side === "left" ? 1 : -1) * (role === "cover" ? 0.009 : 0.005 + beat.step * 0.002);
      const drop = role === "cover" ? 0.006 : 0.003 + beat.step * 0.001;
      const top = role === "cover" ? TOP + 0.06 : bodyTop(0.15 + beat.step * 0.05);
      const height = BOTTOM - 0.095 - top;
      const metrics = {
        fontWeight: role === "cover" ? 900 : 800,
        maxFontSize: role === "cover" ? 96 : 60,
        minFontSize: 26,
        maxChars: role === "cover" ? 150 : 210,
        maxLines: role === "cover" ? 5 : 7,
        uppercase: role === "cover"
      } as const;
      return [
        text(slot, left + slip, top + drop, measure, height, { ...metrics, colorToken: "accent" }),
        text(slot, left, top, measure, height, { ...metrics, colorToken: "foreground" }),
        // The rule is printed twice as well, on the same two plates and by the same slip.
        rule(left + slip, BOTTOM - 0.075 + drop, role === "outro" ? measure : 0.16 + beat.step * 0.08, { thickness: 9 }),
        rule(left, BOTTOM - 0.075, role === "outro" ? measure : 0.16 + beat.step * 0.08, {
          thickness: 9,
          colorToken: "muted"
        }),
        wordmark(),
        progress(phase)
      ];
    }
  }
};
