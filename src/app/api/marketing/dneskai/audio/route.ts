import { z } from 'zod';
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

const headers = { 'Cache-Control': 'no-store' };
const STATUS: Record<string, number> = {
  'audio-library-unavailable': 503, 'audio-upload-missing': 409, 'audio-upload-invalid': 422, 'audio-track-unavailable': 404, 'audio-track-write-failed': 503,
};

async function owner() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  return user?.id ?? null;
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
  const user = await owner();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  try {
    const db = createAdminClient();
    const params = new URL(request?.url ?? 'https://local.invalid').searchParams;
    const selected = params.get('trackId');
    const offset = params.get('offset') ?? '0';
    if (!/^\d{1,7}$/.test(offset) || Number(offset) > 1_000_000 || (selected && !z.uuid().safeParse(selected).success)) return Response.json({ error: 'invalid-request' }, { status: 400, headers });
    if (selected) return Response.json({ tracks: await listDneskaiAudioTracks(db, user, selected), nextOffset: null }, { headers });
    const page = await listDneskaiAudioPage(db, user, Number(offset));
    // #167: today's trending sounds, only while their switch is on.
    // #167: Meta's list joined with the niche ranking of the tracked education profiles (both $0, read from storage).
    const trends = Number(offset) === 0 && dneskaiAudioTrendsEnabled() ? await (async () => {
      const niche = await resolveDneskaiProjectId(db, user).then((project) => loadDneskaiNicheSounds(db, user, project, new Date())).catch(() => []);
      return listDneskaiAudioTrends(db, user, pragueMarketingDate(new Date()), niche).catch(() => []);
    })() : undefined;
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
  const user = await owner();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  const limited = await rateLimit(user, { key: 'dneskai-audio', limit: 30, windowSec: 600 });
  if (!limited.ok) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { ...headers, 'Retry-After': String(limited.retryAfter) } });
  let input: DneskaiAudioRequest;
  try { const raw = await request.text(); if (raw.length > 8000) throw new Error('too-large'); input = DneskaiAudioRequestSchema.parse(JSON.parse(raw)); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400, headers }); }
  const db = createAdminClient();
  try {
    if (input.action === 'prepare') return Response.json(await prepareDneskaiAudioUpload(db, user, input.contentType), { headers });
    if (input.action === 'create') return Response.json({ track: await createDneskaiAudioTrack(db, user, input) }, { headers });
    await setDneskaiAudioTrackEnabled(db, user, input.id, input.enabled);
    return Response.json({ ok: true }, { headers });
  } catch (failure) { return failed(failure); }
}
