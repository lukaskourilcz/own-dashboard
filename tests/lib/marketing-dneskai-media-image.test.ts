import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { inspectDneskaiImage, phashDistance, sniffDneskaiImage } from '@/lib/marketing/dneskai-media-image';
import { scene } from './marketing-dneskai-media-fixture';

describe('DNESKAi source picture inspection', () => {
  it('keeps the bytes as they are and reports format, size and sha256 of exactly those bytes', async () => {
    for (const [format, mime] of [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']] as const) {
      const bytes = await scene(0, 1200, 900).toFormat(format).toBuffer();
      const image = await inspectDneskaiImage(bytes);
      expect(image).toMatchObject({ format, mime, width: 1200, height: 900, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      expect(image.phash).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  it('measures the displayed size after EXIF orientation, like the renderer', async () => {
    const rotated = await scene(0, 1200, 900).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(await inspectDneskaiImage(rotated)).toMatchObject({ width: 900, height: 1200 });
  });

  it('refuses SVG, GIF, tiny pictures and garbage before storing anything', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900"/></svg>');
    await expect(inspectDneskaiImage(svg)).rejects.toThrow('media-excluded-format');
    await expect(inspectDneskaiImage(await scene(0, 1200, 900).gif().toBuffer())).rejects.toThrow('media-excluded-format');
    await expect(inspectDneskaiImage(await scene(0, 640, 299).png().toBuffer())).rejects.toThrow('media-excluded-small');
    await expect(inspectDneskaiImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))).rejects.toThrow('media-undecodable');
    expect(sniffDneskaiImage(Buffer.from('GIF89a'))).toBeNull();
  });

  it('gives the same photograph at another size or quality a near hash, and another picture a far one', async () => {
    const original = await inspectDneskaiImage(await scene(0, 2400, 1800).jpeg({ quality: 92 }).toBuffer());
    const resized = await inspectDneskaiImage(await scene(0, 1080, 810).webp({ quality: 60 }).toBuffer());
    const other = await inspectDneskaiImage(await scene(1, 2400, 1800).jpeg({ quality: 92 }).toBuffer());
    expect(original.sha256).not.toBe(resized.sha256);
    expect(phashDistance(original.phash, resized.phash)).toBeLessThanOrEqual(6);
    expect(phashDistance(original.phash, other.phash)).toBeGreaterThan(6);
    expect(phashDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(() => phashDistance('xyz', '0000000000000000')).toThrow();
  });
});
