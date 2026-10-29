import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedDatabase, setDatabaseTime } from '../helpers/supabase-pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreignProject = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const foreign = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const stamp = '2026-10-25T11:00:00Z';
const migration = '20261025114445_complete_competitor_records.sql';
let db: PGlite;

beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: stamp });
  await db.query('insert into auth.users(id) values($1)', [other]);
  await db.query("insert into projects(id,user_id,name,slug) values($1,$2,'Owned project','owned-competitor-fixture'),($3,$4,'Foreign project','foreign-competitor-fixture')", [project, owner, foreignProject, other]);
}, 120000);
beforeEach(async () => {
  await db.exec('reset role; delete from competitors');
  await setDatabaseTime(db, stamp);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.query("insert into competitors(id,user_id,project_id,name,summary) values($1,$2,$3,'Owned research','Retained summary'),($4,$5,$6,'Foreign research','Foreign summary')", [id, owner, project, foreign, other, foreignProject]);
  await db.exec('set role authenticated');
});
afterAll(async () => db?.close());
const read = async () => (await db.query<{ record: Record<string, unknown> }>('select to_jsonb(c) as record from competitors c where id=$1', [id])).rows[0].record;

it('maintains a real version for ordinary updates and refuses a stale source', async () => {
  const before = await read();
  await setDatabaseTime(db, '2026-10-25T11:01:00Z');
  await db.query('update competitors set name=$2 where id=$1', [id, 'Confirmed name']);
  const after = await read();
  expect(Date.parse(after.updated_at as string)).toBeGreaterThan(Date.parse(before.updated_at as string));
  expect((await db.query('update competitors set name=$3 where id=$1 and updated_at=$2 returning id', [id, before.updated_at, 'Stale name'])).rows).toEqual([]);
  expect(after.summary).toBe(before.summary);
});
it('reads a complete owned collection past the REST cap', async () => {
  await db.query("insert into competitors(user_id,project_id,name) select $1,$2,'Research '||n from generate_series(1,1200)n", [owner, project]);
  const result = (await db.query<{ records: { id: string; user_id: string }[] }>("select read_owned_collection('competitors',$1) as records", [owner])).rows[0].records;
  expect(result).toHaveLength(1201);
  expect(new Set(result.map(row => row.id)).size).toBe(1201);
  expect(result.every(row => row.user_id === owner)).toBe(true);
  expect(result.map(row => row.id)).toEqual(result.map(row => row.id).sort());
});
it('advances a same-clock version by microseconds and ignores an earlier client timestamp', async () => {
  const before = await read();
  await db.query('update competitors set name=$2,updated_at=$3 where id=$1', [id, 'First', '2000-01-01T00:00:00Z']);
  const first = await read();
  await db.query('update competitors set name=$2 where id=$1', [id, 'Second']);
  const second = await read();
  for (const [old, updated] of [[before, first], [first, second]]) {
    expect((await db.query<{ advanced: boolean }>("select $2::timestamptz=$1::timestamptz+interval '1 microsecond' as advanced", [old.updated_at, updated.updated_at])).rows[0].advanced).toBe(true);
  }
});
it('advances a future version and refuses nonfinite inserts', async () => {
  const future = '2099-01-01T00:00:00Z';
  const futureId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  await db.query('insert into competitors(id,user_id,project_id,name,updated_at) values($1,$2,$3,$4,$5)', [futureId, owner, project, 'Future research', future]);
  const row = (await db.query<{ advanced: boolean }>("update competitors set name='Changed' where id=$1 returning updated_at=$2::timestamptz+interval '1 microsecond' as advanced", [futureId, future])).rows[0];
  expect(row.advanced).toBe(true);
  for (const version of ['infinity', '-infinity']) {
    await expect(db.query('insert into competitors(user_id,project_id,name,updated_at) values($1,$2,$3,$4)', [owner, project, 'Nonfinite', version])).rejects.toThrow('competitors_finite_version');
  }
});
it('preserves row and related-project ownership, including the captured empty-owner guard', async () => {
  const before = await read();
  expect((await db.query("update competitors set name='Foreign write' where id=$1 returning id", [foreign])).rows).toEqual([]);
  expect((await db.query('delete from competitors where id=$1 returning id', [foreign])).rows).toEqual([]);
  await expect(db.query('update competitors set project_id=$2 where id=$1', [id, foreignProject])).rejects.toThrow('row-level security');
  expect(await read()).toEqual(before);
  for (const actor of [null, other]) {
    await expect(db.query("select read_owned_collection('competitors',$1::uuid)", [actor])).rejects.toThrow('Captured collection owner unavailable');
  }
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await expect(db.query("select read_owned_collection('competitors')")).rejects.toThrow('Authentication required');
});
it('refuses a row or returned-byte overflow instead of silently truncating research', async () => {
  await db.query("insert into competitors(user_id,project_id,name) select $1,$2,'Bound' from generate_series(1,10000)n", [owner, project]);
  await expect(db.query("select read_owned_collection('competitors')")).rejects.toThrow('Collection exceeds the complete read bound');
  await db.query('delete from competitors where user_id=$1 and id<>$2', [owner, id]);
  await db.query("update competitors set summary=repeat('x',10*1024*1024) where id=$1", [id]);
  await expect(db.query("select read_owned_collection('competitors')")).rejects.toThrow('Collection exceeds the complete read bound');
});
it('retains invoker rights, an empty search path and narrow direct function grants', async () => {
  const rows = (await db.query("select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as authenticated,has_function_privilege('service_role',oid,'execute') as service from pg_proc where oid in ('public.competitor_version_touch()'::regprocedure,'public.read_owned_collection(text)'::regprocedure,'public.read_owned_collection(text,uuid)'::regprocedure) order by proname,pronargs")).rows;
  expect(rows).toEqual([
    { proname: 'competitor_version_touch', prosecdef: false, proconfig: ['search_path=""'], anon: false, authenticated: false, service: false },
    { proname: 'read_owned_collection', prosecdef: false, proconfig: ['search_path=""'], anon: false, authenticated: true, service: false },
    { proname: 'read_owned_collection', prosecdef: false, proconfig: ['search_path=""'], anon: false, authenticated: true, service: false },
  ]);
});
it('upgrades existing research without rewriting its fields, then protects the next update', async () => {
  const old = await createMigratedDatabase({ owner, instant: stamp, beforeMigration: migration });
  try {
    await old.query("insert into projects(id,user_id,name,slug) values($1,$2,'Upgrade project','competitor-upgrade-fixture')", [project, owner]);
    await old.query("insert into competitors(id,user_id,project_id,name,summary) values($1,$2,$3,'Upgrade research','Retained summary')", [id, owner, project]);
    const snapshot = async () => (await old.query<{ record: Record<string, unknown> }>('select to_jsonb(c) as record from competitors c where id=$1', [id])).rows[0].record;
    const before = await snapshot();
    await old.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
    expect(await snapshot()).toEqual(before);
    expect((await old.query<{ lock_timeout: string }>('show lock_timeout')).rows[0].lock_timeout).toBe('0');
    await old.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await old.exec('set role authenticated');
    await old.query("update competitors set name='New name' where id=$1", [id]);
    expect((await snapshot()).updated_at).not.toBe(before.updated_at);
    expect((await snapshot()).summary).toBe(before.summary);
    expect((await old.query("update competitors set name='Stale name' where id=$1 and updated_at=$2 returning id", [id, before.updated_at])).rows).toEqual([]);
  } finally { await old.close(); }
}, 120000);
it('rolls back an upgrade with a nonfinite version without inventing a replacement', async () => {
  const old = await createMigratedDatabase({ owner, instant: stamp, beforeMigration: migration });
  try {
    await old.query("insert into projects(id,user_id,name,slug) values($1,$2,'Nonfinite project','competitor-nonfinite-fixture')", [project, owner]);
    await old.query("insert into competitors(id,user_id,project_id,name,updated_at) values($1,$2,$3,'Nonfinite research','infinity')", [id, owner, project]);
    await old.exec('begin');
    await expect(old.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'))).rejects.toThrow('competitors_finite_version');
    await old.exec('rollback');
    expect((await old.query<{ version: string }>('select updated_at::text as version from competitors where id=$1', [id])).rows[0].version).toBe('infinity');
    expect((await old.query<{ function: string | null }>("select to_regprocedure('public.competitor_version_touch()') as function")).rows[0].function).toBeNull();
  } finally { await old.close(); }
}, 120000);
