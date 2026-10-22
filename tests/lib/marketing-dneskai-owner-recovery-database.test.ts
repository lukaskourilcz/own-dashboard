import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { contentHash } from '@/lib/marketing/hashes';
import { BRIEF_MIGRATIONS, createBriefsDatabase, insertCandidates, syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

/** The prepared owner-recovery SQL (C3, briefs-07) over the brief migrations, in isolated PGlite; every value is synthetic. */
const RECOVERY = '20261022141512_dneskai_owner_recovery.sql', RELEASE = '20261022141613_dneskai_release_lapsed_brief.sql';
const owner = '11111111-1111-4111-8111-111111111111', other = '33333333-3333-4333-8333-333333333333', project = '22222222-2222-4222-8222-222222222222';
// 10:00 in Prague on 23 October 2026: today's open slots are 12:30, 17:00 and 20:00.
const NOW = '2026-10-23T08:00:00Z', TODAY_1230 = '2026-10-23T10:30:00.000Z', TODAY_2000 = '2026-10-23T18:00:00.000Z', TOMORROW_0800 = '2026-10-24T06:00:00.000Z';
let db: PGlite;
beforeAll(async () => { db = await createBriefsDatabase([owner, other], [{ id: project, owner }], NOW, [...BRIEF_MIGRATIONS, RECOVERY, RELEASE]); }, 60_000);
afterAll(async () => { await db?.close(); });

async function as<T>(user: string | null, sql: string, params: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? '']);
  await db.exec('set role authenticated');
  try { return (await db.query<{ r: T }>(sql, params)).rows[0]!.r; } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
const candidateRow = async (id: string) => (await db.query<{ status: string; target_date: string | null; candidate: Record<string, unknown> }>('select status,target_date::text,candidate from marketing_dneskai_candidates where id=$1', [id])).rows[0]!;
const briefRow = async (id: string) => (await db.query<{ status: string; code: string | null; target_date: string; scheduled_at: string | null }>("select status,code,target_date::text,to_char(scheduled_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI') scheduled_at from marketing_dneskai_briefs where id=$1", [id])).rows[0]!;

async function seedHeld(label: string, patch: Parameters<typeof syntheticCandidate>[3] = {}, at = '2026-10-22T18:00:00Z') {
  const run = randomUUID(), projectId = randomUUID();
  await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst')", [projectId, owner]);
  await db.query("insert into marketing_dneskai_runs(id,user_id,project_id,date,target_date) values($1,$2,$3,'2026-10-21','2026-10-22')", [run, owner, projectId]);
  const item = syntheticCandidate('openai-blog', label, `Synthetic ${label}`, { status: 'held', category: 'ai-news', relevance: 0.7, reason: 'collection-review-relevance', ...patch }, undefined, undefined, at);
  await insertCandidates(db, owner, projectId, run, [item]);
  return { ...item, project: projectId };
}

