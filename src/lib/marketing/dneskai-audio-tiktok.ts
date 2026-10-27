import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiApifyRunSchema, DneskaiProviderError, type DneskaiApifyRegistration } from './dneskai-providers';
import { reserveDneskaiTopicSpend } from './dneskai-topic-spend';
import type { MetaPublisherConfig } from './publisher';
import { pragueMarketingDate } from './weekly-planning';
import { awaitWithSignal } from '@/lib/abortable';
import {DneskaiAudioAccountSchema,type DneskaiAudioAccount} from './dneskai-audio-trends';
import {readDneskaiTikTokProgress,completeDneskaiTikTokRun,TikTokTerminalRunSchema,type DneskaiTikTokMatch} from './dneskai-tiktok-progress';
import {databaseTimestamp,databaseVersion} from '@/lib/database-version';
import { boundedResponseText } from '@/lib/bounded-response';

/**
 * The TikTok early signal (#167, plan C5): TikTok Creative Center's Czech sound chart through Apify's
 * `clockworks/tiktok-trends-scraper`, once a day under its own cost cap in the topic spend ledger
 * (`20261023130300`). A chart sound found in Meta's audio search for @dneskai (Facebook Login) marks its row in
 * `marketing_audio_trends` with `tiktok = true`; nothing else is stored. Off unless `DNESKAI_TIKTOK_TRENDS_ENABLED`.
 *
 * One daily tick reads the run the previous tick started and settles its cost, then reserves and starts today's,
 * so the signal is a day behind and the tick never waits for Apify.
 */
type Database = Pick<SupabaseClient, 'rpc'>;
type Environment = Record<string, string | undefined>;

export const DNESKAI_TIKTOK_ACTOR = { id: 'sDvA9jM4WRTDX4Syr', name: 'clockworks~tiktok-trends-scraper' } as const;
/** 25 results estimate $0.0935 on Free / $0.076 on Starter (25 October); the charge cap stays $0.10. */
export const DNESKAI_TIKTOK_RESERVATION_USD = 0.1;
export const DNESKAI_TIKTOK_RESULTS = 25;
export const DEFAULT_DNESKAI_TIKTOK_DAILY_USD = 0.1;
export const DNESKAI_TIKTOK_PASS_MS = 12_000;
export const DNESKAI_TIKTOK_RESPONSE_BYTES = 262_144;

async function boundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  try { return JSON.parse(await boundedResponseText(response, DNESKAI_TIKTOK_RESPONSE_BYTES, signal)); }
  catch { active(signal); throw new DneskaiProviderError('tiktok-response-unavailable'); }
}
const discard = (response: Response | undefined) => {
  if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
};
async function providerResponse(fetcher: typeof fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  active(signal);
  let received: Response | undefined;
  try {
    return await awaitWithSignal(fetcher(url, { ...init, signal }).then(response => {
      received = response;
      if (signal.aborted) discard(response);
      return response;
    }), signal);
  } catch (error) { discard(received); throw error; }
}

export function dneskaiTikTokTrendsEnabled(env: Environment = process.env): boolean {
  return env.DNESKAI_TIKTOK_TRENDS_ENABLED === 'true';
}
/** `MARKETING_DNESKAI_TIKTOK_DAILY_USD`, default $0.10; a malformed value refuses every run. */
export function dneskaiTikTokDailyCeiling(env: Environment = process.env): number {
  const raw = env.MARKETING_DNESKAI_TIKTOK_DAILY_USD;
  if (raw === undefined || raw.trim() === '') return DEFAULT_DNESKAI_TIKTOK_DAILY_USD;
  const value = /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new DneskaiProviderError('tiktok-budget-invalid');
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
  const sounds = items.flatMap((raw) => {
    const item = SoundSchema.safeParse(raw);
    if (!item.success || item.data.error) return [];
    const title = (item.data.title ?? item.data.songName ?? item.data.name ?? '').trim();
    if (!title) return [];
    return [{ title: title.slice(0, 300), artist: (item.data.author ?? item.data.artist ?? '').trim().slice(0, 300) || null, rank: item.data.rank ?? null }];
  });
  const unique = new Map<string, DneskaiTikTokSound>();
  for (const sound of sounds) {
    const key = JSON.stringify([audioIdentity(sound.title), audioIdentity(sound.artist ?? '')]);
    if (!unique.has(key)) unique.set(key, sound);
  }
  return [...unique.values()].slice(0, DNESKAI_TIKTOK_RESULTS);
}

