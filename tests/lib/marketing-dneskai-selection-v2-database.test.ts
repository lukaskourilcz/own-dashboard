import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DneskaiCandidate } from '@/lib/marketing/dneskai-contracts';
import { BRIEF_MIGRATIONS, createBriefsDatabase, insertCandidates, setBriefsTestTime, syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

// Owner decisions 11-13: real migration SQL in isolated WASM Postgres, an OFFLINE clock and synthetic candidates only.
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', fence = '55555555-5555-4555-8555-555555555555';
// 22:30 in Prague on 20 October 2026: the nightly run may be admitted.
const instant = '2026-10-20T20:30:00Z', today = '2026-10-20';
const MAJORITY = '20261022160000_dneskai_event_majority_category.sql', RELEVANCE = '20261022180000_dneskai_relevance_first_selection.sql', REQUEUE = '20261022180100_dneskai_held_requeue.sql';
const json = JSON.stringify;
const classified = (id: string, category: DneskaiCandidate['category'], relevance: number, patch: Partial<DneskaiCandidate> = {}, hoursAgo = 5) =>
  syntheticCandidate('openai-blog', id, `Synthetic distinct story ${id}`, { category, relevance, publishedAt: new Date(Date.parse(instant) - hoursAgo * 3600000).toISOString(), fetchedAt: instant, ...patch }, `Synthetic report ${id}.`);

async function admit(db: PGlite, date = today) {
  const id = (await db.query<{ r: { id: string } }>('select marketing_dneskai_admit($1,$2,$3,$4) r', [owner, project, date, json([{ id: 'openai-blog', kind: 'rss', maxItems: 10 }])])).rows[0]!.r.id;
  await db.query('select marketing_dneskai_claim($1,$2,$3)', [owner, id, fence]);
  await db.query("update marketing_dneskai_stages set status='ok',cost_usd=0 where run_id=$1", [id]);
  return id;
}
/** Yesterday's finished run, inserted directly: admission accepts only today's date. */
async function previousRun(db: PGlite) {
  const id = (await db.query<{ id: string }>("insert into marketing_dneskai_runs(user_id,project_id,date,target_date,status) values($1,$2,'2026-10-19','2026-10-20','complete') returning id", [owner, project])).rows[0]!.id;
  return id;
}
const reset = (db: PGlite) => db.exec('delete from marketing_dneskai_briefs; delete from marketing_dneskai_candidates; delete from marketing_dneskai_stages; delete from marketing_dneskai_runs;');
async function pick(db: PGlite, items: readonly DneskaiCandidate[]) {
  await reset(db);
  const id = await admit(db);
  await insertCandidates(db, owner, project, id, items);
  await db.query('select marketing_dneskai_finish($1,$2,$3,$4,null,null)', [owner, id, fence, 'complete']);
  return (await db.query<{ rank: number; category: string; lead_candidate_id: string }>('select rank,category,lead_candidate_id from marketing_dneskai_briefs where run_id=$1 order by rank', [id])).rows
    .map((row) => [row.rank, row.lead_candidate_id.split(':').pop(), row.category]);
}

// The 21 October night (production-11): strong news waited behind non-news picked for its category.
const project99 = classified('project-99', 'ai-project', 0.99, {}, 120);
const tool98 = classified('tool-98', 'tool', 0.98, {}, 100);
const news97 = classified('news-97', 'ai-news', 0.97);
const tech96 = classified('tech-96', 'tech-news', 0.96);
const news95 = classified('news-95', 'ai-news', 0.95);
const marketing94 = classified('marketing-94', 'marketing', 0.94, {}, 30);
const news93 = classified('news-93', 'ai-news', 0.93);
const night = [project99, tool98, news97, tech96, news95, marketing94, news93];
const id = (item: DneskaiCandidate) => item.id.split(':').pop();

describe('decisions 11 and 12: relevance first, at most one non-news event a day', () => {
  describe('on 20261022160000 (one per category first)', () => {
    let db: PGlite;
    beforeAll(async () => { db = await createBriefsDatabase([owner], [{ id: project, owner }], instant, [...BRIEF_MIGRATIONS, MAJORITY]); }, 60000);
    afterAll(async () => { await db?.close(); });
    it('fills the day with one event per category, three of them non-news', async () => {
      expect(await pick(db, night)).toEqual([[1, id(project99), 'ai-project'], [2, id(tool98), 'tool'], [3, id(news97), 'ai-news'], [4, id(tech96), 'tech-news']]);
    });
  });

  describe('with 20261022180000_dneskai_relevance_first_selection.sql', () => {
    let db: PGlite;
    beforeAll(async () => { db = await createBriefsDatabase([owner], [{ id: project, owner }], instant, [...BRIEF_MIGRATIONS, MAJORITY, RELEVANCE]); }, 60000);
    afterAll(async () => { await db?.close(); });
    it('takes the most relevant events and only the best non-news one; tool and ai-project share that slot', async () => {
      expect(await pick(db, night)).toEqual([[1, id(project99), 'ai-project'], [2, id(news97), 'ai-news'], [3, id(tech96), 'tech-news'], [4, id(news95), 'ai-news']]);
    });
    it('lets strong news push out a weak ai-project item', async () => {
      const weak = classified('weak-project', 'ai-project', 0.86, {}, 48);
      expect(await pick(db, [weak, news97, tech96, news95, news93])).toEqual([[1, id(news97), 'ai-news'], [2, id(tech96), 'tech-news'], [3, id(news95), 'ai-news'], [4, id(news93), 'ai-news']]);
    });
    it('picks a non-news event when it is among the most relevant, and fewer than four when only non-news remains', async () => {
      expect(await pick(db, [tool98, marketing94, project99])).toEqual([[1, id(project99), 'ai-project']]);
      expect(await pick(db, [news95, marketing94])).toEqual([[1, id(news95), 'ai-news'], [2, id(marketing94), 'marketing']]);
    });
    it('keeps the floor, the 48 h news window and the 30 d window for the rest', async () => {
      const low = classified('low', 'ai-news', 0.84), staleNews = classified('stale-news', 'ai-news', 0.99, {}, 49), staleTool = classified('stale-tool', 'tool', 0.99, {}, 31 * 24);
      expect(await pick(db, [low, staleNews, staleTool, news93])).toEqual([[1, id(news93), 'ai-news']]);
    });
    it('keeps the function service-only', async () => {
      expect((await db.query<{ ok: boolean }>("select has_function_privilege('authenticated','public.marketing_dneskai_finish(uuid,uuid,uuid,text,text,jsonb)','execute') as ok")).rows[0]!.ok).toBe(false);
    });
  });
});

describe('decision 13: one automatic second chance for a Jev hold', () => {
  let db: PGlite;
  beforeAll(async () => { db = await createBriefsDatabase([owner], [{ id: project, owner }], instant, [...BRIEF_MIGRATIONS, MAJORITY, RELEVANCE, REQUEUE]); }, 60000);
  afterAll(async () => { await db?.close(); });
  const held = (label: string, patch: Partial<DneskaiCandidate> = {}, hoursAgo = 20) => classified(label, 'ai-news', 0.8, { status: 'held', reason: 'collection-review-relevance', ...patch }, hoursAgo);
  const row = async (item: DneskaiCandidate) => (await db.query<{ status: string; requeued: boolean; candidate: Record<string, unknown> }>('select status,requeued_at is not null as requeued,candidate from marketing_dneskai_candidates where id=$1', [item.id])).rows[0]!;
  const requeue = async (run: string) => (await db.query<{ r: number }>('select marketing_dneskai_requeue_held($1,$2,$3) r', [owner, run, fence])).rows[0]!.r;

  it('opens recent Jev holds once, with the release rules, and records it', async () => {
    await reset(db);
    const previous = await previousRun(db);
    const fresh = held('fresh'), old = held('old'), notJev = held('not-jev', { reason: 'collection-cost-unverified' }), stale = held('stale', {}, 31 * 24), empty = held('empty', { title: ' ', text: ' ' });
    await insertCandidates(db, owner, project, previous, [fresh, old, notJev, stale, empty]);
    await db.query("update marketing_dneskai_candidates set updated_at=$2::timestamptz-interval '49 hours' where id=$1", [old.id, instant]);
    const run = await admit(db);
    expect(await requeue(run)).toBe(1);
    expect(await row(fresh)).toMatchObject({ status: 'new', requeued: true, candidate: { status: 'new', category: null, relevance: null, reason: null, duplicateOf: null, targetDate: null, title: fresh.title, text: fresh.text, url: fresh.url, publishedAt: fresh.publishedAt } });
    for (const item of [old, notJev, stale, empty]) expect(await row(item)).toMatchObject({ status: 'held', requeued: false });
    // A retried tick of the same run adds nothing.
    await db.query('update marketing_dneskai_candidates set requeued_at=null where id=$1', [old.id]);
    await db.query("update marketing_dneskai_candidates set updated_at=$2 where id=$1", [old.id, instant]);
    expect(await requeue(run)).toBe(0);
    expect((await row(old)).status).toBe('held');
  });

  it('never re-queues a report twice', async () => {
    await reset(db);
    const first = await previousRun(db);
    const item = held('twice');
    await insertCandidates(db, owner, project, first, [item]);
    await db.query("update marketing_dneskai_candidates set requeued_at=$2::timestamptz-interval '20 hours' where id=$1", [item.id, instant]);
    expect(await requeue(await admit(db))).toBe(0);
    expect(await row(item)).toMatchObject({ status: 'held', requeued: true });
  });

  it('moves at most sixteen, the most relevant first', async () => {
    await reset(db);
    const previous = await previousRun(db);
    const many = Array.from({ length: 20 }, (_, index) => held(`many-${String(index).padStart(2, '0')}`, { relevance: 0.5 + index / 100 }));
    await insertCandidates(db, owner, project, previous, many);
    expect(await requeue(await admit(db))).toBe(16);
    expect(await Promise.all(many.slice(0, 4).map(async (item) => (await row(item)).status))).toEqual(['held', 'held', 'held', 'held']);
  });

  it('does nothing once the run has planned Jev, on another day or without the fence', async () => {
    await reset(db);
    const previous = await previousRun(db);
    const item = held('late');
    await insertCandidates(db, owner, project, previous, [item]);
    const run = await admit(db);
    await db.query('select marketing_dneskai_plan_jev($1,$2,$3,0)', [owner, run, fence]);
    expect(await requeue(run)).toBe(0);
    await expect(db.query('select marketing_dneskai_requeue_held($1,$2,$3)', [owner, run, '66666666-6666-4666-8666-666666666666'])).rejects.toThrow('collection fence unavailable');
    await reset(db);
    const before = await previousRun(db);
    await insertCandidates(db, owner, project, before, [item]);
    await setBriefsTestTime(db, '2026-10-20T21:59:30Z');
    const closing = await admit(db);
    await setBriefsTestTime(db, '2026-10-20T22:00:10Z'); // 00:00 in Prague on 21 October: the run's day has passed.
    expect(await requeue(closing)).toBe(0);
    await setBriefsTestTime(db, instant);
    expect((await row(item)).status).toBe('held');
  });

  it('is service-only', async () => {
    expect((await db.query<{ ok: boolean }>("select has_function_privilege('authenticated','public.marketing_dneskai_requeue_held(uuid,uuid,uuid)','execute') as ok")).rows[0]!.ok).toBe(false);
  });
});
