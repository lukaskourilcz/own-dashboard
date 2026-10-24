import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedRequestText, MarketingRequestBodyError } from '@/lib/marketing/http';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { DneskaiAudioRequestSchema, type DneskaiAudioRequest } from '@/lib/marketing/dneskai-audio-contracts';
import { DneskaiAudioError, createDneskaiAudioTrack, listDneskaiAudioTracks, listDneskaiAudioPage, prepareDneskaiAudioUpload, setDneskaiAudioTrackEnabled } from '@/lib/marketing/dneskai-audio';
import { dneskaiReelsEnabled } from '@/lib/marketing/dneskai-reel';
import { dneskaiAudioTrendsEnabled, listDneskaiAudioTrends } from '@/lib/marketing/dneskai-audio-trends';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';
import { loadDneskaiNicheSounds } from '@/lib/marketing/dneskai-audio-niche';
import { resolveDneskaiProjectId } from '@/lib/marketing/scheduler-ports';

export const runtime = 'nodejs';
/** A create downloads the uploaded file (at most 20 MiB) and probes it with ffmpeg. */
export const maxDuration = 60;

const headers = { 'Cache-Control': 'private, no-store' };
const requestBudget = (request: Request | undefined, milliseconds: number) => AbortSignal.any([AbortSignal.timeout(milliseconds), ...(request ? [request.signal] : [])]);
const STATUS: Record<string, number> = {
  'audio-library-unavailable': 503, 'audio-upload-missing': 409, 'audio-upload-invalid': 422, 'audio-track-unavailable': 404, 'audio-track-write-failed': 503,
};

async function owner(parent: AbortSignal) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(10_000)]);
  signal.throwIfAborted();
  const session = await awaitWithSignal(createClient(signal), signal);
  const { data, error } = await awaitWithSignal(session.auth.getUser(), signal);
  if (error) {
    if ([400, 401, 403].includes(error.status ?? 0)) return null;
    throw new DneskaiAudioError('audio-library-unavailable');
  }
  if (!data.user) return null;
  if (!z.uuid().safeParse(data.user.id).success) throw new DneskaiAudioError('audio-library-unavailable');
  return data.user.id;
}
function failed(failure: unknown) {
  const code = failure instanceof DneskaiAudioError ? failure.code : 'audio-library-unavailable';
  return Response.json({ error: code }, { status: STATUS[code] ?? 503, headers });
}

/**
 * GET /api/marketing/dneskai/audio (#164): the owner's audio library with one-hour preview URLs.
 * Answers 404 unless `MARKETING_DNESKAI_REELS_ENABLED=true`, so Zdroje → Hudba and the Lab picker stay hidden.
 */
export async function GET(request?: Request) {
  if (!dneskaiReelsEnabled()) return Response.json({ error: 'not-found' }, { status: 404, headers });
  const signal = requestBudget(request, 18_000);
  try {
    const user = await owner(signal);
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
    const params = new URL(request?.url ?? 'https://local.invalid').searchParams;
    const selected = params.get('trackId');
    const offset = params.get('offset') ?? '0';
    if ([...params.keys()].some(key => !['trackId', 'offset'].includes(key) || params.getAll(key).length !== 1) || !/^\d{1,7}$/.test(offset) || Number(offset) > 1_000_000 || (selected !== null && (!z.uuid().safeParse(selected).success || params.has('offset')))) return Response.json({ error: 'invalid-request' }, { status: 400, headers });
    signal.throwIfAborted();
    const db = createAdminClient(signal);
    if (selected) return Response.json({ tracks: await awaitWithSignal(listDneskaiAudioTracks(db, user, selected), signal), nextOffset: null }, { headers });
    const page = await awaitWithSignal(listDneskaiAudioPage(db, user, Number(offset)), signal);
    // #167: today's trending sounds, only while their switch is on.
    // #167: Meta's list joined with the niche ranking of the tracked education profiles (both $0, read from storage).
    const trends = Number(offset) === 0 && dneskaiAudioTrendsEnabled() ? await awaitWithSignal((async () => {
      const niche = await resolveDneskaiProjectId(db, user).then((project) => loadDneskaiNicheSounds(db, user, project, new Date())).catch(() => []);
      signal.throwIfAborted();
      return listDneskaiAudioTrends(db, user, pragueMarketingDate(new Date()), niche).catch(() => []);
    })(), signal) : undefined;
    return Response.json({ ...page, ...(trends ? { trends } : {}) }, { headers });
  }
  catch (failure) { return failed(failure); }
}

/**
 * POST /api/marketing/dneskai/audio: `prepare` hands out a signed upload URL for one new file; `create` checks that
 * file (size, decodable audio, 1 s to 15 min) and records the track with its title, artist, source, licence note,
 * source page and mood tags; `toggle` switches a track on or off. Owner only, same origin, rate-limited. $0.
 */
export async function POST(request: Request) {
  if (!dneskaiReelsEnabled()) return Response.json({ error: 'not-found' }, { status: 404, headers });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = requestBudget(request, 50_000);
  try {
    const user = await owner(signal);
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
    let input: DneskaiAudioRequest;
    try { input = DneskaiAudioRequestSchema.parse(JSON.parse(await boundedRequestText(request, 8192, signal))); }
    catch (error) {
      if (signal.aborted) throw error;
      const timedOut = error instanceof MarketingRequestBodyError && error.code === 'request-body-timeout';
      return Response.json({ error: timedOut ? 'audio-library-unavailable' : 'invalid-request' }, { status: timedOut ? 408 : 400, headers });
    }
    const limited = await awaitWithSignal(rateLimit(user, { key: 'dneskai-audio', limit: 30, windowSec: 600 }), signal);
    if (!limited.ok) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { ...headers, 'Retry-After': String(limited.retryAfter) } });
    signal.throwIfAborted();
    const db = createAdminClient(signal);
    if (input.action === 'prepare') return Response.json(await awaitWithSignal(prepareDneskaiAudioUpload(db, user, input.contentType), signal), { headers });
    if (input.action === 'create') return Response.json({ track: await awaitWithSignal(createDneskaiAudioTrack(db, user, input, { signal }), signal) }, { headers });
    await awaitWithSignal(setDneskaiAudioTrackEnabled(db, user, input.id, input.enabled), signal);
    return Response.json({ ok: true }, { headers });
  } catch (failure) { return failed(failure); }
}
