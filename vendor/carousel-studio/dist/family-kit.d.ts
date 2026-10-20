import type { CarouselLayerInput } from "./schema.js";
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
export declare const TOP = 0.145;
export declare const BOTTOM = 0.835;
export declare const LEFT = 0.075;
export declare const RIGHT = 0.925;
export declare const MEASURE: number;
/** The height a composition actually has to work in, once every canvas has taken its margin. */
export declare const SAFE_HEIGHT: number;
/**
 * Where a body passage's frame starts, as a fraction of the safe height.
 *
 * `docs/design-lab/TOKENS.md` calls this the most load-bearing rule in the set, and the reason is
 * mechanical rather than aesthetic: the engine top-anchors text and has no vertical centring, so a
 * 24-character passage in a frame sized for 240 leaves the bottom two-thirds empty. Starting the
 * frame between 0.14 and 0.26 in puts a short passage near the optical centre and still lets a
 * long one grow down into space that exists.
 */
export declare function bodyTop(fraction: number): number;
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
export declare const RHYTHM: readonly Beat[];
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
export declare const text: (slot: string, x: number, y: number, width: number, height: number, options?: Partial<Extract<CarouselLayerInput, {
    type: "text";
}>>) => CarouselLayerInput;
export declare const rule: (x: number, y: number, width: number, options?: Partial<Extract<CarouselLayerInput, {
    type: "rule";
}>>) => CarouselLayerInput;
export declare const shape: (x: number, y: number, width: number, height: number, options?: Partial<Extract<CarouselLayerInput, {
    type: "shape";
}>>) => CarouselLayerInput;
export declare const hero: (x: number, y: number, width: number, height: number, options?: Partial<Extract<CarouselLayerInput, {
    type: "image";
}>>) => CarouselLayerInput;
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
export declare const wordmark: (colorToken?: string, fontToken?: "headline" | "body" | "mono") => CarouselLayerInput;
/**
 * A progress mark that grows with the deck, so a reader knows where they are.
 *
 * The fill is a parameter because a family may lay the mark over its own accent field, where
 * `muted` measures 1.04:1 and disappears. Shapes are not read by the contrast check, so a mark
 * that vanishes is not a failing template — it is a family that quietly lost its progress mark.
 */
export declare const progress: (phase: number, fillToken?: string) => CarouselLayerInput;
/** The slide's position drawn as segments, one or two digits, in whatever token the ground needs. */
export declare function drawnIndex(position: number, x: number, y: number, digitWidth: number, height: number, weight: number, fillToken?: string): CarouselLayerInput[];
/**
 * The pager: one dot per slide, the current one in the accent, centred at the foot.
 *
 * The one affordance every platform reader already knows. The launch research kept returning to
 * it — a cover that signals "there is more" outperforms one that leaves the swipe to be guessed —
 * and none of the founding families carried it. Inactive dots sit one ground-step away from
 * whatever the slide paints, so the row survives the B variant's ground inversion.
 */
export declare function pagerDots(index: number, slideCount: number, ground: string): CarouselLayerInput[];
/**
 * The entry mark: a solid accent bar with a ghost tail, set at the head of the reading column.
 *
 * The hook's shared vocabulary, here rather than privately in five composers for the same reason
 * the pager is: two families that mark their second slide differently are two families a reader
 * has to learn twice. Solid then ghost reads as "you are at the start of this", which is the one
 * thing a re-served slide has to say, and it says it with two rectangles — no numeral, because a
 * hook is not a position.
 */
export declare function hookMark(x: number, y: number, ground: Beat["ground"]): CarouselLayerInput[];
/**
 * The two renderings every family ships.
 *
 * B is not a relabelling: it swaps the accent for the secondary *and* inverts the ground, so the
 * A/B pair the queue builds is genuinely two designs. Both are checked — the contrast check walks
 * every variant, not only the default — so an inverted beat cannot ship illegible.
 */
export declare function variantsFor(beat: Beat): Array<{
    id: string;
    backgroundToken?: string;
    accentToken?: string;
}>;
//# sourceMappingURL=family-kit.d.ts.map