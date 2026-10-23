import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiCandidateSchema, type DneskaiCandidate } from './dneskai-contracts';
import { createDneskaiBriefsWithStore, dneskaiFreeSlots, dneskaiMemberHash, type DneskaiBriefRow, type DneskaiBriefStore } from './dneskai-briefs';
import { pragueDayAfter } from './dneskai-workspace';
import { pragueMarketingDate } from './weekly-planning';
import { dneskaiActiveSlotTimes, type DneskaiDailyMix } from './dneskai-daily-mix';

/**
 * The topic-to-brief bridge (#155, plan A6). An approved topic (námět) becomes a brief, then a queued generation job
 * through the same guarded path as the night's selection: brief build with the stored source pictures, repeat check,
 * slot, marketing_dneskai_prepare_brief, source head, calendar entry and marketing_enqueue_job. Nothing is generated
 * for a topic the owner has not approved, and the owner still approves the exact rendered post.
 *
 * - A news topic points at the brief row its event already has; the bridge builds and admits that row.
 * - An education topic from a collected report gets its own brief row (rank 5–16, `topic_id`) in the report's run,
 *   for the first day with a free slot (today, else tomorrow). Its report becomes `selected` for that day, so the
 *   scheduler's media step collects its pictures (og:image, article figures, GitHub social preview) first.
 * - A topic from the link library or added by hand has no collected report yet; it waits with
 *   `evidence.bridgeCode = 'topic-source-unsupported'`.
 *
 * Status: approved → enriching (brief row exists, waiting for pictures or a slot) → briefed (job queued) →
 * generated (the job's draft is in review). A brief that lapses leaves its code on the topic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = SupabaseClient<any>;

export type DneskaiBridgeTopic = { id: string; kind: 'news' | 'education'; status: 'approved' | 'enriching' | 'briefed'; source_ref: string; title_cs: string; brief_id: string | null; evidence: Record<string, unknown> | null };
export type DneskaiBridgeCandidate = { id: string; run_id: string; status: DneskaiCandidate['status']; target_date: string | null; content_hash: string; candidate: DneskaiCandidate };

export interface DneskaiTopicBridgeStore {
  /** Approved, enriching and briefed topics, oldest approval first (bounded). */
  topics(owner: string, project: string): Promise<DneskaiBridgeTopic[]>;
  brief(owner: string, project: string, briefId: string): Promise<DneskaiBriefRow | null>;
  candidate(owner: string, project: string, candidateId: string): Promise<DneskaiBridgeCandidate | null>;
  /** Marks a report selected for a day, so media collection and the brief's member checks accept it. */
  selectCandidate(owner: string, project: string, candidate: DneskaiBridgeCandidate, targetDate: string): Promise<void>;
  /** Inserts the topic's brief row with the next free rank from 5; returns the existing row on a repeat. */
  insertTopicBrief(owner: string, row: Pick<DneskaiBriefRow, 'project_id' | 'run_id' | 'event_id' | 'target_date' | 'category' | 'member_ids' | 'lead_candidate_id' | 'member_hash'> & { topic_id: string }): Promise<DneskaiBriefRow>;
  updateTopic(owner: string, topicId: string, patch: { status?: 'approved' | 'enriching' | 'briefed' | 'generated'; brief_id?: string; evidence?: Record<string, unknown> }): Promise<void>;
  /** The job's status and its draft revision id. */
  job(owner: string, jobId: string): Promise<{ status: string; revisionId: string | null } | null>;
  /** #156: kinds of the topics already committed to a Prague day (enriching, briefed or generated for it). */
  committed?(owner: string, project: string, date: string): Promise<Array<'news' | 'education'>>;
}

export type DneskaiTopicBridgeResult = { enriching: number; briefed: number; generated: number; waiting: number; unsupported: number };

/** A stable 64-hex event id per topic, so one topic is one brief and one calendar entry. */
export function dneskaiTopicEventId(topicId: string): string {
  return createHash('sha256').update(`dneskai-topic-event/1\n${z.uuid().parse(topicId)}`).digest('hex');
}