async function apify(path: string, init: RequestInit, env: Environment, fetcher: typeof fetch, signal: AbortSignal): Promise<unknown> {
  active(signal);
  let response: Response;
  try { response = await providerResponse(fetcher, `https://api.apify.com/v2/${path}`, { ...init, headers: { Authorization: `Bearer ${env.APIFY_TOKEN}`, 'Content-Type': 'application/json' }, redirect: 'error', cache: 'no-store' }, signal); }
  catch { active(signal); throw new DneskaiProviderError('tiktok-request-failed'); }
  if (signal.aborted || !response.ok) {
    discard(response);
    active(signal);
    throw new DneskaiProviderError(`tiktok-http-${response.status}`);
  }
  const body = await boundedResponse(response, signal);
  active(signal);
  return body;
}

function active(signal: AbortSignal) {
  if (signal.aborted) throw new DneskaiProviderError('tiktok-cancelled');
}

const audioIdentity = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const searchSchema = z.object({
  data: z.array(z.object({
    audio_id: z.union([z.string().regex(/^\d{1,40}$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String),
    title: z.string().max(300).trim().min(1), display_artist: z.string().max(300).nullish(),
  })).max(50),
  paging: z.object({next: z.string().max(16_384).nullish()}).optional(), error: z.unknown().optional(),
});
/** Unique exact title/artist in one bounded returned set. A continued set cannot prove uniqueness. */
function matchedAudio(sound: DneskaiTikTokSound, body: unknown): { audioId: string; title: string; artist: string | null } | null {
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success || parsed.data.error !== undefined) throw new DneskaiProviderError('tiktok-audio-unavailable');
  if (parsed.data.paging?.next != null) return null;
  const byId = new Map<string, {audioId: string; title: string; artist: string | null}>();
  const conflicting = new Set<string>();
  for (const item of parsed.data.data) {
    const value = {audioId: item.audio_id, title: item.title, artist: item.display_artist?.trim() || null};
    const previous = byId.get(value.audioId);
    if (previous && (previous.title !== value.title || previous.artist !== value.artist)) conflicting.add(value.audioId);
    else byId.set(value.audioId, value);
  }
  if (conflicting.size) return null;
  const matching = [...byId.values()].filter(item => audioIdentity(item.title) === audioIdentity(sound.title) &&
    (!sound.artist || (item.artist !== null && audioIdentity(item.artist) === audioIdentity(sound.artist))));
  return matching.length === 1 ? matching[0] : null;
}

/** Facebook Login only; unavailable search retains the run for reconciliation instead of confirming no match. */
async function instagramAudioFor(sound: DneskaiTikTokSound, config: MetaPublisherConfig, igUserId: string, fetcher: typeof fetch, signal: AbortSignal): Promise<{ audioId: string; title: string; artist: string | null } | null> {
  active(signal);
  const url = new URL(`https://graph.facebook.com/${config.apiVersion}/ig_audio`);
  url.searchParams.set('audio_type', 'music'); url.searchParams.set('user_id', igUserId);
  url.searchParams.set('search_query', [sound.title, sound.artist].filter(Boolean).join(' ').slice(0, 200));
  let response: Response;
  try { response = await providerResponse(fetcher, url.href, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${config.accessToken}` } }, signal); }
  catch { active(signal); throw new DneskaiProviderError('tiktok-audio-unavailable'); }
  if (signal.aborted || !response.ok) {
    discard(response); active(signal); throw new DneskaiProviderError('tiktok-audio-unavailable');
  }
  const body = await boundedResponse(response, signal);
  active(signal);
  return matchedAudio(sound, body);
}

export type DneskaiTikTokOutcome = { status: 'done' | 'skipped'; code?: string; started: boolean; read: number; matched: number };

/**
 * One daily pass: read and settle the previous run (marking matched sounds), then reserve and start today's. Under
 * Instagram Login it does nothing and spends nothing: without Meta's audio search no chart title can become a sound.
 */
export async function advanceDneskaiTikTokChart(db: Database, owner: string, input: { config: MetaPublisherConfig; account: DneskaiAudioAccount; igUserId: string; today: string; env?: Environment; fetcher?: typeof fetch; signal: AbortSignal; now?: Date }): Promise<DneskaiTikTokOutcome> {
  const parent = input.signal, lifetime = new AbortController(), timer = setTimeout(() => lifetime.abort(), DNESKAI_TIKTOK_PASS_MS);
  const signal = AbortSignal.any([parent, lifetime.signal]);
  try {
    return await awaitWithSignal(advanceTikTokPass(db, owner, { ...input, signal }), signal);
  } catch (error) {
    if (parent.aborted) throw new DneskaiProviderError('tiktok-cancelled');
    if (lifetime.signal.aborted) throw new DneskaiProviderError('tiktok-deadline');
    throw error;
  } finally { clearTimeout(timer); lifetime.abort(); }
}
async function advanceTikTokPass(db: Database, owner: string, input: Parameters<typeof advanceDneskaiTikTokChart>[2]): Promise<DneskaiTikTokOutcome> {
  z.uuid().parse(owner);
  const originalEnv = input.env ?? process.env;
  const env: Environment = Object.fromEntries(['DNESKAI_TIKTOK_TRENDS_ENABLED', 'MARKETING_DNESKAI_APIFY_ENABLED', 'MARKETING_DNESKAI_PAID_ENABLED', 'MARKETING_AI_CONSENT', 'APIFY_TOKEN', 'MARKETING_DNESKAI_TIKTOK_DAILY_USD'].map(key => [key, originalEnv[key]]));
  const fetcher = input.fetcher ?? fetch, now = new Date((input.now ?? new Date()).getTime());
  // Later phases retain the original account, day and switches while asynchronous work is pending.
  const config = { ...input.config }, today = input.today, igUserId = input.igUserId, signal = input.signal;
  const outcome: DneskaiTikTokOutcome = { status: 'done', started: false, read: 0, matched: 0 };
  if (!dneskaiTikTokTrendsEnabled(env)) return { ...outcome, status: 'skipped', code: 'tiktok-trends-disabled' };
  if (config.loginMode !== 'facebook' || config.credentialHold || !config.accessToken) return { ...outcome, status: 'skipped', code: 'audio-trends-facebook-login-required' };
  if (!Number.isFinite(now.getTime()) || !z.iso.date().safeParse(today).success || pragueMarketingDate(now) !== today || !/^\d{1,100}$/.test(igUserId) || !/^v\d+\.\d+$/.test(config.apiVersion)) return { ...outcome, status: 'skipped', code: 'tiktok-input-invalid' };
  const parsedAccount = DneskaiAudioAccountSchema.safeParse(input.account);
  if (!parsedAccount.success || parsedAccount.data.user_id !== owner || parsedAccount.data.remote_account_id !== igUserId || databaseVersion(parsedAccount.data.verified_at)! > BigInt(now.getTime())*BigInt(1000)) return {...outcome,status:'skipped',code:'tiktok-input-invalid'};
  const account = parsedAccount.data;
  active(signal);
  const rows = await readDneskaiTikTokProgress(db, owner, now, signal);
  active(signal);

  // 1. The previous run: read its chart once it has finished, mark the sounds, settle the measured cost.
  for (const row of rows.filter((item) => !item.processed)) {
    active(signal);
    const ids = /^tiktok:([A-Za-z0-9_-]{1,100}):([A-Za-z0-9_-]{1,100})$/.exec(row.ref);
    if (!ids || !env.APIFY_TOKEN) continue;
    const registration = DneskaiApifyRunSchema.extend({startedAt: databaseTimestamp}).safeParse((await apify(`actor-runs/${ids[1]}`, { method: 'GET' }, env, fetcher, signal) as { data?: unknown })?.data);
    if (!registration.success || registration.data.id !== ids[1] || registration.data.actId !== DNESKAI_TIKTOK_ACTOR.id || registration.data.defaultDatasetId !== ids[2]) throw new DneskaiProviderError('tiktok-run-unavailable');
    if (['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'].includes(registration.data.status)) continue;
    const run = TikTokTerminalRunSchema.safeParse({id: registration.data.id, actorId: registration.data.actId, datasetId: registration.data.defaultDatasetId,
      status: registration.data.status, startedAt: registration.data.startedAt, finishedAt: registration.data.finishedAt, usageUsd: registration.data.usageTotalUsd ?? null});
    if (!run.success || databaseVersion(run.data.startedAt)! < databaseVersion(row.reserved_at)! - BigInt(300_000_000) ||
      databaseVersion(run.data.finishedAt)! < databaseVersion(run.data.startedAt)! || databaseVersion(run.data.finishedAt)! > BigInt(now.getTime()+300_000)*BigInt(1000)) throw new DneskaiProviderError('tiktok-run-unavailable');
    // Apify warns the first terminal response may still carry preliminary cost/statistics.
    if (databaseVersion(run.data.finishedAt)! > BigInt(now.getTime())*BigInt(1000)-BigInt(10_000_000)) continue;
    if (run.data.usageUsd === null) throw new DneskaiProviderError('tiktok-cost-unavailable');
    const sourceDay = pragueMarketingDate(new Date(row.reserved_at)), since = new Date(Date.parse(today+'T12:00:00Z')-86_400_000).toISOString().slice(0,10);
    const matches = new Map<string,DneskaiTikTokMatch>();
    if (run.data.status === 'SUCCEEDED' && sourceDay >= since) {
      const raw = await apify(`datasets/${ids[2]}/items?format=json&clean=true&limit=${DNESKAI_TIKTOK_RESULTS + 5}`, { method: 'GET' }, env, fetcher, signal);
      const items = z.array(z.unknown()).max(200).safeParse(raw);
      if (!items.success) throw new DneskaiProviderError('tiktok-invalid-response');
      const sounds = dneskaiTikTokSounds(items.data);
      outcome.read += sounds.length;
      for (const sound of sounds) {
        const audio = await instagramAudioFor(sound, config, igUserId, fetcher, signal);
        if (!audio) continue;
        const previous = matches.get(audio.audioId);
        if (previous && (previous.title !== audio.title || previous.artist !== audio.artist)) throw new DneskaiProviderError('tiktok-audio-unavailable');
        matches.set(audio.audioId,audio);
      }
    }
    active(signal);
    outcome.matched += await completeDneskaiTikTokRun(db, owner, {account,row,run:run.data,matches:[...matches.values()],now,signal});
    active(signal);
  }

  // 2. Today's run, once a day, only when every paid switch is on and the cap has room.
  if (rows.some((row) => pragueMarketingDate(new Date(row.reserved_at)) === today)) return outcome;
  if (!paidAllowed(env)) return { ...outcome, code: 'tiktok-paid-disabled' };
  active(signal);
  const spendId = await reserveDneskaiTopicSpend(db, owner, 'tiktok', 'tiktok:pending', DNESKAI_TIKTOK_RESERVATION_USD, dneskaiTikTokDailyCeiling(env), signal);
  active(signal);
  if (!spendId) return { ...outcome, code: 'tiktok-budget-exhausted' };
  const params = new URLSearchParams({ waitForFinish: '0', timeout: '300', restartOnError: 'false', maxItems: String(DNESKAI_TIKTOK_RESULTS), maxTotalChargeUsd: String(DNESKAI_TIKTOK_RESERVATION_USD) });
  let run: DneskaiApifyRegistration;
  try { run = DneskaiApifyRunSchema.parse((await apify(`acts/${DNESKAI_TIKTOK_ACTOR.name}/runs?${params}`, { method: 'POST', body: JSON.stringify(dneskaiTikTokInput()) }, env, fetcher, signal) as { data?: unknown })?.data); }
  catch (failure) {
    // Whether Apify started a run is unknown, so the reservation stays and counts in full.
    return { ...outcome, code: failure instanceof Error && /^tiktok-/.test(failure.message) ? failure.message : 'tiktok-invalid-response' };
  }
  if (run.actId !== DNESKAI_TIKTOK_ACTOR.id) return { ...outcome, code: 'tiktok-apify-binding-invalid' };
  active(signal);
  const bound = await awaitWithSignal(db.rpc('marketing_dneskai_tiktok_bind', { p_owner: owner, p_id: spendId, p_ref: `tiktok:${run.id}:${run.defaultDatasetId}` }).retry(false).abortSignal(signal), signal);
  active(signal);
  if (bound.error || bound.data !== true) return { ...outcome, code: 'tiktok-budget-unavailable' };
  return { ...outcome, started: true };
}
