import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { MetaPublisherConfig } from "./publisher";
import { DNESKAI_AUDIO_TRENDS_MAX, DneskaiAudioTrendSchema, type DneskaiAudioTrend } from "./dneskai-audio-contracts";
import type { DneskaiNicheSound } from "./dneskai-audio-niche";
import { awaitWithSignal } from "@/lib/abortable";
import { boundedResponseText } from "@/lib/bounded-response";
import { databaseTimestamp, databaseVersion } from "@/lib/database-version";
import { pragueMarketingDate } from "./weekly-planning";

/**
 * DNESKAi trending audio (#167, plan C5). Meta's Audio API (`GET /ig_audio`) returns, without a search query, the
 * trending music and original sounds the account may use. It exists only under Facebook Login, so this does nothing
 * on Instagram Login. A daily tick step stores the day's list in `marketing_audio_trends` (migration
 * 20261023130200, with account-bound atomic observations in 20261027044222); the Lab picker offers them, and a Reel with a trending sound publishes a silent MP4 with
 * `audio_configuration`. Behind `DNESKAI_AUDIO_TRENDS_ENABLED`.
 */
type Database = ReturnType<typeof createAdminClient>;

export function dneskaiAudioTrendsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DNESKAI_AUDIO_TRENDS_ENABLED === "true";
}

export const DNESKAI_AUDIO_TREND_TYPES = ["music", "original_sound"] as const;
/** At most this many sounds of each type are kept per day. */
export const DNESKAI_AUDIO_TRENDS_PER_TYPE = 25;

const AudioItemSchema = z.object({
  audio_id: z.union([z.string(), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String).pipe(z.string().regex(/^\d{1,40}$/)),
  title: z.string().max(300).trim().min(1),
  display_artist: z.string().max(300).nullish(),
  duration_in_ms: z.number().int().min(0).max(3_600_000).nullish(),
  // Meta names it `_uri` in search and `_url` in metadata; either is accepted, only https is kept.
  cover_artwork_thumbnail_uri: z.string().max(2048).nullish(),
  cover_artwork_thumbnail_url: z.string().max(2048).nullish(),
});

export type DneskaiTrendIngest = { status: "done" | "skipped"; code?: string; stored: number };

const httpsOrNull = (value: string | null | undefined) => {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && url.href.length <= 2048 && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /^(access_token|api_key|client_secret|authorization)$/i.test(key)) ? url.href : null; } catch { return null; }
};

export const DneskaiAudioAccountSchema = z.strictObject({
  id: z.uuid(), user_id: z.uuid(), brand: z.literal("dneskai"), platform: z.literal("instagram"),
  remote_account_id: z.string().regex(/^\d{1,100}$/), verified_at: databaseTimestamp, enabled: z.boolean(),
});
export type DneskaiAudioAccount = z.infer<typeof DneskaiAudioAccountSchema>;
const observationSchema = z.strictObject({
  audioId: DneskaiAudioTrendSchema.shape.audioId, outcome: z.enum(["stored", "superseded"]),
  title: DneskaiAudioTrendSchema.shape.title.min(1).refine(value => value.trim() === value), artist: DneskaiAudioTrendSchema.shape.artist,
  type: DneskaiAudioTrendSchema.shape.type, durationMs: DneskaiAudioTrendSchema.shape.durationMs, coverUrl: DneskaiAudioTrendSchema.shape.coverUrl,
  firstSeen: z.iso.date(), lastSeen: z.iso.date(), daysSeen: z.number().int().positive().max(2_147_483_647),
  accountId: z.uuid(), remoteAccountId: z.string().regex(/^\d{1,100}$/), verifiedAt: databaseTimestamp, observedAt: databaseTimestamp,
});
const observationReceipt = z.strictObject({
  ownerId: z.uuid(), accountId: z.uuid(), remoteAccountId: z.string().regex(/^\d{1,100}$/), verifiedAt: databaseTimestamp,
  day: z.iso.date(), observedAt: databaseTimestamp, status: z.enum(["done", "account-changed", "day-changed"]), rows: z.array(observationSchema).max(50),
});

