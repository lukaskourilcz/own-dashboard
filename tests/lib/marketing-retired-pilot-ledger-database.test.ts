import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// OFFLINE WASM Postgres only. The clock is simulated; migration sources execute unchanged.
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
const second = '33333333-3333-4333-8333-333333333333', secondProject = '44444444-4444-4444-8444-444444444444';
const generation = { ownerId: owner, startsAt: '2026-10-13T10:00:00Z', expiresAt: '2026-10-14T10:00:00Z' };
const collection = { ownerId: second, projectId: secondProject, startsAt: '2026-10-15T10:00:00Z', expiresAt: '2026-10-16T10:00:00Z' };
const sources = [{ id: 'openai-blog', kind: 'rss', maxItems: 10 }, { id: 'instagram:mosseri', kind: 'instagram', maxItems: 7 }];
const json = JSON.stringify;
const base = ['20261012225640_marketing_control_surface.sql', '20261012232949_marketing_durable_jobs.sql', '20261013092409_marketing_staging_pilot_guard.sql',
  '20261013165236_marketing_dneskai_collection.sql', '20261013181506_dneskai_collection_pilot.sql'];
// Every later migration that redefines one of the scoped functions runs too, in order, so a merge that
// restores the unscoped checks fails here rather than in production.
const later = readdirSync('supabase/migrations').filter(name => name.slice(0, 14) > '20261013181506' && /check_generation_pilot|marketing_dneskai_admit\b|marketing_dneskai_claim_stage/.test(readFileSync(`supabase/migrations/${name}`, 'utf8'))).sort();
let db: PGlite;
const at = (instant: string) => db.query("select set_config('marketing.test_time',$1,false)", [instant]);
async function enqueue(tuple?: unknown) {
  const args = [owner, randomUUID(), 'a'.repeat(64), json({ schemaVersion: 'marketing-job/1' })];
  const sql = tuple === undefined ? 'select marketing_enqueue_job($1,$2,$3,$4) as value' : 'select marketing_enqueue_job($1,$2,$3,$4,$5) as value';
  return (await db.query<{ value: { jobId: string; duplicate: boolean } }>(sql, tuple === undefined ? args : [...args, json(tuple)])).rows[0].value;
}
const claimJob = (job: string, tuple?: unknown) => tuple === undefined
  ? db.query<{ value: unknown }>('select marketing_claim_job($1,$2,$3) value', [owner, job, randomUUID()])
  : db.query<{ value: unknown }>('select marketing_claim_job($1,$2,$3,$4) value', [owner, job, randomUUID(), json(tuple)]);
