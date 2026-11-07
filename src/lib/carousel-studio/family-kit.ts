import type { CarouselLayerInput } from "./schema.js";
import { MASTER_RATIO } from "./canvas.js";
import { ARTICLE_HERO_SLOT } from "./library.js";

/**
 * The primitives every template family is built from.
 *
 * Extracted when the library grew past ten families and `families.ts` past the 400-line cap
 * (`docs/ENGINEERING.md` rule 8). The composers moved into sibling modules; the safe band, the
 * rhythm and the layer constructors could not move with any one of them, because they are the
 * shared vocabulary that makes two families comparable. A leaf module on purpose — it imports the
 * schema and the hero slot name and nothing else, so no family module can import another through
 * it.
 */

/** The union of all four safe areas: the story's, which is the widest. */
export const TOP = 0.145;
export const BOTTOM = 0.835;
export const LEFT = 0.075;
export const RIGHT = 0.925;
export const MEASURE = RIGHT - LEFT;

/** The height a composition actually has to work in, once every canvas has taken its margin. */
export const SAFE_HEIGHT = BOTTOM - TOP;

/**
 * Where a body passage's frame starts, as a fraction of the safe height.
 *
 * `docs/design-lab/TOKENS.md` calls this the most load-bearing rule in the set, and the reason is
 * mechanical rather than aesthetic: the engine top-anchors text and has no vertical centring, so a
 * 24-character passage in a frame sized for 240 leaves the bottom two-thirds empty. Starting the
 * frame between 0.14 and 0.26 in puts a short passage near the optical centre and still lets a
 * long one grow down into space that exists.
 */
export function bodyTop(fraction: number): number {
  return TOP + SAFE_HEIGHT * Math.min(0.26, Math.max(0.14, fraction));
}

/**
 * What a slide is for, which is not the same as where it sits.
 *
 * `hook` is slide two, and it is a role rather than a body beat because the platform makes it one:
 * Instagram re-serves a carousel to a reader who did not finish it and opens on a slide they have
 * not seen, so the second slide is a second cover for anyone who came back. A slide composed as
 * the third beat of a rhythm reads as the middle of an argument when it is served as the start of
 * one. The hook therefore carries the cover's type ceiling and an entry mark instead of the body's
 * position numeral — it says "this is where you are", not "this is the second of seven".
 */
export type Role = "cover" | "hook" | "body" | "outro";

export interface Beat {
  /** The ground this beat paints. Adjacent beats differ, which is what makes a rhythm. */
  ground: "background" | "surface" | "surface-strong";
  /** Which side of the frame the beat leans to, for families that alternate sides. */
  side: "left" | "right";
  /** 0, 1 or 2: the step within the family's own three-step pattern. */
  step: number;
}

export const RHYTHM: readonly Beat[] = [
  { ground: "background", side: "left", step: 0 },
  { ground: "surface", side: "right", step: 1 },
  { ground: "surface-strong", side: "left", step: 2 },
  { ground: "surface", side: "right", step: 1 }
];

export interface Context {
  slot: string;
  index: number;
  slideCount: number;
  role: Role;
  beat: Beat;
  /**
   * The token this slide's ground actually paints, which is not always the beat's.
   *
   * The cover is forced to `background` and the closing slide to `surface`, so a composer that
   * reads `beat.ground` to decide what colour a panel has to be in order to be *seen* gets the
   * wrong answer on two slides in five. Resolved once, where the slide is built.
   */
  ground: "background" | "surface" | "surface-strong";
  /** 0 on the cover, 1 on the closing slide, walking evenly between. */
  phase: number;
}

export type Composer = (context: Context) => CarouselLayerInput[];

export interface FamilySpec {
  description: string;
  compose: Composer;
}

export const text = (
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
  fontToken: "headline",
  fontWeight: 700,
  minFontSize: 28,
  maxFontSize: 60,
  maxChars: 240,
  maxLines: 8,
  align: "start",
  uppercase: false,
  ...options
});

export const rule = (
  x: number,
  y: number,
  width: number,
  options: Partial<Extract<CarouselLayerInput, { type: "rule" }>> = {}
): CarouselLayerInput => ({
  type: "rule",
  x,
  y,
  width,
  height: 0.005,
  colorToken: "accent",
  thickness: 8,
  ...options
});

export const shape = (
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<Extract<CarouselLayerInput, { type: "shape" }>> = {}
): CarouselLayerInput => ({
  type: "shape",
  x,
  y,
  width,
  height,
  fillToken: "surface",
  strokeWidth: 0,
  radius: 0,
  ...options
});

export const hero = (
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<Extract<CarouselLayerInput, { type: "image" }>> = {}
): CarouselLayerInput => ({
  type: "image",
  slot: ARTICLE_HERO_SLOT,
  optional: true,
  fit: "cover",
  scrim: "bottom",
  x,
  y,
  width,
  height,
  ...options
});

