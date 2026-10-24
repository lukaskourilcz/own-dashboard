import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", stamp = "2026-10-24T09:00:00Z";
type Row = { id: string; user_id: string; name: string; sort_order: number; updated_at: string; engagement: string; parent_id: string | null; is_active: boolean };
let db: PGlite, owned: Row[], foreign: Row;
const read = async () => (await db.query<Row>("select id,user_id,name,sort_order,updated_at::text,engagement,parent_id,is_active from projects order by name")).rows;
const order = (rows = owned) => [...rows].reverse().map((row, sort_order) => ({ id: row.id, user_id: row.user_id, updated_at: row.updated_at, previous_sort_order: row.sort_order, sort_order, engagement: row.engagement, parent_id: row.parent_id, is_active: row.is_active }));
const save = async (rows: unknown = order()) => (await db.query<{ saved: Row[] }>("select reorder_owned_projects($1::jsonb) as saved", [JSON.stringify(rows)])).rows[0].saved;
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: "2026-10-24T10:00:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]); }, 120000);
beforeEach(async () => {
  await db.exec("reset role; drop trigger if exists audit_order_trigger on projects; drop policy if exists audit_order_suppression on projects; delete from projects");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.query("insert into projects(user_id,name,slug,sort_order,updated_at) select $1,label,lower(label),n*10,$2 from (values('A',0),('B',1),('C',2)) seed(label,n)", [owner, stamp]);
  owned = await read();
  await db.query("insert into projects(user_id,name,slug,sort_order,updated_at,engagement,is_active,parent_id) values($1,'Client','client',8,$2,'client',true,null),($1,'Inactive','inactive',9,$2,'own',false,null),($1,'Child','child',9,$2,'own',true,$3),($4,'Foreign','foreign',3,$2,'own',true,null)", [owner, stamp, owned[0].id, other]);
  foreign = (await read()).find(row => row.user_id === other)!; await db.exec("set role authenticated");
});
afterAll(async () => db?.close());
it("atomically reorders the complete active group and returns only changed order/version receipts", async () => {
  const before = await read(), rows = order(), saved = await save(rows); expect(saved).toHaveLength(3);
  for (const row of saved) { expect(Object.keys(row).sort()).toEqual(["id", "sort_order", "updated_at", "user_id"]); expect(row.user_id).toBe(owner); expect(row.sort_order).toBe(rows.find(input => input.id === row.id)!.sort_order); expect(Date.parse(row.updated_at)).toBeGreaterThan(Date.parse(stamp)); }
  const after = await read(); for (const row of before.filter(row => !owned.some(item => item.id === row.id))) expect(after.find(item => item.id === row.id)).toEqual(row);
});
it("does not rewrite unchanged positions or return them in the receipt", async () => {
  const rows = order(); rows.forEach(row => { row.previous_sort_order = row.sort_order; });
  for (const row of rows) await db.query("update projects set sort_order=$2 where id=$1", [row.id, row.sort_order]);
  const before = await read(); expect(await save(rows)).toEqual([]); expect(await read()).toEqual(before);
});
it("refuses stale versions and partial or changed group membership before any write", async () => {
  await expect(save(order().slice(0, 2))).rejects.toThrow("Project order changed");
  const stale = order(); await db.query("update projects set updated_at=$2 where id=$1", [owned[0].id, "2026-10-24T09:01:00Z"]); const before = await read();
  await expect(save(stale)).rejects.toThrow("Project order changed"); expect(await read()).toEqual(before);
  await db.query("insert into projects(user_id,name,slug) values($1,'New','new')", [owner]); await expect(save()).rejects.toThrow("Project order changed");
});
it("refuses duplicate, malformed, overbound and forged source fields without changing rows", async () => {
  const rows = order(), before = await read();
  for (const input of [null, {}, [], [rows[0], rows[0]], rows.map(row => ({ ...row, sort_order: 1 })), rows.map(row => ({ ...row, user_id: other })), rows.map(row => ({ ...row, name: "Injected" })), rows.map(row => ({ ...row, sort_order: 0.5 })), rows.map(row => ({ ...row, is_active: false })), rows.map(row => ({ ...row, parent_id: foreign.id })), Array(20001).fill(rows[0]), [{ ...rows[0], extra: "x".repeat(8388608) }]]) await expect(save(input)).rejects.toThrow();
  expect(await read()).toEqual(before);
});
it("isolates owners and refuses a foreign id hidden behind a forged owner field", async () => {
  const forged = order(); forged[0].id = foreign.id; const before = await read(); await expect(save(forged)).rejects.toThrow("Project order changed"); expect(await read()).toEqual(before);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]); await expect(save()).rejects.toThrow("Invalid project order source");
});
it("rolls back every row when RLS suppresses one update", async () => {
  await db.exec("reset role; create policy audit_order_suppression on projects as restrictive for update to authenticated using (name<>'B') with check (name<>'B'); set role authenticated");
  const before = await read(); await expect(save()).rejects.toThrow("Project order not confirmed"); expect(await read()).toEqual(before);
});
it("rolls back an altered or suppressed trigger receipt", async () => {
  const before = await read(); await db.exec("reset role; create or replace function pg_temp.audit_order_trigger() returns trigger language plpgsql as $$ begin if new.name='B' then return null; end if; return new; end $$; create trigger audit_order_trigger before update on projects for each row execute function pg_temp.audit_order_trigger(); set role authenticated");
  await expect(save()).rejects.toThrow("Project order not confirmed"); expect(await read()).toEqual(before);
  await db.exec("reset role; create or replace function pg_temp.audit_order_trigger() returns trigger language plpgsql as $$ begin new.sort_order:=99; return new; end $$; set role authenticated");
  await expect(save()).rejects.toThrow("Project order not confirmed"); expect(await read()).toEqual(before);
});
it("preserves project text and metadata while sending no note bodies in either direction", async () => {
  await db.query("update projects set notes=repeat('x',2097152),name='Renamed' where id=$1", [owned[0].id]);
  expect(JSON.stringify(order()).length).toBeLessThan(2000); expect(JSON.stringify(await save()).length).toBeLessThan(1000);
  const row = (await db.query<{ name: string; size: number }>("select name,length(notes) as size from projects where id=$1", [owned[0].id])).rows[0]; expect(row).toEqual({ name: "Renamed", size: 2097152 });
});
it("retains invoker RLS, an empty search path, finite lock wait and authenticated-only execution", async () => {
  const row = (await db.query<{ prosecdef: boolean; proconfig: string[]; anon: boolean; service: boolean; authenticated: boolean }>("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='reorder_owned_projects(jsonb)'::regprocedure")).rows[0];
  expect(row).toMatchObject({ prosecdef: false, anon: false, service: false, authenticated: true }); expect(row.proconfig).toEqual(['search_path=""', 'lock_timeout=5s']);
  await db.exec("reset role; set role anon"); await expect(save()).rejects.toThrow("permission denied"); await db.exec("reset role; set role service_role"); await expect(save()).rejects.toThrow("permission denied");
});

it("refuses an authenticated role without an owner claim", async () => {
  await db.query("select set_config('request.jwt.claim.sub','',false)"); await expect(save()).rejects.toThrow("Authentication required");
});
it("refuses a hidden child, inactive row or different group disguised as an eligible source", async () => {
  const before = await read();
  for (const name of ["Child", "Inactive", "Client"]) {
    const row = before.find(item => item.name === name)!, forged = order(); forged[0] = { ...forged[0], id: row.id, previous_sort_order: row.sort_order, updated_at: row.updated_at };
    await expect(save(forged)).rejects.toThrow("Project order changed"); expect(await read()).toEqual(before);
  }
});
