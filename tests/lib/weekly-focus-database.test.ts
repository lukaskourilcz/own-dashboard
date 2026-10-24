import { parseWeeklyFocusSnapshot } from '@/lib/weekly-focus';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { createMigratedDatabase, MIGRATION_FILES } from '../helpers/supabase-pglite';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const week = '2026-10-12';
type Snapshot = { ownerId: string; weekStart: string; sets: Array<{ id: string; user_id: string; focus_date: string; generation: number;
  items: Array<{ id: string; user_id: string; set_id: string; position: number; title_snapshot: string; completed_at: string | null }> }> };
let db: PGlite;
const read = async (start: string | null = week) => (await db.query<{ result: Snapshot }>('select weekly_focus_snapshot($1) as result', [start])).rows[0]!.result;
const seed = async (actor = owner, start = week, generation = 1, title = 'Owned task') => {
  const result = await db.query<{ id: string }>('insert into daily_focus_sets(user_id,focus_date,generation) values($1,$2,$3) returning id', [actor, start, generation]);
  const id = result.rows[0]!.id;
  await db.query("insert into daily_focus_items(set_id,user_id,position,title_snapshot,waiting_since,completed_at) select $1,$2,n,$3||' '||n,now(),case when n%2=0 then now() else null end from generate_series(1,7) n order by n desc", [id, actor, title]);
  return id;
};
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: '2026-10-25T00:10:00Z' }); await db.query('insert into auth.users(id) values($1)', [other]); }, 120_000);
beforeEach(async () => {
  await db.exec('reset role; delete from daily_focus_sets');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec('set role authenticated');
});
afterAll(async () => db?.close());
it('returns all seven latest sets and exactly 49 ordered items despite more than the REST cap of older generations', async () => {
  await db.query("insert into daily_focus_sets(user_id,focus_date,generation) select $1,$2,n from generate_series(1,1200) n", [owner, week]);
  await seed(owner, week, 1201, 'Latest Monday');
  for (const day of [13,14,15,16,17,18]) await seed(owner, `2026-10-${day}`);
  const result = await read(); expect(parseWeeklyFocusSnapshot(result, owner, week)).toHaveLength(7); expect(result.ownerId).toBe(owner); expect(result.weekStart).toBe(week);
  expect(result.sets.map(row => row.focus_date)).toEqual(['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18']);
  expect(result.sets[0]!.generation).toBe(1201); expect(result.sets.flatMap(row => row.items)).toHaveLength(49);
  for (const set of result.sets) {
    expect(set.user_id).toBe(owner); expect(set.items.map(row => row.position)).toEqual([1,2,3,4,5,6,7]);
    for (const item of set.items) { expect(item.user_id).toBe(owner); expect(item.set_id).toBe(set.id); }
  }
  expect(result.sets[0]!.items.every(item => item.title_snapshot.startsWith('Latest Monday'))).toBe(true);
});
it('selects the latest generation rather than the earlier most-completed garden generation', async () => {
  await seed(owner, week, 1, 'Old completed');
  await db.query('update daily_focus_items set completed_at=now()');
  await seed(owner, week, 2, 'Latest unfinished');
  const result = await read(); expect(result.sets).toHaveLength(1); expect(result.sets[0]!.generation).toBe(2);
  expect(result.sets[0]!.items.filter(item => item.completed_at)).toHaveLength(3);
});
it('keeps foreign owners and both week edges outside the caller snapshot', async () => {
  await db.exec('reset role'); await seed(other, week, 9999, 'Foreign private task');
  await db.exec('set role authenticated');
  await seed(owner, '2026-10-11', 1, 'Before'); await seed(owner, '2026-10-19', 1, 'After'); await seed();
  const result = await read(); expect(result.sets).toHaveLength(1); expect(JSON.stringify(result)).not.toMatch(/Foreign|Before|After/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  const foreignResult = await read(); expect(foreignResult.ownerId).toBe(other); expect(foreignResult.sets).toHaveLength(1); expect(foreignResult.sets[0]!.generation).toBe(9999);
});
it('confirms an empty week and retains a real empty latest set', async () => {
  expect(await read()).toEqual({ ownerId: owner, weekStart: week, sets: [] });
  await seed(); await db.query('insert into daily_focus_sets(user_id,focus_date,generation) values($1,$2,2)', [owner, week]);
  const result = await read(); expect(result.sets).toHaveLength(1); expect(result.sets[0]!.items).toEqual([]); expect(result.sets[0]!.generation).toBe(2);
});
it('refuses an overbound complete response without truncating rows or changing saved data', async () => {
  await seed(owner, week, 1, 'x'.repeat(100_000));
  await expect(read()).rejects.toThrow('weekly focus limit');
  expect((await db.query<{ count: number }>('select count(*)::int as count from daily_focus_items')).rows[0]!.count).toBe(7);
});
it('rejects missing, non-Monday and nonfinite calendar windows', async () => {
  for (const start of [null, '2026-10-13', 'infinity', '-infinity']) await expect(read(start)).rejects.toThrow('weekly focus invalid');
});
it('preserves invoker RLS, a fixed search path and authenticated-only execution', async () => {
  expect(MIGRATION_FILES).toContain('20261024220621_weekly_focus_snapshot.sql');
  expect((await db.query("select prosecdef,provolatile,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='weekly_focus_snapshot(date)'::regprocedure")).rows[0])
    .toEqual({ prosecdef: false, provolatile: 's', proconfig: ['search_path=""'], anon: false, service: false, authenticated: true });
  await db.query("select set_config('request.jwt.claim.sub','',false)"); await expect(read()).rejects.toThrow('weekly focus unavailable');
  for (const role of ['anon','service_role']) { await db.exec(`reset role; set role ${role}`); await expect(read()).rejects.toThrow('permission denied'); }
});
