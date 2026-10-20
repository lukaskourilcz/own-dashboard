import { z } from 'zod';

/**
 * The owner's read model of DNESKAi source media (#114), served by GET /api/marketing/dneskai/media and
 * consumed by the brief (#115), generation (#116) and the review UI (#119). Assets are identified by the
 * sha256 of their stored bytes; `previewUrl` is a one-hour signed link for the owner's preview only and
 * never belongs in a revision or its approval hash.
 */
export const DNESKAI_MEDIA_READ_VERSION = 'dneskai-media/1';
/** Browser-safe: no server module is imported here, so the review UI can validate the response. */
export const DNESKAI_MEDIA_ORIGIN_KINDS = ['instagram-display', 'instagram-child', 'og-image', 'article-figure', 'feed-image'] as const;
export type DneskaiMediaOriginKind = (typeof DNESKAI_MEDIA_ORIGIN_KINDS)[number];
export const DNESKAI_MEDIA_COLLECTION_STATUSES = ['pending', 'complete', 'partial', 'failed', 'empty'] as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const code = z.string().regex(/^[a-z0-9-]{1,64}$/);

export const DneskaiMediaAssetViewSchema = z.strictObject({
  assetId: z.uuid(),
  sha256,
  /** Zero-based place in the original carousel or article. */
  position: z.number().int().min(0).max(49),
  originKind: z.enum(DNESKAI_MEDIA_ORIGIN_KINDS),
  originUrl: z.url().max(2048),
  /** „Foto: @účet“ or „Obrázek: vydavatel“; always present (owner decision 7, #110). */
  credit: z.string().min(1).max(120),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  bytes: z.number().int().positive(),
  fetchedAt: z.string(),
  /** Shorter side ≥ 900 px: may fill a slide (cover-photo, single). */
  fullBleedCapable: z.boolean(),
  /** Width ≥ 600 px: may sit in a frame (figure, split). Smaller pictures are shown as small. */
  insetCapable: z.boolean(),
  /** Set when a larger copy of the same picture exists; that one is canonical. */
  duplicateOfAssetId: z.uuid().nullable(),
  duplicateOfSha256: sha256.nullable(),
  /** The bytes were removed by retention; the row, origin and credit stay. */
  purged: z.boolean(),
  previewUrl: z.url().nullable(),
});
export type DneskaiMediaAssetView = z.infer<typeof DneskaiMediaAssetViewSchema>;

export const DneskaiMediaCandidateViewSchema = z.strictObject({
  candidateId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(100),
  title: z.string().max(500),
  url: z.url(),
  candidateStatus: z.enum(['new', 'held', 'duplicate', 'rejected', 'selected']),
  /** The text is an Instagram caption, never a transcript of the video. */
  captionOnly: z.boolean(),
  mediaType: z.enum(['image', 'carousel', 'video']).nullable(),
  /** null: media were never collected for this candidate. */
  collection: z.strictObject({
    status: z.enum(DNESKAI_MEDIA_COLLECTION_STATUSES),
    pageStatus: z.enum(['not-applicable', 'pending', 'ok', 'failed']),
    pageError: code.nullable(),
    attemptedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    /** Positions that produced no picture, with the reason (`media-http-403`, `media-excluded-small`, …). */
    skipped: z.array(z.strictObject({ position: z.number().int(), code })).max(12),
  }).nullable(),
  assets: z.array(DneskaiMediaAssetViewSchema).max(10),
});
export type DneskaiMediaCandidateView = z.infer<typeof DneskaiMediaCandidateViewSchema>;

export const DneskaiMediaReadSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_MEDIA_READ_VERSION),
  candidates: z.array(DneskaiMediaCandidateViewSchema).max(8),
});
export type DneskaiMediaRead = z.infer<typeof DneskaiMediaReadSchema>;
