import type { DneskaiBriefMedia } from "./dneskai-brief";
import type { DneskaiSlide, DneskaiSlideType } from "./dneskai-slides";

/**
 * What each DNESKAi slide type draws and holds, browser-safe: the template a slide resolves to, the written
 * fields it places, the most characters each layer holds, how many pictures it takes and which pictures can fill
 * them. Generation, the renderer's gate, the review read model and the owner's editor all read these tables, so a
 * type or variant change in the Design Lab follows exactly the rules generation follows.
 */

/** A field of a slide that carries written copy. `sources` stands for each of its lines. */
export type DneskaiTextField = "headline" | "body" | "kicker" | "credit" | "sources";

/**
 * The written fields each slide type draws. The studio fills only its template's slots, so any
 * other field would sit in the approved deck and never reach the picture. Checked against the
 * vendored templates (`tests/lib/carousel-studio-vendor.test.ts`).
 */
export const DNESKAI_PLACED_FIELDS = {
  "cover-photo": ["headline", "kicker", "credit"],
  figure: ["headline", "body", "credit"],
  split: ["headline", "body", "kicker", "credit"],
  statement: ["headline", "body"],
  sources: ["sources"],
  single: ["headline", "body", "kicker", "credit"],
} as const satisfies Record<DneskaiSlideType, readonly DneskaiTextField[]>;

/**
 * The most characters each written field of a DNESKAi template holds (`maxChars` of its text layer in the
 * vendored `dneskai-photo.js`). `tests/lib/marketing-dneskai-generation.test.ts` reads them back from the
 * studio. Whether a line fits is still the fitter's call; this is the hard ceiling the prompt aims under.
 */
export const DNESKAI_TEXT_LIMITS = {
  "dneskai-cover-photo": { headline: 110, kicker: 56, credit: 80 },
  "dneskai-figure": { headline: 110, body: 260, credit: 80 },
  "dneskai-split": { headline: 110, body: 330, kicker: 28, credit: 80 },
  "dneskai-split-pair": { headline: 110, body: 320, kicker: 28, credit: 80 },
  "dneskai-statement": { headline: 170, body: 240 },
  "dneskai-single-photo": { headline: 110, body: 100, kicker: 44, credit: 30 },
  "dneskai-single-type": { headline: 120, body: 280, kicker: 56, credit: 80 },
} as const satisfies Record<string, Partial<Record<"headline" | "body" | "kicker" | "credit", number>>>;
export type DneskaiTemplateId = keyof typeof DNESKAI_TEXT_LIMITS;

type Shaped = { type: DneskaiSlideType; variant?: string | undefined; images: ArrayLike<unknown> };

/** The studio template a written slide resolves to. */
export function dneskaiTemplateId(slide: Pick<Shaped, "variant" | "images"> & { type: Exclude<DneskaiSlideType, "sources"> }): DneskaiTemplateId {
  switch (slide.type) {
    case "cover-photo": return "dneskai-cover-photo";
    case "figure": return "dneskai-figure";
    case "split": return slide.images.length > 1 ? "dneskai-split-pair" : "dneskai-split";
    case "statement": return "dneskai-statement";
    case "single": return slide.variant === "type" ? "dneskai-single-type" : "dneskai-single-photo";
  }
}

export const DNESKAI_EDITABLE_FIELDS = ["headline", "body", "kicker", "credit"] as const;
export type DneskaiEditableField = (typeof DNESKAI_EDITABLE_FIELDS)[number];
const SCHEMA_LIMITS: Record<DneskaiEditableField, number> = { headline: 200, body: 700, kicker: 80, credit: 120 };

/** The written fields a slide's template draws, with the most characters its layer holds. Sources lines are code-owned. */
export function dneskaiSlideFieldLimits(slide: Shaped & { readonly [field: string]: unknown }): Array<{ field: DneskaiEditableField; max: number }> {
  if (slide.type === "sources") return [];
  const placed: readonly string[] = DNESKAI_PLACED_FIELDS[slide.type];
  const limits: Partial<Record<string, number>> = DNESKAI_TEXT_LIMITS[dneskaiTemplateId(slide as Parameters<typeof dneskaiTemplateId>[0])];
  return DNESKAI_EDITABLE_FIELDS.filter((field) => placed.includes(field)).map((field) => ({ field, max: limits[field] ?? SCHEMA_LIMITS[field] }));
}

