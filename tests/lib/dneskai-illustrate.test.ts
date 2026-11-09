import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { dneskaiIllustratedSlide, dneskaiReuseCrop, dneskaiSlidesNeedingPicture, rankDneskaiIllustrations } from '@/lib/marketing/dneskai-illustrate';
import { dneskaiClosingSlide } from '@/lib/marketing/dneskai-closing';

const a = 'a'.repeat(64), b = 'b'.repeat(64);
describe('fitting photographs on every DNESKAi slide (9 November 2026)', () => {
  it('asks for a picture on a photo-less or refused slide, never on the closing slide', () => {
    const deck = { slides: [
      { type: 'cover-photo' as const, headline: 'H', images: [{ slot: 'image-1', assetSha256: a }] },
      { type: 'statement' as const, headline: 'Q', images: [] },
      { type: 'figure' as const, headline: 'F', images: [{ slot: 'image-1', assetSha256: b }] },
      dneskaiClosingSlide(),
    ] };
    expect(dneskaiSlidesNeedingPicture(deck as never, new Set())).toEqual([1]);
    expect(dneskaiSlidesNeedingPicture(deck as never, new Set([b]))).toEqual([1, 2]);
  });
  it('turns a statement into a figure with the picture, and keeps a reused picture recognisably different', () => {
    const slide = dneskaiIllustratedSlide({ type: 'statement', variant: 'accent', headline: 'Q', body: 'n', images: [] } as never, { slot: 'image-1', assetSha256: a });
    expect(slide).toMatchObject({ type: 'figure', headline: 'Q', body: 'n', images: [{ slot: 'image-1', assetSha256: a }] });
    expect('variant' in slide).toBe(false);
    const crop = dneskaiReuseCrop(a, 'r1');
    expect(crop.zoom).toBeGreaterThanOrEqual(1.2); expect(crop.zoom).toBeLessThanOrEqual(1.6);
    expect(crop.focal.x).toBeGreaterThanOrEqual(0.3); expect(crop.focal.x).toBeLessThanOrEqual(0.7);
    expect(dneskaiReuseCrop(a, 'r1')).toEqual(crop);
    expect(dneskaiReuseCrop(a, 'r2')).not.toEqual(crop);
  });
  it('ranks library pictures by shared keywords, then topic, then the least used', () => {
    const rows = [
      { id: '1', sha256: '1'.repeat(64), topic: 'banking', tags: ['credit card', 'payment'], uses: 3 },
      { id: '2', sha256: '2'.repeat(64), topic: 'banking', tags: ['coins'], uses: 0 },
      { id: '3', sha256: '3'.repeat(64), topic: 'space', tags: ['rocket'], uses: 0 },
      { id: '4', sha256: '4'.repeat(64), topic: 'office', tags: ['credit card', 'payment', 'laptop'], uses: 1 },
    ];
    expect(rankDneskaiIllustrations(rows, { topics: ['banking'], keywords: ['payment', 'credit card'] }, new Set()).map((row) => row.id)).toEqual(['1', '4', '2']);
    expect(rankDneskaiIllustrations(rows, { topics: ['banking'], keywords: ['payment'] }, new Set(['1'.repeat(64)])).map((row) => row.id)).toEqual(['2', '4']);
  });
});

describe('library pictures large enough for a full-bleed slide (9 November 2026)', () => {
  it('retains the 1300 px minimum for stock and accepts full-size Codex portraits', () => {
    const rows = [
      { id: 's', sha256: 's'.repeat(64), topic: 'banking', tags: ['payment'], uses: 0, width: 732, height: 1300 },
      { id: 'l', sha256: 'l'.repeat(64), topic: 'banking', tags: ['payment'], uses: 5, width: 1365, height: 2048 },
      { id: 'c', sha256: 'c'.repeat(64), topic: 'banking', tags: ['payment'], uses: 1, width: 1080, height: 1350, source: 'codex' },
      { id: 't', sha256: 't'.repeat(64), topic: 'banking', tags: ['payment'], uses: 0, width: 960, height: 1200, source: 'codex' },
    ];
    expect(rankDneskaiIllustrations(rows, { topics: ['banking'], keywords: ['payment'] }, new Set()).map((row) => row.id)).toEqual(['c', 'l']);
  });
});
