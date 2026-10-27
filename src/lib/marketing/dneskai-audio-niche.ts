import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiCandidateSchema, type DneskaiCandidate } from './dneskai-contracts';
import { loadDneskaiSourceCatalog } from './dneskai-source-catalog';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';

/**
 * The niche audio ranking (#167, plan C5): which music sounds the tracked education profiles used on their reels in
 * the last seven days. It reads the reels the nightly collection already stored (scouting keeps each reel's
 * `musicInfo`), without starting a provider or model call. Original and muted audio are excluded from these hints;
 * that filter establishes neither a licence nor attachment availability. Each sound counts distinct reels,
 * weighted by their plays. Only the separate Meta list marks a hint attachable for the account.
 */
type Database = Pick<SupabaseClient, 'from' | 'rpc'>;
export const DNESKAI_NICHE_AUDIO_WINDOW_MS = 7 * 86_400_000;
export const DNESKAI_NICHE_AUDIO_MAX = 10_000;
const optionalLabel = z.string().max(300).nullable().transform(value => value?.trim() || null);
const musicSchema = DneskaiCandidateSchema.shape.instagram.unwrap().shape.music.unwrap().extend({
  title: optionalLabel, artist: optionalLabel,
});
const rowSchema = z.strictObject({
  id: DneskaiCandidateSchema.shape.id, createdAt: databaseTimestamp,
  sourceId: DneskaiCandidateSchema.shape.sourceId, externalId: DneskaiCandidateSchema.shape.externalId,
  instagram: z.strictObject({plays: z.number().int().min(0).max(1e12), music: musicSchema}),
});
const sourceIdsSchema = z.array(DneskaiCandidateSchema.shape.sourceId).max(120);
const snapshotSchema = z.strictObject({
  ownerId: z.uuid(), projectId: z.uuid(), sourceIds: sourceIdsSchema,
  since: databaseTimestamp, until: databaseTimestamp, rows: z.array(rowSchema).max(DNESKAI_NICHE_AUDIO_MAX),
});
type CandidateMusic = NonNullable<NonNullable<DneskaiCandidate['instagram']>['music']>;
type RankingMusic = Omit<CandidateMusic, 'title' | 'artist'> & {title?: string | null; artist?: string | null};
type RankingCandidate = {externalId: string; instagram?: {plays?: number; music?: RankingMusic}};

export type DneskaiNicheSound = { audioId: string; title: string | null; artist: string | null; reels: number; plays: number; score: number };

/** Ranks sounds by reels × log of their summed plays, so one viral reel does not outrank a sound many profiles use. */
export function rankDneskaiNicheSounds(candidates: readonly RankingCandidate[]): DneskaiNicheSound[] {
  const sounds = new Map<string, { title: string | null; artist: string | null; reels: Set<string>; plays: number }>();
  for (const candidate of candidates) {
    const music = candidate.instagram?.music;
    if (!music || music.originalAudio || music.muted) continue;
    const entry = sounds.get(music.audioId) ?? { title: null, artist: null, reels: new Set<string>(), plays: 0 };
    if (entry.reels.has(candidate.externalId)) continue;
    entry.reels.add(candidate.externalId);
    entry.plays += candidate.instagram?.plays ?? 0;
    entry.title ??= music.title ?? null;
    entry.artist ??= music.artist ?? null;
    sounds.set(music.audioId, entry);
  }
  return [...sounds.entries()].map(([audioId, entry]) => ({ audioId, title: entry.title, artist: entry.artist, reels: entry.reels.size, plays: entry.plays,
    score: Math.round(entry.reels.size * Math.log10(10 + entry.plays) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || b.reels - a.reels || a.audioId.localeCompare(b.audioId));
}

/** Complete seven-day ranking facts only, under one captured owner/project/window. */
export async function loadDneskaiNicheSounds(
  db: Database, owner: string, project: string, now: Date,
  env: Record<string, string | undefined> = process.env, parent?: AbortSignal,
): Promise<DneskaiNicheSound[]> {
  try {
    z.uuid().parse(owner); z.uuid().parse(project);
    const instant = now.getTime();
    if (!Number.isFinite(instant)) throw new Error();
    const until = new Date(instant).toISOString(), since = new Date(instant - DNESKAI_NICHE_AUDIO_WINDOW_MS).toISOString();
    const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
    const flags = {DNESKAI_SOURCES_TABLE_ENABLED: env.DNESKAI_SOURCES_TABLE_ENABLED};
    signal.throwIfAborted();
    const catalog = await loadDneskaiSourceCatalog(db, owner, project, flags, signal);
    signal.throwIfAborted();
    const sourceIds = sourceIdsSchema.parse([...catalog.educationIds()].sort());
    if (new Set(sourceIds).size !== sourceIds.length) throw new Error();
    if (!sourceIds.length) return [];
    const reply = await awaitWithSignal(db.rpc('read_dneskai_niche_audio', {
      p_owner: owner, p_project: project, p_source_ids: sourceIds, p_since: since, p_until: until,
    }).retry(false).abortSignal(signal), signal);
    signal.throwIfAborted();
    if (reply.error) throw new Error();
    const snapshot = snapshotSchema.parse(reply.data);
    const lower = databaseVersion(since)!, upper = databaseVersion(until)!;
    if (snapshot.ownerId !== owner || snapshot.projectId !== project ||
      databaseVersion(snapshot.since) !== lower || databaseVersion(snapshot.until) !== upper ||
      JSON.stringify(snapshot.sourceIds) !== JSON.stringify(sourceIds) ||
      new Set(snapshot.rows.map(row => row.id)).size !== snapshot.rows.length ||
      snapshot.rows.some(row => !sourceIds.includes(row.sourceId) || databaseVersion(row.createdAt)! < lower || databaseVersion(row.createdAt)! > upper)) throw new Error();
    return rankDneskaiNicheSounds(snapshot.rows);
  } catch { throw new Error('audio-niche-unavailable'); }
}
