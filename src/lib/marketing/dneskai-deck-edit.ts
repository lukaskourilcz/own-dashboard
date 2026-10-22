import { z } from "zod";
import { DneskaiDeckSchema, DneskaiSlideImageSchema, DneskaiSlideTypeSchema, DneskaiSlideVariantSchema, type DneskaiDeck, type DneskaiSlide } from "./dneskai-slides";
import {
  DNESKAI_INSERT_SHAPES, DNESKAI_PLACED_FIELDS, dneskaiCreditLine, dneskaiInsertablePictures, dneskaiPictureFitsShape, dneskaiShapeId, dneskaiShapePictureCounts,
  dneskaiSlideFieldLimits, dneskaiSlideMoves, dneskaiSlideShape, type DneskaiPoolPicture, type DneskaiSlideShape,
} from "./dneskai-slide-layout";

/**
 * The owner's deck edit (#118, review-10), browser-safe so the server, the Design Lab's preview and the
 * `/dev-preview` harness apply exactly the same rules.
 *
 * Every entry of `slides` is one slide of the edited deck, in its new order; a slide left out is removed.
 * - `{ from, … }` keeps slide `from` of the revision being edited and changes its text, credit, alt text, pictures
 *   inside their places and, since review-10, its `type` and `variant` within the moves its pictures allow
 *   (`dneskaiSlideMoves`).
 * - `{ insert }` adds a carousel slide: a framed picture from the brief's pool or a statement. Code sets its credit
 *   from the pool; the owner writes its words. It may not follow the sources slide.
 * Sources lines stay code-owned. Every save is a new revision with its own content hash and needs a new approval.
 */
export const DneskaiSlideEditSchema = z.strictObject({
  from: z.number().int().min(0).max(9),
  headline: z.string().max(200).optional(),
  body: z.string().max(700).nullable().optional(),
  kicker: z.string().max(80).nullable().optional(),
  credit: z.string().max(120).optional(),
  alt: z.string().min(1).max(1000).optional(),
  images: z.array(DneskaiSlideImageSchema).max(4).optional(),
  /** review-10: a new slide type, within the moves the slide's pictures allow. */
  type: DneskaiSlideTypeSchema.optional(),
  /** review-10: a variant within the type's set (`accent | ink`, `photo | type`); null clears it. */
  variant: DneskaiSlideVariantSchema.nullable().optional(),
});
export const DneskaiSlideInsertSchema = z.strictObject({
  insert: z.strictObject({
    type: z.enum(["figure", "split", "statement"]),
    variant: z.enum(["accent", "ink"]).optional(),
    headline: z.string().max(200),
    body: z.string().max(700).optional(),
    kicker: z.string().max(80).optional(),
    alt: z.string().min(1).max(1000),
    images: z.array(DneskaiSlideImageSchema).max(2),
  }),
});
export const DneskaiDeckEditEntrySchema = z.union([DneskaiSlideEditSchema, DneskaiSlideInsertSchema]);
export const DneskaiDeckEditSchema = z.strictObject({ slides: z.array(DneskaiDeckEditEntrySchema).min(1).max(10) });
export type DneskaiDeckEdit = z.infer<typeof DneskaiDeckEditSchema>;
export type DneskaiSlideEditEntry = z.infer<typeof DneskaiSlideEditSchema>;
export type DneskaiSlideInsert = z.infer<typeof DneskaiSlideInsertSchema>["insert"];

/** The brief's pictures with their capability flags and the primary source, which type moves and inserts need. */
export type DneskaiEditPool = { media: readonly DneskaiPoolPicture[]; primaryCandidateId: string | null };

export class DneskaiRevisionEditError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DneskaiRevisionEditError"; }
}
const fail = (code: string): never => { throw new DneskaiRevisionEditError(code); };
const slotKey = (images: { slot: string }[]) => images.map((image) => image.slot).sort().join(",");
const isInsert = (entry: DneskaiDeckEdit["slides"][number]): entry is z.infer<typeof DneskaiSlideInsertSchema> => "insert" in entry;

