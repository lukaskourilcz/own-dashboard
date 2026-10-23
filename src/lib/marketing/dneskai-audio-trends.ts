import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { MetaPublisherConfig } from "./publisher";
import type { DneskaiAudioTrend } from "./dneskai-audio-contracts";

/**
 * DNESKAi trending audio (#167, plan C5). Meta's Audio API (`GET /ig_audio`) returns, without a search query, the
 * trending music and original sounds the account may use. It exists only under Facebook Login, so this does nothing
 * on Instagram Login. A daily tick step stores the day's list in `marketing_audio_trends` (migration
 * 20261023130200); the Lab picker offers them, and a Reel with a trending sound publishes a silent MP4 with
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
  audio_id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d{1,40}$/)),
  title: z.string().min(1).max(300),
  display_artist: z.string().max(300).nullish(),
  duration_in_ms: z.number().int().min(0).max(3_600_000).nullish(),
  // Meta names it `_uri` in search and `_url` in metadata; either is accepted, only https is kept.
  cover_artwork_thumbnail_uri: z.string().max(2048).nullish(),
  cover_artwork_thumbnail_url: z.string().max(2048).nullish(),
});

export type DneskaiTrendIngest = { status: "done" | "skipped"; code?: string; stored: number };

const httpsOrNull = (value: string | null | undefined) => {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
};

/**
 * Reads today's trending sounds of both types and records them: a sound seen before keeps its first day and counts
 * one more day when `last_seen` moves. Under Instagram Login, or without a usable token, it reads nothing.
 */
export async function ingestDneskaiAudioTrends(db: Database, owner: string, input: { config: MetaPublisherConfig; remoteAccountId: string; today: string; fetcher?: typeof fetch; signal?: AbortSignal }): Promise<DneskaiTrendIngest> {
  z.uuid().parse(owner);
  const { config } = input;
  if (config.loginMode !== "facebook") return { status: "skipped", code: "audio-trends-facebook-login-required", stored: 0 };
  if (config.credentialHold || !config.accessToken) return { status: "skipped", code: config.credentialHold ?? "access-token-missing", stored: 0 };
  if (!/^v\d+\.\d+$/.test(config.apiVersion) || !/^\d{1,100}$/.test(input.remoteAccountId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.today)) return { status: "skipped", code: "audio-trends-input-invalid", stored: 0 };
  const items: Array<z.infer<typeof AudioItemSchema> & { audio_type: (typeof DNESKAI_AUDIO_TREND_TYPES)[number] }> = [];
  for (const type of DNESKAI_AUDIO_TREND_TYPES) {
    const url = new URL(`https://graph.facebook.com/${config.apiVersion}/ig_audio`);
    url.searchParams.set("audio_type", type);
    url.searchParams.set("user_id", input.remoteAccountId);
    const timeout = AbortSignal.timeout(10_000);
    let response: Response;
    try {
      response = await (input.fetcher ?? fetch)(url.href, { method: "GET", redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout });
    } catch { throw new Error("audio-trends-request-failed"); }
    if (!response.ok) throw new Error(`meta-http-${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error("meta-invalid-response"); }
    const data = z.object({ data: z.array(z.unknown()).max(500) }).safeParse(body);
    if (!data.success) throw new Error("meta-invalid-response");
    for (const raw of data.data.data.slice(0, DNESKAI_AUDIO_TRENDS_PER_TYPE)) {
      const item = AudioItemSchema.safeParse(raw);
      if (item.success) items.push({ ...item.data, audio_type: type });
    }
  }
  if (!items.length) return { status: "done", stored: 0 };
  const ids = [...new Set(items.map((item) => item.audio_id))];
  const { data: known, error: readError } = await db.from("marketing_audio_trends").select("audio_id,first_seen,last_seen,days_seen").eq("user_id", owner).in("audio_id", ids);
  if (readError) throw new Error("audio-trends-store-failed");
  const previous = new Map((known as Array<{ audio_id: string; first_seen: string; last_seen: string; days_seen: number }> ?? []).map((row) => [row.audio_id, row]));
  const rows = [...new Map(items.map((item) => [item.audio_id, item])).values()].map((item) => {
    const before = previous.get(item.audio_id);
    return {
      user_id: owner, audio_id: item.audio_id, title: item.title.trim().slice(0, 300), display_artist: item.display_artist?.trim().slice(0, 300) || null,
      audio_type: item.audio_type, duration_ms: item.duration_in_ms ?? null,
      cover_artwork_thumbnail_url: httpsOrNull(item.cover_artwork_thumbnail_uri ?? item.cover_artwork_thumbnail_url),
      first_seen: before?.first_seen ?? input.today, last_seen: input.today,
      days_seen: before ? before.days_seen + (before.last_seen === input.today ? 0 : 1) : 1, updated_at: new Date().toISOString(),
    };
  });
  const { error } = await db.from("marketing_audio_trends").upsert(rows, { onConflict: "user_id,audio_id" });
  if (error) throw new Error("audio-trends-store-failed");
  return { status: "done", stored: rows.length };
}

/** The sounds seen in the last two days, most persistent first, for Zdroje → Hudba and the Lab picker. */
export async function listDneskaiAudioTrends(db: Database, owner: string, today: string): Promise<DneskaiAudioTrend[]> {
  z.uuid().parse(owner);
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db.from("marketing_audio_trends").select("audio_id,title,display_artist,audio_type,duration_ms,cover_artwork_thumbnail_url,days_seen,niche_count,tiktok,last_seen")
    .eq("user_id", owner).gte("last_seen", since).order("days_seen", { ascending: false }).limit(50);
  if (error) throw new Error("audio-trends-store-failed");
  return (data as Array<Record<string, unknown>> ?? []).map((row) => ({
    audioId: String(row.audio_id), title: String(row.title), artist: (row.display_artist as string | null) ?? null, type: row.audio_type as DneskaiAudioTrend["type"],
    durationMs: (row.duration_ms as number | null) ?? null, coverUrl: (row.cover_artwork_thumbnail_url as string | null) ?? null,
    daysSeen: Number(row.days_seen), nicheCount: Number(row.niche_count), tiktok: row.tiktok === true,
  }));
}