/** A brief of 22 October whose slot passed before any admission attempt; its report is still selected for that day. */
async function seedLapsed(label: string, options: { code?: string; built?: boolean; at?: string } = {}) {
  const projectId = randomUUID();
  await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst')", [projectId, owner]);
  const run = randomUUID(), brief = randomUUID(), event = contentHash(label);
  await db.query("insert into marketing_dneskai_runs(id,user_id,project_id,date,target_date) values($1,$2,$3,'2026-10-21','2026-10-22')", [run, owner, projectId]);
  const item = syntheticCandidate('openai-blog', label, `Synthetic ${label}`, { status: 'selected', targetDate: '2026-10-22', category: 'ai-news', relevance: 0.99, reason: 'research-selection-not-fact-checked' }, undefined, undefined, options.at ?? '2026-10-22T18:00:00Z');
  await insertCandidates(db, owner, projectId, run, [item]);
  const hash = (await db.query<{ h: string }>('select marketing_private.dneskai_member_hash($1,$2,$3) h', [owner, projectId, [item.id]])).rows[0]!.h;
  const built = options.built === false ? null : JSON.stringify({ schemaVersion: 'dneskai-brief/1', eventId: event, memberHash: hash, targetDate: '2026-10-22', category: 'ai-news', evidence: [{ candidateId: item.id }], scheduledAt: '2026-10-22T06:00:00.000Z', observedAt: '2026-10-21T21:00:00.000Z', expiresAt: '2026-10-23T21:00:00.000Z' });
  await db.query("insert into marketing_dneskai_briefs(id,user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash,status,code,brief,scheduled_at) values($1,$2,$3,$4,$5,'2026-10-22',1,'ai-news',$6,$7,$8,'skipped',$9,$10,$11)",
    [brief, owner, projectId, run, event, [item.id], item.id, hash, options.code ?? 'brief-slot-passed', built, built ? '2026-10-22T06:00:00Z' : null]);
  return { brief, event, hash, item, project: projectId, run };
}
const doc = (f: { event: string; hash: string; item: { id: string } }, scheduledAt: string, patch: Record<string, unknown> = {}) => ({
  schemaVersion: 'dneskai-brief/1', eventId: f.event, memberHash: f.hash, targetDate: new Date(Date.parse(scheduledAt) + 2 * 3600000).toISOString().slice(0, 10), category: 'ai-news',
  evidence: [{ candidateId: f.item.id }], scheduledAt, observedAt: '2026-10-21T21:00:00.000Z', expiresAt: '2026-10-23T21:00:00.000Z', ...patch,
});
const reslot = (user: string, brief: string, value: unknown, at: string) => as<{ status: string; code: string }>(user, 'select marketing_dneskai_reslot_brief($1,$2,$3) r', [brief, JSON.stringify(value), at]);

describe('C3: owner release of a held report', () => {
  it('returns a held report to the open, unclassified queue without touching its authored fields', async () => {
    const item = await seedHeld('held-release');
    expect(await as(owner, 'select marketing_dneskai_release_candidate($1,$2) r', [item.project, item.id])).toEqual({ id: item.id, status: 'new' });
    const row = await candidateRow(item.id);
    expect(row).toMatchObject({ status: 'new', target_date: null, candidate: { status: 'new', category: null, relevance: null, reason: null, duplicateOf: null, targetDate: null, title: item.title, text: item.text, url: item.url, publishedAt: item.publishedAt } });
    await expect(as(owner, 'select marketing_dneskai_release_candidate($1,$2) r', [item.project, item.id])).rejects.toThrow('candidate not held');
  });
  it('refuses another owner, an anonymous caller, an empty report and a report outside the 30-day review window', async () => {
    const item = await seedHeld('held-fence');
    await expect(as(other, 'select marketing_dneskai_release_candidate($1,$2) r', [item.project, item.id])).rejects.toThrow('candidate unavailable');
    await expect(as(null, 'select marketing_dneskai_release_candidate($1,$2) r', [item.project, item.id])).rejects.toThrow('candidate unavailable');
    const stale = await seedHeld('held-stale', { reason: 'collection-source-date-unavailable-or-stale' }, '2026-09-01T10:00:00Z');
    await expect(as(owner, 'select marketing_dneskai_release_candidate($1,$2) r', [stale.project, stale.id])).rejects.toThrow('candidate outside window');
    const empty = await seedHeld('held-empty', { title: '', text: '', reason: 'collection-empty-source-text' });
    await expect(as(owner, 'select marketing_dneskai_release_candidate($1,$2) r', [empty.project, empty.id])).rejects.toThrow('candidate not releasable');
    expect((await candidateRow(item.id)).status).toBe('held');
  });
  it('is executable by authenticated only', async () => {
    const rows = (await db.query<{ role: string; allowed: boolean }>("select r as role,has_function_privilege(r,'marketing_dneskai_release_candidate(uuid,text)','execute') allowed from unnest(array['anon','authenticated']) r")).rows;
    expect(rows).toEqual([{ role: 'anon', allowed: false }, { role: 'authenticated', allowed: true }]);
  });
});

