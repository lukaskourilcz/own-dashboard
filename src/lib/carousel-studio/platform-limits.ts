/**
 * What the destination platform will actually accept, checked on the template rather than assumed.
 *
 * A leaf module, importing only `canvas.js` and the schema types — the same ring-avoidance rule
 * `designs.ts` and `canvas.ts` state at their own tops.
 *
 * ## Why this is a check and not a comment
 *
 * `reviewDeck` already refuses a *deck* of more than `INSTAGRAM_MAX_SLIDES` items, and the editorial
 * band in `slides.ts` is narrower again. Neither of those looks at a template. A composition enters
 * the library as a composer in `families*.ts` or as a stored `carousel-template/1` record, and
 * before this nothing asked whether the thing entering could be posted at all. So the platform fact
 * is stored here, next to the ratio arithmetic, and it is read by `validateTemplateForBrand` —
 * which `renderCarouselSvg` refuses to draw past. The library is nowhere near the ceiling
 * (`CarouselTemplateSchema` caps `slides` at 10 and `MAX_SLIDES` is 8); the point is that the
 * ceiling is now written down and enforced rather than remembered.
 *
 * ## One ratio per post
 *
 * Instagram applies one orientation to every item of a post. The studio satisfies that structurally
 * — a render names one `format` and every slide is drawn at `formats[format]` — and the `canvas`
 * check refuses a format the template never declared. What is left for this module is the shape
 * itself: a canvas whose ratio is not one the platform shows uncropped is a deck that will be
 * cropped by the feed, and nothing downstream would say so.
 *
 * ## The PDF limit in the source idea has no subject here
 *
 * The issue this module comes from lists "PDF under 100 MB and 300 pages" among the platform
 * limits. This repository produces no PDF: the deck export route emits a ZIP of PNGs, and the only
 * other mentions of the format in the tree are a prose aside and a banned-extension list. A gate on
 * a file nobody writes is a gate that can only ever pass, so it is recorded as not applicable
 * rather than written.
 */
import {
  CANVAS_ORDER,
  CANVAS_RATIO_TOLERANCE,
  CONNECTOR_MAX_SLIDES,
  INSTAGRAM_MAX_SLIDES,
  INSTAGRAM_MIN_SLIDES,
  canvasRatio,
  ratiosAgree
} from "./canvas.js";
import { carouselCanvas, type CarouselCanvas, type CarouselFormat, type CarouselTemplate } from "./schema.js";
// Type-only, so nothing here is a runtime edge back into the checks that call this one.
import type { TemplateCheck } from "./validation.js";

/**
 * The canvas shapes this studio composes for, each named the way a platform names it.
 *
 * Not a catalogue of everything Instagram accepts — 1.91:1 landscape is accepted and this studio
 * does not compose it, so it is not here. A shape nobody draws does not belong in a check.
 */
export const ACCEPTED_RATIOS: ReadonlyArray<{ readonly name: string; readonly ratio: number }> = [
  { name: "1:1", ratio: 1 },
  { name: "4:5", ratio: 4 / 5 },
  { name: "9:16", ratio: 9 / 16 }
];

/** The limits a composition is held to before it may enter the library. */
export const PLATFORM_LIMITS = {
  /** What Instagram itself accepts in one post. */
  maxItemsPerPost: INSTAGRAM_MAX_SLIDES,
  /** What Instagram itself requires before a post is a carousel rather than a single image. */
  minCarouselItems: INSTAGRAM_MIN_SLIDES,
  /** What the guarded Graph connector this repository publishes through will carry. Narrower. */
  maxItemsPerConnectorItem: CONNECTOR_MAX_SLIDES,
  /** Every item of one post is shown at one orientation. */
  oneRatioPerPost: true,
  ratioTolerance: CANVAS_RATIO_TOLERANCE
} as const;

/** The shape this canvas is, or null when it is none of the ones the studio composes. */
export function ratioName(spec: { readonly width: number; readonly height: number }): string | null {
  const ratio = canvasRatio(spec);
  return ACCEPTED_RATIOS.find((candidate) => ratiosAgree(ratio, candidate.ratio))?.name ?? null;
}

/**
 * Whether this template could be posted as it stands, at this canvas.
 *
 * Reported as one check with every reason it failed, rather than the first: a composer fixing a
 * layout should see the whole list once instead of discovering it a run at a time.
 */
export function platformLimitCheck(template: CarouselTemplate, format: CarouselFormat): TemplateCheck {
  const problems: string[] = [];
  const count = template.slides.length;
  if (count > PLATFORM_LIMITS.maxItemsPerPost) {
    problems.push(`${count} slides exceeds the ${PLATFORM_LIMITS.maxItemsPerPost} Instagram accepts in one post`);
  }
  if (count > PLATFORM_LIMITS.maxItemsPerConnectorItem) {
    problems.push(`${count} slides exceeds the ${PLATFORM_LIMITS.maxItemsPerConnectorItem} the guarded connector will carry`);
  }
  // One slide is a single-image post and legitimate. Two is where a carousel starts; anything
  // between is not a shape the platform has.
  if (count > 1 && count < PLATFORM_LIMITS.minCarouselItems) {
    problems.push(`${count} slides is neither a single image nor a carousel of ${PLATFORM_LIMITS.minCarouselItems} or more`);
  }
  // Every canvas the template says it holds at, not only the one being rendered: a template that
  // declares a shape the feed crops is a template that will be posted cropped one day.
  const declared = new Set<CarouselCanvas>([template.canvas.master, ...template.canvas.derive]);
  for (const canvas of CANVAS_ORDER.filter((candidate) => declared.has(candidate))) {
    const spec = template.formats[canvas];
    if (!ratioName(spec)) {
      problems.push(`${canvas} is ${spec.width}×${spec.height}, which is none of ${ACCEPTED_RATIOS.map(({ name }) => name).join(", ")}`);
    }
  }
  if (problems.length) {
    return { id: "platform-limits", status: "fail", detail: `${template.id} cannot be posted: ${problems.join("; ")}` };
  }
  // The rendered canvas need not be one the template declared — that is the `canvas` check's
  // refusal to make, not this one's — so its shape may be unnamed here without being a failure.
  const rendered = template.formats[carouselCanvas(format)];
  const shape = ratioName(rendered) ?? `${rendered.width}×${rendered.height}`;
  return {
    id: "platform-limits",
    status: "pass",
    detail: `${count} slides at one ${shape} canvas, inside the ${PLATFORM_LIMITS.maxItemsPerConnectorItem}-item connector limit`
  };
}