/** Whether an edit needs the brief's pool with its capability flags: a picture slide changes type, or a slide is inserted. */
export function dneskaiDeckEditNeedsPool(deck: DneskaiDeck, value: DneskaiDeckEdit): boolean {
  return value.slides.some((entry) => isInsert(entry) || (entry.type !== undefined && entry.type !== deck.slides[entry.from]?.type && (deck.slides[entry.from]?.images.length ?? 0) > 0));
}

/** Written fields a slide holds that its type does not draw: they would be approved and never shown. */
function unplacedFields(slide: DneskaiSlide): string[] {
  const placed: readonly string[] = DNESKAI_PLACED_FIELDS[slide.type];
  return (["headline", "body", "kicker", "credit"] as const).filter((field) => (slide[field] ?? "").trim() && !placed.includes(field));
}

function moved(source: DneskaiSlide, change: DneskaiSlideEditEntry, index: number, format: DneskaiDeck["format"], pool: DneskaiEditPool | null): { slide: DneskaiSlide; shape: DneskaiSlideShape | null } {
  if (change.type === undefined && change.variant === undefined) return { slide: structuredClone(source), shape: null };
  const type = change.type ?? source.type;
  const variant = change.variant === null ? undefined : change.variant ?? (type === source.type ? source.variant : undefined);
  const variants: Partial<Record<DneskaiSlide["type"], readonly string[]>> = { statement: ["accent", "ink"], single: ["photo", "type"] };
  if (variant !== undefined && !variants[type]?.includes(variant)) return fail("deck-edit-variant-invalid");
  const target = dneskaiSlideShape({ type, variant });
  const current = dneskaiSlideShape(source);
  if (dneskaiShapeId(target) === dneskaiShapeId(current)) {
    // Naming the shape a slide already has (or the studio's default variant) changes nothing.
    return { slide: structuredClone(source), shape: null };
  }
  const media = new Map((pool?.media ?? []).map((item) => [item.assetSha256, item]));
  const allowed = dneskaiSlideMoves(source, { index, format, media });
  if (!allowed.some((shape) => dneskaiShapeId(shape) === dneskaiShapeId(target))) return fail("deck-edit-move-not-allowed");
  const next = structuredClone(source);
  next.type = target.type;
  if ("variant" in target) next.variant = target.variant; else delete next.variant;
  if (dneskaiShapePictureCounts(target).includes(0) && !dneskaiShapePictureCounts(target).some((count) => count > 0)) { next.images = []; delete next.credit; }
  return { slide: next, shape: target };
}

function inserted(entry: DneskaiSlideInsert, deck: DneskaiDeck, pool: DneskaiEditPool, taken: Set<string>): DneskaiSlide {
  if (deck.format !== "carousel") return fail("deck-edit-insert-not-allowed");
  const shape = dneskaiSlideShape({ type: entry.type, variant: entry.variant ?? (entry.type === "statement" ? "accent" : undefined) });
  if (!DNESKAI_INSERT_SHAPES.includes(dneskaiShapeId(shape))) return fail("deck-edit-insert-not-allowed");
  if (entry.variant && entry.type !== "statement") return fail("deck-edit-variant-invalid");
  if (!dneskaiShapePictureCounts(shape).includes(entry.images.length) || entry.images.some((image, position) => image.slot !== `image-${position + 1}`)) return fail("deck-edit-insert-pictures");
  const insertable = new Map(dneskaiInsertablePictures(pool.media, deck, pool.primaryCandidateId).map((item) => [item.assetSha256, item]));
  const credits: string[] = [];
  for (const image of entry.images) {
    const media = insertable.get(image.assetSha256);
    if (!media) return fail(pool.media.some((item) => item.assetSha256 === image.assetSha256) ? "deck-edit-insert-picture-unavailable" : "deck-asset-outside-brief");
    if (!dneskaiPictureFitsShape(media, shape)) return fail("deck-edit-insert-picture-unfit");
    if (taken.has(image.assetSha256)) return fail("deck-edit-insert-picture-unavailable");
    taken.add(image.assetSha256);
    credits.push(media.credit);
  }
  const slide: DneskaiSlide = {
    type: entry.type, ...(entry.type === "statement" ? { variant: entry.variant ?? "accent" } : {}),
    headline: entry.headline, ...(entry.body?.trim() ? { body: entry.body } : {}), ...(entry.kicker?.trim() ? { kicker: entry.kicker } : {}),
    images: entry.images.map((image) => structuredClone(image)), alt: entry.alt,
  };
  if (credits.length) {
    const limit = dneskaiSlideFieldLimits(slide).find((field) => field.field === "credit")?.max ?? 80;
    const credit = dneskaiCreditLine(credits, limit);
    if (credit === null) return fail("picture-credits-too-long");
    slide.credit = credit;
  }
  if (unplacedFields(slide).length) return fail("deck-edit-text-unplaced");
  return slide;
}

