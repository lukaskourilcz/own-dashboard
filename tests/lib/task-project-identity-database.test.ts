import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const renamed = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actual = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", legacy = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", inactive = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const migration = "20261024113157_daily_focus_repository_identity.sql";
type Item = { todo_id: string; title_snapshot: string; project_name_snapshot: string | null; importance_snapshot: number; position: number; completed_at: string | null };
let db: PGlite, oldSet: string, newSet: string, oldRows: Item[], sourceBindings: { id: string; project_id: string | null }[];
const create = async (regenerate = true) => (await db.query<{ id: string }>("select create_daily_focus_set($1) as id", [regenerate])).rows[0].id;
const items = async (set: string) => (await db.query<Item>("select todo_id,title_snapshot,project_name_snapshot,importance_snapshot,position,completed_at from daily_focus_items where set_id=$1 order by position", [set])).rows;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-24T10:00:00Z", beforeMigration: migration });
  await db.query("insert into auth.users(id) values($1)", [other]);
  await db.query("insert into projects(id,user_id,name,slug,repo_id,repo_full_name,previous_repo_full_names,sort_order,is_active) values($1,$5,'Renamed','renamed',101,'owner/new',array['owner/reused','owner/old'],0,true),($2,$5,'Actual','actual',999,'owner/reused','{}',2,true),($3,$5,'Legacy','legacy',null,'owner/reused','{}',-1,true),($4,$5,'Inactive actual','inactive',888,'owner/inactive','{}',5,false)", [renamed, actual, legacy, inactive, owner]);
  await db.query("insert into projects(user_id,name,slug,repo_id,repo_full_name) values($1,'Foreign','foreign',999,'owner/reused'),($2,'Blank','blank',null,'   ')", [other, owner]);
  const add = async (title: string, options: { project?: string; repo?: string; name?: string; global?: boolean } = {}) => db.query("insert into todos(user_id,title,source,project_id,repo_id,repo_full_name,importance,is_global) values($1,$2,'github',$3,$4,$5,3,$6)", [owner, title, options.project ?? null, options.repo ?? null, options.name ?? null, options.global ?? false]);
  await add("Known identity", { repo: "999", name: "owner/reused" });
  await add("Legacy tie", { name: " OWNER/REUSED " });
  await add("Explicit project", { project: renamed, repo: "999", name: "owner/reused" });
  await add("Inactive known identity", { repo: "888", name: "owner/reused" });
  await add("Inactive explicit project", { project: inactive, repo: "999", name: "owner/reused" });
  await add("Conflicting known id", { repo: "777", name: "owner/new" });
  await add("Unknown name", { name: "owner/missing" });
  await add("Blank legacy name", { name: "   " });
  await add("Historical whitespace", { name: " OWNER/OLD " });
  await add("Global inactive", { global: true, repo: "888", name: "owner/reused" });
  await add("Global unassigned", { global: true });
  await db.query("insert into todos(user_id,title,source,repo_id,repo_full_name,importance) values($1,'Foreign task','github','999','owner/reused',3)", [other]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("set role authenticated");
  sourceBindings = (await db.query<{ id: string; project_id: string | null }>("select id,project_id from todos order by id")).rows;
  oldSet = await create(); oldRows = await items(oldSet);
  await db.exec("reset role"); await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8")); await db.exec("set role authenticated");
}, 120000);
afterAll(async () => db?.close());
it("upgrades the real previous function without rewriting existing generations or source bindings", async () => {
  expect(await items(oldSet)).toEqual(oldRows); expect(await create(false)).toBe(oldSet);
  expect((await db.query("select id,project_id from todos order by id")).rows).toEqual(sourceBindings);
});
it("prefers a known id globally over earlier aliases and name-only projects in a new generation", async () => {
  newSet = await create(); expect(newSet).not.toBe(oldSet);
  const rows = await items(newSet), names = Object.fromEntries(rows.map(row => [row.title_snapshot, row.project_name_snapshot]));
  expect(names).toEqual({ "Known identity": "Actual", "Legacy tie": "Legacy", "Explicit project": "Renamed", "Historical whitespace": "Renamed", "Global inactive": "Inactive actual", "Global unassigned": null });
  expect(rows).toHaveLength(6); expect(rows.map(row => row.position)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(rows.filter(row => row.title_snapshot.startsWith("Global")).map(row => row.position).sort()).toEqual([1, 2]);
  expect(rows.filter(row => row.title_snapshot.startsWith("Global")).every(row => row.importance_snapshot === 6)).toBe(true);
});
it("does not reclassify inactive, mismatched, missing or blank identities through a reused name", async () => {
  const titles = (await items(newSet)).map(row => row.title_snapshot);
  for (const title of ["Inactive known identity", "Inactive explicit project", "Conflicting known id", "Unknown name", "Blank legacy name", "Foreign task"]) expect(titles).not.toContain(title);
  expect(await create(false)).toBe(newSet); expect(await items(oldSet)).toEqual(oldRows);
});
it("keeps inferred project assignments out of stored tasks", async () => {
  expect((await db.query("select id,project_id from todos order by id")).rows).toEqual(sourceBindings);
});
it("isolates another owner even when numeric and named repository identities coincide", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  const rows = await items(await create()); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ title_snapshot: "Foreign task", project_name_snapshot: "Foreign" });
  expect(await items(newSet)).toEqual([]); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
});
it("retains invoker RLS and the empty search path with authenticated-only execution", async () => {
  const row = (await db.query<{ prosecdef: boolean; proconfig: string[]; anon: boolean; service: boolean; authenticated: boolean }>("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='create_daily_focus_set(boolean)'::regprocedure")).rows[0];
  expect(row).toEqual({ prosecdef: false, proconfig: ['search_path=""'], anon: false, service: false, authenticated: true });
  await db.exec("reset role; set role anon"); await expect(create()).rejects.toThrow("permission denied"); await db.exec("reset role; set role service_role"); await expect(create()).rejects.toThrow("permission denied"); await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub','',false)"); await expect(create()).rejects.toThrow("authentication required");
});
