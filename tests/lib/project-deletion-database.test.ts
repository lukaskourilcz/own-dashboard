import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", stamp = "2026-10-24T09:00:00.000001Z";
let db: PGlite;
const remove = (target = id, user = owner, version = stamp) => db.query<Record<string, unknown>>("delete from projects where id=$1 and user_id=$2 and updated_at=$3 returning id,user_id,updated_at", [target, user, version]);
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: "2026-10-24T14:00:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]); }, 120000);
beforeEach(async () => {
  await db.exec("reset role; drop trigger if exists audit_delete_suppression on projects; delete from projects");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.query("insert into projects(id,user_id,name,slug,notes,updated_at) values($1,$2,'Fixture','fixture','Private notes',$3),($4,$5,'Foreign','foreign','Foreign private notes',$3)", [id, owner, stamp, foreign, other]);
  await db.exec("set role authenticated");
});
afterAll(async () => db?.close());
it("returns only the exact owned deleted version with no private metadata", async () => {
  const result = await remove(); expect(result.rows).toHaveLength(1); expect(result.rows[0]).toMatchObject({ id, user_id: owner }); expect(Object.keys(result.rows[0]).sort()).toEqual(["id", "updated_at", "user_id"]);
  expect((await db.query("select id from projects where id=$1", [id])).rows).toEqual([]); expect((await remove()).rows).toEqual([]);
});
it("rejects a changed microsecond and preserves the newer note", async () => {
  await db.query("update projects set notes='New note',updated_at='2026-10-24T09:00:00.000002Z' where id=$1", [id]);
  expect((await remove()).rows).toEqual([]); expect((await db.query("select notes from projects where id=$1", [id])).rows).toEqual([{ notes: "New note" }]);
});
it("cannot delete a foreign owner even with a forged requested owner", async () => {
  expect((await remove(foreign, other)).rows).toEqual([]); expect((await remove(id, other)).rows).toEqual([]);
  await db.exec("reset role"); expect((await db.query("select count(*)::integer as n from projects")).rows).toEqual([{ n: 2 }]);
});
it("cascades project costs and rejects a suppressed deletion without erasing anything", async () => {
  await db.query("insert into project_costs(user_id,project_id,label,amount,currency) values($1,$2,'Fixture',10,'CZK')", [owner, id]);
  await db.exec("reset role; create or replace function pg_temp.audit_delete_suppression() returns trigger language plpgsql as $$ begin return null; end $$; create trigger audit_delete_suppression before delete on projects for each row execute function pg_temp.audit_delete_suppression(); set role authenticated");
  expect((await remove()).rows).toEqual([]); expect((await db.query("select count(*)::integer as n from project_costs")).rows).toEqual([{ n: 1 }]);
  await db.exec("reset role; drop trigger audit_delete_suppression on projects; set role authenticated"); await remove(); expect((await db.query("select count(*)::integer as n from project_costs")).rows).toEqual([{ n: 0 }]);
});
