import { after } from 'next/server';
import { z } from 'zod';
import {readVerifiedServerOwner} from '@/lib/supabase/server-owner';
import {awaitWithSignal} from '@/lib/abortable';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { authenticateAutomation } from '@/lib/marketing/automation-auth';
import { boundedRequestText, MarketingRequestBodyError } from '@/lib/marketing/http';
import { DneskaiReelRenderError } from '@/lib/marketing/dneskai-reel-render';
import { DneskaiAudioError, loadDneskaiAudioTrack } from '@/lib/marketing/dneskai-audio';
import { DneskaiReelError, createDneskaiReelStorage, recordDneskaiReel, dneskaiReelForRevision, dneskaiReelsEnabled, loadDneskaiSlideBytes } from '@/lib/marketing/dneskai-reel';

export const runtime = 'nodejs';
/** Native encoding retains the existing five-minute function limit. */
export const maxDuration = 300;

const headers = { 'Cache-Control': 'private, no-store', Vary:'Cookie' };
/**
 * `audioTrackId` and `async` are for the scheduler only (#165): the rotation's track for a post without its own
 * choice, and an answer of 202 before the render, which then runs in `after()` within this function's 300 s.
 */
const RequestSchema = z.strictObject({ revisionId: z.uuid(), audioTrackId: z.uuid().nullable().optional(), async: z.literal(true).optional() });
/** Bound the render/record phase inside the function's existing 300 s limit. */
const RENDER_BUDGET_MS = 280_000;

const STATUS: Record<string, number> = {
  'reel-request-unavailable':503, 'reel-revision-unavailable': 404, 'reel-revision-not-deck': 409, 'reel-render-required': 409,
  'reel-slides-unavailable': 503, 'reel-audio-unavailable': 503, 'reel-storage-failed': 503, 'reel-bucket-required': 503,
  'reel-input-invalid': 409, 'reel-ffmpeg-unavailable': 503, 'reel-compose-failed': 500, 'reel-encode-failed': 500, 'reel-timeout': 504,
};

/**
 * POST /api/marketing/dneskai/render-reel (#163): the 1080 × 1920 Reel MP4 of one revision's rendered slides.
 * Body `{ revisionId }`. Callers: the owner (session, same origin, rate-limited) and the scheduler or publisher
 * (signed automation request). Reuses a verified stored MP4 for the same ordered slide/audio bytes and encoding policy; otherwise renders
 * into the private `marketing-reels` bucket and answers its signed URL. No model call; encoding uses server compute and private storage.
 * Answers 404 unless `MARKETING_DNESKAI_REELS_ENABLED=true`.
 */
export async function POST(request: Request) {
    if (!dneskaiReelsEnabled())
        return Response.json({ error: 'not-found' }, { status: 404, headers });
    const automation = !!request.headers.get('x-marketing-signature');
    if (!automation) {
        const csrf = rejectCrossOrigin(request);
        if (csrf) {
            for (const [key, value] of Object.entries(headers))
                csrf.headers.set(key, value);
            return csrf;
        }
    }
    const admission = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
    let ownerId: string, input: z.infer<typeof RequestSchema>;
    try {
        const raw = await boundedRequestText(request, 2000, admission);
        admission.throwIfAborted();
        if (automation) {
            const principal = authenticateAutomation(request, raw);
            if (!principal)
                return Response.json({ error: 'unauthorized' }, { status: 401, headers });
            if (principal.role !== 'scheduler' && principal.role !== 'publisher')
                return Response.json({ error: 'forbidden' }, { status: 403, headers });
            ownerId = principal.ownerId;
        }
        else {
            const owner = await readVerifiedServerOwner(admission);
            if (!owner)
                return Response.json({ error: 'unauthorized' }, { status: 401, headers });
            ownerId = owner;
        }
        admission.throwIfAborted();
        try {
            input = RequestSchema.parse(JSON.parse(raw));
        }
        catch {
            return Response.json({ error: 'invalid-request' }, { status: 400, headers });
        }
        if (!automation && (input.audioTrackId !== undefined || input.async))
            return Response.json({ error: 'invalid-request' }, { status: 400, headers });
        if (!automation) {
            const limited = await awaitWithSignal(rateLimit(ownerId, { key: 'dneskai-render-reel', limit: 6, windowSec: 600 }), admission);
            admission.throwIfAborted();
            if (!limited.ok)
                return Response.json({ error: 'rate-limited' }, { status: 429, headers: { ...headers, 'Retry-After': String(limited.retryAfter) } });
        }
        admission.throwIfAborted();
    }
    catch (failure) {
        if (failure instanceof MarketingRequestBodyError && !['request-body-aborted', 'request-body-timeout'].includes(failure.code))
            return Response.json({ error: 'invalid-request' }, { status: 400, headers });
        return Response.json({ error: 'reel-request-unavailable' }, { status: failure instanceof MarketingRequestBodyError && failure.code === 'request-body-timeout' ? 408 : 503, headers });
    }
    const render = async (signal: AbortSignal) => {
        signal.throwIfAborted();
        const db = createAdminClient(signal);
        const reel = await awaitWithSignal(dneskaiReelForRevision(db, ownerId, input.revisionId, {
            loadSlide: renderKey => loadDneskaiSlideBytes(db, ownerId, renderKey),
            loadAudio: async (revision) => {
                if (revision.audio && 'instagramAudioId' in revision.audio)
                    return null;
                const trackId = revision.audio?.trackId ?? input.audioTrackId ?? null;
                return trackId ? loadDneskaiAudioTrack(db, ownerId, trackId, signal) : null;
            },
            storage: createDneskaiReelStorage(db, ownerId, signal), signal,
        }), signal);
        signal.throwIfAborted();
        await awaitWithSignal(recordDneskaiReel(db, ownerId, input.revisionId, { reelKey: reel.reelKey, revisionHash: reel.revisionHash, audioId: reel.audioId, sha256: reel.sha256, bytes: reel.bytes }), signal);
        signal.throwIfAborted();
        return reel;
    };
    const codeOf = (failure: unknown, signal: AbortSignal) => signal.aborted ? 'reel-timeout' : failure instanceof DneskaiAudioError ? 'reel-audio-unavailable' : failure instanceof DneskaiReelError || failure instanceof DneskaiReelRenderError ? failure.code : 'reel-storage-failed';
    if (input.async) {
        try {
            after(async () => {
                const signal = AbortSignal.timeout(RENDER_BUDGET_MS);
                try {
                    await render(signal);
                }
                catch (failure) {
                    console.warn(JSON.stringify({ event: 'dneskai-reel-render-failed', code: codeOf(failure, signal) }));
                }
            });
        }
        catch {
            return Response.json({ error: 'reel-request-unavailable' }, { status: 503, headers });
        }
        return Response.json({ status: 'rendering' }, { status: 202, headers });
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(RENDER_BUDGET_MS)]);
    try {
        const reel = await render(signal);
        return Response.json({ reelKey: reel.reelKey, url: reel.url, sha256: reel.sha256, bytes: reel.bytes, durationSeconds: reel.durationSeconds, silent: reel.silent, cached: reel.cached }, { headers });
    }
    catch (failure) {
        const code = request.signal.aborted ? 'reel-request-unavailable' : codeOf(failure, signal);
        return Response.json({ error: code }, { status: STATUS[code] ?? 500, headers });
    }
}
