import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { exportColumns } from '@/lib/data-export-columns';
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
beforeAll(async () => {
 db = await createMigratedDatabase({ owner, instant: '2026-10-25T12:00:00Z' });
 await db.query('insert into auth.users(id) values($1)', [other]);
}, 120000);
beforeEach(async () => { await db.exec('reset role; delete from notes'); });
afterAll(async () => db?.close());
async function read(tables: unknown, expected: string | null = owner, actor: string | null = owner, role = 'authenticated') {
 await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? '']);
 await db.exec(`set role ${role}`);
 try { return (await db.query<{ data: { version: number; owner_id: string; tables: Record<string, Record<string, unknown>[]>; columns: Record<string, string[]> } }>('select public.export_owned_records($1::text[],$2::uuid) data', [tables, expected])).rows[0].data; }
 finally { await db.exec('reset role'); }
}
it('returns every explicit table/column contract with empty collections retained', async () => {
 const data = await read(Object.keys(exportColumns));
 expect(data.version).toBe(1); expect(data.owner_id).toBe(owner);
 expect(data.columns).toEqual(exportColumns);
 expect(Object.keys(data.tables).sort()).toEqual(Object.keys(exportColumns).sort());
 for (const [table, rows] of Object.entries(data.tables)) for (const row of rows) {
  expect(Object.keys(row).sort()).toEqual([...exportColumns[table as keyof typeof exportColumns]].sort());
  expect(row[table === 'profiles' ? 'id' : 'user_id']).toBe(owner);
 }
 expect(data.tables.notes).toEqual([]);
});
it('reads 1,201 owner rows deterministically without any foreign rows', async () => {
 await db.query("insert into notes(user_id,title) select $1,'Synthetic note '||n from generate_series(1,1201)n", [owner]);
 await db.query("insert into notes(user_id,title) values($1,'Foreign synthetic note')", [other]);
 const data = await read(['notes']);
 expect(data.tables.notes).toHaveLength(1201);
 expect(data.tables.notes.every(row => row.user_id === owner)).toBe(true);
 const ids = data.tables.notes.map(row => row.id); expect(ids).toEqual([...ids].sort());
});
it.each([[other, owner], [null, owner], [owner, other], [owner, null]])('rejects captured/actual owner mismatch even with no rows: %s/%s', async (expected, actor) => {
 await expect(read(['notes'], expected, actor)).rejects.toMatchObject({ code: '42501' });
});
it.each([null, [], ['notes', 'notes'], [null], ['constructor'], ['daily_pulse'], ['marketing_provider_credentials'], ['notes;drop table notes']])('rejects unsupported/duplicate table input %j', async tables => {
 await expect(read(tables)).rejects.toMatchObject({ code: '22023' });
});
it.each(['anon', 'service_role'])('denies direct %s execution', async role => {
 await expect(read(['notes'], owner, owner, role)).rejects.toMatchObject({ code: '42501' });
});
it('retains STABLE invoker execution with an empty search path', async () => {
 const { rows } = await db.query<{ provolatile: string; prosecdef: boolean; proconfig: string[] }>("select provolatile,prosecdef,proconfig from pg_proc where oid='public.export_owned_records(text[],uuid)'::regprocedure");
 expect(rows[0]).toMatchObject({ provolatile: 's', prosecdef: false, proconfig: ['search_path=""'] });
});
it('excludes future columns without changing existing source data', async () => {
 await db.exec("alter table notes add column future_private_field text default 'SYNTHETIC-ONLY';");
 try {
  await db.query("insert into notes(user_id,title) values($1,'Synthetic projection')", [owner]);
  const data = await read(['notes']); expect(data.tables.notes[0]).not.toHaveProperty('future_private_field');
  expect(data.columns.notes).not.toContain('future_private_field');
  expect((await db.query<{ value: string }>('select future_private_field value from notes')).rows[0].value).toBe('SYNTHETIC-ONLY');
 } finally { await db.exec('alter table notes drop column future_private_field'); }
});
it('refuses 10,001 rows instead of returning a partial collection', async () => {
 await db.query("insert into notes(user_id,title) select $1,'Bound '||n from generate_series(1,10001)n", [owner]);
 await expect(read(['notes'])).rejects.toMatchObject({ code: '54000' });
 expect((await db.query<{ count: number }>('select count(*)::integer count from notes')).rows[0].count).toBe(10001);
});
it('refuses oversized projected rows before aggregating a download', async () => {
 await db.query("insert into notes(user_id,title,content) values($1,'Synthetic large record',to_jsonb(repeat('x',10*1024*1024)))", [owner]);
 await expect(read(['notes'])).rejects.toMatchObject({ code: '54000' });
});