const admit = async (who: string, projectId: string, date: string) => (await db.query<{ r: { id: string } }>('select marketing_dneskai_admit($1,$2,$3,$4) r', [who, projectId, date, json(sources)])).rows[0].r.id;
const admitPilot = async (date: string) => (await db.query<{ r: { id: string } }>('select marketing_dneskai_admit_pilot($1,$2,$3,$4,$5) r', [second, secondProject, date, json(sources), json(collection)])).rows[0].r.id;
const claimRun = (who: string, run: string, fence: string) => db.query('select marketing_dneskai_claim($1,$2,$3)', [who, run, fence]);
const stage = (who: string, run: string, fence: string, source: string, paid: boolean) => db.query('select marketing_dneskai_claim_stage($1,$2,$3,$4,$5)', [who, run, fence, source, paid]);
const save = (who: string, run: string, fence: string, source: string, costUsd: number | null) => db.query('select marketing_dneskai_save_stage($1,$2,$3,$4,$5)', [who, run, fence, source, json({ status: 'held', items: [], complete: false, costUsd, errorCode: 'test-only-known-outcome' })]);
const ledger = async () => (await db.query<Record<string, string>>(`select
  (select count(*) from marketing_private.generation_pilots)::text generation_windows,
  (select count(*)||'/'||sum(reserved_usd) from marketing_private.generation_pilot_reservations) generation_reservations,
  (select count(run_id)||'/'||count(*) from marketing_private.dneskai_collection_pilots) collection_runs,
  (select coalesce(sum(reserved_usd),0)::text from marketing_dneskai_stages where run_id=(select run_id from marketing_private.dneskai_collection_pilots limit 1)) pilot_reserved`)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.projects(id uuid primary key,user_id uuid not null,portfolio_key text,repo_full_name text,parent_id uuid,previous_repo_full_names text[] default '{}');
    create table public.ai_links(id uuid primary key,user_id uuid not null);
    create table public.user_preferences(hidden_project_tabs text[] default '{}');
    create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$select current_setting('marketing.test_time')::timestamptz$$;`);
  await at('2026-10-13T12:00:00Z');
  await db.query('insert into auth.users values($1),($2)', [owner, second]);
  await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst'),($3,$4,'aifirst')", [project, owner, secondProject, second]);
  for (const name of [...base, ...later]) await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });

describe('retired pilot ledgers block only while their window is unexpired (#113)', () => {
  it('applies the scoping migration after the original pilot migrations', () => {
    expect(later).toContain('20261020120000_scope_retired_pilot_ledgers.sql');
  });

  it('keeps the generation pilot interlock during its window and frees ordinary admission after expiry, retaining every reservation', async () => {
    const reserved = [];
    for (let index = 0; index < 3; index++) reserved.push((await enqueue(generation)).jobId);
    await expect(enqueue(generation)).rejects.toThrow('pilot budget exhausted');
    await expect(enqueue()).rejects.toThrow('pilot configuration required');
    await expect(claimJob(reserved[0])).rejects.toThrow('pilot configuration required');
    await at('2026-10-14T09:59:59.999Z');
    await expect(enqueue()).rejects.toThrow('pilot configuration required');
    await at(generation.expiresAt);
    const ordinary = await enqueue();
    expect(ordinary.duplicate).toBe(false);
    expect((await claimJob(ordinary.jobId)).rows[0].value).toBeTruthy();
    // The expired tuple can never be replayed, extended or replaced with a second window.
    await expect(enqueue(generation)).rejects.toThrow('pilot outside window');
    await expect(enqueue({ ...generation, expiresAt: '2026-10-14T10:00:01Z' })).rejects.toThrow('pilot configuration changed');
    await expect(claimJob(reserved[1], generation)).rejects.toThrow('pilot outside window');
    expect(await ledger()).toMatchObject({ generation_windows: '1', generation_reservations: '3/0.75' });
  });

  it('holds ordinary paid collection during an unexpired generation window and admits it after expiry', async () => {
    await at('2026-10-13T20:30:00Z');
    const during = await admit(owner, project, '2026-10-13'), fence = randomUUID();
    await claimRun(owner, during, fence);
    await expect(stage(owner, during, fence, 'instagram:mosseri', true)).rejects.toThrow('collection paid pilot blocked');
    expect((await stage(owner, during, fence, 'openai-blog', false)).rows).toHaveLength(1);
    await at('2026-10-14T20:30:00Z');
    const after = await admit(owner, project, '2026-10-14'), next = randomUUID();
    await claimRun(owner, after, next);
    await stage(owner, after, next, 'instagram:mosseri', true);
    expect((await db.query<{ reserved_usd: string }>("select reserved_usd from marketing_dneskai_stages where run_id=$1 and source_id='instagram:mosseri'", [after])).rows[0].reserved_usd).toBe('0.04');
    await save(owner, after, next, 'instagram:mosseri', 0.01);
    expect(await ledger()).toMatchObject({ generation_windows: '1', generation_reservations: '3/0.75' });
  });

  it('keeps the collection pilot exclusive during its window, never adopts its run and frees ordinary collection after expiry', async () => {
    await at('2026-10-15T12:00:00Z');
    const pilotRun = await admitPilot('2026-10-15'), fence = randomUUID();
    await claimRun(second, pilotRun, fence);
    await stage(second, pilotRun, fence, 'instagram:mosseri', true);
    await save(second, pilotRun, fence, 'instagram:mosseri', 0.01);
    await at('2026-10-15T20:30:00Z');
    await expect(admit(second, secondProject, '2026-10-15')).rejects.toThrow('collection pilot explicit scope required');
    await at('2026-10-16T20:30:00Z');
    await expect(admit(second, secondProject, '2026-10-15')).rejects.toThrow('collection pilot existing daily run');
    await expect(claimRun(second, pilotRun, randomUUID())).rejects.toThrow('collection pilot expired');
    await expect(admitPilot('2026-10-16')).rejects.toThrow('collection pilot expired');
    const ordinary = await admit(second, secondProject, '2026-10-16'), next = randomUUID();
    await claimRun(second, ordinary, next);
    await stage(second, ordinary, next, 'instagram:mosseri', true);
    expect(await ledger()).toMatchObject({ collection_runs: '1/1', pilot_reserved: '0.04' });
    // An unknown paid outcome still stops further paid work; only the pilot gate was scoped.
    await save(second, ordinary, next, 'instagram:mosseri', null);
    await expect(stage(second, ordinary, next, '__jev:00', true)).rejects.toThrow('collection cost unresolved');
  });

  it('keeps every scoped function service-only', async () => {
    const { rows } = await db.query<Record<string, boolean>>(`select
      has_function_privilege('authenticated','marketing_private.check_generation_pilot(uuid,jsonb,boolean)','execute') generation_authenticated,
      has_function_privilege('authenticated','public.marketing_dneskai_admit(uuid,uuid,date,jsonb)','execute') admit_authenticated,
      has_function_privilege('anon','public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean)','execute') stage_anon,
      has_function_privilege('service_role','public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean)','execute') stage_service`);
    expect(rows[0]).toEqual({ generation_authenticated: false, admit_authenticated: false, stage_anon: false, stage_service: true });
  });
});
