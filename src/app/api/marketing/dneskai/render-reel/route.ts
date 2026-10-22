import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { authenticateAutomation } from '@/lib/marketing/automation-auth';
import { boundedRequestText } from '@/lib/marketing/http';
import { DneskaiReelRenderError } from '@/lib/marketing/dneskai-reel-render';
import { DneskaiAudioError, loadDneskaiAudioTrack } from '@/lib/marketing/dneskai-audio';
import { DneskaiReelError, createDneskaiReelStorage, dneskaiReelForRevision, dneskaiReelsEnabled, loadDneskaiSlideBytes } from '@/lib/marketing/dneskai-reel';

export const runtime = 'nodejs';
/** A 7-slide render took about 25 s on an M2 (docs/dneskai-source-media.md); 300 s leaves room on one Vercel vCPU. */
export const maxDuration = 300;

const headers = { 'Cache-Control': 'no-store' };
const RequestSchema = z.strictObject({ revisionId: z.uuid() });
/** Leaves 20 s of the function's 300 s for storage and the answer. */
const RENDER_BUDGET_MS = 280_000;

const STATUS: Record<string, number> = {
  'reel-revision-unavailable': 404, 'reel-revision-not-deck': 409, 'reel-render-required': 409,
  'reel-slides-unavailable': 503, 'reel-audio-unavailable': 503, 'reel-storage-failed': 503, 'reel-bucket-required': 503,
  'reel-input-invalid': 409, 'reel-ffmpeg-unavailable': 503, 'reel-compose-failed': 500, 'reel-encode-failed': 500, 'reel-timeout': 504,
};

/**
 * POST /api/marketing/dneskai/render-reel (#163): the 1080 × 1920 Reel MP4 of one revision's rendered slides.
 * Body `{ revisionId }`. Callers: the owner (session, same origin, rate-limited) and the scheduler or publisher
 * (signed automation request). Renders once per reel key (revision hash and audio) into the private
 * `marketing-reels` bucket and answers the signed URL; a second call reuses the stored file. $0: no model call.
 * Answers 404 unless `MARKETING_DNESKAI_REELS_ENABLED=true`.
 */
export async function POST(request: Request) {
  if (!dneskaiReelsEnabled()) return Response.json({ error: 'not-found' }, { status: 404, headers });
  let raw: string;
  try { raw = await boundedRequestText(request, 2000); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400, headers }); }

  let owner: string | null = null;
  if (request.headers.get('x-marketing-signature')) {
    const principal = authenticateAutomation(request, raw);
    if (!principal) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
    if (principal.role !== 'scheduler' && principal.role !== 'publisher') return Response.json({ error: 'forbidden' }, { status: 403, headers });
    owner = principal.ownerId;
  } else {
    const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
    const session = await createClient(); const { data: { user } } = await session.auth.getUser();
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
    const limited = await rateLimit(user.id, { key: 'dneskai-render-reel', limit: 6, windowSec: 600 });
    if (!limited.ok) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { ...headers, 'Retry-After': String(limited.retryAfter) } });
    owner = user.id;
  }

  let input: z.infer<typeof RequestSchema>;
  try { input = RequestSchema.parse(JSON.parse(raw)); } catch { return Response.json({ error: 'invalid-request' }, { status: 400, headers }); }
  const db = createAdminClient();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(RENDER_BUDGET_MS)]);
  try {
    const reel = await dneskaiReelForRevision(db, owner, input.revisionId, {
      loadSlide: (renderKey) => loadDneskaiSlideBytes(db, owner, renderKey),
      // The track the owner approved (#164). A revision without one renders silent here; the publisher (#165) picks
      // the next track in rotation before it asks for the Reel.
      loadAudio: async (revision) => revision.audio ? loadDneskaiAudioTrack(db, owner, revision.audio.trackId) : null,
      storage: createDneskaiReelStorage(db, owner),
      signal,
    });
    return Response.json({ reelKey: reel.reelKey, url: reel.url, sha256: reel.sha256, bytes: reel.bytes, durationSeconds: reel.durationSeconds, silent: reel.silent, cached: reel.cached }, { headers });
  } catch (failure) {
    const code = failure instanceof DneskaiAudioError ? 'reel-audio-unavailable' : failure instanceof DneskaiReelError || failure instanceof DneskaiReelRenderError ? failure.code : 'reel-storage-failed';
    return Response.json({ error: code }, { status: STATUS[code] ?? 500, headers });
  }
}
