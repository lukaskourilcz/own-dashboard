import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { contentHash } from '@/lib/marketing/hashes';
import { createBriefsDatabase, insertCandidates, syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
beforeAll(async () => { db = await createBriefsDatabase([owner], [{ id: project, owner }], '2026-10-23T08:00:00Z'); }, 60_000);
afterAll(async () => { await db?.close(); });
async function seed(label: string, future = false) {
  const project = randomUUID();
  await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst')", [project, owner]);
  const run = randomUUID(), brief = randomUUID(), target = future ? '2026-10-24' : '2026-10-22', event = contentHash(label);
  await db.query('insert into marketing_dneskai_runs(id,user_id,project_id,date,target_date) values($1,$2,$3,$4,$5)', [run, owner, project, future ? '2026-10-23' : '2026-10-21', target]);
  const item = syntheticCandidate('openai-blog', label, `Synthetic ${label}`, { status: 'selected', targetDate: target, category: 'ai-news', relevance: 0.99, reason: 'research-selection-not-fact-checked' }, undefined, undefined, '2026-10-22T18:00:00Z');
  await insertCandidates(db, owner, project, run, [item]);
  await db.query("insert into marketing_dneskai_briefs(id,user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash) values($1,$2,$3,$4,$5,$6,1,'ai-news',$7,$8,$9)", [brief, owner, project, run, event, target, [item.id], item.id, contentHash(item.id)]);
  return { run, brief, event, item, project };
}
const skip = (id: string, code = 'brief-target-date-passed', duplicate: string | null = null) => db.query('select marketing_dneskai_skip_brief($1,$2,$3,$4)', [owner, id, code, duplicate]);
const state = async (id: string) => (await db.query<{ status: string; target_date: string | null; candidate: { status: string; targetDate: string | null; reason: string | null } }>('select status,target_date::text,candidate from marketing_dneskai_candidates where id=$1', [id])).rows[0]!;

describe('future lapsed-brief skip path; no historic cleanup', () => {
  it('releases an ungenerated lapse, preserves the skipped row, and makes its report eligible for a later day', async () => {
    const f = await seed('lapsed-release');
    await skip(f.brief); await skip(f.brief);
    expect(await state(f.item.id)).toMatchObject({ status: 'new', target_date: null, candidate: { status: 'new', targetDate: null, reason: null } });
    expect((await db.query<{ status: string; member_ids: string[] }>('select status,member_ids from marketing_dneskai_briefs where id=$1', [f.brief])).rows[0]).toEqual({ status: 'skipped', member_ids: [f.item.id] });
    const run = randomUUID(), fence = randomUUID();
    await db.query("insert into marketing_dneskai_runs(id,user_id,project_id,date,target_date,fence,lease_until) values($1,$2,$3,'2026-10-23','2026-10-24',$4,'2026-10-23T08:01:00Z')", [run, owner, f.project, fence]);
    await db.query("select marketing_dneskai_finish($1,$2,$3,'complete',null,null)", [owner, run, fence]);
    expect(await state(f.item.id)).toMatchObject({ status: 'selected', target_date: '2026-10-24' });
  });
  it.each(['job', 'revision', 'another-brief', 'future', 'invalid', 'covered'])('retains reports protected by %s', async (protection) => {
    const f = await seed(`protect-${protection}`, protection === 'future');
    if (protection === 'job') await db.query("insert into marketing_jobs(user_id,idempotency_key,request_hash,request,status) values($1,$2,$3,$4,'failed')", [owner, randomUUID(), contentHash('job'), JSON.stringify({ generation: { source: { brand: 'dneskai', sourceId: f.event } } })]);
    if (protection === 'revision') await db.query("insert into marketing_revisions(user_id,project_id,brand,revision,content_hash) values($1,$2,'dneskai',$3,$4)", [owner, f.project, JSON.stringify({ sources: [{ sourceId: f.event }] }), contentHash('revision')]);
    if (protection === 'another-brief') await db.query("insert into marketing_dneskai_briefs(user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash) values($1,$2,$3,$4,'2026-10-23',2,'ai-news',$5,$6,$7)", [owner, f.project, f.run, contentHash('other'), [f.item.id], f.item.id, contentHash('members')]);
    await skip(f.brief, protection === 'invalid' ? 'brief-invalid' : 'brief-target-date-passed', protection === 'covered' ? randomUUID() : null);
    expect((await state(f.item.id)).status).toBe(protection === 'covered' ? 'duplicate' : 'selected');
  });
  it('refuses a foreign owner and does not grant authenticated execution', async () => {
    const f = await seed('owner-fence');
    await expect(db.query('select marketing_dneskai_skip_brief($1,$2,$3)', [randomUUID(), f.brief, 'brief-target-date-passed'])).rejects.toThrow('brief unavailable');
    expect((await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','marketing_dneskai_skip_brief(uuid,uuid,text,text)','execute') allowed")).rows[0]!.allowed).toBe(false);
  });
});
