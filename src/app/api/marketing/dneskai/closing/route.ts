import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { DNESKAI_CLOSING_DEFAULTS, renderDneskaiClosingCard } from '@/lib/marketing/dneskai-closing-card';

export const runtime = 'nodejs';

/**
 * The DNESKAi closing slide's settings (owner, 9 November 2026). GET reads the owner's row (defaults when none: off, the
 * original words); `?preview=1&headline=&body=&handle=` draws the card for those words as a PNG; PUT saves the switch
 * and the words. While the switch is on, the plan adds the slide with these words to every planned carousel; while it
 * is off, the plan takes it off. Only the signed-in owner, through RLS.
 */
const WordsSchema = z.strictObject({
  headline: z.string().trim().min(1).max(24),
  body: z.string().trim().min(1).max(160),
  handle: z.string().trim().regex(/^@[A-Za-z0-9._]{1,30}$/),
});
const SaveSchema = WordsSchema.extend({ enabled: z.boolean() });
const headers = { 'Cache-Control': 'private, no-store' };

async function owner() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  return { db, user };
}

export async function GET(request: Request) {
  const { db, user } = await owner();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  if (params.get('preview') === '1') {
    const words = WordsSchema.safeParse({ headline: params.get('headline') ?? DNESKAI_CLOSING_DEFAULTS.headline, body: params.get('body') ?? DNESKAI_CLOSING_DEFAULTS.body, handle: params.get('handle') ?? DNESKAI_CLOSING_DEFAULTS.handle });
    if (!words.success) return Response.json({ error: 'closing-words-invalid' }, { status: 400 });
    try {
      const png = await renderDneskaiClosingCard(words.data);
      return new Response(new Uint8Array(png), { headers: { ...headers, 'Content-Type': 'image/png' } });
    } catch { return Response.json({ error: 'closing-preview-failed' }, { status: 503 }); }
  }
  const { data, error } = await db.from('marketing_dneskai_closing').select('enabled,headline,body,handle,updated_at').eq('user_id', user.id).maybeSingle();
  if (error) return Response.json({ error: 'closing-unavailable' }, { status: 503 });
  return Response.json(data ?? { enabled: false, ...DNESKAI_CLOSING_DEFAULTS, updated_at: null }, { headers });
}

export async function PUT(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const { db, user } = await owner();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const input = SaveSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: 'closing-words-invalid' }, { status: 400 });
  const { data, error } = await db.from('marketing_dneskai_closing').upsert({ user_id: user.id, ...input.data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('enabled,headline,body,handle,updated_at').single();
  if (error) return Response.json({ error: 'closing-unavailable' }, { status: 503 });
  return Response.json(data, { headers });
}