describe('briefs-07: reslot a lapsed brief', () => {
  it('moves the brief and its reports to a free slot today and reopens it as pending without an account', async () => {
    const f = await seedLapsed('reslot-today');
    expect(await reslot(owner, f.brief, doc(f, TODAY_1230), TODAY_1230)).toMatchObject({ status: 'pending', code: 'account-unavailable', targetDate: '2026-10-23' });
    expect(await briefRow(f.brief)).toEqual({ status: 'pending', code: 'account-unavailable', target_date: '2026-10-23', scheduled_at: '2026-10-23T10:30' });
    expect(await candidateRow(f.item.id)).toMatchObject({ status: 'selected', target_date: '2026-10-23', candidate: { status: 'selected', targetDate: '2026-10-23' } });
    // The brief can be prepared again through the ordinary function (same member hash, new day).
    await db.query("select marketing_dneskai_prepare_brief($1,$2,null,null,'ready',null)", [owner, f.brief]);
    expect((await briefRow(f.brief)).status).toBe('ready');
  });
  it('codes the brief owner-reslot when a verified account exists, and accepts reports the lapse path released', async () => {
    const f = await seedLapsed('reslot-released');
    await db.query("update marketing_dneskai_candidates set status='new',target_date=null,candidate=candidate||'{\"status\":\"new\",\"targetDate\":null,\"reason\":null}' where id=$1", [f.item.id]);
    await db.query("insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at) values($1,'dneskai','instagram','synthetic-1','dneskai',now())", [owner]);
    try {
      expect(await reslot(owner, f.brief, doc(f, TODAY_2000), TODAY_2000)).toMatchObject({ status: 'pending', code: 'owner-reslot', targetDate: '2026-10-23' });
      expect((await candidateRow(f.item.id)).status).toBe('selected');
    } finally { await db.query("delete from marketing_accounts where user_id=$1", [owner]); }
  });
  it.each([
    ['a time that is not a daily slot', '2026-10-23T11:00:00.000Z', {}, 'brief slot invalid'],
    ['a slot under 30 minutes away', '2026-10-23T08:20:00.000Z', {}, 'brief slot invalid'],
    ['a day after tomorrow', '2026-10-25T07:00:00.000Z', {}, 'brief slot invalid'],
    ['an extended expiry', TODAY_1230, { expiresAt: '2026-10-30T00:00:00.000Z' }, 'brief invalid'],
    ['another member hash', TODAY_1230, { memberHash: 'a'.repeat(64) }, 'brief invalid'],
    ['a foreign report as evidence', TODAY_1230, { evidence: [{ candidateId: 'foreign' }] }, 'brief invalid'],
  ])('refuses %s', async (_label, at, patch, message) => {
    const f = await seedLapsed(`reslot-refuse-${_label}`);
    await expect(reslot(owner, f.brief, doc(f, at, patch), at)).rejects.toThrow(message);
    expect((await briefRow(f.brief)).status).toBe('skipped');
  });
  it.each(['job', 'source-head', 'other-brief', 'repeat', 'stale', 'foreign-owner'])('refuses when protected by %s', async (protection) => {
    const f = await seedLapsed(`reslot-protect-${protection}`, { code: protection === 'repeat' ? 'collection-already-covered' : 'brief-slot-passed', at: protection === 'stale' ? '2026-10-20T06:00:00Z' : undefined });
    if (protection === 'job') await db.query("insert into marketing_jobs(user_id,idempotency_key,request_hash,request,status) values($1,$2,$3,$4,'failed')", [owner, randomUUID(), contentHash(`job-${f.event}`), JSON.stringify({ generation: { source: { brand: 'dneskai', sourceId: f.event } } })]);
    if (protection === 'source-head') await db.query("insert into marketing_sources(user_id,brand,source_id,source_revision,content_hash,packet,observed_at,eligible) values($1,'dneskai',$2,$3,$4,'{}',now(),true)", [owner, f.event, f.hash, contentHash('head')]);
    if (protection === 'other-brief') await db.query("insert into marketing_dneskai_briefs(user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash) values($1,$2,$3,$4,'2026-10-23',2,'ai-news',$5,$6,$7)", [owner, f.project, f.run, contentHash(`other-${f.event}`), [f.item.id], f.item.id, f.hash]);
    const expected = { job: 'brief admitted', 'source-head': 'brief admitted', 'other-brief': 'brief members changed', repeat: 'brief not reslottable', stale: 'brief outside window', 'foreign-owner': 'brief unavailable' }[protection]!;
    await expect(reslot(protection === 'foreign-owner' ? other : owner, f.brief, doc(f, TODAY_1230), TODAY_1230)).rejects.toThrow(expected);
    expect((await candidateRow(f.item.id)).target_date).toBe('2026-10-22');
  });
  it('rebuilds a brief that was never built with a fresh observation', async () => {
    const f = await seedLapsed('reslot-unbuilt', { code: 'brief-target-date-passed', built: false });
    await reslot(owner, f.brief, doc(f, TOMORROW_0800, { expiresAt: '2026-10-25T08:00:00.000Z' }), TOMORROW_0800);
    expect((await briefRow(f.brief)).target_date).toBe('2026-10-24');
  });
  it('is executable by authenticated only', async () => {
    expect((await db.query<{ a: boolean; b: boolean }>("select has_function_privilege('anon','marketing_dneskai_reslot_brief(uuid,jsonb,timestamptz)','execute') a,has_function_privilege('authenticated','marketing_dneskai_reslot_brief(uuid,jsonb,timestamptz)','execute') b")).rows[0]).toEqual({ a: false, b: true });
  });
});

