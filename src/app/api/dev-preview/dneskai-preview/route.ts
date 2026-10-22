import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { rejectCrossOrigin } from '@/lib/csrf';
import { DneskaiDeckSchema } from '@/lib/marketing/dneskai-slides';
import { DNESKAI_PREVIEW_BUDGET_MS, dneskaiPreviewResponse } from '@/lib/marketing/dneskai-preview';
import assets from '@/lib/demo/dneskai-preview-assets.json';

export const runtime = 'nodejs';

const Body = z.strictObject({ deck: DneskaiDeckSchema, slide: z.number().int().min(0).max(9) });

/**
 * The Design Lab's render-only preview for the fixture-only `/dev-preview` harness: the same in-memory render as
 * POST /api/marketing/dneskai/preview over committed synthetic photographs, without a session because the preview has
 * none. The harness applies the edit with the shared rules first and sends the edited deck. No owner data, storage,
 * revision or model call. Like the preview page, it exists only in development and explicit NEXT_E2E builds.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_E2E !== '1') return Response.json({ error: 'not-found' }, { status: 404 });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  let input: z.infer<typeof Body>;
  try { const raw = await request.text(); if (raw.length > 40_000) throw new Error('too-large'); input = Body.parse(JSON.parse(raw)); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400 }); }
  const photos = new Map(Object.values(assets.photos).map((photo) => [photo.sha256, photo]));
  if (input.deck.slides.some((slide) => slide.images.some((image) => !photos.has(image.assetSha256)))) return Response.json({ error: 'deck-asset-outside-brief' }, { status: 409 });
  const loadMedia = async (sha256: string) => {
    const bytes = await readFile(path.join(process.cwd(), 'public', photos.get(sha256)!.originalFile));
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('fixture-hash-mismatch');
    return bytes;
  };
  return dneskaiPreviewResponse(input.deck, input.slide, loadMedia, AbortSignal.any([request.signal, AbortSignal.timeout(DNESKAI_PREVIEW_BUDGET_MS)]));
}
