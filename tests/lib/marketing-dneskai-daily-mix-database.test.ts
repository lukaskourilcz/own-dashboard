import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { BRIEF_MIGRATIONS, createBriefsDatabase } from './marketing-dneskai-briefs-db';
import { DneskaiDailyMixReceiptSchema, type DneskaiDailyMix } from '@/lib/marketing/dneskai-daily-mix';
vi.mock('server-only', () => ({}));

/** The prepared daily mix table (#156) over the brief migrations, in isolated PGlite; every value is synthetic. */
const owner = '11111111-1111-4111-8111-111111111111', other = '33333333-3333-4333-8333-333333333333';
const project = '22222222-2222-4222-8222-222222222222', foreign = '44444444-4444-4444-8444-444444444444';
let db: PGlite;
beforeAll(async () => { db = await createBriefsDatabase([owner, other], [{ id: project, owner }, { id: foreign, owner: other }], '2026-10-23T08:00:00Z', [...BRIEF_MIGRATIONS, '20261023100300_dneskai_daily_mix.sql', '20261024170208_confirmed_dneskai_daily_mix.sql']); }, 60_000);
afterAll(async () => { await db?.close(); });
async function as<T>(user: string, sql: string, params: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}

describe('marketing_dneskai_daily_mix (#156)', () => {
  it('stores the default mix for the owner and keeps every row own-only', async () => {
    await as(owner, 'insert into marketing_dneskai_daily_mix(user_id,project_id) values($1,$2)', [owner, project]);
    expect(await as(owner, 'select news_per_day,education_per_day,slots from marketing_dneskai_daily_mix')).toEqual([{ news_per_day: 1, education_per_day: 1, slots: ['08:00', '17:00'] }]);
    expect(await as(other, 'select * from marketing_dneskai_daily_mix')).toEqual([]);
    await expect(as(other, 'insert into marketing_dneskai_daily_mix(user_id,project_id) values($1,$2)', [owner, project])).rejects.toThrow(/row-level security/);
    await expect(as(other, 'insert into marketing_dneskai_daily_mix(user_id,project_id) values($1,$2)', [other, project])).rejects.toThrow(/foreign collection project/);
    await as(other, "update marketing_dneskai_daily_mix set news_per_day=0 where user_id=$1", [owner]);
    expect((await as<{ n: number }>(owner, 'select news_per_day n from marketing_dneskai_daily_mix'))[0]!.n).toBe(1);
  });

  it('accepts 0 to 4 per kind only with a time for every post, and only the four times', async () => {
    await as(owner, "update marketing_dneskai_daily_mix set news_per_day=4,education_per_day=0,slots=array['08:00','12:30','17:00','20:00'] where user_id=$1", [owner]);
    await as(owner, "update marketing_dneskai_daily_mix set news_per_day=0,education_per_day=0,slots=array['20:00'] where user_id=$1", [owner]);
    for (const update of ["news_per_day=5", "education_per_day=-1", "news_per_day=2,education_per_day=1,slots=array['08:00','17:00']", "slots=array['09:00']", "slots='{}'::text[]"]) {
      await expect(as(owner, `update marketing_dneskai_daily_mix set ${update} where user_id=$1`, [owner]), update).rejects.toThrow(/check/);
    }
  });
});

