import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { renderDneskaiSlide } from '@boardlessai/carousel-studio/dneskai-slide';
import { rejectCrossOrigin } from '@/lib/csrf';
import { DneskaiDeckSchema } from '@/lib/marketing/dneskai-slides';
import assets from '@/lib/demo/dneskai-preview-assets.json';

export const runtime = 'nodejs';
/** Fixture-only renderer: committed synthetic images only; no URL fetching, storage or model calls. */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_E2E !== '1') return Response.json({ error: 'not-found' }, { status: 404 });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  let deck;
  try { const raw = await request.text(); if (raw.length > 30_000) throw new Error('too-large'); deck = DneskaiDeckSchema.parse(JSON.parse(raw)); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400 }); }
  const photos = new Map(Object.values(assets.photos).map((photo) => [photo.sha256, photo]));
  if (deck.slides.some((slide) => slide.images.some((image) => !photos.has(image.assetSha256)))) return Response.json({ error: 'deck-asset-outside-brief' }, { status: 400 });
  try {
    const rendered = [], problems = [];
    for (const [index, slide] of deck.slides.entries()) {
      if (request.signal.aborted) throw new Error('aborted');
      const images = await Promise.all(slide.images.map(async (image) => {
        const photo = photos.get(image.assetSha256)!;
        const bytes = await readFile(path.join(process.cwd(), 'public', photo.originalFile));
        if (createHash('sha256').update(bytes).digest('hex') !== image.assetSha256) throw new Error('fixture-hash-mismatch');
        return { ...image, bytes };
      }));
      const result = await renderDneskaiSlide({ ...slide, images, position: { index, count: deck.slides.length }, locale: 'cs' });
      problems.push(...result.problems.map((problem) => ({ ...problem, slide: index, blocking: problem.blocking || problem.code === 'text-clipped' })));
      if (!result.png || result.status !== 'rendered' || result.truncatedSlots.length) continue;
      const jpeg = await sharp(result.png).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
      rendered.push({ url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, sha256: createHash('sha256').update(jpeg).digest('hex'), width: 1080, height: 1350, alt: slide.alt });
    }
    const ready = rendered.length === deck.slides.length && !problems.some((problem) => problem.blocking);
    return Response.json({ ready, assets: ready ? rendered : [], problems }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ error: 'render-unavailable' }, { status: 503 }); }
}
