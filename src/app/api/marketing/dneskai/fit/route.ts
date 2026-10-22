import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { dneskaiFitResponse } from '@/lib/marketing/dneskai-fit';

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * POST /api/marketing/dneskai/fit (design-lab-spec.md §5): text fit feedback for the Design Lab while the owner types.
 * Body `{ kit, slides: [{ type, variant?, headline, body?, kicker?, credit?, images: ['image-1', …] }] }`; answers per
 * slide and field whether it fits the kit's template. Pure: no media, no render, no storage and no model call ($0).
 * Rate-limited per owner because the Lab calls it on every pause in typing.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await rateLimit(user.id, { key: 'dneskai-fit', limit: 120, windowSec: 60 });
  if (!limited.ok) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } });
  return dneskaiFitResponse(request);
}
