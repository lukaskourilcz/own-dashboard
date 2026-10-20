import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dneskaiEventId, dneskaiEventMemberHash, dneskaiFinishEvents, groupDneskaiEvents } from '@/lib/marketing/dneskai-events';
import type { DneskaiCandidate } from '@/lib/marketing/dneskai-contracts';
import { createBriefsDatabase, insertCandidates, setBriefsTestTime, syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

// Real migration SQL in isolated WASM Postgres; OFFLINE clock and synthetic candidates only.
const owner = '11111111-1111-4111-8111-111111111111', other = '99999999-9999-4999-8999-999999999999';
const project = '22222222-2222-4222-8222-222222222222', secondProject = '44444444-4444-4444-8444-444444444444', fence = '55555555-5555-4555-8555-555555555555';
const instant = '2026-10-20T20:30:00Z', today = '2026-10-20', target = '2026-10-21';
let db: PGlite;
const json = JSON.stringify;
const classified = (sourceId: string, id: string, title: string, category: DneskaiCandidate['category'], relevance: number, patch: Partial<DneskaiCandidate> = {}, minutes = 0) =>
  syntheticCandidate(sourceId, id, title, { category, relevance, publishedAt: new Date(Date.parse('2026-10-20T15:00:00Z') + minutes * 60000).toISOString(), fetchedAt: new Date(Date.parse('2026-10-20T20:00:00Z') + minutes * 60000).toISOString(), ...patch }, `${title}. Synthetic report ${id}.`);
async function run(projectId: string) {
  const id = (await db.query<{ r: { id: string } }>('select marketing_dneskai_admit($1,$2,$3,$4) r', [owner, projectId, today, json([{ id: 'openai-blog', kind: 'rss', maxItems: 10 }])])).rows[0]!.r.id;
  await db.query('select marketing_dneskai_claim($1,$2,$3)', [owner, id, fence]);
  await db.query("update marketing_dneskai_stages set status='ok',cost_usd=0 where run_id=$1", [id]);
  return id;
}
const rows = async <T,>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;

beforeAll(async () => { db = await createBriefsDatabase([owner, other], [{ id: project, owner }, { id: secondProject, owner }], instant); }, 60000);
afterAll(async () => { await db?.close(); });

describe('event selection in marketing_dneskai_finish (#115)', () => {
  const lead = classified('openai-blog', 'lead', 'Synthetic launch of Model Nine for developers', 'ai-news', 0.95);
  const verge = classified('the-verge', 'verge', 'Synthetic launch of Model Nine for developers', 'ai-news', 0.9, {}, 5);
  const hn = classified('hn-frontpage', 'hn', 'Model Nine discussion', 'ai-news', 0.8, { status: 'duplicate', duplicateOf: verge.id, reason: 'collection-semantic-duplicate' }, 9);
  const secondAi = classified('wired-ai', 'second-ai', 'Synthetic chip export rules tightened again', 'ai-news', 0.92, {}, 1);
  const tool = classified('hf-blog', 'tool', 'Synthetic notebook tool for tiny datasets', 'tool', 0.88, {}, 2);
  const tech = classified('ars-technica', 'tech', 'Synthetic satellite broadband outage explained', 'tech-news', 0.9, {}, 3);
  const marketing = classified('digiday', 'marketing', 'Synthetic creator ads measurement change', 'marketing', 0.86, {}, 4);
  const earlier = classified('mit-tech-review', 'earlier', 'Synthetic robot dog learns to open doors', 'ai-news', 0.9, { status: 'selected', targetDate: today, reason: 'research-selection-not-fact-checked' }, -600);
  const repeat = classified('the-register', 'repeat', 'Synthetic robot dog learns to open doors', 'ai-news', 0.99, {}, 6);
  const weak = classified('variety', 'weak', 'Synthetic studio contract news', 'ai-news', 0.5, {}, 7);
  const all = [lead, verge, hn, secondAi, tool, tech, marketing, earlier, repeat, weak];
  let runId: string;
  const events = () => dneskaiFinishEvents(groupDneskaiEvents(all.filter((item) => ['new', 'duplicate', 'selected'].includes(item.status))));

  it('selects at most four events, one per category first, and selects every classified report of a chosen event', async () => {
    runId = await run(project);
    await insertCandidates(db, owner, project, runId, all);
    expect(events().map((event) => event.memberIds.length).sort()).toEqual([2, 3]);
    const finished = (await db.query<{ r: { selected_count: number; status: string } }>('select marketing_dneskai_finish($1,$2,$3,$4,null,$5) r', [owner, runId, fence, 'complete', json(events())])).rows[0]!.r;
    expect(finished).toMatchObject({ selected_count: 4, status: 'complete' });
    const briefs = await rows<{ rank: number; category: string; event_id: string; member_ids: string[]; lead_candidate_id: string; member_hash: string; status: string; target_date: string }>(
      "select rank,category,event_id,member_ids,lead_candidate_id,member_hash,status,target_date::text from marketing_dneskai_briefs where run_id=$1 order by rank", [runId]);
    expect(briefs.map((brief) => [brief.rank, brief.category])).toEqual([[1, 'ai-news'], [2, 'tech-news'], [3, 'tool'], [4, 'marketing']]);
    expect(briefs[0]).toMatchObject({ event_id: dneskaiEventId(lead.id), lead_candidate_id: lead.id, member_ids: [lead.id, verge.id, hn.id], status: 'pending', target_date: target });
    expect(briefs[0]!.member_hash).toBe(dneskaiEventMemberHash([lead, verge, hn]));
    expect(briefs[1]!.member_hash).toBe(dneskaiEventMemberHash([tech]));
    const status = async (item: DneskaiCandidate) => (await rows<{ status: string; target_date: string | null; candidate: DneskaiCandidate }>('select status,target_date::text,candidate from marketing_dneskai_candidates where id=$1', [item.id]))[0]!;
    for (const item of [lead, verge, hn, tech, tool, marketing]) expect(await status(item)).toMatchObject({ status: 'selected', target_date: target, candidate: { status: 'selected', targetDate: target, reason: 'research-selection-not-fact-checked' } });
    // A second ai-news event waits behind the other categories; it is not forced in.
    expect((await status(secondAi)).status).toBe('new');
    expect((await status(weak)).status).toBe('new');
  });

  it('never selects an event that was covered before and marks its open reports as duplicates of the earlier selection', async () => {
    const value = (await rows<{ status: string; candidate: DneskaiCandidate }>('select status,candidate from marketing_dneskai_candidates where id=$1', [repeat.id]))[0]!;
    expect(value).toMatchObject({ status: 'duplicate', candidate: { status: 'duplicate', duplicateOf: earlier.id, reason: 'collection-already-covered' } });
    expect((await rows<{ target_date: string }>('select target_date::text from marketing_dneskai_candidates where id=$1', [earlier.id]))[0]!.target_date).toBe(today);
  });

  it('treats every candidate as its own event without a grouping and keeps the five-argument call', async () => {
    await setBriefsTestTime(db, instant);
    const id = await run(secondProject);
    const a = classified('openai-blog', 'single-a', 'Synthetic single report alpha', 'ai-news', 0.9);
    const b = classified('the-verge', 'single-b', 'Synthetic single report alpha', 'ai-news', 0.89, {}, 1);
    await insertCandidates(db, owner, secondProject, id, [a, b]);
    await db.query('select marketing_dneskai_finish($1,$2,$3,$4,null)', [owner, id, fence, 'partial']);
    expect((await rows<{ event_id: string }>('select event_id from marketing_dneskai_briefs where run_id=$1 order by rank', [id])).map((row) => row.event_id)).toEqual([dneskaiEventId(a.id), dneskaiEventId(b.id)]);
  });

  it('refuses a grouping whose event is not named by its anchor or that repeats a candidate', async () => {
    const id = (await rows<{ id: string }>('select id from marketing_dneskai_runs where project_id=$1', [project]))[0]!.id;
    await db.query('select marketing_dneskai_claim($1,$2,$3)', [owner, id, fence]).catch(() => undefined);
    await db.query("update marketing_dneskai_runs set status='running',fence=$2,lease_until=clock_timestamp()+interval '1 minute' where id=$1", [id, fence]);
    await expect(db.query('select marketing_dneskai_finish($1,$2,$3,$4,null,$5)', [owner, id, fence, 'complete', json([{ eventId: 'f'.repeat(64), anchorId: lead.id, memberIds: [lead.id, verge.id] }])])).rejects.toThrow('collection events invalid');
    await expect(db.query('select marketing_dneskai_finish($1,$2,$3,$4,null,$5)', [owner, id, fence, 'complete', json([{ eventId: dneskaiEventId(lead.id), anchorId: lead.id, memberIds: [lead.id, verge.id] }, { eventId: dneskaiEventId(hn.id), anchorId: hn.id, memberIds: [hn.id, verge.id] }])])).rejects.toThrow('collection events invalid');
  });

  it('keeps briefs owner-only: service functions only, foreign rows invisible', async () => {
    for (const signature of ['marketing_dneskai_finish(uuid,uuid,uuid,text,text,jsonb)', 'marketing_dneskai_prepare_brief(uuid,uuid,jsonb,timestamptz,text,text)', 'marketing_dneskai_skip_brief(uuid,uuid,text,text)',
      'marketing_dneskai_admit_brief(uuid,uuid,uuid)', 'marketing_dneskai_brief_queued(uuid,uuid,uuid)', 'marketing_dneskai_brief_source(uuid,text,date)', 'marketing_private.dneskai_member_hash(uuid,uuid,text[])']) {
      const permission = (await rows<{ anon: boolean; authenticated: boolean; service: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", [signature]))[0];
      expect(permission, signature).toEqual({ anon: false, authenticated: false, service: true });
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.exec('set role authenticated');
    try {
      expect((await db.query('select * from marketing_dneskai_briefs')).rows).toEqual([]);
      await expect(db.query("update marketing_dneskai_briefs set status='queued'")).rejects.toThrow();
    } finally { await db.exec('reset role'); }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    try { expect((await db.query('select * from marketing_dneskai_briefs')).rows.length).toBeGreaterThan(0); } finally { await db.exec('reset role'); }
    await expect(db.query("insert into marketing_dneskai_briefs(user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash) values($1,$2,$3,$4,$5,1,'tool','{x}','x',$4)",
      [other, project, runId, 'a'.repeat(64), target])).rejects.toThrow('foreign collection project');
  });
});
