import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiApifyRunSchema, type DneskaiApifyRegistration } from './dneskai-providers';
import { reserveDneskaiTopicSpend, settleDneskaiTopicSpend } from './dneskai-topic-spend';
import type { MetaPublisherConfig } from './publisher';

/**
 * The TikTok early signal (#167, plan C5): TikTok Creative Center's Czech sound chart through Apify's
 * `clockworks/tiktok-trends-scraper`, once a day under its own cost cap in the topic spend ledger
 * (`20261023130300`). A chart sound found in Meta's audio search for @dneskai (Facebook Login) marks its row in
 * `marketing_audio_trends` with `tiktok = true`; nothing else is stored. Off unless `DNESKAI_TIKTOK_TRENDS_ENABLED`.
 *
 * One daily tick reads the run the previous tick started and settles its cost, then reserves and starts today's,
 * so the signal is a day behind and the tick never waits for Apify.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = Pick<SupabaseClient<any>, 'from' | 'rpc'>;
type Environment = Record<string, string | undefined>;

export const DNESKAI_TIKTOK_ACTOR = { id: 'sDvA9jM4WRTDX4Syr', name: 'clockworks~tiktok-trends-scraper' } as const;
/** About 25 sounds at $0.003 each plus the $0.001 start, held under this per-run charge cap. */
export const DNESKAI_TIKTOK_RESERVATION_USD = 0.1;
export const DNESKAI_TIKTOK_RESULTS = 25;
export const DEFAULT_DNESKAI_TIKTOK_DAILY_USD = 0.1;

export function dneskaiTikTokTrendsEnabled(env: Environment = process.env): boolean {
  return env.DNESKAI_TIKTOK_TRENDS_ENABLED === 'true';
}
/** `MARKETING_DNESKAI_TIKTOK_DAILY_USD`, default $0.10; a malformed value refuses every run. */
export function dneskaiTikTokDailyCeiling(env: Environment = process.env): number {
  const raw = env.MARKETING_DNESKAI_TIKTOK_DAILY_USD;
  if (raw === undefined || raw.trim() === '') return DEFAULT_DNESKAI_TIKTOK_DAILY_USD;
  const value = /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error('tiktok-budget-invalid');
  return value;
}
/** Paid starts need the collection's Apify and paid switches, the AI consent and this switch. */
function paidAllowed(env: Environment) {
  return dneskaiTikTokTrendsEnabled(env) && env.MARKETING_DNESKAI_APIFY_ENABLED === 'true' && env.MARKETING_DNESKAI_PAID_ENABLED === 'true' && env.MARKETING_AI_CONSENT === 'true' && !!env.APIFY_TOKEN;
}

/** The actor input: Czech songs on the surging leaderboard, no hashtags, creators or videos. */
export function dneskaiTikTokInput() {
  return { adsScrapeSounds: true, adsSoundsCountryCode: 'CZ', adsRankType: 'surging', adsScrapeHashtags: false, adsScrapeCreators: false, adsScrapeVideos: false, resultsPerPage: DNESKAI_TIKTOK_RESULTS };
}

const SoundSchema = z.object({ title: z.string().max(300).optional(), name: z.string().max(300).optional(), songName: z.string().max(300).optional(),
  author: z.string().max(300).optional(), artist: z.string().max(300).optional(), rank: z.number().optional(), error: z.unknown().optional() }).loose();
export type DneskaiTikTokSound = { title: string; artist: string | null; rank: number | null };
/** The chart's sounds by title (and artist, when the item has one); error items and untitled items are dropped. */
export function dneskaiTikTokSounds(items: readonly unknown[]): DneskaiTikTokSound[] {
  return items.flatMap((raw) => {
    const item = SoundSchema.safeParse(raw);
    if (!item.success || item.data.error) return [];
    const title = (item.data.title ?? item.data.songName ?? item.data.name ?? '').trim();
    if (!title) return [];
    return [{ title: title.slice(0, 300), artist: (item.data.author ?? item.data.artist ?? '').trim().slice(0, 300) || null, rank: item.data.rank ?? null }];
  }).slice(0, DNESKAI_TIKTOK_RESULTS);
}