/**
 * Applies an owner edit to a deck. Throws `DneskaiRevisionEditError` with a stable code; never returns an invalid
 * deck. `pool` is needed only when a picture slide changes type or a slide is inserted (`dneskaiDeckEditNeedsPool`).
 */
export function applyDneskaiDeckEdit(deck: DneskaiDeck, value: DneskaiDeckEdit, pool: DneskaiEditPool | null = null): DneskaiDeck {
  const edit = DneskaiDeckEditSchema.safeParse(value);
  if (!edit.success) return fail("deck-edit-invalid");
  if (dneskaiDeckEditNeedsPool(deck, edit.data) && !pool) return fail("deck-edit-pool-unavailable");
  const used = new Set<number>();
  // Pictures the kept slides show: an inserted slide may not repeat one.
  const taken = new Set(edit.data.slides.flatMap((entry) => !isInsert(entry) && deck.slides[entry.from]?.type !== "sources" ? deck.slides[entry.from]?.images.map((image) => image.assetSha256) ?? [] : []));
  let sourcesSeen = false;
  const slides = edit.data.slides.map((change, index) => {
    if (isInsert(change)) {
      if (sourcesSeen) return fail("deck-edit-insert-after-sources");
      return inserted(change.insert, deck, pool!, taken);
    }
    const source = deck.slides[change.from];
    if (!source || used.has(change.from)) return fail("deck-edit-slide-invalid");
    used.add(change.from);
    if (source.type === "sources") sourcesSeen = true;
    const { slide: next, shape } = moved(source, change, index, deck.format, pool);
    if (change.headline !== undefined) next.headline = change.headline;
    if (change.body === null) delete next.body; else if (change.body !== undefined) next.body = change.body;
    if (change.kicker === null) delete next.kicker; else if (change.kicker !== undefined) next.kicker = change.kicker;
    if (change.credit !== undefined) next.credit = change.credit;
    if (change.alt !== undefined) next.alt = change.alt;
    if (change.images !== undefined) {
      // Swap a picture or its crop inside the slide's places; adding or dropping a place would change the template.
      if (slotKey(change.images) !== slotKey(next.images) || new Set(change.images.map((image) => image.slot)).size !== change.images.length) return fail("deck-edit-slots-changed");
      next.images = next.images.map((image) => structuredClone(change.images!.find((candidate) => candidate.slot === image.slot)!));
    }
    if (shape) {
      // A moved slide's pictures must fit their new place, and no text may stay where the new type draws none.
      const media = new Map((pool?.media ?? []).map((item) => [item.assetSha256, item]));
      for (const image of next.images) {
        const picture = media.get(image.assetSha256);
        if (!picture) return fail(pool ? "deck-asset-outside-brief" : "deck-edit-pool-unavailable");
        if (!dneskaiPictureFitsShape(picture, shape)) return fail("deck-edit-move-not-allowed");
      }
      if (unplacedFields(next).length) return fail("deck-edit-text-unplaced");
    }
    return next;
  });
  if (deck.format === "carousel" && (slides.length < 2 || slides.length > 10)) return fail("deck-edit-slide-count");
  if (deck.format === "single-image" && slides.length !== 1) return fail("deck-edit-slide-count");
  const parsed = DneskaiDeckSchema.safeParse({ ...deck, slides });
  return parsed.success ? parsed.data : fail("deck-edit-invalid");
}
