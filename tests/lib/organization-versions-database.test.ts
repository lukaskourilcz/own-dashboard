import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedDatabase, setDatabaseTime } from '../helpers/supabase-pglite';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', foreign = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stamp = '2026-10-25T09:00:00Z';
let db: PGlite;
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: stamp }); await db.query('insert into auth.users(id) values($1)', [other]); }, 120000);
beforeEach(async () => {
 await db.exec('reset role; delete from organizations'); await setDatabaseTime(db, stamp); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
 await db.query("insert into organizations(id,user_id,name,notes) values($1,$2,'Owned','Private fixture note'),($3,$4,'Foreign','Foreign fixture note')", [id,owner,foreign,other]); await db.exec('set role authenticated');
});
afterAll(async () => db?.close());
const read = async () => (await db.query<{ row: Record<string, unknown> }>('select to_jsonb(o) as row from organizations o where id=$1', [id])).rows[0].row;
it('advances ordinary writer versions and refuses an earlier-version update without changing private data', async () => {
 const before = await read(); await setDatabaseTime(db, '2026-10-25T09:02:00Z'); await db.query('update organizations set name=$2 where id=$1', [id,'New name']); const after = await read();
 expect(Date.parse(after.updated_at as string)).toBeGreaterThan(Date.parse(before.updated_at as string));
 expect((await db.query('update organizations set name=$3 where id=$1 and updated_at=$2 returning id',[id,before.updated_at,'Stale name'])).rows).toEqual([]); expect((await read()).name).toBe('New name'); expect(after.notes).toBe(before.notes);
});
it('uses PostgreSQL microsecond ordering for same-clock writes and ignores a forged earlier client timestamp', async () => {
 const before = await read(); await db.query('update organizations set name=$2,updated_at=$3 where id=$1',[id,'First','2000-01-01T00:00:00Z']); const first = await read(); await db.query('update organizations set name=$2 where id=$1',[id,'Second']); const second = await read();
 expect((await db.query<{ delta: string }>('select (($2::timestamptz-$1::timestamptz)*1000000)::text as delta',[first.updated_at,second.updated_at])).rows[0].delta).toContain('00:00:01'); expect(first.updated_at).not.toBe(before.updated_at);
});
it('advances future stored versions without moving them backwards and refuses nonfinite creation versions', async () => {
 await db.exec('reset role'); const future = '2099-01-01T00:00:00Z'; await db.query('insert into organizations(id,user_id,name,updated_at) values($1,$2,$3,$4) on conflict(id) do nothing',[ 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', owner,'Future',future]); await db.exec('set role authenticated');
 const row = (await db.query<{ updated: string }>('update organizations set name=$2 where id=$1 returning updated_at::text as updated',['cccccccc-cccc-4ccc-8ccc-cccccccccccc','Future changed'])).rows[0]; expect(row.updated).toContain('00:00:00.000001');
 for (const value of ['infinity','-infinity']) await expect(db.query('insert into organizations(user_id,name,updated_at) values($1,$2,$3)',[owner,'Invalid',value])).rejects.toThrow('organizations_finite_version');
});
it('preserves own-only RLS on direct writes and snapshots', async () => {
 expect((await db.query('update organizations set name=$2 where id=$1 returning id',[foreign,'Changed'])).rows).toEqual([]);
 const rows = (await db.query<{ result: Array<{id:string;user_id:string}> }>("select read_owned_collection('organizations') as result")).rows[0].result; expect(rows.map(row=>row.id)).toEqual([id]); expect(rows.every(row=>row.user_id===owner)).toBe(true);
 await db.query("select set_config('request.jwt.claim.sub','',false)"); await expect(db.query("select read_owned_collection('organizations')")).rejects.toThrow('Authentication required');
});
it('reads beyond the REST cap with stable name/id order and no omitted owned rows', async () => {
 await db.query("insert into organizations(user_id,name) select $1,'Same name' from generate_series(1,1005)",[owner]); const rows = (await db.query<{ result: Array<{id:string;user_id:string;name:string}> }>("select read_owned_collection('organizations') as result")).rows[0].result;
 expect(rows).toHaveLength(1006); expect(new Set(rows.map(row=>row.id)).size).toBe(1006); expect(rows.some(row=>row.id===foreign)).toBe(false); expect(rows.slice(1).map(row=>row.id)).toEqual(rows.slice(1).map(row=>row.id).sort());
});
it('refuses the complete collection instead of returning a partial row or byte-bound result', async () => {
 await db.query("insert into organizations(user_id,name) select $1,'Bound' from generate_series(1,10000)",[owner]); await expect(db.query("select read_owned_collection('organizations')")).rejects.toThrow('complete read bound');
 await db.query('delete from organizations where id<>$1',[id]); await db.query('update organizations set notes=$2 where id=$1',[id,'x'.repeat(10*1024*1024)]); await expect(db.query("select read_owned_collection('organizations')")).rejects.toThrow('complete read bound');
});
it('keeps the snapshot invoker-only with narrow grants and does not expose the trigger as an RPC', async () => {
 const rows=(await db.query("select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid in ('read_owned_collection(text)'::regprocedure,'organization_version_touch()'::regprocedure) order by proname")).rows;
 expect(rows[0]).toMatchObject({proname:'organization_version_touch',prosecdef:false,anon:false,service:false,authenticated:false}); expect(rows[1]).toMatchObject({proname:'read_owned_collection',prosecdef:false,anon:false,service:false,authenticated:true});
});

it('upgrades existing records without rewriting their fields, then protects their next version', async () => {
 const migration = '20261025091027_complete_organization_records.sql', old = await createMigratedDatabase({ owner, instant: stamp, beforeMigration: migration });
 try {
  await old.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await old.query('insert into organizations(id,user_id,name,notes) values($1,$2,$3,$4)',[id,owner,'Upgrade fixture','Retained note']);
  const readOld = async () => (await old.query<{ row: Record<string, unknown> }>('select to_jsonb(o) as row from organizations o where id=$1',[id])).rows[0].row;
  const before = await readOld(); await old.exec(readFileSync(`supabase/migrations/${migration}`,'utf8')); expect(await readOld()).toEqual(before);
  await old.exec('set role authenticated'); await old.query('update organizations set name=$2 where id=$1',[id,'Changed']); expect((await readOld()).updated_at).not.toBe(before.updated_at);
  expect((await old.query('update organizations set name=$3 where id=$1 and updated_at=$2 returning id',[id,before.updated_at,'Stale'])).rows).toEqual([]);
 } finally { await old.close(); }
}, 120000);
it('refuses and rolls back an upgrade with a nonfinite existing version instead of repairing owner data silently', async () => {
 const migration = '20261025091027_complete_organization_records.sql', old = await createMigratedDatabase({ owner, instant: stamp, beforeMigration: migration });
 try {
  await old.query("insert into organizations(id,user_id,name,updated_at) values($1,$2,$3,'infinity')",[id,owner,'Nonfinite fixture']);
  await old.exec('begin'); await expect(old.exec(readFileSync(`supabase/migrations/${migration}`,'utf8'))).rejects.toThrow('organizations_finite_version'); await old.exec('rollback');
  expect((await old.query<{ stamp: string }>("select updated_at::text as stamp from organizations where id=$1",[id])).rows[0].stamp).toBe('infinity');
  expect((await old.query<{ function: string | null }>("select to_regprocedure('public.organization_version_touch()') as function")).rows[0].function).toBeNull();
 } finally { await old.close(); }
}, 120000);