async function apify(path: string, init: RequestInit, env: Environment, fetcher: typeof fetch, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(`https://api.apify.com/v2/${path}`, { ...init, headers: { Authorization: `Bearer ${env.APIFY_TOKEN}`, 'Content-Type': 'application/json' }, redirect: 'error', signal }); }
  catch { throw new Error('tiktok-request-failed'); }
  if (!response.ok) throw new Error(`tiktok-http-${response.status}`);
  try { return await response.json(); } catch { throw new Error('tiktok-invalid-response'); }
}

/** Searches Meta's audio for a chart title; the best hit's id, or null. Facebook Login only. */
async function instagramAudioFor(sound: DneskaiTikTokSound, config: MetaPublisherConfig, igUserId: string, fetcher: typeof fetch, signal: AbortSignal): Promise<{ audioId: string; title: string; artist: string | null } | null> {
  const url = new URL(`https://graph.facebook.com/${config.apiVersion}/ig_audio`);
  url.searchParams.set('audio_type', 'music'); url.searchParams.set('user_id', igUserId);
  url.searchParams.set('search_query', [sound.title, sound.artist].filter(Boolean).join(' ').slice(0, 200));
  let response: Response;
  try { response = await fetcher(url.href, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${config.accessToken}` }, signal }); }
  catch { return null; }
  if (!response.ok) return null;
  const body = z.object({ data: z.array(z.object({ audio_id: z.union([z.string(), z.number()]).transform(String), title: z.string().max(300), display_artist: z.string().max(300).nullish() }).loose()).max(50) })
    .safeParse(await response.json().catch(() => null));
  const hit = body.success ? body.data.data.find((item) => /^\d{1,40}$/.test(item.audio_id) && item.title.trim().toLowerCase() === sound.title.toLowerCase()) : undefined;
  return hit ? { audioId: hit.audio_id, title: hit.title.trim(), artist: hit.display_artist?.trim() || null } : null;
}

export type DneskaiTikTokOutcome = { status: 'done' | 'skipped'; code?: string; started: boolean; read: number; matched: number };

/**
 * One daily pass: read and settle the previous run (marking matched sounds), then reserve and start today's. Under
 * Instagram Login it does nothing and spends nothing: without Meta's audio search no chart title can become a sound.
 */
export async function advanceDneskaiTikTokChart(db: Database, owner: string, input: { config: MetaPublisherConfig; igUserId: string; today: string; env?: Environment; fetcher?: typeof fetch; signal: AbortSignal; now?: Date }): Promise<DneskaiTikTokOutcome> {
  z.uuid().parse(owner);
  const env = input.env ?? process.env, fetcher = input.fetcher ?? fetch, now = input.now ?? new Date();
  const outcome: DneskaiTikTokOutcome = { status: 'done', started: false, read: 0, matched: 0 };
  if (!dneskaiTikTokTrendsEnabled(env)) return { ...outcome, status: 'skipped', code: 'tiktok-trends-disabled' };
  if (input.config.loginMode !== 'facebook' || input.config.credentialHold || !input.config.accessToken) return { ...outcome, status: 'skipped', code: 'audio-trends-facebook-login-required' };
  const runs = await db.rpc('marketing_dneskai_tiktok_runs', { p_owner: owner });
  if (runs.error) throw new Error('tiktok-budget-unavailable');
  const rows = z.array(z.object({ id: z.uuid(), ref: z.string(), reserved_at: z.string(), settled: z.boolean() })).parse(runs.data ?? []);

  // 1. The previous run: read its chart once it has finished, mark the sounds, settle the measured cost.
  for (const row of rows.filter((item) => !item.settled)) {
    const ids = /^tiktok:([A-Za-z0-9_-]{1,100}):([A-Za-z0-9_-]{1,100})$/.exec(row.ref);
    if (!ids || !env.APIFY_TOKEN) continue;
    const run = DneskaiApifyRunSchema.safeParse((await apify(`actor-runs/${ids[1]}`, { method: 'GET' }, env, fetcher, input.signal) as { data?: unknown })?.data);
    if (!run.success || run.data.actId !== DNESKAI_TIKTOK_ACTOR.id || run.data.defaultDatasetId !== ids[2]) continue;
    if (['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'].includes(run.data.status)) continue;
    if (run.data.status === 'SUCCEEDED') {
      const items = z.array(z.unknown()).max(200).safeParse(await apify(`datasets/${ids[2]}/items?format=json&clean=true&limit=${DNESKAI_TIKTOK_RESULTS + 5}`, { method: 'GET' }, env, fetcher, input.signal));
      const sounds = items.success ? dneskaiTikTokSounds(items.data) : [];
      outcome.read += sounds.length;
      for (const sound of sounds) {
        const audio = await instagramAudioFor(sound, input.config, input.igUserId, fetcher, input.signal);
        if (!audio) continue;
        const { error } = await db.from('marketing_audio_trends').upsert({ user_id: owner, audio_id: audio.audioId, title: audio.title, display_artist: audio.artist, audio_type: 'music',
          first_seen: input.today, last_seen: input.today, tiktok: true, updated_at: now.toISOString() }, { onConflict: 'user_id,audio_id', ignoreDuplicates: true });
        if (error) throw new Error('audio-trends-store-failed');
        await db.from('marketing_audio_trends').update({ tiktok: true }).eq('user_id', owner).eq('audio_id', audio.audioId);
        outcome.matched++;
      }
    }
    // An unknown cost counts in full, as everywhere in the ledger.
    await settleDneskaiTopicSpend(db, owner, row.id, run.data.usageTotalUsd ?? DNESKAI_TIKTOK_RESERVATION_USD);
  }

  // 2. Today's run, once a day, only when every paid switch is on and the cap has room.
  if (rows.some((row) => Date.parse(row.reserved_at) > now.getTime() - 20 * 3_600_000)) return outcome;
  if (!paidAllowed(env)) return { ...outcome, code: 'tiktok-paid-disabled' };
  const spendId = await reserveDneskaiTopicSpend(db, owner, 'tiktok', 'tiktok:pending', DNESKAI_TIKTOK_RESERVATION_USD, dneskaiTikTokDailyCeiling(env));
  if (!spendId) return { ...outcome, code: 'tiktok-budget-exhausted' };
  const params = new URLSearchParams({ waitForFinish: '0', timeout: '300', restartOnError: 'false', maxItems: String(DNESKAI_TIKTOK_RESULTS), maxTotalChargeUsd: String(DNESKAI_TIKTOK_RESERVATION_USD) });
  let run: DneskaiApifyRegistration;
  try { run = DneskaiApifyRunSchema.parse((await apify(`acts/${DNESKAI_TIKTOK_ACTOR.name}/runs?${params}`, { method: 'POST', body: JSON.stringify(dneskaiTikTokInput()) }, env, fetcher, input.signal) as { data?: unknown })?.data); }
  catch (failure) {
    // Whether Apify started a run is unknown, so the reservation stays and counts in full.
    return { ...outcome, code: failure instanceof Error && /^tiktok-/.test(failure.message) ? failure.message : 'tiktok-invalid-response' };
  }
  if (run.actId !== DNESKAI_TIKTOK_ACTOR.id) return { ...outcome, code: 'tiktok-apify-binding-invalid' };
  const bound = await db.rpc('marketing_dneskai_tiktok_bind', { p_owner: owner, p_id: spendId, p_ref: `tiktok:${run.id}:${run.defaultDatasetId}` });
  if (bound.error || bound.data !== true) return { ...outcome, code: 'tiktok-budget-unavailable' };
  return { ...outcome, started: true };
}
