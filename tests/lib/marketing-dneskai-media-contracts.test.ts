import { describe, expect, it } from 'vitest';
import { dneskaiOfferableMediaAssets, type DneskaiMediaAssetView } from '@/lib/marketing/dneskai-media-contracts';

// Synthetic views; ids, hashes and URLs are fixtures.
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
function view(n: number, patch: Partial<DneskaiMediaAssetView> = {}): DneskaiMediaAssetView {
  return { assetId: id(n), sha256: n.toString(16).padStart(64, '0'), position: n, originKind: n === 0 ? 'instagram-display' : 'instagram-child', originUrl: `https://scontent.cdninstagram.com/v/t51/${n}_n.jpg?stp=s1080`,
    credit: 'Foto: @mosseri', width: 1080, height: 1350, mime: 'image/jpeg', bytes: 1000, fetchedAt: '2026-10-20T21:30:00Z', fullBleedCapable: true, insetCapable: true,
    duplicateOfAssetId: null, duplicateOfSha256: null, purged: false, previewUrl: null, ...patch };
}
const positions = (assets: DneskaiMediaAssetView[]) => dneskaiOfferableMediaAssets({ assets }).map((asset) => asset.position);

describe('dneskaiOfferableMediaAssets', () => {
  it('keeps distinct carousel slides that the pHash marks as near-duplicates', () => {
    // Same-template text slides: slide 2 and 3 sit within 6 bits of slide 1, but they are different slides.
    expect(positions([view(0), view(1), view(2, { duplicateOfAssetId: id(1) }), view(3, { duplicateOfAssetId: id(1) })])).toEqual([0, 1, 2, 3]);
  });

  it('folds the display image into the child rendition of the same Instagram file', () => {
    const child = 'https://scontent.cdninstagram.com/v/t51/777_n.jpg?stp=s1440';
    expect(positions([view(0, { originUrl: 'https://scontent.cdninstagram.com/v/t51/777_n.jpg?stp=s640', duplicateOfAssetId: id(1) }), view(1, { originUrl: child }), view(2)])).toEqual([1, 2]);
    // The other way round the smaller child goes and the display image stays first.
    expect(positions([view(0, { originUrl: child }), view(1, { originUrl: 'https://scontent.cdninstagram.com/v/t51/777_n.jpg?stp=s640', duplicateOfAssetId: id(0) }), view(2)])).toEqual([0, 2]);
  });

  it('folds a feed social card into the body figure it repeats, never one figure into another', () => {
    const feed = (n: number, kind: DneskaiMediaAssetView['originKind'], patch: Partial<DneskaiMediaAssetView> = {}) => view(n, { originKind: kind, originUrl: `https://www.publisher.test/${n}.jpg`, credit: 'Obrázek: Publisher', ...patch });
    expect(positions([feed(0, 'og-image', { duplicateOfAssetId: id(1) }), feed(1, 'article-figure'), feed(2, 'article-figure', { duplicateOfAssetId: id(1) })])).toEqual([1, 2]);
  });

  it('folds a social card that reframes a body figure, and keeps an unrelated card or a card without a figure', () => {
    const feed = (n: number, kind: DneskaiMediaAssetView['originKind'], phash: string | null) => view(n, { originKind: kind, originUrl: `https://www.publisher.test/${n}.jpg`, credit: 'Obrázek: Publisher', phash });
    // The pair measured in production on 22 October 2026: 1200 × 630 card, 1920 × 1080 hero, 12 bits apart.
    const card = 'c4d2b549ba748b2d', hero = 'c496b3c99ba489ad';
    expect(positions([feed(0, 'og-image', card), feed(1, 'article-figure', hero)])).toEqual([1]);
    expect(positions([feed(0, 'feed-image', card), feed(1, 'article-figure', hero)])).toEqual([1]);
    // 15 bits is past the limit: two pictures.
    expect(positions([feed(0, 'og-image', '0000000000007fff'), feed(1, 'article-figure', '0000000000000000')])).toEqual([0, 1]);
    // Two body figures stay two figures however close; a card alone, or without a hash, stays.
    expect(positions([feed(0, 'article-figure', card), feed(1, 'article-figure', hero)])).toEqual([0, 1]);
    expect(positions([feed(0, 'og-image', card)])).toEqual([0]);
    expect(positions([feed(0, 'og-image', null), feed(1, 'article-figure', hero)])).toEqual([0, 1]);
    // A purged figure offers nothing, so the card stays.
    expect(positions([feed(0, 'og-image', card), view(1, { originKind: 'article-figure', phash: hero, purged: true })])).toEqual([0]);
  });

  it('drops purged pictures and keeps a copy whose larger picture is purged or belongs to another candidate', () => {
    const repeated = { originUrl: 'https://scontent.cdninstagram.com/v/t51/1_n.jpg?stp=s640' };
    expect(positions([view(0, { ...repeated, duplicateOfAssetId: id(1) }), view(1, { purged: true }), view(2, { duplicateOfAssetId: id(99) })])).toEqual([0, 2]);
  });
});