/* ---- shapes: a slide type with its variant, and the moves between them ---------------------------------------- */

/** A slide's look: its type and, for `statement` and `single`, its variant. */
export type DneskaiSlideShape =
  | { type: "cover-photo" | "figure" | "split" | "sources" }
  | { type: "statement"; variant: "accent" | "ink" }
  | { type: "single"; variant: "photo" | "type" };
export type DneskaiShapeId = "cover-photo" | "figure" | "split" | "sources" | "statement-accent" | "statement-ink" | "single-photo" | "single-type";

/** The studio's defaults: a statement without a variant is `accent`, a single slide `photo`. */
export function dneskaiSlideShape(slide: Pick<DneskaiSlide, "type" | "variant">): DneskaiSlideShape {
  if (slide.type === "statement") return { type: "statement", variant: slide.variant === "ink" ? "ink" : "accent" };
  if (slide.type === "single") return { type: "single", variant: slide.variant === "type" ? "type" : "photo" };
  return { type: slide.type };
}
export function dneskaiShapeId(shape: DneskaiSlideShape): DneskaiShapeId {
  return "variant" in shape ? `${shape.type}-${shape.variant}` as DneskaiShapeId : shape.type;
}
export function dneskaiShapeFromId(id: DneskaiShapeId): DneskaiSlideShape {
  if (id === "statement-accent" || id === "statement-ink") return { type: "statement", variant: id === "statement-ink" ? "ink" : "accent" };
  if (id === "single-photo" || id === "single-type") return { type: "single", variant: id === "single-type" ? "type" : "photo" };
  return { type: id };
}

/** How many pictures a shape takes (generation's `image-count` rule; the studio refuses any other count). */
export function dneskaiShapePictureCounts(shape: DneskaiSlideShape): readonly number[] {
  switch (shape.type) {
    case "cover-photo": case "figure": return [1];
    case "split": return [1, 2];
    case "statement": return [0];
    case "single": return shape.variant === "photo" ? [1] : [0];
    case "sources": return [0, 1, 2, 3, 4];
  }
}

/** The credit layer of a single photo slide: the shortest credit line a single-image post can carry. */
const SINGLE_PHOTO_CREDIT = DNESKAI_TEXT_LIMITS["dneskai-single-photo"].credit;
export type DneskaiPoolPicture = Pick<DneskaiBriefMedia, "assetSha256" | "candidateId" | "credit" | "fullBleedCapable" | "insetCapable">;

/**
 * Whether a picture from the brief's pool can fill a shape's picture place, by the same capability flags
 * generation offers the model: a cover needs a full-bleed picture, a single photo a full-bleed picture whose credit
 * fits its short credit line (`singlePhotoCapable`), every framed slide a picture at least inset-capable.
 */
export function dneskaiPictureFitsShape(media: Pick<DneskaiPoolPicture, "credit" | "fullBleedCapable" | "insetCapable">, shape: DneskaiSlideShape): boolean {
  if (shape.type === "cover-photo") return media.fullBleedCapable;
  if (shape.type === "single") return shape.variant === "photo" && media.fullBleedCapable && dneskaiCreditLine([media.credit], SINGLE_PHOTO_CREDIT) !== null;
  if (shape.type === "statement") return false;
  return media.insetCapable || media.fullBleedCapable;
}

export type DneskaiMoveContext = {
  /** The slide's place in the edited deck. */
  index: number;
  format: "carousel" | "single-image";
  /** The pool's pictures by sha256; a picture missing from it blocks every move that keeps it. */
  media: ReadonlyMap<string, Pick<DneskaiPoolPicture, "credit" | "fullBleedCapable" | "insetCapable">>;
};

/**
 * The shapes a slide can change to while keeping its own pictures (the review-10 moves): a statement switches
 * between accent and ink; a slide with one picture moves between cover (first carousel slide only, full-bleed
 * picture), figure and split when the picture can fill the new place; a single photo post can drop its picture and
 * become a type-only post. A split with two pictures, the sources slide and a single type post have no move that
 * keeps their pictures. The current shape is always first.
 */
