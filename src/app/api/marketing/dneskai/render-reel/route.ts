import { after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { authenticateAutomation } from '@/lib/marketing/automation-auth';
import { boundedRequestText } from '@/lib/marketing/http';
import { DneskaiReelRenderError } from '@/lib/marketing/dneskai-reel-render';
import { DneskaiAudioError, loadDneskaiAudioTrack } from '@/lib/marketing/dneskai-audio';
import { DneskaiReelError, createDneskaiReelStorage, recordDneskaiReel, dneskaiReelForRevision, dneskaiReelsEnabled, loadDneskaiSlideBytes } from '@/lib/marketing/dneskai-reel';

export const runtime = 'nodejs';
/** A 7-slide render took about 25 s on an M2 (docs/dneskai-source-media.md); 300 s leaves room on one Vercel vCPU. */
export const maxDuration = 300;

const headers = { 'Cache-Control': 'no-store' };
/**
 * `audioTrackId` and `async` are for the scheduler only (#165): the rotation's track for a post without its own
 * choice, and an answer of 202 before the render, which then runs in `after()` within this function's 300 s.
 */
const RequestSchema = z.strictObject({ revisionId: z.uuid(), audioTrackId: z.uuid().nullable().optional(), async: z.literal(true).optional() });
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
  let automation = false;
  if (request.headers.get('x-marketing-signature')) {
    automation = true;
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
  if (!automation && (input.audioTrackId !== undefined || input.async)) return Response.json({ error: 'invalid-request' }, { status: 400, headers });
  const ownerId = owner;
  const db = createAdminClient();
  const render = async (signal: AbortSignal) => {
    const reel = await dneskaiReelForRevision(db, ownerId, input.revisionId, {
      loadSlide: (renderKey) => loadDneskaiSlideBytes(db, ownerId, renderKey),
      // The track the owner approved (#164); without one, the rotation's track the scheduler names, or silence.
      loadAudio: async (revision) => {
        // A trending Instagram sound (#167) is attached by Instagram: the MP4 stays silent.
        if (revision.audio && 'instagramAudioId' in revision.audio) return null;
        const trackId = revision.audio?.trackId ?? input.audioTrackId ?? null;
        return trackId ? loadDneskaiAudioTrack(db, ownerId, trackId) : null;
      },
      storage: createDneskaiReelStorage(db, ownerId),
      signal,
    });
    // The publisher finds the Reel of a revision through this record, whichever track it carries (#165).
    await recordDneskaiReel(db, ownerId, input.revisionId, { reelKey: reel.reelKey, revisionHash: reel.revisionHash, audioId: reel.audioId, sha256: reel.sha256, bytes: reel.bytes });
    return reel;
  };
  const codeOf = (failure: unknown) => failure instanceof DneskaiAudioError ? 'reel-audio-unavailable' : failure instanceof DneskaiReelError || failure instanceof DneskaiReelRenderError ? failure.code : 'reel-storage-failed';
  if (input.async) {
    // The caller (the 60 s tick) does not wait; this function keeps its own 300 s for the render.
    after(async () => {
      try { await render(AbortSignal.timeout(RENDER_BUDGET_MS)); }
      catch (failure) { console.warn(JSON.stringify({ event: 'dneskai-reel-render-failed', code: codeOf(failure) })); }
    });
    return Response.json({ status: 'rendering' }, { status: 202, headers });
  }
  try {
    const reel = await render(AbortSignal.any([request.signal, AbortSignal.timeout(RENDER_BUDGET_MS)]));
    return Response.json({ reelKey: reel.reelKey, url: reel.url, sha256: reel.sha256, bytes: reel.bytes, durationSeconds: reel.durationSeconds, silent: reel.silent, cached: reel.cached }, { headers });
  } catch (failure) {
    const code = codeOf(failure);
    return Response.json({ error: code }, { status: STATUS[code] ?? 500, headers });
  }
}
