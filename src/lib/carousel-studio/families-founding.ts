import {
  BOTTOM,
  LEFT,
  MEASURE,
  RIGHT,
  TOP,
  hero,
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
 * The ten families of the founding delivery, from `docs/design-lab/SPEC.md`.
 *
 * Five of them are the photo-forward set and are the only families in the library that take a
 * photograph, which is why they stayed together when the 2026-08-10 expansion split the composers
 * into modules: what they share is a posture toward the article's hero, not a trend.
 *
 * They are also the reason the expansion had a bar to clear. The five deck *styles* they replaced
 * were one design in five coats — `mesh`, `aurora` and `spotlight` are the same blurred-radial-blob
 * primitive — and nothing in the suite compared two designs, so five wallpapers and an A/B pair
 * that shared one byte stream both passed every gate they had.
 */

export const FOUNDING_FAMILIES: Readonly<Record<Extract<DeckFamily,
  "masthead" | "gutter" | "bevel" | "porthole" | "slab" | "terrace" | "figure" | "pull" | "tower" | "dossier"
>, FamilySpec>> = {
  /*
   * A front page. The photograph runs full-bleed to a hard accent rule and the headline sits in
   * the type block beneath it, never on the picture — which is also why the wordmark is legible
   * on every article rather than on the ones that happen to have a dark hero.
   */
  masthead: {
    description: "A front page: the photograph runs full-bleed to a hard rule, and the words live beneath it.",
    compose: ({ slot, role, beat, phase }) => {
      if (role === "cover") {
        return [
          hero(0, 0, 1, 0.46),
          rule(0, 0.46, 1, { height: 0.008, thickness: 12 }),
          text(slot, LEFT, 0.52, MEASURE, 0.24, { fontWeight: 800, maxFontSize: 84, minFontSize: 36, maxChars: 150, maxLines: 5 }),
          wordmark(),
          progress(phase)
        ];
      }
      if (role === "outro") {
        return [
          // The same photograph, small, on the way out: one slot used twice, which is what the
          // reprise flag and the slot-counting image cap exist for.
          hero(0, 0, 1, 0.14, { reprise: true, scrim: "full" }),
          rule(LEFT, 0.24, 0.2, { thickness: 12 }),
          text(slot, LEFT, 0.3, MEASURE, 0.32, { fontWeight: 800, maxFontSize: 66, minFontSize: 30, maxChars: 160, maxLines: 5 }),
          wordmark("accent"),
          progress(phase)
        ];
      }
      return [
        rule(LEFT, TOP + 0.02, beat.side === "left" ? 0.18 : 0.4, { thickness: beat.step === 1 ? 12 : 8 }),
        text(slot, LEFT, TOP + 0.09, MEASURE, 0.44, { maxFontSize: 62, minFontSize: 28, maxChars: 240, maxLines: 7 }),
        wordmark(),
        progress(phase)
      ];
    }
  },

  /*
   * A hard vertical split that changes sides as the reader swipes. The column is the constant and
   * the side is the beat, so a thumb moving through the deck sees the frame flip rather than the
   * same frame with new words.
   */
  gutter: {
    description: "A hard vertical split whose column changes sides as the reader swipes.",
    compose: ({ slot, role, beat, phase }) => {
      const columnWidth = 0.3 + beat.step * 0.02;
      const onLeft = role === "cover" ? true : beat.side === "left";
      const columnX = onLeft ? 0 : 1 - columnWidth;
      // The type takes whichever side the column does not, from the column's edge to the safe
      // margin on the far side. Measuring it from the wrong edge is how a 0.55 measure becomes a
      // 0.32 one and every slide reports that its own character limit cannot fit.
      const textX = onLeft ? columnWidth + 0.04 : LEFT;
      const textWidth = (onLeft ? RIGHT : 1 - columnWidth - 0.04) - textX;
      if (role === "cover") {
        return [
          hero(columnX, 0, columnWidth, 1, { scrim: "none" }),
          shape(columnWidth, 0, 1 - columnWidth, 1, { fillToken: "background" }),
          rule(textX, TOP, 0.12, { thickness: 10 }),
          text(slot, textX, TOP + 0.04, textWidth, 0.4, { fontWeight: 800, maxFontSize: 72, minFontSize: 30, maxChars: 150, maxLines: 6 }),
          wordmark(),
          progress(phase)
        ];
      }
      return [
        shape(columnX, 0, columnWidth, 1, { fillToken: role === "outro" ? "accent" : "surface-strong" }),
        text(slot, textX, TOP + 0.05, textWidth, 0.42, {
          maxFontSize: role === "outro" ? 58 : 54,
          minFontSize: 26,
          maxChars: 210,
          maxLines: 8
        }),
        rule(textX, TOP, 0.1, { thickness: 8 }),
        wordmark(),
        progress(phase)
      ];
    }
  },

  /*
   * The photograph is cut on a slope, and the slope keeps cutting. Both gradient stops sit at one
   * offset, which is how a hard diagonal is drawn without a bitmap; the angle flips with the beat.
   */
  bevel: {
    description: "The photograph is cut on a slope, and the same slope keeps cutting the frame.",
    compose: ({ slot, role, beat, phase }) => {
      const angle = beat.side === "left" ? 168 : 12;
      const cut = 0.74 + beat.step * 0.08;
      if (role === "cover") {
        return [
          hero(0, 0, 1, 0.52, { clip: [[0, 0], [1, 0], [1, cut], [0, 1]] }),
          text(slot, LEFT, 0.56, MEASURE, 0.22, { fontWeight: 800, maxFontSize: 78, minFontSize: 34, maxChars: 150, maxLines: 5 }),
          rule(LEFT, 0.8, 0.14, { thickness: 10 }),
          wordmark(),
          progress(phase)
        ];
      }
      return [
        {
          type: "linear-gradient",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          angle,
          stops: [{ colorToken: "surface-strong", offset: 0.42 }, { colorToken: "background", offset: 0.42 }]
        },
        rule(LEFT, role === "outro" ? TOP : TOP + 0.3, role === "outro" ? 0.24 : 0.1, { thickness: 8 }),
        text(slot, LEFT, role === "outro" ? TOP + 0.05 : TOP + 0.37, MEASURE, role === "outro" ? 0.3 : 0.32, {
          maxFontSize: role === "outro" ? 60 : 56,
          minFontSize: 28,
          maxChars: 200,
          maxLines: 7
        }),
        wordmark(),
        progress(phase)
      ];
    }
  },

  /*
   * One circular window on the cover, and the same window travelling the deck as an empty accent
   * ring. Nothing else in the set is round, which is most of why it reads as its own family.
   */
  porthole: {
    description: "A circular window on the cover, and the same window travelling the deck as an empty ring.",
    compose: ({ slot, role, beat, phase }) => {
      const walk = [0.12, 0.42, 0.72][beat.step] ?? 0.42;
      if (role === "cover") {
        return [
          shape(0.2, 0.1, 0.6, 0.42, { fillToken: "surface", radius: 0.5 }),
          hero(0.22, 0.11, 0.56, 0.4, { clip: "circle", scrim: "none" }),
          text(slot, LEFT, 0.56, MEASURE, 0.22, { fontWeight: 800, maxFontSize: 70, minFontSize: 32, maxChars: 150, maxLines: 5, align: "middle" }),
          rule(0.42, 0.8, 0.16, { thickness: 8 }),
          wordmark(),
          progress(phase)
        ];
      }
      return [
        shape(walk, 0.06, 0.16, 0.11, { fillToken: "surface-strong", radius: 0.5, strokeToken: "accent", strokeWidth: 6 }),
        text(slot, LEFT, TOP + 0.08, MEASURE, 0.42, {
          maxFontSize: role === "outro" ? 60 : 54,
          minFontSize: 26,
          maxChars: 210,
          maxLines: 8,
          align: role === "outro" ? "middle" : "start"
        }),
        rule(LEFT, TOP + 0.02, role === "outro" ? 0.3 : 0.12, { thickness: 8 }),
        wordmark(),
        progress(phase)
      ];
    }
  },

  /*
   * A type poster. No photograph, and the inverted beat inverts the whole slide rather than a
   * panel — which is the honest way to invert while the contrast check reads grounds one layer at
   * a time.
   */
  slab: {
    description: "A type poster: the words at poster scale, and the whole slide inverts on the beat.",
    compose: ({ slot, role, beat, phase }) => [
      shape(0, 0, 1, beat.step === 2 ? 0.5 : 0.16, { fillToken: beat.step === 2 ? "surface" : "accent" }),
      text(slot, LEFT, TOP + 0.06, MEASURE, role === "cover" ? 0.42 : 0.46, {
        fontWeight: role === "cover" ? 900 : 800,
        maxFontSize: role === "cover" ? 96 : 72,
        minFontSize: 30,
        maxChars: role === "cover" ? 130 : 220,
        maxLines: 7,
        uppercase: role === "cover"
      }),
      rule(LEFT, BOTTOM - 0.09, role === "outro" ? 0.5 : 0.16, { thickness: 12 }),
      wordmark(role === "outro" ? "accent" : "muted"),
      progress(phase)
    ]
  },

  /*
   * Three offset bands step across the frame and the type sits in the space they leave. No
   * photograph: the composition is the picture.
   */
  terrace: {
    description: "Three offset bands step across the frame and the words sit in the space they leave.",
    compose: ({ slot, role, beat, phase }) => {
      const drift = beat.step * 0.06;
      return [
        shape(0, 0.02 + drift, 0.46 + drift, 0.1, { fillToken: "surface" }),
        shape(0.3 - drift, 0.86, 0.7, 0.14, { fillToken: "surface-strong" }),
        shape(RIGHT - 0.05, 0.2, 0.05 + drift * 0.3, 0.44, { fillToken: "accent" }),
        text(slot, LEFT, TOP + 0.03, MEASURE - 0.08, 0.48, {
          fontWeight: role === "cover" ? 800 : 700,
          maxFontSize: role === "cover" ? 76 : 58,
          minFontSize: 26,
          maxChars: 220,
          maxLines: 8
        }),
        rule(LEFT, BOTTOM - 0.11, role === "outro" ? 0.4 : 0.12, { thickness: 8, dash: role === "body" && beat.step === 1 }),
        wordmark(),
        progress(phase)
      ];
    }
  },

  /*
   * The count is the picture.
   *
   * The specification's Figure family fills its cover with one number, and says in its own words
   * that the slot takes an honest figure from the article or the family is not used. A deck payload
   * carries the article's sentences and no figures, so rather than invent one this family counts
   * the only number it actually has: how far through the deck the reader is, drawn as a stack of
   * blocks on the cover and a chip row afterwards. No fabricated statistic, and the family keeps
   * its thesis — a quantity is the image.
   */
  figure: {
    description: "A quantity is the image: the reader's position through the deck, drawn rather than written.",
    compose: ({ slot, role, index, slideCount, beat, phase }) => {
      const blocks = Math.max(1, Math.min(slideCount, index + 1));
      const bar = (position: number): CarouselLayerInput =>
        shape(LEFT + position * 0.075, role === "cover" ? 0.16 : 0.06, 0.05, role === "cover" ? 0.22 : 0.05, {
          fillToken: position < blocks ? "accent" : "surface-strong",
          radius: role === "cover" ? 0.06 : 0.5
        });
      return [
        ...Array.from({ length: Math.min(slideCount, 10) }, (_, position) => bar(position)),
        text(slot, LEFT, role === "cover" ? 0.44 : TOP + 0.05, MEASURE, role === "cover" ? 0.34 : 0.46, {
          fontWeight: role === "cover" ? 900 : 700,
          maxFontSize: role === "cover" ? 80 : 60,
          minFontSize: 28,
          maxChars: role === "cover" ? 150 : 220,
          maxLines: 8
        }),
        rule(LEFT, BOTTOM - 0.1, role === "outro" ? 0.44 : 0.1 + beat.step * 0.04, { thickness: 8 }),
        wordmark(),
        progress(phase)
      ];
    }
  },

  /*
   * Something a named person said, set at the size it was said with. The accent bar and the
   * centred panel trade places on the beat, so the argument alternates between spoken and written.
   * The panel hugs its text rather than standing at a fixed height over a short line.
   */
  pull: {
    description: "A line set at the size it was said with, between an accent bar and a panel that hugs it.",
    compose: ({ slot, role, beat, phase }) => {
      if (role === "cover") {
        return [
          shape(LEFT, 0.06, 0.2, 0.16, { fillToken: "surface", radius: 0.5 }),
          hero(LEFT + 0.01, 0.07, 0.18, 0.14, { clip: "circle", scrim: "none" }),
          text(slot, LEFT, 0.28, MEASURE, 0.4, { fontWeight: 800, maxFontSize: 88, minFontSize: 32, maxChars: 160, maxLines: 6 }),
          rule(LEFT, BOTTOM - 0.09, 0.18, { thickness: 12 }),
          wordmark(),
          progress(phase)
        ];
      }
      const panelled = beat.step === 1 || role === "outro";
      return [
        ...(panelled
          ? [shape(LEFT - 0.02, TOP, MEASURE + 0.04, 0.5, { fillToken: "surface", radius: 0.03, padText: slot, padding: 0.035 })]
          : [shape(LEFT, TOP, 0.014, 0.42, { fillToken: "accent" })]),
        text(slot, panelled ? LEFT + 0.02 : LEFT + 0.05, TOP + 0.025, MEASURE - (panelled ? 0.04 : 0.05), 0.42, {
          maxFontSize: 62,
          minFontSize: 26,
          maxChars: 200,
          maxLines: 7,
          align: panelled ? "middle" : "start"
        }),
        rule(LEFT, BOTTOM - 0.09, role === "outro" ? 0.36 : 0.1, { thickness: 8 }),
        wordmark(),
        progress(phase)
      ];
    }
  },

  /*
   * Built for 9:16. A chapter bar climbs the left edge as the deck runs and the type sits in a
   * tall column beside it, so the composition uses the height the story canvas actually has
   * instead of floating a 4:5 layout in the middle of it.
   */
  tower: {
    description: "A chapter bar climbing the left edge, with the words in a tall column beside it.",
    compose: ({ slot, role, phase }) => [
      shape(0, 0, 0.045, 1, { fillToken: "surface-strong" }),
      shape(0, 0, 0.045, Math.max(0.08, phase * 0.98), { fillToken: "accent" }),
      ...(role === "cover" ? [hero(0.045, 0, 0.955, 0.36)] : []),
      text(slot, 0.11, role === "cover" ? 0.44 : TOP + 0.02, RIGHT - 0.11, role === "cover" ? 0.34 : 0.5, {
        fontWeight: role === "cover" ? 800 : 700,
        maxFontSize: role === "cover" ? 74 : 58,
        minFontSize: 26,
        maxChars: 230,
        maxLines: 9
      }),
      rule(0.11, BOTTOM - 0.1, role === "outro" ? 0.4 : 0.1, { thickness: 8 }),
      {
        type: "logo",
        x: 0.11,
        y: BOTTOM - 0.03,
        width: 0.3,
        height: 0.028,
        colorToken: role === "outro" ? "accent" : "muted",
        fontToken: "headline"
      },
      progress(phase)
    ]
  },

  /*
   * A record, not a poster. Hairlines instead of bars, a dashed rule on the middle beat, type at
   * reading rather than shouting size — the family for a piece that is a note in a file.
   */
  dossier: {
    description: "A record rather than a poster: hairlines, reading-size type and a dashed middle beat.",
    compose: ({ slot, role, beat, phase }) => [
      rule(LEFT, TOP, MEASURE, { thickness: 2, colorToken: "muted", dash: beat.step === 1 && role === "body" }),
      rule(LEFT, BOTTOM - 0.055, MEASURE, { thickness: 2, colorToken: "muted" }),
      shape(LEFT, TOP, 0.08, 0.006, { fillToken: "accent" }),
      text(slot, LEFT, TOP + 0.04, MEASURE, 0.44, {
        fontToken: role === "cover" ? "headline" : "body",
        fontWeight: role === "cover" ? 700 : 400,
        maxFontSize: role === "cover" ? 60 : 44,
        minFontSize: 24,
        maxChars: 240,
        maxLines: 9
      }),
      rule(LEFT, BOTTOM - 0.12, role === "outro" ? 0.28 : 0.06, { thickness: 6 }),
      wordmark(role === "outro" ? "accent" : "muted"),
      progress(phase)
    ]
  }
};