/**
 * Today when it still has a free slot at least 30 minutes ahead, else tomorrow, else null. With a daily mix (#156)
 * only the active times count, and a day that already holds as many topics of this kind as the mix asks is full.
 */
export async function dneskaiTopicTargetDate(store: Pick<DneskaiBriefStore, 'takenSlots'>, owner: string, project: string, now: Date,
  mix?: { daily: DneskaiDailyMix; kind: 'news' | 'education'; committed?: DneskaiTopicBridgeStore['committed'] }): Promise<string | null> {
  for (const date of [pragueMarketingDate(now), pragueDayAfter(pragueMarketingDate(now), 1)]) {
    if (mix) {
      const target = mix.kind === 'news' ? mix.daily.newsPerDay : mix.daily.educationPerDay;
      const used = mix.committed ? (await mix.committed(owner, project, date)).filter((kind) => kind === mix.kind).length : 0;
      if (used >= target) continue;
    }
    // The run id only excludes that run's own briefs; a nil id excludes none.
    if (dneskaiFreeSlots(date, await store.takenSlots(owner, project, date, '00000000-0000-4000-8000-000000000000'), now, mix ? dneskaiActiveSlotTimes(mix.daily) : undefined).length) return date;
  }
  return null;
}

export async function advanceDneskaiTopicBriefs(stores: { topics: DneskaiTopicBridgeStore; briefs: DneskaiBriefStore }, input: { owner: string; project: string; now: Date; signal: AbortSignal; remainingMs: () => number; mix?: DneskaiDailyMix }): Promise<DneskaiTopicBridgeResult> {
  const { owner, project, now } = input;
  z.uuid().parse(owner); z.uuid().parse(project);
  const result: DneskaiTopicBridgeResult = { enriching: 0, briefed: 0, generated: 0, waiting: 0, unsupported: 0 };
  const evidence = (topic: DneskaiBridgeTopic, patch: Record<string, unknown>) => ({ ...(topic.evidence ?? {}), ...patch });
  const time = () => input.remainingMs() > 8_000 && !input.signal.aborted;

  /** Builds and admits one brief row; moves the topic to briefed when its job exists. */
  const admit = async (topic: DneskaiBridgeTopic, row: DneskaiBriefRow) => {
    const outcome = await createDneskaiBriefsWithStore(stores.briefs, { owner, project, runId: row.run_id, signal: input.signal }, { now: () => now, only: new Set([row.id]), ...(input.mix ? { slotTimes: dneskaiActiveSlotTimes(input.mix) } : {}) });
    const created = outcome.created.find((item) => item.briefId === row.id);
    if (created?.jobId) {
      await stores.topics.updateTopic(owner, topic.id, { status: 'briefed', brief_id: row.id, evidence: evidence(topic, { jobId: created.jobId, bridgeCode: null }) });
      result.briefed++; return;
    }
    const skipped = outcome.skipped.find((item) => item.eventId === row.event_id);
    if (skipped) await stores.topics.updateTopic(owner, topic.id, { evidence: evidence(topic, { bridgeCode: skipped.code }) });
    result.waiting++;
  };

  for (let topic of await stores.topics.topics(owner, project)) {
    if (!time()) break;
    if (topic.status === 'briefed') {
      // Generation finished: the topic is generated and points at its draft.
      const row = topic.brief_id ? await stores.topics.brief(owner, project, topic.brief_id) : null;
      const jobId = row?.job_id ?? (typeof topic.evidence?.jobId === 'string' ? topic.evidence.jobId : null);
      const job = jobId ? await stores.topics.job(owner, jobId) : null;
      if (job?.status === 'review') { await stores.topics.updateTopic(owner, topic.id, { status: 'generated', evidence: evidence(topic, { revisionId: job.revisionId }) }); result.generated++; }
      continue;
    }
    if (topic.source_ref.startsWith('event:')) {
      const row = topic.brief_id ? await stores.topics.brief(owner, project, topic.brief_id) : null;
      if (!row) { await stores.topics.updateTopic(owner, topic.id, { evidence: evidence(topic, { bridgeCode: 'topic-brief-unavailable' }) }); result.unsupported++; continue; }
      if (row.status === 'queued' && row.job_id) { await stores.topics.updateTopic(owner, topic.id, { status: 'briefed', evidence: evidence(topic, { jobId: row.job_id, bridgeCode: null }) }); result.briefed++; continue; }
      if (row.status === 'skipped') { await stores.topics.updateTopic(owner, topic.id, { evidence: evidence(topic, { bridgeCode: row.code ?? 'brief-skipped' }) }); result.waiting++; continue; }
      // #156: a news event belongs to its own day; it waits while that day already has the news posts the mix asks for.
      if (input.mix && topic.status === 'approved') {
        const used = stores.topics.committed ? (await stores.topics.committed(owner, project, row.target_date)).filter((kind) => kind === 'news').length : 0;
        if (used >= input.mix.newsPerDay) { await stores.topics.updateTopic(owner, topic.id, { evidence: evidence(topic, { bridgeCode: 'topic-daily-mix-full' }) }); result.waiting++; continue; }
        await stores.topics.updateTopic(owner, topic.id, { status: 'enriching', evidence: evidence(topic, { targetDate: row.target_date, bridgeCode: null }) });
        topic = { ...topic, status: 'enriching', evidence: evidence(topic, { targetDate: row.target_date }) };
      }
      await admit(topic, row); continue;
    }
    if (!topic.source_ref.startsWith('report:')) {
      if (topic.evidence?.bridgeCode !== 'topic-source-unsupported') await stores.topics.updateTopic(owner, topic.id, { evidence: evidence(topic, { bridgeCode: 'topic-source-unsupported' }) });
      result.unsupported++; continue;
    }
    if (topic.status === 'enriching' && topic.brief_id) {
      const row = await stores.topics.brief(owner, project, topic.brief_id);
      if (!row) { result.unsupported++; continue; }
      if (row.status === 'queued' && row.job_id) { await stores.topics.updateTopic(owner, topic.id, { status: 'briefed', evidence: evidence(topic, { jobId: row.job_id, bridgeCode: null }) }); result.briefed++; continue; }
      if (row.status === 'skipped') { await stores.topics.updateTopic(owner, topic.id, { evidence: evidence(topic, { bridgeCode: row.code ?? 'brief-skipped' }) }); result.waiting++; continue; }
      await admit(topic, row); continue;
    }
    // approved, from a report: pick the day, select the report and write the brief row.
    const candidate = await stores.topics.candidate(owner, project, topic.source_ref.slice('report:'.length));
    if (!candidate) { await stores.topics.updateTopic(owner, topic.id, { evidence: evidence(topic, { bridgeCode: 'topic-source-unavailable' }) }); result.unsupported++; continue; }
    const targetDate = await dneskaiTopicTargetDate(stores.briefs, owner, project, now, input.mix ? { daily: input.mix, kind: topic.kind, committed: stores.topics.committed } : undefined);
    if (!targetDate) { await stores.topics.updateTopic(owner, topic.id, { evidence: evidence(topic, { bridgeCode: input.mix ? 'topic-daily-mix-full' : 'topic-slot-unavailable' }) }); result.waiting++; continue; }
    if (candidate.status !== 'selected' || candidate.target_date !== targetDate) await stores.topics.selectCandidate(owner, project, candidate, targetDate);
    const row = await stores.topics.insertTopicBrief(owner, { project_id: project, run_id: candidate.run_id, event_id: dneskaiTopicEventId(topic.id), target_date: targetDate,
      category: topic.kind === 'news' ? 'ai-news' : 'tool', member_ids: [candidate.id], lead_candidate_id: candidate.id, member_hash: dneskaiMemberHash([candidate]), topic_id: topic.id });
    await stores.topics.updateTopic(owner, topic.id, { status: 'enriching', brief_id: row.id, evidence: evidence(topic, { targetDate, bridgeCode: null }) });
    result.enriching++;
  }
  return result;
}

