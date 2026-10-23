import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { BRIEF_MIGRATIONS, createBriefsDatabase } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

/** The prepared daily mix table (#156) over the brief migrations, in isolated PGlite; every value is synthetic. */
const owner = '11111111-1111-4111-8111-111111111111', other = '33333333-3333-4333-8333-333333333333';
const project = '22222222-2222-4222-8222-222222222222', foreign = '44444444-4444-4444-8444-444444444444';
let db: PGlite;
beforeAll(async () => { db = await createBriefsDatabase([owner, other], [{ id: project, owner }, { id: foreign, owner: other }], '2026-10-23T08:00:00Z', [...BRIEF_MIGRATIONS, '20261023100300_dneskai_daily_mix.sql']); }, 60_000);
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
