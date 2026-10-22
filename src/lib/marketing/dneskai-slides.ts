import { z } from "zod";

/**
 * The DNESKAi slide contract shared by generation (#116), revisions and approval (#118), rendering (#117)
 * and the review UI (#119). It mirrors the input of `renderDneskaiSlide` in `@boardlessai/carousel-studio`
 * (quorum#603): one entry per slide, images referenced by the sha256 of the stored source bytes, never by URL,
 * so an approval binds the exact pictures and crops and a renewed delivery link changes nothing.
 */
export const DNESKAI_SLIDES_VERSION = "dneskai-slides/1";

export const DNESKAI_SLIDE_TYPES = ["cover-photo", "figure", "split", "statement", "sources", "single"] as const;
export const DneskaiSlideTypeSchema = z.enum(DNESKAI_SLIDE_TYPES);
export type DneskaiSlideType = z.infer<typeof DneskaiSlideTypeSchema>;

/**
 * The five DNESKAi kits (quorum `studio/src/dneskai-kits`). A deck names its kit only when it is not `editorial`:
 * a deck without `kit` is drawn in editorial, so every deck saved before kits existed keeps its hash.
 */
export const DNESKAI_KIT_IDS = ["editorial", "bold", "explainer", "magazine", "ticker"] as const;
export const DneskaiKitIdSchema = z.enum(DNESKAI_KIT_IDS);
export type DneskaiKitId = z.infer<typeof DneskaiKitIdSchema>;
export const DNESKAI_EDITORIAL_KIT: DneskaiKitId = "editorial";
/**
 * The kits the vendored studio (vendor/carousel-studio) registers and so can draw and fit. Browser-safe, so the Lab can
 * offer exactly these; `tests/lib/carousel-studio-vendor.test.ts` holds it to the vendored registry.
 */
export const DNESKAI_RENDERABLE_KIT_IDS: readonly DneskaiKitId[] = ["editorial", "bold", "explainer", "magazine", "ticker"];
/** The kit a deck is drawn in. */
export const dneskaiKitOf = (deck: { kit?: DneskaiKitId } | null | undefined): DneskaiKitId => deck?.kit ?? DNESKAI_EDITORIAL_KIT;

/** Statement slides take `accent | ink`; a single-image post takes `photo | type`. */
export const DneskaiSlideVariantSchema = z.enum(["accent", "ink", "photo", "type"]);

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const unit = z.number().min(0).max(1);

/** Same shape as the studio's ImageCrop without its optional assetSha256 (the slide image carries it). */
export const DneskaiImageCropSchema = z.strictObject({
  focal: z.strictObject({ x: unit, y: unit }),
  zoom: z.number().min(1).max(4).optional(),
  fit: z.enum(["cover", "contain"]).optional(),
});
export type DneskaiImageCrop = z.infer<typeof DneskaiImageCropSchema>;

export const DneskaiSlideImageSchema = z.strictObject({
  slot: z.string().regex(/^image-[1-9]$/),
  /** sha256 of the stored source bytes in `marketing_media_assets` (#114). */
  assetSha256: sha256,
  crop: DneskaiImageCropSchema.optional(),
});
export type DneskaiSlideImage = z.infer<typeof DneskaiSlideImageSchema>;

export const DneskaiSlideSchema = z.strictObject({
  type: DneskaiSlideTypeSchema,
  variant: DneskaiSlideVariantSchema.optional(),
  headline: z.string().max(200),
  body: z.string().max(700).optional(),
  kicker: z.string().max(80).optional(),
  credit: z.string().max(120).optional(),
  sources: z.array(z.string().min(1).max(240)).max(4).optional(),
  images: z.array(DneskaiSlideImageSchema).max(4),
  alt: z.string().min(1).max(1000),
}).superRefine((slide, context) => {
  const slots = slide.images.map((image) => image.slot);
  if (new Set(slots).size !== slots.length) context.addIssue({ code: "custom", message: "image slots must be distinct", path: ["images"] });
  if (slide.type !== "sources" && !slide.headline.trim()) context.addIssue({ code: "custom", message: "headline required", path: ["headline"] });
  if (slide.type === "sources" && !(slide.sources?.length)) context.addIssue({ code: "custom", message: "sources slide needs sources", path: ["sources"] });
  if (slide.variant && slide.type === "statement" && !["accent", "ink"].includes(slide.variant)) context.addIssue({ code: "custom", message: "statement variant must be accent or ink", path: ["variant"] });
  if (slide.variant && slide.type === "single" && !["photo", "type"].includes(slide.variant)) context.addIssue({ code: "custom", message: "single variant must be photo or type", path: ["variant"] });
  if (slide.variant && !["statement", "single"].includes(slide.type)) context.addIssue({ code: "custom", message: "only statement and single slides take a variant", path: ["variant"] });
});
export type DneskaiSlide = z.infer<typeof DneskaiSlideSchema>;

export const DneskaiDeckSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_SLIDES_VERSION),
  format: z.enum(["carousel", "single-image"]),
  /** Absent means editorial; editorial is never written, so one deck has one hash. */
  kit: DneskaiKitIdSchema.exclude(["editorial"]).optional(),
  slides: z.array(DneskaiSlideSchema).min(1).max(10),
}).superRefine((deck, context) => {
  if (deck.format === "single-image" && (deck.slides.length !== 1 || deck.slides[0]?.type !== "single")) {
    context.addIssue({ code: "custom", message: "a single-image post is exactly one single slide", path: ["slides"] });
  }
  if (deck.format === "carousel") {
    if (deck.slides.length < 2) context.addIssue({ code: "custom", message: "a carousel needs at least two slides", path: ["slides"] });
    if (deck.slides.some((slide) => slide.type === "single")) context.addIssue({ code: "custom", message: "single slides belong to single-image posts", path: ["slides"] });
  }
});
export type DneskaiDeck = z.infer<typeof DneskaiDeckSchema>;

/** Every distinct source asset a deck draws, in first-use order. */
export function dneskaiDeckAssetHashes(deck: DneskaiDeck): string[] {
  return [...new Set(deck.slides.flatMap((slide) => slide.images.map((image) => image.assetSha256)))];
}
