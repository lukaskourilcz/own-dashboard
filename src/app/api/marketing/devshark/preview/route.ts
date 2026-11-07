import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { DevsharkDeckSchema } from '@/lib/marketing/devshark-deck';
import { renderDevsharkDeck } from '@/lib/marketing/devshark-render';
import { MarketingRenderError } from '@/lib/marketing/render';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/marketing/devshark/preview (owner request, 7 November 2026): renders a devShark deck as the studio shows
 * it and returns the slides as JPEG data URLs. It stores nothing, publishes nothing and calls no model. A text that
 * does not fit answers with the renderer's code.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await rateLimit(user.id, { key: 'devshark-preview', limit: 60, windowSec: 600 });
  if (!limited.ok) return NextResponse.json({ error: 'rate-limited' }, { status: 429 });
  const input = z.strictObject({ deck: DevsharkDeckSchema }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'invalid-deck' }, { status: 400 });
  try {
    const slides = await renderDevsharkDeck(input.data.deck);
    return NextResponse.json({ slides: slides.map((slide) => ({ src: `data:image/jpeg;base64,${slide.jpeg.toString('base64')}`, alt: slide.alt })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingRenderError ? error.code : 'render-unavailable' }, { status: 422 });
  }
}
