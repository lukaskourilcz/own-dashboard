/**
 * The master canvas, the ratio arithmetic around it, and the three slide-count bounds.
 *
 * A leaf module on purpose, and the same reason `designs.ts` is one: the schema needs the master
 * format's name to default a field, the validation needs it to judge a render, the library needs
 * it to decide what a template may be offered in, and the families need its aspect to keep a dot
 * round. Four files that would otherwise import each other in a ring. This one imports nothing.
 *
 * ## One master, derivations by declaration
 *
 * Instagram applies one orientation to every item of a post, so a deck is rendered at one canvas
 * or it is not a deck. 4:5 is that canvas: it is the tallest frame the feed shows uncropped, which
 * is why Meta's own carousel guidance recommends 1080 × 1350. Everything else a template offers —
 * the 1:1 square, the 9:16 story, the Threads square — is a *derivation*, and a template says in
 * its own record which of them it was actually composed for. A canvas nobody declared is refused
 * rather than rendered, because the alternative is a deck whose slides do not share a shape.
 *
 * ## Three numbers that are not the same number
 *
 * These were one constant in two files and the comment on it was wrong, which is how "the
 * platform's own carousel limit" came to name a figure the platform has never used:
 *
 * - `INSTAGRAM_MIN_SLIDES` / `INSTAGRAM_MAX_SLIDES` — what Instagram itself accepts in one post.
 * - `CONNECTOR_MAX_SLIDES` — what the guarded Graph connector this repository publishes through
 *   will carry. Narrower than the platform, and it is the number `assertQueueItemPublishable`
 *   enforces. Widening the platform constant must never widen this one.
 * - The editorial band — `MIN_SLIDES`, `MAX_SLIDES` and `QUEUE_MAX_SLIDES` in `slides.ts` — is
 *   narrower again, and is an owner instruction rather than a platform fact. It lives there.
 */

/**
 * Every canvas the studio renders, in the order it renders them.
 *
 * The one list. `CarouselFormatSchema` is this enum, `declaredCanvases` answers in this order and
 * the preview route's own set is this array — three places that each had their own copy of four
 * strings, which is three places a fifth canvas would have to be remembered.
 */
export const CANVAS_ORDER = [
  "instagram-square",
  "instagram-portrait",
  "instagram-story",
  "threads"
] as const;

/** The canvas every recipe is rendered at unless a template declares otherwise. */
export const MASTER_FORMAT = "instagram-portrait" as const;

/** 1080 × 1350: Meta's recommended carousel frame, and this studio's master. */
export const MASTER_CANVAS = { width: 1_080, height: 1_350 } as const;

/**
 * How far a canvas may sit from a declared ratio and still count as that ratio.
 *
 * One percent, which is the tolerance Meta's own carousel guidance states. Wider would let a
 * near-square pass as 4:5; exact equality would refuse a 1440 × 1800 frame that is the same
 * picture at a different size.
 */
export const CANVAS_RATIO_TOLERANCE = 0.01;

/** Width over height. A number below 1 is taller than it is wide. */
export function canvasRatio(spec: { readonly width: number; readonly height: number }): number {
  return spec.width / spec.height;
}

/** 0.8 — the master canvas as one number, for the places that need the aspect rather than the size. */
export const MASTER_RATIO = canvasRatio(MASTER_CANVAS);

/** Whether two canvases are the same shape, within the stated tolerance. */
export function ratiosAgree(left: number, right: number, tolerance = CANVAS_RATIO_TOLERANCE): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return false;
  return Math.abs(left - right) <= tolerance * Math.max(left, right);
}

/** The fewest items Instagram will accept as a carousel rather than a single image. */
export const INSTAGRAM_MIN_SLIDES = 2;

/** The most items Instagram will accept in one post. The platform's number, and only that. */
export const INSTAGRAM_MAX_SLIDES = 20;

/**
 * The most hosted images the guarded Graph connector will carry in one item.
 *
 * Narrower than the platform on purpose and enforced in `assertQueueItemPublishable`. A queue item
 * over this cannot be sent, so producing one is work thrown away at the last step.
 */
export const CONNECTOR_MAX_SLIDES = 10;