/** One captured free-metadata pass; stored counts confirmed current observations, including exact replays. */
export async function ingestDneskaiAudioTrends(db: Database, owner: string, input: {
  config: MetaPublisherConfig; account: DneskaiAudioAccount; remoteAccountId: string; today: string;
  now?: Date; fetcher?: typeof fetch; signal?: AbortSignal;
}): Promise<DneskaiTrendIngest> {
  z.uuid().parse(owner);
  // Capture credentials, identity and clock before any await. Never serialize config into persistence or diagnostics.
  const { loginMode, credentialHold, accessToken, apiVersion } = input.config;
  if (loginMode !== "facebook") return { status: "skipped", code: "audio-trends-facebook-login-required", stored: 0 };
  if (credentialHold || !accessToken) return { status: "skipped", code: credentialHold ?? "access-token-missing", stored: 0 };
  const parsed = DneskaiAudioAccountSchema.safeParse(input.account), remote = input.remoteAccountId, day = input.today;
  const instant = (input.now ?? new Date()).getTime(), fetcher = input.fetcher ?? fetch;
  if (!parsed.success || parsed.data.user_id !== owner || parsed.data.remote_account_id !== remote ||
    !/^v\d+\.\d+$/.test(apiVersion) || !z.iso.date().safeParse(day).success || !Number.isFinite(instant) ||
    pragueMarketingDate(new Date(instant)) !== day || Date.parse(parsed.data.verified_at) > instant)
    return { status: "skipped", code: "audio-trends-input-invalid", stored: 0 };
  const account = parsed.data, observedAt = new Date(instant).toISOString();
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(input.signal ? [input.signal] : [])]);
  const items: Array<z.infer<typeof AudioItemSchema> & { audio_type: (typeof DNESKAI_AUDIO_TREND_TYPES)[number] }> = [];
  let received: Response | undefined;
  try {
    signal.throwIfAborted();
    for (const type of DNESKAI_AUDIO_TREND_TYPES) {
      const url = new URL(`https://graph.facebook.com/${apiVersion}/ig_audio`);
      url.searchParams.set("audio_type", type); url.searchParams.set("user_id", remote);
      const pending = fetcher(url.href, { method: "GET", redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` }, signal })
        .then(response => { received = response; if (signal.aborted && response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); return response; });
      const response = await awaitWithSignal(pending, signal); signal.throwIfAborted();
      if (!response.ok) { if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); throw new Error(); }
      const body: unknown = JSON.parse(await boundedResponseText(response, 256 * 1024, signal));
      const data = z.object({ data: z.array(z.unknown()).max(500) }).parse(body);
      for (const raw of data.data.slice(0, DNESKAI_AUDIO_TRENDS_PER_TYPE)) {
        const item = AudioItemSchema.safeParse(raw);
        if (item.success) items.push({ ...item.data, audio_type: type });
      }
      signal.throwIfAborted();
      received = undefined;
    }
  } catch {
    if (received?.body && !received.body.locked) void received.body.cancel().catch(() => undefined);
    throw new Error("audio-trends-request-failed");
  }
  if (!items.length) return { status: "done", stored: 0 };
  const rows = [...new Map(items.map(item => [item.audio_id, item])).values()].map(item => ({
    audio_id: item.audio_id, title: item.title, display_artist: item.display_artist?.trim() || null,
    audio_type: item.audio_type, duration_ms: item.duration_in_ms ?? null,
    cover_artwork_thumbnail_url: httpsOrNull(item.cover_artwork_thumbnail_uri ?? item.cover_artwork_thumbnail_url),
  }));
  try {
    signal.throwIfAborted();
    const reply = await awaitWithSignal(db.rpc("record_dneskai_audio_observations", {
      p_owner: owner, p_account: account.id, p_remote: remote, p_verified_at: account.verified_at,
      p_enabled: account.enabled, p_day: day, p_observed_at: observedAt, p_items: rows,
    }).retry(false).abortSignal(signal), signal);
    signal.throwIfAborted();
    if (reply.error) throw new Error();
    const receipt = observationReceipt.parse(reply.data), version = databaseVersion(observedAt)!;
    if (receipt.ownerId !== owner || receipt.accountId !== account.id || receipt.remoteAccountId !== remote ||
      databaseVersion(receipt.verifiedAt) !== databaseVersion(account.verified_at) || receipt.day !== day || databaseVersion(receipt.observedAt) !== version) throw new Error();
    if (receipt.status !== "done") {
      if (receipt.rows.length) throw new Error();
      return { status: "skipped", code: `audio-trends-${receipt.status}`, stored: 0 };
    }
    if (receipt.rows.length !== rows.length || new Set(receipt.rows.map(row => row.audioId)).size !== rows.length) throw new Error();
    let stored = 0;
    for (const row of receipt.rows) {
      const expected = rows.find(item => item.audio_id === row.audioId);
      if (!expected || row.accountId !== account.id || row.remoteAccountId !== remote || databaseVersion(row.verifiedAt) !== databaseVersion(account.verified_at) ||
        row.firstSeen > row.lastSeen || row.firstSeen > day || row.lastSeen !== day || databaseVersion(row.observedAt)! < version) throw new Error();
      if (row.outcome === "superseded") { if (databaseVersion(row.observedAt)! <= version) throw new Error(); continue; }
      if (databaseVersion(row.observedAt) !== version || row.title !== expected.title || row.artist !== expected.display_artist || row.type !== expected.audio_type ||
        row.durationMs !== expected.duration_ms || row.coverUrl !== expected.cover_artwork_thumbnail_url) throw new Error();
      stored++;
    }
    return { status: "done", stored };
  } catch { throw new Error("audio-trends-store-failed"); }
}

/** Niche-only sounds shown next to Meta's list. */
export const DNESKAI_NICHE_SOUNDS_SHOWN = 15;

const TrendRowSchema = z.strictObject({
  user_id: z.uuid(), audio_id: DneskaiAudioTrendSchema.shape.audioId,
  title: DneskaiAudioTrendSchema.shape.title.min(1).refine(value => value.trim() === value), display_artist: DneskaiAudioTrendSchema.shape.artist,
  audio_type: DneskaiAudioTrendSchema.shape.type, duration_ms: DneskaiAudioTrendSchema.shape.durationMs,
  cover_artwork_thumbnail_url: DneskaiAudioTrendSchema.shape.coverUrl, days_seen: DneskaiAudioTrendSchema.shape.daysSeen.min(1),
  tiktok: z.literal(false), last_seen: z.iso.date(),
  observed_account_id: z.uuid(), observed_remote_account_id: z.string().regex(/^\d{1,100}$/),
  observed_verified_at: databaseTimestamp, observed_at: databaseTimestamp,
});
const NicheSchema = z.array(z.object({
  audioId: DneskaiAudioTrendSchema.shape.audioId, title: DneskaiAudioTrendSchema.shape.title.min(1).refine(value => value.trim() === value).nullable(), artist: DneskaiAudioTrendSchema.shape.artist,
  reels: z.number().int().nonnegative(), plays: z.number().nonnegative(), score: z.number().nonnegative(),
})).max(10_000);
const compareAudioId = (a: { audioId: string }, b: { audioId: string }) => a.audioId < b.audioId ? -1 : a.audioId > b.audioId ? 1 : 0;

/**
 * The sounds seen in the last two days, most persistent first, for Zdroje → Hudba and the Lab picker, joined by audio
 * id with the niche ranking (#167): Meta's sounds get their niche count; the niche's own top sounds follow as hints
 * that Instagram may not attach.
 */
export async function listDneskaiAudioTrends(db: Database, owner: string, today: string, niche: readonly DneskaiNicheSound[] = [], parent?: AbortSignal): Promise<DneskaiAudioTrend[]> {
  try {
    z.uuid().parse(owner); z.iso.date().parse(today);
    const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
    signal.throwIfAborted();
    const hints = NicheSchema.parse(niche);
    if (new Set(hints.map(sound => sound.audioId)).size !== hints.length) throw new Error();
    const since = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await awaitWithSignal(db.rpc("read_dneskai_audio_observations", {p_owner: owner, p_today: today}).retry(false).abortSignal(signal), signal);
    signal.throwIfAborted();
    if (error) throw new Error();
    const snapshot = z.strictObject({ownerId: z.uuid(), today: z.iso.date(), rows: z.array(TrendRowSchema).max(DNESKAI_AUDIO_TRENDS_MAX)}).parse(data);
    const rows = snapshot.rows;
    if (snapshot.ownerId !== owner || snapshot.today !== today || new Set(rows.map(row => row.audio_id)).size !== rows.length ||
      rows.some(row => row.user_id !== owner || row.last_seen < since || row.last_seen > today ||
        pragueMarketingDate(new Date(row.observed_at)) < since || pragueMarketingDate(new Date(row.observed_at)) > today ||
        databaseVersion(row.observed_verified_at)! > databaseVersion(row.observed_at)! ||
        row.observed_account_id !== rows[0].observed_account_id || row.observed_remote_account_id !== rows[0].observed_remote_account_id ||
        databaseVersion(row.observed_verified_at) !== databaseVersion(rows[0].observed_verified_at))) throw new Error();
    const ranked = new Map(hints.map(sound => [sound.audioId, sound]));
    const meta: DneskaiAudioTrend[] = rows.map(row => ({
      audioId: row.audio_id, title: row.title, artist: row.display_artist, type: row.audio_type,
      durationMs: row.duration_ms, coverUrl: row.cover_artwork_thumbnail_url,
      daysSeen: row.days_seen, nicheCount: ranked.get(row.audio_id)?.reels ?? 0, tiktok: row.tiktok, attachable: true,
    })).sort((a, b) => b.nicheCount - a.nicheCount || b.daysSeen - a.daysSeen || compareAudioId(a, b));
    const listed = new Set(meta.map(sound => sound.audioId));
    const nicheOnly: DneskaiAudioTrend[] = hints.filter(sound => !listed.has(sound.audioId) && sound.title)
      .sort((a, b) => b.score - a.score || b.reels - a.reels || compareAudioId(a, b)).slice(0, DNESKAI_NICHE_SOUNDS_SHOWN).map(sound => ({
        audioId: sound.audioId, title: sound.title!, artist: sound.artist, type: "music", durationMs: null, coverUrl: null, daysSeen: 0, nicheCount: sound.reels, tiktok: false, attachable: false,
      }));
    // These are bounded recommendations: Meta sounds first, then hints only while slots remain.
    return [...meta, ...nicheOnly].slice(0, DNESKAI_AUDIO_TRENDS_MAX);
  } catch { throw new Error("audio-trends-store-failed"); }
}