describe('briefs-07: release the reports of a lapsed brief', () => {
  it('releases the selected reports of an unadmitted lapse and keeps the brief skipped', async () => {
    const f = await seedLapsed('release-ok');
    expect(await as(owner, 'select marketing_dneskai_release_brief($1) r', [f.brief])).toEqual({ id: f.brief, released: 1 });
    expect(await candidateRow(f.item.id)).toMatchObject({ status: 'new', target_date: null, candidate: { status: 'new', targetDate: null, reason: null } });
    expect((await briefRow(f.brief)).status).toBe('skipped');
    await expect(as(owner, 'select marketing_dneskai_release_brief($1) r', [f.brief])).rejects.toThrow('brief nothing to release');
  });
  it.each(['job', 'repeat', 'foreign-owner'])('refuses when protected by %s', async (protection) => {
    const f = await seedLapsed(`release-protect-${protection}`, { code: protection === 'repeat' ? 'collection-already-covered' : 'brief-slot-passed' });
    if (protection === 'job') await db.query("insert into marketing_jobs(user_id,idempotency_key,request_hash,request,status) values($1,$2,$3,$4,'failed')", [owner, randomUUID(), contentHash(`job-${f.event}`), JSON.stringify({ generation: { source: { brand: 'dneskai', sourceId: f.event } } })]);
    const expected = { job: 'brief admitted', repeat: 'brief not releasable', 'foreign-owner': 'brief unavailable' }[protection]!;
    await expect(as(protection === 'foreign-owner' ? other : owner, 'select marketing_dneskai_release_brief($1) r', [f.brief])).rejects.toThrow(expected);
    expect((await candidateRow(f.item.id)).status).toBe('selected');
  });
  it('refuses to apply before the lapsed-report migration 20261022021835', async () => {
    const bare = await createBriefsDatabase([owner], [{ id: project, owner }], NOW, BRIEF_MIGRATIONS.filter((file) => !file.startsWith('20261022021835')));
    try {
      const { readFileSync } = await import('node:fs');
      await expect(bare.exec(readFileSync(`supabase/migrations/${RELEASE}`, 'utf8'))).rejects.toThrow('apply 20261022021835');
      // The held release and reslot migration does not depend on it.
      await expect(bare.exec(readFileSync(`supabase/migrations/${RECOVERY}`, 'utf8'))).resolves.toBeDefined();
    } finally { await bare.close(); }
  }, 60_000);
});
