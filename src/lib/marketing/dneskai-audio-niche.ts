import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiCandidateSchema, type DneskaiCandidate } from './dneskai-contracts';
import { loadDneskaiSourceCatalog } from './dneskai-source-catalog';

/**
 * The niche audio ranking (#167, plan C5): which licensed sounds the tracked education profiles used on their reels in
 * the last seven days. It reads the reels the nightly collection already stored (scouting keeps each reel's
 * `musicInfo`), so it costs nothing and calls nothing. Original audio and muted sounds do not count: neither can be
 * reused. Each sound counts the distinct reels that used it, weighted by their plays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = Pick<SupabaseClient<any>, 'from'>;

export const DNESKAI_NICHE_AUDIO_WINDOW_MS = 7 * 86_400_000;
const CANDIDATE_READ_LIMIT = 500;

export type DneskaiNicheSound = { audioId: string; title: string | null; artist: string | null; reels: number; plays: number; score: number };

/** Ranks sounds by reels × log of their summed plays, so one viral reel does not outrank a sound many profiles use. */
export function rankDneskaiNicheSounds(candidates: readonly DneskaiCandidate[]): DneskaiNicheSound[] {
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

/** The ranking over the owner's education Instagram profiles for the seven days before `now`. */
export async function loadDneskaiNicheSounds(db: Database, owner: string, project: string, now: Date, env: Record<string, string | undefined> = process.env): Promise<DneskaiNicheSound[]> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const catalog = await loadDneskaiSourceCatalog(db as never, owner, project, env);
  const educationIds = catalog.educationIds();
  if (!educationIds.length) return [];
  const { data, error } = await db.from('marketing_dneskai_candidates').select('candidate').eq('user_id', owner).eq('project_id', project).in('candidate->>sourceId', educationIds)
    .gte('created_at', new Date(now.getTime() - DNESKAI_NICHE_AUDIO_WINDOW_MS).toISOString()).not('candidate->instagram->music', 'is', null)
    .order('created_at', { ascending: false }).limit(CANDIDATE_READ_LIMIT);
  if (error) throw new Error('audio-niche-unavailable');
  const candidates = (data as Array<{ candidate: unknown }> ?? []).flatMap((row) => { const parsed = DneskaiCandidateSchema.safeParse(row.candidate); return parsed.success ? [parsed.data] : []; });
  return rankDneskaiNicheSounds(candidates);
}
