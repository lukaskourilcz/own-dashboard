import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { DNESKAI_RESTYLE_NOTE, DNESKAI_RESTYLE_PICTURES, dneskaiRestyleJobKey, dneskaiRestyleMissingPictures } from '@/lib/marketing/dneskai-restyle';

const owner = '11111111-1111-4111-8111-111111111111';
const revision = '22222222-2222-4222-8222-222222222222';
const hash = 'a'.repeat(64);
const pictures = (count: number) => Array.from({ length: count }, (_, index) => ({ assetSha256: String(index).padStart(64, '0') }));

describe('DNESKAi restyle (owner request, 8 November 2026)', () => {
  it('keys one job per post version and slot, as a v5-shaped uuid', () => {
    const key = dneskaiRestyleJobKey(owner, revision, hash, '2026-11-09T07:00:00.000Z');
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(dneskaiRestyleJobKey(owner, revision, hash, '2026-11-09T07:00:00.000Z')).toBe(key);
    expect(dneskaiRestyleJobKey(owner, revision, hash, '2026-11-09T09:00:00.000Z')).not.toBe(key);
    expect(dneskaiRestyleJobKey(owner, revision, 'b'.repeat(64), '2026-11-09T07:00:00.000Z')).not.toBe(key);
    // A retry after a failure gets its own key; attempt 0 keeps the original one.
    expect(dneskaiRestyleJobKey(owner, revision, hash, '2026-11-09T07:00:00.000Z', 0)).toBe(key);
    expect(dneskaiRestyleJobKey(owner, revision, hash, '2026-11-09T07:00:00.000Z', 1)).not.toBe(key);
  });

  it('asks for stock pictures only while the stock source is on and the brief is short', () => {
    const on = { MARKETING_DNESKAI_STOCK_ENABLED: 'true', PEXELS_API_KEY: 'key' };
    expect(dneskaiRestyleMissingPictures(pictures(1), on)).toBe(DNESKAI_RESTYLE_PICTURES - 1);
    expect(dneskaiRestyleMissingPictures(pictures(DNESKAI_RESTYLE_PICTURES), on)).toBe(0);
    expect(dneskaiRestyleMissingPictures(pictures(1), { PEXELS_API_KEY: 'key' })).toBe(0);
    expect(dneskaiRestyleMissingPictures(pictures(1), { MARKETING_DNESKAI_STOCK_ENABLED: 'true' })).toBe(0);
  });

  it('asks the model for the house style only, keeps every other rule, and names no source', () => {
    expect(DNESKAI_RESTYLE_NOTE).toContain('domácím stylu');
    expect(DNESKAI_RESTYLE_NOTE).toContain('pravidla platí');
    expect(DNESKAI_RESTYLE_NOTE).not.toMatch(/zdroj/i);
  });
});
