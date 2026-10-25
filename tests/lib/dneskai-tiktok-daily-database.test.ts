import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase, setDatabaseTime } from '../helpers/supabase-pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const filename = '20261025184649_tiktok_prague_daily_admission.sql';
const migration = readFileSync(`supabase/migrations/${filename}`, 'utf8');
type Decision = { admitted: boolean; id?: string; spentUsd: number };
let db: PGlite;
const reserve = async (database = db, user = owner, ceiling = 0.1, kind = 'tiktok') =>
  (await database.query<{ r: Decision }>('select public.marketing_reserve_dneskai_topic_spend($1,$2,$3,0.1,$4) r', [user, kind, `${kind}:pending`, ceiling])).rows[0]!.r;
const settle = (id: string, cost = 0, database = db) => database.query('select public.marketing_settle_dneskai_topic_spend($1,$2,$3)', [owner, id, cost]);

beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: '2026-10-24T00:15:00Z' });
  await db.query('insert into auth.users(id) values($1)', [other]);
}, 60_000);
beforeEach(async () => {
  await db.exec("reset role; set timezone='UTC'; truncate marketing_private.dneskai_topic_spend");
  await setDatabaseTime(db, '2026-10-24T00:15:00Z');
});
afterAll(async () => { await db?.close(); });

describe('atomic Prague-day TikTok admission', () => {
  it('upgrades existing evidence without rewriting it and rolls back the function atomically', async () => {
    const old = await createMigratedDatabase({ owner, instant: '2026-10-24T00:15:00Z', beforeMigration: filename });
    try {
      const first = await reserve(old); await settle(first.id!, 0, old);
      const second = await reserve(old); expect(second.admitted).toBe(true); await settle(second.id!, 0, old);
      const before = (await old.query('select * from marketing_private.dneskai_topic_spend order by id')).rows;
      await old.exec('begin'); await old.exec(migration);
      expect((await reserve(old)).admitted).toBe(false);
      expect((await old.query('select * from marketing_private.dneskai_topic_spend order by id')).rows).toEqual(before);
      await old.exec('rollback');
      expect((await reserve(old)).admitted).toBe(true);
      await old.exec(migration);
      expect((await reserve(old)).admitted).toBe(false);
    } finally { await old.close(); }
  }, 60_000);

  it('keeps a zero-cost settled reservation binding for its whole local day', async () => {
    const first = await reserve(); await settle(first.id!);
    expect((await reserve()).admitted).toBe(false);
    expect((await db.query('select id from marketing_private.dneskai_topic_spend')).rows).toHaveLength(1);
  });
  it('retains an ambiguous pending start at its full cost and blocks a second start', async () => {
    expect((await reserve(db, owner, 1)).admitted).toBe(true);
    expect((await reserve(db, owner, 1)).admitted).toBe(false);
    expect((await db.query('select ref,cost_usd,settled_at from marketing_private.dneskai_topic_spend')).rows).toEqual([{ ref: 'tiktok:pending', cost_usd: null, settled_at: null }]);
  });
  it('blocks the same-day twenty-hour application gap', async () => {
    await reserve(db, owner, 1); await setDatabaseTime(db, '2026-10-24T20:30:00Z');
    expect((await reserve(db, owner, 1)).admitted).toBe(false);
  });
  it('permits a new Prague day after a settled zero cost without requiring twenty hours', async () => {
    await setDatabaseTime(db, '2026-10-24T21:50:00Z'); const first = await reserve(); await settle(first.id!);
    await setDatabaseTime(db, '2026-10-24T22:10:00Z');
    expect((await reserve()).admitted).toBe(true);
  });
  it('preserves the rolling 24-hour spend ceiling across local midnight', async () => {
    await setDatabaseTime(db, '2026-10-24T21:50:00Z'); const first = await reserve();
    await setDatabaseTime(db, '2026-10-24T22:10:00Z'); expect((await reserve()).admitted).toBe(false);
    await settle(first.id!, 0.001); expect((await reserve()).admitted).toBe(false);
    await setDatabaseTime(db, '2026-10-25T22:11:00Z'); expect((await reserve()).admitted).toBe(true);
  });
  it.each([
    ['23-hour spring day', '2026-03-28T23:10:00Z', '2026-03-29T21:50:00Z', '2026-03-29T22:01:00Z'],
    ['25-hour autumn day', '2026-10-24T22:10:00Z', '2026-10-25T22:50:00Z', '2026-10-25T23:01:00Z'],
  ])('uses the actual %s boundaries', async (_label, firstAt, sameDay, nextDay) => {
    await setDatabaseTime(db, firstAt); const first = await reserve(db, owner, 1); await settle(first.id!);
    await setDatabaseTime(db, sameDay); expect((await reserve(db, owner, 1)).admitted).toBe(false);
    await setDatabaseTime(db, nextDay); expect((await reserve(db, owner, 1)).admitted).toBe(true);
  });
  it('does not depend on the connection timezone', async () => {
    await db.exec("set timezone='America/Los_Angeles'");
    await setDatabaseTime(db, '2026-10-24T21:50:00Z'); const first = await reserve(); await settle(first.id!);
    await setDatabaseTime(db, '2026-10-24T22:10:00Z'); expect((await reserve()).admitted).toBe(true);
  });
  it('isolates owners and retains the independent transcript/model budgets', async () => {
    expect((await reserve(db, owner, 1)).admitted).toBe(true);
    expect((await reserve(db, other, 1)).admitted).toBe(true);
    for (const kind of ['transcript', 'classify', 'title']) {
      expect((await reserve(db, owner, 1, kind)).admitted).toBe(true);
      expect((await reserve(db, owner, 1, kind)).admitted).toBe(true);
    }
  });
  it('keeps the invoker function service-only with an empty search path', async () => {
    const { rows } = await db.query<{ anonymous: boolean; authenticated: boolean; service: boolean; definer: boolean; config: string[] }>(`select
      has_function_privilege('anon',oid,'EXECUTE') anonymous,has_function_privilege('authenticated',oid,'EXECUTE') authenticated,
      has_function_privilege('service_role',oid,'EXECUTE') service,prosecdef definer,proconfig config
      from pg_proc where oid='public.marketing_reserve_dneskai_topic_spend(uuid,text,text,numeric,numeric)'::regprocedure`);
    expect(rows[0]).toEqual({ anonymous: false, authenticated: false, service: true, definer: false, config: ['search_path=""'] });
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await expect(reserve()).rejects.toThrow(/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    expect((await reserve()).admitted).toBe(true);
    await db.exec('reset role');
  });
  it('inserts the exact captured reservation instant and does not add a second index', async () => {
    const instant = '2026-10-24T20:30:00.123Z'; await setDatabaseTime(db, instant);
    const decision = await reserve();
    const row = (await db.query<{ at: Date }>('select reserved_at at from marketing_private.dneskai_topic_spend where id=$1', [decision.id])).rows[0]!;
    expect(row.at.toISOString()).toBe(instant);
    const indexes = (await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='marketing_private' and tablename='dneskai_topic_spend' order by indexname")).rows.map(row => row.indexname);
    expect(indexes).toEqual(['dneskai_topic_spend_pkey', 'dneskai_topic_spend_window']);
  });
});