async function save(user: string, projectId: string, expected: string | null, mix: unknown) {
  const rows = await as<{receipt: unknown}>(user, 'select save_dneskai_daily_mix($1,$2,$3::jsonb) receipt', [projectId,expected,JSON.stringify(mix)]);
  return DneskaiDailyMixReceiptSchema.parse(rows[0]!.receipt);
}
const stopped: DneskaiDailyMix = { newsPerDay:0, educationPerDay:0, slots:['08:00'] };
describe('captured-version mix persistence', () => {
  it('creates a first mix and returns exactly its stored owner/project/version', async () => {
    const receipt = await save(other,foreign,null,stopped);
    expect(receipt).toMatchObject({kind:'saved',ownerId:other,projectId:foreign,sourceVersion:null,read:{mix:stopped,stored:true}});
    const row = (await as<{version:string;news:number}>(other, 'select updated_at::text version,news_per_day news from marketing_dneskai_daily_mix'))[0]!;
    expect(Date.parse(row.version)).toBe(Date.parse(receipt.read.version!)); expect(row.news).toBe(0);
    expect(JSON.stringify(receipt).length).toBeLessThan(1000);
  });
  it('keeps an identical retry at the same version and refuses a stale first-save overwrite', async () => {
    const receipt = await save(other,foreign,null,stopped), next = await save(other,foreign,null,stopped);
    expect(next.read.version).toBe(receipt.read.version); expect(next.sourceVersion).toBe(receipt.read.version);
    const conflict = await save(other,foreign,null,{...stopped,newsPerDay:1});
    expect(conflict.kind).toBe('conflict'); expect(conflict.read).toEqual(receipt.read);
  });
  it('updates only the captured version and rejects another stale form without a write', async () => {
    const before = await save(other,foreign,null,stopped), desired = {...stopped,newsPerDay:1};
    const changed = await save(other,foreign,before.read.version,desired);
    expect(changed.kind).toBe('saved'); expect(changed.sourceVersion).toBe(before.read.version);
    expect(changed.read.mix).toEqual(desired); expect(changed.read.version).not.toBe(before.read.version);
    const conflict = await save(other,foreign,before.read.version,stopped);
    expect(conflict.kind).toBe('conflict'); expect(conflict.read).toEqual(changed.read);
    expect((await save(other,foreign,before.read.version,desired)).read.version).toBe(changed.read.version);
  });
  it('refuses foreign projects, absent users and ungranted roles', async () => {
    await expect(save(other,project,null,stopped)).rejects.toThrow(/Project unavailable/);
    await expect(save('',project,null,stopped)).rejects.toThrow(/Authentication required/);
    for(const role of ['anon','service_role']) {
      expect((await db.query<{allowed:boolean}>('select has_function_privilege($1,$2,$3) allowed',[role,'public.save_dneskai_daily_mix(uuid,timestamptz,jsonb)','EXECUTE'])).rows[0]!.allowed).toBe(false);
    }
    const metadata = (await db.query<{security:boolean;config:string[]}>('select prosecdef security,proconfig config from pg_proc where oid=$1::regprocedure',['public.save_dneskai_daily_mix(uuid,timestamptz,jsonb)'])).rows[0]!;
    expect(metadata.security).toBe(false); expect(metadata.config).toEqual(expect.arrayContaining(['search_path=""','lock_timeout=5s']));
  });
  it('refuses malformed shapes, unknown fields, repeated slots and insufficient capacity', async () => {
    for(const mix of [null,[],{...stopped,extra:true},{...stopped,newsPerDay:0.5},{...stopped,newsPerDay:'1'},{...stopped,slots:['08:00','08:00']},{...stopped,slots:[null]},{...stopped,slots:['09:00']},{...stopped,newsPerDay:2}]) {
      await expect(save(other,foreign,null,mix),JSON.stringify(mix)).rejects.toThrow(/Invalid daily mix/);
    }
  });
  it('rolls back a suppressed write instead of returning a false acknowledgement', async () => {
    const before = await save(other,foreign,null,{...stopped,newsPerDay:1});
    await db.exec("create function suppress_mix() returns trigger language plpgsql as $$begin return null;end$$; create trigger suppressed_mix before update on marketing_dneskai_daily_mix for each row execute function suppress_mix();");
    try { await expect(save(other,foreign,before.read.version,stopped)).rejects.toThrow(/unconfirmed/); }
    finally { await db.exec('drop trigger suppressed_mix on marketing_dneskai_daily_mix;drop function suppress_mix();'); }
    expect((await save(other,foreign,null,{...stopped,newsPerDay:1})).read).toEqual(before.read);
  });
});
