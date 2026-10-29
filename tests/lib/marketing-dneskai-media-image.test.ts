import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { dneskaiEmbeddedCredits, inspectDneskaiImage, phashDistance, sniffDneskaiImage } from '@/lib/marketing/dneskai-media-image';
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

  it('reads the credit fields embedded in the file, and nothing when a publisher stripped them', async () => {
    // A Getty-style XMP packet: attribute and element forms, an rdf:Alt rights line with an entity.
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" photoshop:Credit="Getty Images" photoshop:Source="Getty Images North America">
      <dc:creator><rdf:Seq><rdf:li>Justin Sullivan</rdf:li></rdf:Seq></dc:creator><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">&#169; 2026 Getty Images</rdf:li></rdf:Alt></dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const tagged = await scene(1, 1200, 900).jpeg().withXmp(xmp).toBuffer();
    expect((await inspectDneskaiImage(tagged)).embeddedCredits).toEqual(['Getty Images', 'Getty Images North America', '© 2026 Getty Images', 'Justin Sullivan']);
    expect((await inspectDneskaiImage(await scene(1, 1200, 900).jpeg().toBuffer())).embeddedCredits).toEqual([]);
  });

  it.each(['&#1114112;', '&#x110000;', '&#999999999999999999999999999999999999999999;', '&#55296;', '&#xDFFF;'])('retains a malformed numeric credit literally instead of rejecting a valid picture (%s)', async (reference) => {
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:Credit="Reuters ${reference} &#x1F4F7;"/></rdf:RDF></x:xmpmeta>`;
    const expected = [`Reuters ${reference} 📷`];
    expect(dneskaiEmbeddedCredits({ xmp: Buffer.from(xmp) })).toEqual(expected);
    const bytes = await scene(1, 1200, 900).jpeg().withXmp(xmp).toBuffer();
    expect(await inspectDneskaiImage(bytes)).toMatchObject({ format: 'jpeg', width: 1200, height: 900, embeddedCredits: expected });
  });

  it('reads IPTC credit, source, by-line and copyright records, skipping the rest', () => {
    const record = (dataset: number, value: string) => { const bytes = Buffer.from(value, 'utf8'); return Buffer.concat([Buffer.from([0x1c, 0x02, dataset, bytes.length >> 8, bytes.length & 0xff]), bytes]); };
    // Inside a Photoshop 8BIM resource, as JPEG APP13 carries it: the IIM records are found wherever they sit.
    const iptc = Buffer.concat([Buffer.from('Photoshop 3.0\u00008BIM\u0004\u0004\u0000\u0000', 'latin1'), record(0, '\u0000\u0004'), record(5, 'OFFLINE headline'), record(80, 'AP Photo/Jae C. Hong'), record(110, 'AP'), record(115, 'Associated Press'), record(116, 'Copyright 2026 The Associated Press')]);
    expect(dneskaiEmbeddedCredits({ iptc })).toEqual(['AP Photo/Jae C. Hong', 'AP', 'Associated Press', 'Copyright 2026 The Associated Press']);
    expect(dneskaiEmbeddedCredits({ iptc: Buffer.from([0x1c, 0x02, 110, 0xff, 0xff, 0x41]) })).toEqual([]);
    expect(dneskaiEmbeddedCredits({})).toEqual([]);
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

  it('reports a decoder that does not load as its own code, not as an unreadable picture', async () => {
    const bytes = await scene(0, 1200, 900).jpeg().toBuffer();
    vi.resetModules();
    vi.doMock('sharp', () => { throw new Error('TEST-ONLY libvips-cpp.so: cannot open shared object file'); });
    try {
      const { inspectDneskaiImage: inspect, DneskaiMediaImageError } = await import('@/lib/marketing/dneskai-media-image');
      const failure = await inspect(bytes).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DneskaiMediaImageError);
      expect(failure).toMatchObject({ code: 'media-decoder-unavailable', message: 'media-decoder-unavailable' });
      // A file that is no picture at all is still refused before the decoder is needed.
      await expect(inspect(Buffer.from('GIF89a'))).rejects.toThrow('media-excluded-format');
    } finally { vi.doUnmock('sharp'); vi.resetModules(); }
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
