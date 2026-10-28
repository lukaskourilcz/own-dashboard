import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
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
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  try {
    const context = await readVerifiedServerContext(signal);
    if (!context) return Response.json({ error: 'unauthorized' }, { status: 401 });
    signal.throwIfAborted();
    const rateSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
    rateSignal.throwIfAborted();
    const limited = await awaitWithSignal(rateLimit(context.ownerId, { key: 'dneskai-fit', limit: 120, windowSec: 60 }), rateSignal);
    signal.throwIfAborted();
    if (!limited.ok) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } });
    return await dneskaiFitResponse(request, signal);
  } catch {
    return Response.json({ error: 'fit-unavailable' }, { status: 503 });
  }
}
