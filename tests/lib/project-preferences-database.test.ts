import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", stamp = "2026-10-24T09:00:00Z";
type Receipt = { kind: "saved" | "conflict"; id: string; user_id: string; values: Record<string, unknown>; previous_values: Record<string, unknown>; source_updated_at: string; updated_at: string };
let db: PGlite;
const save = async (patch: unknown = { is_active: false }, expected: string | null = stamp, target: string | null = id) => (await db.query<{ result: Receipt }>("select set_project_preferences($1,$2,$3) as result", [target, expected, JSON.stringify(patch)])).rows[0].result;
const read = async () => (await db.query<{ row: Record<string, unknown> }>("select to_jsonb(p) as row from projects p where id=$1", [id])).rows[0].row;
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: "2026-10-24T14:00:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]); }, 120000);
beforeEach(async () => {
  await db.exec("reset role; drop trigger if exists audit_pref_trigger on projects; drop policy if exists audit_pref_suppression on projects; delete from projects");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.query("insert into projects(id,user_id,name,slug,notes,updated_at,repo_id,repo_full_name,previous_repo_full_names,previous_slugs) values($1,$2,'Private project','pref-fixture','Private notes',$3,101,'owner/current',array['owner/old'],array['old-slug']),($4,$5,'Foreign','foreign','Foreign notes',$3,999,'owner/foreign','{}','{}')", [id, owner, stamp, foreign, other]);
  await db.exec("set role authenticated");
});
afterAll(async () => db?.close());
it("confirms both classification controls while retaining every unrelated field and a small receipt", async () => {
  const before = await read(), patch = { is_active: false, engagement: "client" }, result = await save(patch), after = await read();
  expect(result).toMatchObject({ kind: "saved", id, user_id: owner, values: patch, previous_values: { is_active: true, engagement: "own" } });
  expect(Date.parse(result.updated_at)).toBeGreaterThan(Date.parse(result.source_updated_at));
  const rest = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !["is_active", "engagement", "updated_at"].includes(key)));
  expect(rest(after)).toEqual(rest(before)); expect(after).toMatchObject(patch); expect(JSON.stringify(result).length).toBeLessThan(500);
  expect(JSON.stringify(result)).not.toMatch(/Private|owner\//);
});
it("keeps the unrequested classification unchanged and makes an identical stale retry a no-op", async () => {
  const first = await save({ engagement: "client" }), before = await read(), retry = await save({ engagement: "client" });
  expect(retry.updated_at).toBe(first.updated_at); expect(retry.source_updated_at).toBe(retry.updated_at); expect(retry.previous_values).toEqual({ engagement: "client" });
  expect(await read()).toEqual(before); expect(before.is_active).toBe(true);
});
it("rejects a stale edit after a note change without replacing either field", async () => {
  await db.query("update projects set notes='Changed elsewhere',updated_at='2026-10-24T10:00:00Z' where id=$1", [id]);
  const before = await read(), result = await save(); expect(result.kind).toBe("conflict"); expect(result.values).toEqual({ is_active: true });
  expect(result.updated_at).toBe(result.source_updated_at); expect(await read()).toEqual(before);
});
it("advances a source version ahead of the database clock", async () => {
  const future = "2026-10-25T00:00:00Z"; await db.query("update projects set updated_at=$2 where id=$1", [id, future]);
  expect(Date.parse((await save({ is_active: false }, future)).updated_at)).toBe(Date.parse(future) + 1);
});
it("rejects empty, unknown, wrongly typed or overbound payloads without writing", async () => {
  const before = await read();
  for (const patch of [null, [], true, {}, { notes: "Replace" }, { user_id: other }, { is_active: "false" }, { is_active: null }, { engagement: null }, { engagement: false }, { engagement: "Client" }, { is_active: false, notes: "Replace" }, { engagement: "x".repeat(129) }]) await expect(save(patch)).rejects.toThrow("Invalid project preferences");
  for (const [expected, target] of [[null, id], ["infinity", id], ["-infinity", id], [stamp, null]] as const) await expect(save({ is_active: false }, expected, target)).rejects.toThrow("Invalid project preferences");
  expect(await read()).toEqual(before);
});
it("isolates foreign and missing projects under the calling owner's RLS", async () => {
  await expect(save({ is_active: false }, stamp, foreign)).rejects.toThrow("Project not found");
  await expect(save({ is_active: false }, stamp, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).rejects.toThrow("Project not found");
  expect((await read()).is_active).toBe(true);
});
it("rolls back suppressed or altered acknowledgements, including the other classification and notes", async () => {
  const before = await read();
  await db.exec("reset role; create policy audit_pref_suppression on projects as restrictive for update to authenticated using(false); set role authenticated");
  await expect(save()).rejects.toThrow(); expect(await read()).toEqual(before);
  await db.exec("reset role; drop policy audit_pref_suppression on projects; create or replace function pg_temp.audit_pref_trigger() returns trigger language plpgsql as $$ begin new.engagement:='client'; return new; end $$; create trigger audit_pref_trigger before update on projects for each row execute function pg_temp.audit_pref_trigger(); set role authenticated");
  await expect(save()).rejects.toThrow("Project preferences save not confirmed"); expect(await read()).toEqual(before);
  await db.exec("reset role; create or replace function pg_temp.audit_pref_trigger() returns trigger language plpgsql as $$ begin new.notes:='Altered'; return new; end $$; set role authenticated");
  await expect(save()).rejects.toThrow("Project preferences save not confirmed"); expect(await read()).toEqual(before);
  await db.exec("reset role; create or replace function pg_temp.audit_pref_trigger() returns trigger language plpgsql as $$ begin return null; end $$; set role authenticated");
  await expect(save()).rejects.toThrow("Project preferences save not confirmed"); expect(await read()).toEqual(before);
});
it("keeps invoker RLS, bounded locks, an empty path and authenticated-only execution", async () => {
  expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='set_project_preferences(uuid,timestamptz,jsonb)'::regprocedure")).rows[0])
    .toEqual({ prosecdef: false, proconfig: ['search_path=""', 'lock_timeout=5s'], anon: false, service: false, authenticated: true });
  await db.query("select set_config('request.jwt.claim.sub','',false)"); await expect(save()).rejects.toThrow("Authentication required");
  for (const role of ["anon", "service_role"]) { await db.exec(`reset role; set role ${role}`); await expect(save()).rejects.toThrow("permission denied"); }
});