/**
 * The wordmark, always in the same place: bottom-left, inside every canvas's safe area.
 *
 * A constant `y = 0.07` put it squarely under the story's top chrome, which is the one line that
 * kept every deck template out of 9:16. Bottom-left inside the union envelope clears the profile
 * row at the top and the reply bar at the bottom, at every canvas, without a second composition.
 *
 * `fontToken` is a family's one lever over it. A poster and a terminal print the same words, and
 * the difference between them is whether the mark is set in the headline face or the mono one.
 */
export const wordmark = (colorToken = "muted", fontToken: "headline" | "body" | "mono" = "headline"): CarouselLayerInput => ({
  type: "logo",
  x: LEFT,
  y: BOTTOM - 0.03,
  width: 0.3,
  height: 0.028,
  colorToken,
  fontToken
});

/**
 * A progress mark that grows with the deck, so a reader knows where they are.
 *
 * The fill is a parameter because a family may lay the mark over its own accent field, where
 * `muted` measures 1.04:1 and disappears. Shapes are not read by the contrast check, so a mark
 * that vanishes is not a failing template — it is a family that quietly lost its progress mark.
 */
export const progress = (phase: number, fillToken = "muted"): CarouselLayerInput =>
  shape(RIGHT - 0.16, BOTTOM - 0.018, 0.02 + phase * 0.14, 0.008, { fillToken, radius: 0.5 });

/**
 * Which strokes each digit lights, in the seven-segment order a, b, c, d, e, f, g.
 *
 * A numeral has to be *drawn*, because a text layer can only set a string the article wrote. That
 * limit is the point rather than a workaround: the moment a template can print its own characters
 * it can print a statistic nobody measured, which is exactly what the content rules forbid. Seven
 * rectangles can only ever say which slide this is. Promoted here from `families-poster.ts` when
 * the launch families made the numeral shared vocabulary rather than one family's trick.
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

function segmentDigit(value: string, x: number, y: number, width: number, height: number, weight: number, fillToken: string): CarouselLayerInput[] {
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
    return shape(left, top, wide, tall, { fillToken });
  });
}

/** The slide's position drawn as segments, one or two digits, in whatever token the ground needs. */
export function drawnIndex(position: number, x: number, y: number, digitWidth: number, height: number, weight: number, fillToken = "accent"): CarouselLayerInput[] {
  const characters = [...String(Math.max(0, Math.min(99, position)))];
  return characters.flatMap((character, place) =>
    segmentDigit(character, x + place * (digitWidth + digitWidth * 0.22), y, digitWidth, height, weight, fillToken));
}

/**
 * The pager: one dot per slide, the current one in the accent, centred at the foot.
 *
 * The one affordance every platform reader already knows. The launch research kept returning to
 * it — a cover that signals "there is more" outperforms one that leaves the swipe to be guessed —
 * and none of the founding families carried it. Inactive dots sit one ground-step away from
 * whatever the slide paints, so the row survives the B variant's ground inversion.
 */
export function pagerDots(index: number, slideCount: number, ground: string): CarouselLayerInput[] {
  const size = 0.011;
  const gap = 0.03;
  const first = 0.5 - ((slideCount - 1) * gap) / 2 - size / 2;
  const inactive = ground === "surface" ? "surface-strong" : "surface";
  return Array.from({ length: slideCount }, (_, dot) =>
    // Frames are fractions of the canvas, so a square needs the canvas's own aspect to come out
    // round. That aspect is the master canvas's, named here rather than written as two numbers.
    shape(first + dot * gap, BOTTOM + 0.005, size, size * MASTER_RATIO, {
      fillToken: dot === index ? "accent" : inactive,
      radius: 0.5
    }));
}

/**
 * The entry mark: a solid accent bar with a ghost tail, set at the head of the reading column.
 *
 * The hook's shared vocabulary, here rather than privately in five composers for the same reason
 * the pager is: two families that mark their second slide differently are two families a reader
 * has to learn twice. Solid then ghost reads as "you are at the start of this", which is the one
 * thing a re-served slide has to say, and it says it with two rectangles — no numeral, because a
 * hook is not a position.
 */
export function hookMark(x: number, y: number, ground: Beat["ground"]): CarouselLayerInput[] {
  const ghost = ground === "surface" ? "surface-strong" : "surface";
  return [
    rule(x, y, 0.14, { thickness: 12, colorToken: "accent" }),
    rule(x + 0.155, y, 0.085, { thickness: 12, colorToken: ghost })
  ];
}

/**
 * The two renderings every family ships.
 *
 * B is not a relabelling: it swaps the accent for the secondary *and* inverts the ground, so the
 * A/B pair the queue builds is genuinely two designs. Both are checked — the contrast check walks
 * every variant, not only the default — so an inverted beat cannot ship illegible.
 */
export function variantsFor(beat: Beat): Array<{ id: string; backgroundToken?: string; accentToken?: string }> {
  const inverted = beat.ground === "background" ? "surface-strong" : "background";
  return [{ id: "A" }, { id: "B", accentToken: "secondary", backgroundToken: inverted }];
}
