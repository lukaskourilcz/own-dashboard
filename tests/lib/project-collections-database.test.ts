import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const migration = "20261024095216_complete_project_collections.sql";
let db: PGlite, projectId: string;
type Row = { id: string; user_id: string; sort_order?: number; created_at: string; project_id?: string };
const collection = async (entity: string) => (await db.query<{ rows: Row[] }>("select read_owned_collection($1) as rows", [entity])).rows[0].rows;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-24T10:00:00Z", beforeMigration: migration });
  await db.query("insert into auth.users(id) values($1)", [other]);
  for (const actor of [owner, other]) {
    const rows = await db.query<{ id: string }>("insert into projects(user_id,name,slug,sort_order) select $1,'Fixture '||n,'fixture-'||n,n%17 from generate_series(1,1201) n returning id", [actor]);
    const parent = rows.rows[0].id; if (actor === owner) projectId = parent;
    await db.query("insert into project_costs(user_id,project_id,label,amount,sort_order) select $1,$2,'Fixture cost '||n,n,n%11 from generate_series(1,1201) n", [actor, parent]);
    await db.query("insert into crons(user_id,project_id,name) select $1,$2,'Fixture job '||n from generate_series(1,1201) n", [actor, parent]);
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("set role authenticated");
}, 120000);
afterAll(async () => db?.close());
it("upgrades the real previous reader without changing rows or widening execution grants", async () => {
  await expect(collection("projects")).rejects.toThrow("Unsupported collection");
  await db.exec("reset role"); await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8")); await db.exec("set role authenticated");
  expect(await collection("projects")).toHaveLength(1201);
});
it("returns every owned project, cost and cron beyond the ordinary REST cap", async () => {
  for (const entity of ["projects", "project_costs", "crons"]) {
    const rows = await collection(entity); expect(rows).toHaveLength(1201); expect(rows.every(row => row.user_id === owner)).toBe(true); expect(new Set(rows.map(row => row.id)).size).toBe(1201);
  }
});
it("retains deterministic project and cost order including tied timestamps", async () => {
  for (const [entity, ordering] of [["projects", "sort_order,created_at,id"], ["project_costs", "project_id,sort_order,created_at,id"], ["crons", "project_id,created_at,id"]]) {
    const expected = (await db.query<{ id: string }>(`select id from ${entity} where user_id=$1 order by ${ordering}`, [owner])).rows.map(row => row.id);
    expect((await collection(entity)).map(row => row.id)).toEqual(expected);
  }
});
it("isolates the same-sized second owner and rejects unsupported entity names", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  for (const entity of ["projects", "project_costs", "crons"]) { const rows = await collection(entity); expect(rows).toHaveLength(1201); expect(rows.every(row => row.user_id === other)).toBe(true); }
  await expect(collection("projects; select * from auth.users")).rejects.toThrow("Unsupported collection");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
});
it("refuses an oversized whole snapshot rather than returning a truncated project", async () => {
  await db.query("update projects set notes=repeat('x',10485760) where id=$1", [projectId]);
  await expect(collection("projects")).rejects.toThrow("Collection exceeds the complete read bound");
  await db.query("update projects set notes='' where id=$1", [projectId]); expect(await collection("projects")).toHaveLength(1201);
});
it("retains stable invoker RLS, the empty search path and authenticated-only execution", async () => {
  const row = (await db.query<{ prosecdef: boolean; provolatile: string; proconfig: string[]; anon: boolean; service: boolean; authenticated: boolean }>("select prosecdef,provolatile,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='read_owned_collection(text)'::regprocedure")).rows[0];
  expect(row).toEqual({ prosecdef: false, provolatile: "s", proconfig: ['search_path=""'], anon: false, service: false, authenticated: true });
  await db.exec("reset role; set role service_role"); await expect(collection("projects")).rejects.toThrow("permission denied");
  await db.exec("reset role; set role anon"); await expect(collection("projects")).rejects.toThrow("permission denied");
  await db.exec("reset role; set role authenticated");
});
it("refuses a project count over the complete-read bound without changing the data", async () => {
  await db.query("insert into projects(user_id,name,slug) select $1,'Cap fixture '||n,'cap-fixture-'||n from generate_series(1,18800) n", [owner]);
  await expect(collection("projects")).rejects.toThrow("Collection exceeds the complete read bound");
  expect((await db.query<{ count: number }>("select count(*)::int as count from projects where user_id=$1", [owner])).rows[0].count).toBe(20001);
});