export function dneskaiSlideMoves(slide: Pick<DneskaiSlide, "type" | "variant" | "images">, context: DneskaiMoveContext): DneskaiSlideShape[] {
  const current = dneskaiSlideShape(slide);
  const shapes: DneskaiSlideShape[] = [current];
  const add = (shape: DneskaiSlideShape) => { if (dneskaiShapeId(shape) !== dneskaiShapeId(current)) shapes.push(shape); };
  if (current.type === "statement") { add({ type: "statement", variant: "accent" }); add({ type: "statement", variant: "ink" }); return shapes; }
  if (current.type === "single") { if (current.variant === "photo") add({ type: "single", variant: "type" }); return shapes; }
  if (current.type === "sources" || context.format !== "carousel" || slide.images.length !== 1) return shapes;
  const picture = context.media.get(slide.images[0]!.assetSha256);
  if (!picture) return shapes;
  const candidates: DneskaiSlideShape[] = [{ type: "cover-photo" }, { type: "figure" }, { type: "split" }];
  for (const shape of candidates) {
    if (shape.type === "cover-photo" && context.index !== 0) continue;
    if (dneskaiPictureFitsShape(picture, shape)) add(shape);
  }
  return shapes;
}

/** The shapes the owner may insert as a new carousel slide: a framed picture or a statement in either colour. */
export const DNESKAI_INSERT_SHAPES: readonly DneskaiShapeId[] = ["figure", "split", "statement-accent", "statement-ink"];

/**
 * The pictures an inserted slide may use: pictures of the brief's pool the deck does not show yet, from a source
 * the sources slide already names (the primary source, or a source the deck already takes a picture from), so the
 * deck never shows a picture whose source it does not cite. Each picture still carries its own code-set credit.
 */
export function dneskaiInsertablePictures<T extends DneskaiPoolPicture>(pool: readonly T[], deck: { slides: ReadonlyArray<Pick<DneskaiSlide, "type" | "images">> }, primaryCandidateId: string | null): T[] {
  const byHash = new Map(pool.map((item) => [item.assetSha256, item]));
  const used = new Set(deck.slides.flatMap((slide) => slide.images.map((image) => image.assetSha256)));
  const shown = new Set(deck.slides.filter((slide) => slide.type !== "sources").flatMap((slide) => slide.images.map((image) => image.assetSha256)));
  const cited = new Set([...used].flatMap((hash) => byHash.get(hash)?.candidateId ?? []));
  if (primaryCandidateId) cited.add(primaryCandidateId);
  return pool.filter((item, index) => !shown.has(item.assetSha256) && cited.has(item.candidateId) && pool.findIndex((other) => other.assetSha256 === item.assetSha256) === index);
}

/**
 * The credit line code sets for a slide's pictures, the same four forms as generation (`fitDneskaiCredit` in
 * dneskai-generation.ts): full credits, then without the „Foto:“/„Obrázek:“ label, then also without the platform in
 * brackets, then an agency credit without the publisher („Getty Images přes TechCrunch“ → „Getty Images“). Null when
 * even the shortest form does not fit.
 */
export function dneskaiCreditLine(credits: readonly string[], limit: number): string | null {
  const whitespace = (value: string) => value.replace(/\s+/gu, " ").trim();
  const distinct = <T>(values: T[]) => [...new Set(values)];
  const characters = (value: string) => [...value.normalize("NFC")].length;
  const full = distinct(credits.map(whitespace).filter(Boolean));
  if (!full.length) return "";
  const unlabelled = full.map((credit) => credit.replace(/^(?:Foto|Obrázek):\s+/u, ""));
  const bare = unlabelled.map((credit) => credit.replace(/\s+\((?:Bluesky|GitHub|Instagram)\)$/u, ""));
  const agency = bare.map((credit) => credit.replace(/\s+přes\s+.+$/u, ""));
  for (const form of [full, unlabelled, bare, agency]) {
    const line = distinct(form).join(" · ");
    if (characters(line) <= limit) return line;
  }
  return null;
}
