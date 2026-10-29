import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedDatabase, setDatabaseTime } from '../helpers/supabase-pglite';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', foreign = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stamp = '2026-10-25T17:00:00Z', migration = '20261025170608_confirmed_plan_records.sql';
let db: PGlite;
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: stamp }); await db.query('insert into auth.users(id) values($1)', [other]); }, 120000);
beforeEach(async () => {
 await db.exec('reset role; delete from plans'); await setDatabaseTime(db, stamp); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
 await db.query("insert into plans(id,user_id,title,recurrence,last_completed_at,notes,linked_calendar_event_id) values($1,$2,'Owned','weekly',$5,'Retained private note','retained-event'),($3,$4,'Foreign','none',null,null,null)", [id, owner, foreign, other, stamp]); await db.exec('set role authenticated');
});
afterAll(async () => db?.close());
const read = async () => (await db.query<{ row: Record<string, unknown> }>('select to_jsonb(p) as row from plans p where id=$1', [id])).rows[0].row;
it('advances every ordinary writer version and refuses stale update/deletion', async () => {
 const before = await read(); await setDatabaseTime(db, '2026-10-25T17:01:00Z');
 await db.query("update plans set status='active' where id=$1", [id]); const after = await read();
 expect(Date.parse(after.updated_at as string)).toBeGreaterThan(Date.parse(before.updated_at as string));
 expect((await db.query("update plans set status='done' where id=$1 and updated_at=$2 returning id", [id, before.updated_at])).rows).toEqual([]);
 expect((await db.query('delete from plans where id=$1 and updated_at=$2 returning id', [id, before.updated_at])).rows).toEqual([]);
 expect(after).toEqual({ ...before, status: 'active', updated_at: after.updated_at });
});
it('advances same-clock/future versions by a PostgreSQL microsecond, ignoring forged timestamps', async () => {
 const before = await read(); await db.query("update plans set status='active',updated_at='2000-01-01' where id=$1", [id]); const first = await read();
 expect((await db.query<{ advanced: boolean }>("select $2::timestamptz=$1::timestamptz+interval '1 microsecond' as advanced", [before.updated_at, first.updated_at])).rows[0].advanced).toBe(true);
 const future = '2099-01-01T00:00:00Z', futureId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 await db.query("insert into plans(id,user_id,title,updated_at) values($1,$2,'Future',$3)", [futureId, owner, future]);
 expect((await db.query<{ advanced: boolean }>("update plans set status='active' where id=$1 returning updated_at=$2::timestamptz+interval '1 microsecond' as advanced", [futureId, future])).rows[0].advanced).toBe(true);
 for (const version of ['infinity', '-infinity']) await expect(db.query("insert into plans(user_id,title,updated_at) values($1,'Nonfinite',$2)", [owner, version])).rejects.toThrow('plans_finite_version');
});
it('returns all owned plans beyond the REST cap in stable created/id descending order', async () => {
 await db.query("insert into plans(user_id,title) select $1,'Synthetic plan '||n from generate_series(1,1200)n", [owner]);
 const rows = (await db.query<{ rows: { id: string; user_id: string }[] }>("select read_owned_collection('plans',$1) as rows", [owner])).rows[0].rows;
 expect(rows).toHaveLength(1201); expect(new Set(rows.map(row => row.id)).size).toBe(1201); expect(rows.every(row => row.user_id === owner)).toBe(true); expect(rows.map(row => row.id)).toEqual(rows.map(row => row.id).sort().reverse());
});
it('preserves own-only writes and checks the captured owner even for an empty result', async () => {
 expect((await db.query("update plans set title='Foreign change' where id=$1 returning id", [foreign])).rows).toEqual([]); expect((await db.query('delete from plans where id=$1 returning id', [foreign])).rows).toEqual([]);
 await expect(db.query('update plans set user_id=$2 where id=$1', [id, other])).rejects.toThrow('row-level security');
 await db.query('delete from plans where id=$1', [id]); expect((await db.query<{ rows: unknown[] }>("select read_owned_collection('plans',$1) as rows", [owner])).rows[0].rows).toEqual([]);
 for (const expected of [null, other]) await expect(db.query("select read_owned_collection('plans',$1::uuid)", [expected])).rejects.toThrow('Captured collection owner unavailable');
 await db.query("select set_config('request.jwt.claim.sub','',false)"); await expect(db.query("select read_owned_collection('plans')")).rejects.toThrow('Authentication required');
});
it('refuses row/byte overflow rather than presenting a partial Goals or Home collection', async () => {
 await db.query("insert into plans(user_id,title) select $1,'Bound' from generate_series(1,10000)n", [owner]); await expect(db.query("select read_owned_collection('plans')")).rejects.toThrow('complete read bound');
 await db.query('delete from plans where id<>$1', [id]); await db.query("update plans set notes=repeat('x',10*1024*1024) where id=$1", [id]); await expect(db.query("select read_owned_collection('plans')")).rejects.toThrow('complete read bound');
});
it('retains invoker RLS, stable snapshots, empty search paths and narrow function grants', async () => {
 const rows = (await db.query("select proname,prosecdef,provolatile,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as authenticated,has_function_privilege('service_role',oid,'execute') as service from pg_proc where oid in ('public.plan_version_touch()'::regprocedure,'public.read_owned_collection(text)'::regprocedure,'public.read_owned_collection(text,uuid)'::regprocedure) order by proname,pronargs")).rows;
 expect(rows).toEqual([
  { proname: 'plan_version_touch', prosecdef: false, provolatile: 'v', proconfig: ['search_path=""'], anon: false, authenticated: false, service: false },
  { proname: 'read_owned_collection', prosecdef: false, provolatile: 's', proconfig: ['search_path=""'], anon: false, authenticated: true, service: false },
  { proname: 'read_owned_collection', prosecdef: false, provolatile: 's', proconfig: ['search_path=""'], anon: false, authenticated: true, service: false },
 ]);
});
it('upgrades an existing plan without changing content, recurrence, completion, Calendar or money', async () => {
 const old = await createMigratedDatabase({ owner, instant: stamp, beforeMigration: migration });
 try {
  await old.query("insert into plans(id,user_id,title,recurrence,last_completed_at,notes,linked_calendar_event_id) values($1,$2,'Upgrade','biweekly',$3,'Retained','retained-event')", [id, owner, stamp]);
  const snapshot = async () => (await old.query<{ row: Record<string, unknown> }>('select to_jsonb(p) as row from plans p where id=$1', [id])).rows[0].row;
  const before = await snapshot(); await old.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8')); expect(await snapshot()).toEqual(before);
  expect((await old.query<{ lock_timeout: string }>('show lock_timeout')).rows[0].lock_timeout).toBe('0'); await old.exec('set role authenticated'); await old.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await old.query("update plans set status='active' where id=$1", [id]); expect((await snapshot()).updated_at).not.toBe(before.updated_at);
 } finally { await old.close(); }
}, 120000);
it('rolls back a nonfinite existing version without silently repairing owner data', async () => {
 const old = await createMigratedDatabase({ owner, instant: stamp, beforeMigration: migration });
 try {
  await old.query("insert into plans(id,user_id,title,updated_at) values($1,$2,'Nonfinite','infinity')", [id, owner]); await old.exec('begin'); await expect(old.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'))).rejects.toThrow('plans_finite_version'); await old.exec('rollback');
  expect((await old.query<{ version: string }>('select updated_at::text as version from plans where id=$1', [id])).rows[0].version).toBe('infinity'); expect((await old.query<{ function: string | null }>("select to_regprocedure('public.plan_version_touch()') as function")).rows[0].function).toBeNull();
 } finally { await old.close(); }
}, 120000);
