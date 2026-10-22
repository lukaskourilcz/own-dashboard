import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiCandidateSchema, type DneskaiCandidate } from './dneskai-contracts';
import { DNESKAI_EDUCATION_SOURCES, dneskaiCheapIdentity, dneskaiSourceById } from './dneskai-registry';
import { DNESKAI_TOPIC_TITLE_MAX } from './dneskai-topics';
import { pragueMarketingDate } from './weekly-planning';

/**
 * Scouting (#151, plan A2): turns what the night brought into proposed topics (náměty), with no model call and no
 * network request of its own. The nightly collection reads the education sources (registry `topic: 'education'`)
 * under its existing timeouts, cursors and Apify caps; this step only reads the stored reports of those sources and
 * the owner's highly rated library links, and inserts one `proposed` topic per new source. Writes go through the
 * service role; every row carries the owner and the DNESKAi project.
 *
 * Until titling (A4) writes a Czech working title, a topic carries the source's own title, cut to the column's
 * limit, and `evidence.titled = false`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = Pick<SupabaseClient<any>, 'from'>;

/** Reports of the last 48 hours are scouted; older ones were offered on an earlier night. */
export const DNESKAI_SCOUTING_WINDOW_MS = 48 * 3_600_000;
/** At most this many new topics from reports per night, newest first. */
export const DNESKAI_SCOUTING_REPORT_LIMIT = 30;
/** At most this many library links per night, best rated and oldest first, so the backlog arrives a few at a time. */
export const DNESKAI_SCOUTING_LIBRARY_LIMIT = 3;
const CANDIDATE_READ_LIMIT = 200;
const LIBRARY_READ_LIMIT = 200;
const TOPIC_READ_LIMIT = 1000;

export type DneskaiScoutingTopic = {
  kind: 'education'; sourceKind: 'feed' | 'instagram' | 'library'; sourceRef: string; title: string; summary: string | null;
  evidence: { titled: false; urls: string[]; canonicalUrl: string; sourceId?: string; handle?: string; excerpt?: string; publishedAt?: string | null; rating?: number };
};
export type DneskaiScoutingResult = { reports: number; library: number; inserted: number; skipped: number };
type LibraryLink = { id: string; title: string; url: string; description: string | null; usefulness_rating: number | null };

const clip = (value: string, max: number) => { const text = value.replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text; };
const canonical = (url: string) => { try { return dneskaiCheapIdentity({ title: '', text: '', url }).canonicalUrl; } catch { return null; } };

/** One topic per education report: its title (or the caption's first line), first URL, handle and an excerpt. */
export function dneskaiReportTopic(candidate: DneskaiCandidate): DneskaiScoutingTopic | null {
  const source = dneskaiSourceById(candidate.sourceId);
  const url = canonical(candidate.url);
  const title = clip(candidate.title || candidate.text.split('\n')[0] || '', DNESKAI_TOPIC_TITLE_MAX);
  if (!source || !url || !title) return null;
  const instagram = source.kind === 'instagram';
  const handle = instagram ? (candidate.instagram?.ownerUsername ?? new URL(source.url).pathname.split('/').filter(Boolean)[0]) : undefined;
  return {
    kind: 'education', sourceKind: instagram ? 'instagram' : 'feed', sourceRef: `report:${candidate.id}`.slice(0, 300), title,
    summary: candidate.text ? clip(candidate.text, 600) : null,
    evidence: { titled: false, urls: [candidate.url], canonicalUrl: url, sourceId: candidate.sourceId, ...(handle ? { handle } : {}),
      ...(candidate.text ? { excerpt: clip(candidate.text, 1000) } : {}), publishedAt: candidate.publishedAt },
  };
}

/** One topic per library link the owner rated 4 or 5. */
export function dneskaiLibraryTopic(link: LibraryLink): DneskaiScoutingTopic | null {
  const url = /^https:\/\//.test(link.url) ? canonical(link.url) : null;
  const title = clip(link.title, DNESKAI_TOPIC_TITLE_MAX);
  if (!url || !title) return null;
  return {
    kind: 'education', sourceKind: 'library', sourceRef: `library:${link.id}`, title, summary: link.description ? clip(link.description, 600) : null,
    evidence: { titled: false, urls: [link.url], canonicalUrl: url, ...(link.description ? { excerpt: clip(link.description, 1000) } : {}), ...(link.usefulness_rating ? { rating: link.usefulness_rating } : {}) },
  };
}

