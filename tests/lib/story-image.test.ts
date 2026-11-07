import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import sharp from 'sharp';
import { composeStoryFromCover, storyRenderKey } from '@/lib/marketing/story-image';

describe('stories from a cover slide', () => {
  it('makes a deterministic 1080 x 1920 JPEG with the cover in the middle', async () => {
    const cover = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#2d7a2d' } }).jpeg().toBuffer();
    const a = await composeStoryFromCover(cover), b = await composeStoryFromCover(cover);
    expect(a.sha256).toBe(b.sha256);
    const meta = await sharp(a.jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1080, 1920]);
    // The middle row is the cover's green; the top band is the darker blurred copy.
    const { data } = await sharp(a.jpeg).raw().toBuffer({ resolveWithObject: true });
    const pixel = (y: number) => [...data.subarray((y * 1080 + 540) * 3, (y * 1080 + 540) * 3 + 3)];
    expect(pixel(960)[1]).toBeGreaterThan(pixel(40)[1]);
  });

  it('refuses a cover that is not a JPEG and keys a story by its cover', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
    await expect(composeStoryFromCover(png)).rejects.toThrow('story-cover-invalid');
    expect(storyRenderKey('a'.repeat(64))).toMatch(/^[a-f0-9]{64}$/);
    expect(() => storyRenderKey('x')).toThrow();
  });
});
