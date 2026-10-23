import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDneskaiBriefStore, type DneskaiBriefRow, type DneskaiBriefStore } from '@/lib/marketing/dneskai-briefs';
import { advanceDneskaiTopicBriefs, dneskaiTopicEventId, type DneskaiBridgeTopic, type DneskaiTopicBridgeStore } from '@/lib/marketing/dneskai-topic-bridge';
import { dneskaiFinishEvents, groupDneskaiEvents } from '@/lib/marketing/dneskai-events';
import { dneskaiMediaCapabilities } from '@/lib/marketing/dneskai-media-plan';
import { contentHash } from '@/lib/marketing/hashes';
import { DneskaiCandidateSchema } from '@/lib/marketing/dneskai-contracts';
import type { DneskaiMediaAssetView } from '@/lib/marketing/dneskai-media-contracts';
import { BRIEF_MIGRATIONS, briefsRpcClient, createBriefsDatabase, insertCandidates, pgliteRestClient, syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

/**
 * The topic-to-brief bridge (#155) over the prepared migrations in isolated PGlite: an approved education topic from a
 * collected report ends as a queued generation job with its evidence and picture. Every value is synthetic.
 */
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', fence = '55555555-5555-4555-8555-555555555555';
const topicId = '66666666-6666-4666-8666-666666666666';
const instant = '2026-10-20T20:30:00Z'; // 22:30 in Prague: today's slots are gone, so the topic takes tomorrow 08:00.
const MIGRATIONS = [...BRIEF_MIGRATIONS, '20261023100000_dneskai_topics.sql', '20261023100200_dneskai_topic_briefs.sql'];
let db: PGlite; let runId: string; let briefs: DneskaiBriefStore; let topics: DneskaiTopicBridgeStore;
const json = JSON.stringify;
const rows = async <T,>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;
const report = syntheticCandidate('show-hn', '4242', 'Show HN: A synthetic tool that turns screenshots into notes', { publishedAt: '2026-10-20T15:00:00Z', fetchedAt: '2026-10-20T20:10:00Z' },
  'Show HN: A synthetic tool that turns screenshots into notes. Synthetic description of what it does. '.repeat(12), 'https://example.com/tool');
const picture = 'd'.repeat(64);

/** The production brief store over a PostgREST stand-in, with SQL for the reads that use embedded relations. */
function briefStore(): DneskaiBriefStore {
  const rpc = briefsRpcClient(db);
  const real = createDneskaiBriefStore(pgliteRestClient(db) as never, {
    enqueue: async (who, request) => {
      const value = request as { idempotencyKey: string; generation: { source: { observedAt: string } } };
      const { data, error } = await rpc.rpc('marketing_enqueue_job', { p_owner: who, p_key: value.idempotencyKey, p_hash: contentHash({ ...value, generation: { ...value.generation, source: { ...value.generation.source, observedAt: null } } }), p_request: request });
      if (error) throw new Error(error.message);
      return data as { jobId: string; status: string; duplicate: boolean };
    },
  });
  return {
    ...real,
    media: async (who, projectId, candidateId) => ({ candidateId, assets: (await rows<{ asset_id: string; sha256: string; position: number; origin_kind: DneskaiMediaAssetView['originKind']; origin_url: string; credit: string; width: number; height: number }>(
      'select a.id asset_id,a.sha256,l.position,l.origin_kind,l.origin_url,l.credit,a.width,a.height from marketing_media_asset_links l join marketing_media_assets a on a.id=l.asset_id where l.user_id=$1 and l.project_id=$2 and l.candidate_id=$3 order by l.position', [who, projectId, candidateId]))
      .map((row) => ({ assetId: row.asset_id, sha256: row.sha256, position: row.position, originKind: row.origin_kind, originUrl: row.origin_url, credit: row.credit, width: row.width, height: row.height, mime: 'image/jpeg', bytes: 1000, fetchedAt: instant, ...dneskaiMediaCapabilities(row), duplicateOfAssetId: null, duplicateOfSha256: null, purged: false, previewUrl: null })) }) as never,
    takenSlots: async () => [],
    coverage: async () => [],
    pictureArticles: async () => [],
  };
}

/** The bridge store as SQL against the same database (the service role's writes). */
function topicStore(): DneskaiTopicBridgeStore {
  return {
    topics: async () => rows<DneskaiBridgeTopic>("select id,kind,status,source_ref,title_cs,brief_id,evidence from marketing_dneskai_topics where user_id=$1 and status in('approved','enriching','briefed') order by approved_at", [owner]),
    brief: async (_who, _project, id) => (await rows<DneskaiBriefRow>('select * from marketing_dneskai_briefs where id=$1', [id]))[0] ?? null,
    async candidate(_who, _project, id) {
      const row = (await rows<{ id: string; run_id: string; status: string; target_date: string | null; content_hash: string; candidate: unknown }>('select id,run_id,status,target_date::text,content_hash,candidate from marketing_dneskai_candidates where id=$1', [id]))[0];
      return row ? { ...row, status: row.status as never, candidate: DneskaiCandidateSchema.parse(row.candidate) } : null;
    },
    async selectCandidate(_who, _project, candidate, targetDate) {
      await db.query("update marketing_dneskai_candidates set status='selected',target_date=$2,candidate=$3 where id=$1", [candidate.id, targetDate, json({ ...candidate.candidate, status: 'selected', targetDate })]);
    },
    async insertTopicBrief(who, row) {
      const existing = (await rows<DneskaiBriefRow>('select * from marketing_dneskai_briefs where topic_id=$1', [row.topic_id]))[0];
      if (existing) return existing;
      return (await rows<DneskaiBriefRow>(`insert into marketing_dneskai_briefs(user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash,status,topic_id)
        values($1,$2,$3,$4,$5,5,$6,$7,$8,$9,'pending',$10) returning *`, [who, row.project_id, row.run_id, row.event_id, row.target_date, row.category, row.member_ids, row.lead_candidate_id, row.member_hash, row.topic_id]))[0]!;
    },
    async updateTopic(_who, id, patch) {
      await db.query('update marketing_dneskai_topics set status=coalesce($2,status),brief_id=coalesce($3,brief_id),evidence=coalesce($4,evidence) where id=$1', [id, patch.status ?? null, patch.brief_id ?? null, patch.evidence ? json(patch.evidence) : null]);
    },
    job: async (_who, id) => { const row = (await rows<{ status: string; revision_id: string | null }>("select status,request->'generation'->>'revisionId' revision_id from marketing_jobs where id=$1", [id]))[0]; return row ? { status: row.status, revisionId: row.revision_id } : null; },
  };
}
const advance = () => advanceDneskaiTopicBriefs({ topics, briefs }, { owner, project, now: new Date(instant), signal: new AbortController().signal, remainingMs: () => 40_000 });
const topic = async () => (await rows<{ status: string; brief_id: string | null; evidence: Record<string, unknown> }>('select status,brief_id,evidence from marketing_dneskai_topics where id=$1', [topicId]))[0]!;

beforeAll(async () => {
  db = await createBriefsDatabase([owner], [{ id: project, owner }], instant, MIGRATIONS);
  await db.exec("create or replace function pg_catalog.now() returns timestamptz language sql stable as $$ select current_setting('marketing.test_time')::timestamptz $$");
  runId = (await rows<{ r: { id: string } }>('select marketing_dneskai_admit($1,$2,$3,$4) r', [owner, project, '2026-10-20', json([{ id: 'show-hn', kind: 'hnsearch', maxItems: 10 }])]))[0]!.r.id;
  await db.query('select marketing_dneskai_claim($1,$2,$3)', [owner, runId, fence]);
  await db.query("update marketing_dneskai_stages set status='ok',cost_usd=0 where run_id=$1", [runId]);
  await insertCandidates(db, owner, project, runId, [report]);
  await db.query('select marketing_dneskai_finish($1,$2,$3,$4,null,$5)', [owner, runId, fence, 'complete', json(dneskaiFinishEvents(groupDneskaiEvents([])))]);
  await db.query("insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,'dneskai','instagram','17840000000000000','dneskai',now(),false)", [owner]);
  await db.query(`insert into marketing_dneskai_topics(id,user_id,project_id,kind,source_kind,source_ref,title_cs,status,approved_at,evidence)
    values($1,$2,$3,'education','feed',$4,'Nástroj z jednoho snímku obrazovky udělá poznámky','approved',now(),$5)`, [topicId, owner, project, `report:${report.id}`, json({ titled: true, urls: [report.url] })]);
  briefs = briefStore(); topics = topicStore();
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('topic briefs (#155)', () => {
  it('keeps ranks 1 to 4 for the night and lets only a topic brief use 5 to 16', async () => {
    await expect(db.query(`insert into marketing_dneskai_briefs(user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash)
      values($1,$2,$3,$4,'2026-10-21',6,'tool',$5,$6,$7)`, [owner, project, runId, 'a'.repeat(64), [report.id], report.id, 'b'.repeat(64)])).rejects.toThrow(/marketing_dneskai_briefs_rank_range/);
    await expect(db.query(`insert into marketing_dneskai_briefs(user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash,topic_id)
      values($1,$2,$3,$4,'2026-10-21',17,'tool',$5,$6,$7,$8)`, [owner, project, runId, 'a'.repeat(64), [report.id], report.id, 'b'.repeat(64), topicId])).rejects.toThrow(/marketing_dneskai_briefs_rank_range/);
  });

  it('writes the brief row and selects the report for the first day with a free slot', async () => {
    expect(await advance()).toMatchObject({ enriching: 1, briefed: 0 });
    const state = await topic();
    expect(state.status).toBe('enriching');
    const [row] = await rows<{ rank: number; target_date: string; event_id: string; topic_id: string; status: string; member_ids: string[] }>('select rank,target_date::text,event_id,topic_id,status,member_ids from marketing_dneskai_briefs where id=$1', [state.brief_id]);
    expect(row).toEqual({ rank: 5, target_date: '2026-10-21', event_id: dneskaiTopicEventId(topicId), topic_id: topicId, status: 'pending', member_ids: [report.id] });
    expect((await rows<{ status: string; target_date: string }>('select status,target_date::text from marketing_dneskai_candidates where id=$1', [report.id]))[0]).toEqual({ status: 'selected', target_date: '2026-10-21' });
    // Until its pictures are collected the brief waits.
    expect(await advance()).toMatchObject({ waiting: 1, briefed: 0 });
    expect(await rows('select id from marketing_jobs')).toEqual([]);
  });

  it('ends as a queued job with the report as evidence and its picture, once the media step collected it', async () => {
    const [asset] = await rows<{ id: string }>("insert into marketing_media_assets(user_id,project_id,sha256,candidate_id,source_id,external_id,origin_url,origin_kind,position,width,height,mime,bytes,storage_path,credit) values($1,$2,$3,$4,'show-hn','4242','https://images.example.test/tool.jpg','og-image',0,1600,900,'image/jpeg',1000,$5,'Obrázek: Example') returning id",
      [owner, project, picture, report.id, `marketing-media/${owner}/${picture}.jpg`]);
    await db.query("insert into marketing_media_asset_links(user_id,project_id,candidate_id,asset_id,origin_url,origin_kind,position,credit) values($1,$2,$3,$4,'https://images.example.test/tool.jpg','og-image',0,'Obrázek: Example')", [owner, project, report.id, asset!.id]);
    await db.query("insert into marketing_media_collections(user_id,project_id,candidate_id,status,asset_count) values($1,$2,$3,'complete',1)", [owner, project, report.id]);
    expect(await advance()).toMatchObject({ briefed: 1 });
    const state = await topic();
    expect(state.status).toBe('briefed');
    const jobs = await rows<{ id: string; status: string; request: { generation: { scheduledAt: string; source: { kind: string; brief: { evidence: Array<{ candidateId: string }>; media: Array<{ assetSha256: string }> } } } } }>('select id,status,request from marketing_jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe('queued');
    expect(state.evidence.jobId).toBe(jobs[0]!.id);
    expect(jobs[0]!.request.generation.scheduledAt).toBe('2026-10-21T06:00:00.000Z');
    expect(jobs[0]!.request.generation.source.brief.evidence.map((item) => item.candidateId)).toEqual([report.id]);
    expect(jobs[0]!.request.generation.source.brief.media.map((item) => item.assetSha256)).toEqual([picture]);
    // Idempotent: nothing new on the next pass; the topic becomes generated once its draft is in review.
    expect(await advance()).toMatchObject({ briefed: 0, generated: 0 });
    await db.query("update marketing_jobs set status='review' where id=$1", [jobs[0]!.id]);
    expect(await advance()).toMatchObject({ generated: 1 });
    expect((await topic()).status).toBe('generated');
    expect(await rows('select id from marketing_jobs')).toHaveLength(1);
  });
});