/**
 * Picks the topics to insert: no source reference or normalised URL that a topic already holds or that an earlier
 * pick took, then the per-night limits.
 */
export function dneskaiScoutingPicks(reports: readonly DneskaiScoutingTopic[], library: readonly DneskaiScoutingTopic[], known: { refs: ReadonlySet<string>; urls: ReadonlySet<string> }) {
  const refs = new Set(known.refs), urls = new Set(known.urls);
  const take = (items: readonly DneskaiScoutingTopic[], limit: number) => {
    const picked: DneskaiScoutingTopic[] = [];
    for (const item of items) {
      if (picked.length >= limit) break;
      if (refs.has(item.sourceRef) || urls.has(item.evidence.canonicalUrl)) continue;
      refs.add(item.sourceRef); urls.add(item.evidence.canonicalUrl); picked.push(item);
    }
    return picked;
  };
  return { reports: take(reports, DNESKAI_SCOUTING_REPORT_LIMIT), library: take(library, DNESKAI_SCOUTING_LIBRARY_LIMIT) };
}

const rows = <T>(result: { data: T[] | null; error: unknown }, code: string): T[] => { if (result.error) throw new Error(code); return result.data ?? []; };

/** One scouting pass for the owner's DNESKAi project. Idempotent: a second pass inserts nothing new. */
export async function scoutDneskaiTopics(db: Database, owner: string, project: string, now: Date): Promise<DneskaiScoutingResult> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const educationIds = DNESKAI_EDUCATION_SOURCES.map((source) => source.id);
  const [candidateResult, libraryResult, topicResult] = await Promise.all([
    db.from('marketing_dneskai_candidates').select('candidate').eq('user_id', owner).eq('project_id', project).in('candidate->>sourceId', educationIds)
      .gte('created_at', new Date(now.getTime() - DNESKAI_SCOUTING_WINDOW_MS).toISOString()).order('created_at', { ascending: false }).limit(CANDIDATE_READ_LIMIT),
    db.from('ai_links').select('id,title,url,description,usefulness_rating').eq('user_id', owner).eq('record_type', 'link').gte('usefulness_rating', 4)
      .order('usefulness_rating', { ascending: false }).order('created_at', { ascending: true }).limit(LIBRARY_READ_LIMIT),
    db.from('marketing_dneskai_topics').select('source_ref,url:evidence->>canonicalUrl').eq('user_id', owner).order('created_at', { ascending: false }).limit(TOPIC_READ_LIMIT),
  ]);
  const reports = rows(candidateResult as { data: Array<{ candidate: unknown }> | null; error: unknown }, 'scouting-reports-unavailable').flatMap((row) => {
    const candidate = DneskaiCandidateSchema.safeParse(row.candidate);
    const topic = candidate.success ? dneskaiReportTopic(candidate.data) : null;
    return topic ? [topic] : [];
  });
  const library = rows(libraryResult as { data: LibraryLink[] | null; error: unknown }, 'scouting-library-unavailable').flatMap((link) => { const topic = dneskaiLibraryTopic(link); return topic ? [topic] : []; });
  const known = rows(topicResult as { data: Array<{ source_ref: string; url: string | null }> | null; error: unknown }, 'scouting-topics-unavailable');
  const picks = dneskaiScoutingPicks(reports, library, { refs: new Set(known.map((row) => row.source_ref)), urls: new Set(known.flatMap((row) => row.url ? [row.url] : [])) });
  const insert = [...picks.reports, ...picks.library];
  if (insert.length) {
    const proposedFor = pragueMarketingDate(now);
    const { error } = await db.from('marketing_dneskai_topics').upsert(insert.map((topic) => ({ user_id: owner, project_id: project, kind: topic.kind, source_kind: topic.sourceKind, source_ref: topic.sourceRef, title_cs: topic.title,
        summary: topic.summary, evidence: topic.evidence, status: 'proposed', proposed_for: proposedFor })), { onConflict: 'user_id,source_ref', ignoreDuplicates: true });
    if (error) throw new Error('scouting-write-failed');
  }
  return { reports: picks.reports.length, library: picks.library.length, inserted: insert.length, skipped: reports.length + library.length - insert.length };
}
