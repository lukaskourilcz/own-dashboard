import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
import type { ProjectDetailsValues, ProjectDetailsReceipt } from "@/lib/project-details";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", organization = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", foreignOrganization = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const stamp = "2026-10-24T09:00:00Z";
const desired: ProjectDetailsValues = { name: "New project", slug: "new-project", repo_full_name: "owner/new", repo_id: 101, url: "https://example.com/", dev_url: "http://localhost:3000/", engagement: "client", organization_id: null };
let db: PGlite;
const save = async (values: unknown = desired, expected: string | null = stamp, target: string | null = id) => (await db.query<{ result: ProjectDetailsReceipt }>("select save_project_details($1,$2,$3) as result", [target, expected, JSON.stringify(values)])).rows[0].result;
const read = async () => (await db.query<{ row: Record<string, unknown> }>("select to_jsonb(p) as row from projects p where id=$1", [id])).rows[0].row;
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: "2026-10-24T14:00:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]); }, 120000);
beforeEach(async () => {
  await db.exec("reset role; drop trigger if exists audit_details_trigger on projects; drop policy if exists audit_details_suppression on projects; delete from projects; delete from organizations");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.query("insert into organizations(id,user_id,name) values($1,$2,'Owned organization'),($3,$4,'Foreign organization')", [organization, owner, foreignOrganization, other]);
  await db.query("insert into projects(id,user_id,name,slug,notes,updated_at,repo_id,repo_full_name,previous_repo_full_names,previous_slugs,sort_order,is_active) values($1,$2,'Original project','original','Private notes',$3,101,'owner/current',array['owner/earlier'],array['earlier-slug'],7,false),($4,$5,'Foreign','foreign','Foreign notes',$3,999,'owner/foreign','{}','{}',0,true)", [id, owner, stamp, foreign, other]);
  await db.exec("set role authenticated");
});
afterAll(async () => db?.close());
it("retains URL/repository history and every unrequested field with a note-free receipt", async () => {
  const before = await read(), result = await save(), after = await read();
  expect(result).toMatchObject({ kind: "saved", id, user_id: owner, values: desired, previous_slugs: ["earlier-slug", "original"], previous_repo_full_names: ["owner/earlier", "owner/current"] });
  expect(Date.parse(result.updated_at)).toBeGreaterThan(Date.parse(result.source_updated_at)); expect(after).toMatchObject(desired);
  const metadata = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => ![...Object.keys(desired), "previous_slugs", "previous_repo_full_names", "updated_at"].includes(key)));
  expect(metadata(after)).toEqual(metadata(before)); expect(JSON.stringify(result)).not.toMatch(/Private notes|notes|sort_order|is_active/); expect(JSON.stringify(result).length).toBeLessThan(1000);
});
it("makes identical stale retries a no-op without duplicating old handles", async () => {
  const first = await save(), before = await read(), again = await save();
  expect(again.kind).toBe("saved"); expect(again.updated_at).toBe(first.updated_at); expect(again.source_updated_at).toBe(again.updated_at); expect(await read()).toEqual(before);
});
it("preserves a linked parent, registry binding and financial context", async () => {
  const parent = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await db.query("insert into projects(id,user_id,name,slug) values($1,$2,'Parent','parent')", [parent, owner]);
  await db.query("update projects set parent_id=$2,portfolio_key='fixture-venture',summary='Owned context',status='on_hold',revenue=1234.56,revenue_currency='EUR',color='blue' where id=$1", [id, parent]);
  const before = await read(); await save(); const after = await read();
  for (const field of ["parent_id", "portfolio_key", "summary", "status", "revenue", "revenue_currency", "color", "is_active", "sort_order", "notes", "created_at"]) expect(after[field]).toEqual(before[field]);
});
it("returns a narrow conflict after a concurrent note change without replacing metadata or notes", async () => {
  await db.query("update projects set notes='Updated privately',updated_at='2026-10-24T09:00:00.000001Z' where id=$1", [id]);
  const before = await read(), result = await save(); expect(result.kind).toBe("conflict");
  expect(Object.keys(result).sort()).toEqual(["id", "kind", "source_updated_at", "updated_at", "user_id"]); expect(await read()).toEqual(before);
});
it("clears old repository aliases on a different id, an explicit unlink or an unverified name change", async () => {
  await save({ ...desired, repo_id: 202 }); expect((await read()).previous_repo_full_names).toEqual([]);
  const source = await read(); await save({ ...desired, repo_id: null, repo_full_name: null }, source.updated_at as string); expect((await read()).repo_full_name).toBeNull(); expect((await read()).previous_repo_full_names).toEqual([]);
  await db.query("update projects set repo_id=null,repo_full_name='owner/current',previous_repo_full_names=array['owner/earlier'] where id=$1", [id]);
  await save({ ...desired, repo_id: null }, (await read()).updated_at as string); expect((await read()).previous_repo_full_names).toEqual([]);
});
it("retains history for a case-only rename and for a legacy name acquiring its verified id", async () => {
  await save({ ...desired, repo_full_name: "Owner/Current" }); expect((await read()).previous_repo_full_names).toEqual(["owner/earlier"]);
  await db.query("update projects set repo_id=null where id=$1", [id]);
  await save({ ...desired, repo_full_name: "Owner/Current" }, (await read()).updated_at as string); expect((await read()).previous_repo_full_names).toEqual(["owner/earlier"]);
});
it("does not duplicate a previously captured alias when reverting a name or slug", async () => {
  await db.query("update projects set previous_slugs=array['original'],previous_repo_full_names=array['OWNER/CURRENT'] where id=$1", [id]);
  const result = await save(); expect(result).toMatchObject({ previous_slugs: ["original"], previous_repo_full_names: ["OWNER/CURRENT"] });
});
it("checks related organization ownership before changing the project", async () => {
  const before = await read();
  for (const target of [foreignOrganization, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]) await expect(save({ ...desired, organization_id: target })).rejects.toThrow("Organization unavailable");
  expect(await read()).toEqual(before); await save({ ...desired, organization_id: organization }); expect((await read()).organization_id).toBe(organization);
});
it("isolates foreign/missing rows and rolls back a conflicting current slug", async () => {
  await expect(save(desired, stamp, foreign)).rejects.toThrow("Project not found");
  await expect(save(desired, stamp, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).rejects.toThrow("Project not found");
  await db.query("insert into projects(user_id,name,slug) values($1,'Existing','new-project')", [owner]);
  const before = await read(); await expect(save()).rejects.toThrow(/unique|duplicate/i); expect(await read()).toEqual(before);
});
it("rejects missing, overbroad, mistyped and unsafe values before writing", async () => {
  const before = await read(), missing = Object.fromEntries(Object.entries(desired).filter(([key]) => key !== "name"));
  for (const values of [null, [], missing, { ...desired, notes: "Replace" }, { ...desired, name: " " }, { ...desired, name: "x".repeat(201) }, { ...desired, slug: "Bad/Slug" },
    { ...desired, repo_full_name: "owner/repo/other" }, { ...desired, repo_id: -1 }, { ...desired, repo_id: 1.5 }, { ...desired, repo_id: 9007199254740992 }, { ...desired, repo_id: 1, repo_full_name: null },
    { ...desired, engagement: "other" }, { ...desired, organization_id: "invalid" }, { ...desired, url: "javascript:alert(1)" }, { ...desired, url: "https://user:pass@example.com/" },
    { ...desired, url: "https://example.com/" + "x".repeat(2000) }, { ...desired, dev_url: "https://example.com/\npath" }, { ...desired, url: "http://" }, { ...desired, url: "https://example.com\\path" }]) await expect(save(values)).rejects.toThrow();
  for (const expected of [null, "infinity", "-infinity"]) await expect(save(desired, expected)).rejects.toThrow("Invalid project details");
  await expect(save(desired, stamp, null)).rejects.toThrow("Invalid project details"); expect(await read()).toEqual(before);
});
it("bounds source/retained history and can edit a project with a large private note without returning it", async () => {
  const large = "x".repeat(2097152); await db.query("update projects set notes=$2 where id=$1", [id, large]);
  const result = await save(); expect(JSON.stringify(result).length).toBeLessThan(1000); expect((await read()).notes).toBe(large);
  await db.query("update projects set previous_slugs=array(select 'old-'||s from generate_series(1,501) s) where id=$1", [id]);
  const before = await read(); await expect(save(desired, before.updated_at as string)).rejects.toThrow("Project history too large"); expect(await read()).toEqual(before);
});
it("rolls back suppressed, altered or partial updates instead of acknowledging success", async () => {
  const before = await read();
  await db.exec("reset role; create policy audit_details_suppression on projects as restrictive for update to authenticated using(false); set role authenticated");
  await expect(save()).rejects.toThrow(); expect(await read()).toEqual(before);
  await db.exec("reset role; drop policy audit_details_suppression on projects; create or replace function pg_temp.audit_details_trigger() returns trigger language plpgsql as $$ begin new.notes:='Altered'; return new; end $$; create trigger audit_details_trigger before update on projects for each row execute function pg_temp.audit_details_trigger(); set role authenticated");
  await expect(save()).rejects.toThrow("Project details save not confirmed"); expect(await read()).toEqual(before);
  await db.exec("reset role; create or replace function pg_temp.audit_details_trigger() returns trigger language plpgsql as $$ begin new.is_active:=true; return new; end $$; set role authenticated");
  await expect(save()).rejects.toThrow("Project details save not confirmed"); expect(await read()).toEqual(before);
  await db.exec("reset role; create or replace function pg_temp.audit_details_trigger() returns trigger language plpgsql as $$ begin new.slug:='unexpected'; return new; end $$; set role authenticated");
  await expect(save()).rejects.toThrow("Project details save not confirmed"); expect(await read()).toEqual(before);
  await db.exec("reset role; create or replace function pg_temp.audit_details_trigger() returns trigger language plpgsql as $$ begin return null; end $$; set role authenticated");
  await expect(save()).rejects.toThrow("Project details save not confirmed"); expect(await read()).toEqual(before);
});
it("advances a future source version and retains invoker RLS, bounded locks and narrow execution grants", async () => {
  const future = "2026-10-25T00:00:00Z"; await db.query("update projects set updated_at=$2 where id=$1", [id, future]);
  expect(Date.parse((await save(desired, future)).updated_at)).toBe(Date.parse(future) + 1);
  expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='save_project_details(uuid,timestamptz,jsonb)'::regprocedure")).rows[0])
    .toEqual({ prosecdef: false, proconfig: ['search_path=""', 'lock_timeout=5s'], anon: false, service: false, authenticated: true });
  await db.query("select set_config('request.jwt.claim.sub','',false)"); await expect(save()).rejects.toThrow("Authentication required");
  for (const role of ["anon", "service_role"]) { await db.exec(`reset role; set role ${role}`); await expect(save()).rejects.toThrow("permission denied"); }
});