const read = <T>(result: { data: T | null; error: unknown }, code: string): T | null => { if (result.error) throw new Error(code); return result.data; };

/** The service-role store. Every query filters on the owner; writes keep the topic's project. */
export function createDneskaiTopicBridgeStore(db: Database): DneskaiTopicBridgeStore {
  return {
    async topics(owner, project) {
      return (read(await db.from('marketing_dneskai_topics').select('id,kind,status,source_ref,title_cs,brief_id,evidence').eq('user_id', owner).eq('project_id', project)
        .in('status', ['approved', 'enriching', 'briefed']).order('approved_at', { ascending: true }).limit(12), 'topic-bridge-unavailable') ?? []) as DneskaiBridgeTopic[];
    },
    async brief(owner, project, briefId) {
      return read(await db.from('marketing_dneskai_briefs').select('*').eq('user_id', owner).eq('project_id', project).eq('id', briefId).maybeSingle(), 'topic-bridge-unavailable') as DneskaiBriefRow | null;
    },
    async candidate(owner, project, candidateId) {
      const row = read(await db.from('marketing_dneskai_candidates').select('id,run_id,status,target_date,content_hash,candidate').eq('user_id', owner).eq('project_id', project).eq('id', candidateId).maybeSingle(), 'topic-bridge-unavailable') as (Omit<DneskaiBridgeCandidate, 'candidate'> & { candidate: unknown }) | null;
      const parsed = row ? DneskaiCandidateSchema.safeParse(row.candidate) : null;
      return row && parsed?.success && parsed.data.id === row.id ? { ...row, candidate: parsed.data } : null;
    },
    async selectCandidate(owner, project, candidate, targetDate) {
      const { error } = await db.from('marketing_dneskai_candidates').update({ status: 'selected', target_date: targetDate, updated_at: new Date().toISOString(),
        candidate: { ...candidate.candidate, status: 'selected', targetDate, reason: 'topic-approved-by-owner' } }).eq('user_id', owner).eq('project_id', project).eq('id', candidate.id);
      if (error) throw new Error('topic-bridge-write-failed');
    },
    async insertTopicBrief(owner, row) {
      const existing = read(await db.from('marketing_dneskai_briefs').select('*').eq('user_id', owner).eq('topic_id', row.topic_id).maybeSingle(), 'topic-bridge-unavailable') as DneskaiBriefRow | null;
      if (existing) return existing;
      const ranks = (read(await db.from('marketing_dneskai_briefs').select('rank').eq('user_id', owner).eq('run_id', row.run_id), 'topic-bridge-unavailable') ?? []) as Array<{ rank: number }>;
      const rank = Array.from({ length: 12 }, (_, index) => index + 5).find((value) => !ranks.some((item) => item.rank === value));
      if (!rank) throw new Error('topic-brief-rank-unavailable');
      const inserted = await db.from('marketing_dneskai_briefs').insert({ user_id: owner, ...row, rank, status: 'pending' }).select('*').single();
      return read(inserted, 'topic-bridge-write-failed') as DneskaiBriefRow;
    },
    async updateTopic(owner, topicId, patch) {
      const { error } = await db.from('marketing_dneskai_topics').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', owner).eq('id', topicId);
      if (error) throw new Error('topic-bridge-write-failed');
    },
    async committed(owner, project, date) {
      const rows = (read(await db.from('marketing_dneskai_topics').select('kind').eq('user_id', owner).eq('project_id', project).in('status', ['enriching', 'briefed', 'generated'])
        .eq('evidence->>targetDate', date).limit(20), 'topic-bridge-unavailable') ?? []) as Array<{ kind: 'news' | 'education' }>;
      return rows.map((row) => row.kind);
    },
    async job(owner, jobId) {
      const row = read(await db.from('marketing_jobs').select('status,revision_id:request->generation->>revisionId').eq('user_id', owner).eq('id', jobId).maybeSingle(), 'topic-bridge-unavailable') as { status: string; revision_id: string | null } | null;
      return row ? { status: row.status, revisionId: row.revision_id } : null;
    },
  };
}
