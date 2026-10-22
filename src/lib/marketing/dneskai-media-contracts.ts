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
  sourceAltText:z.string().max(1000).optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  bytes: z.number().int().positive(),
  fetchedAt: z.string(),
  /** Shorter side ≥ 900 px: may fill a slide (cover-photo, single). */
  fullBleedCapable: z.boolean(),
  /** Width ≥ 600 px: may sit in a frame (figure, split). Smaller pictures are shown as small. */
  insetCapable: z.boolean(),
  /** The 64-bit perceptual hash recorded at collection (`dneskai-media-image.ts`); absent on older reads. */
  phash: z.string().regex(/^[a-f0-9]{16}$/).nullable().optional(),
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
  articleText:z.string().max(4000).optional(),
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

const CARD_KINDS: ReadonlySet<DneskaiMediaOriginKind> = new Set(['og-image', 'feed-image']);
const fileName = (url: string) => { try { return new URL(url).pathname.split('/').pop()?.toLowerCase() ?? ''; } catch { return ''; } };
/** Two linked pictures of one candidate that are the same picture repeated, not two pictures that look alike. */
function repeatedPicture(copy: DneskaiMediaAssetView, canonical: DneskaiMediaAssetView) {
  const instagram = copy.originKind.startsWith('instagram-');
  if (instagram !== canonical.originKind.startsWith('instagram-')) return false;
  // Instagram names a media file once: displayUrl and images[] / childPosts[] renditions share it.
  if (instagram) return fileName(copy.originUrl) !== '' && fileName(copy.originUrl) === fileName(canonical.originUrl);
  // A feed's social card or feed image repeats a body figure; two body figures are two figures.
  return CARD_KINDS.has(copy.originKind) || CARD_KINDS.has(canonical.originKind);
}

/**
 * How far a social card's pHash may sit from a body figure of the same article and still be that figure
 * reframed. Publishers crop or widen the hero for og:image, which moves the hash beyond the 6 bits the
 * database uses for byte-level copies: Anthropic's card and hero for one post measured 12 bits on
 * 22 October 2026. Unrelated pictures sit near 32 bits (σ ≈ 4), so 14 stays far from chance.
 */
export const DNESKAI_CARD_REFRAME_MAX_DISTANCE = 14;
const NIBBLE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
const hammingDistance = (left: string, right: string) => {
  let count = 0;
  for (let index = 0; index < 16; index += 1) count += NIBBLE_BITS[parseInt(left[index], 16) ^ parseInt(right[index], 16)];
  return count;
};
/** A feed's social card or feed image that reframes a body figure of the same candidate. */
function reframedCard(card: DneskaiMediaAssetView, live: readonly DneskaiMediaAssetView[]) {
  if (!CARD_KINDS.has(card.originKind) || !card.phash) return false;
  return live.some((figure) => figure.originKind === 'article-figure' && figure.phash != null
    && hammingDistance(card.phash!, figure.phash) <= DNESKAI_CARD_REFRAME_MAX_DISTANCE);
}

/**
 * The pictures of one candidate that the brief (#115), generation (#116) and review (#119) should offer, in
 * original order. A purged picture has no bytes. A near-duplicate marker alone never hides a picture:
 * distinct carousel slides built on one template measure 4-6 bits apart. Only a repeated copy is folded
 * into its larger copy when both belong to this candidate: an Instagram display image or rendition with
 * the same CDN file name, or a feed's social card or feed image against a body figure. A social card that
 * reframes a body figure (`DNESKAI_CARD_REFRAME_MAX_DISTANCE`) is folded into the figure too, so a deck
 * never shows the hero twice.
 */
export function dneskaiOfferableMediaAssets(candidate: Pick<DneskaiMediaCandidateView, 'assets'>): DneskaiMediaAssetView[] {
  const live = candidate.assets.filter((asset) => !asset.purged);
  const byId = new Map(live.map((asset) => [asset.assetId, asset]));
  return live.filter((asset) => {
    const canonical = asset.duplicateOfAssetId ? byId.get(asset.duplicateOfAssetId) : undefined;
    return (!canonical || !repeatedPicture(asset, canonical)) && !reframedCard(asset, live);
  });
}
