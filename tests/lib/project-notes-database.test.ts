import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", hash = (text: string) => createHash("sha256").update(text).digest("hex");
const original = "Příliš žluťoučký 🦊\r\nOriginal notes", stamp = "2026-10-24T09:00:00Z";
type Receipt = { kind: "saved" | "conflict"; id: string; user_id: string; notes_hash: string; source_notes_hash: string; source_updated_at: string; updated_at: string };
let db: PGlite;
const save = async (notes: string | null = "Saved", expected: string | null = hash(original), target: string | null = id) => (await db.query<{ result: Receipt }>("select save_project_notes($1,$2,$3) as result", [target, expected, notes])).rows[0].result;
const read = async () => (await db.query<{ row: Record<string, unknown> }>("select to_jsonb(p) as row from projects p where id=$1", [id])).rows[0].row;
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: "2026-10-24T12:00:00Z" }); await db.query("insert into auth.users(id) values($1)", [other]); }, 120000);
beforeEach(async () => {
  await db.exec("reset role; drop trigger if exists audit_note_trigger on projects; drop policy if exists audit_note_suppression on projects; delete from projects");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.query("insert into projects(id,user_id,name,slug,notes,updated_at,repo_id,repo_full_name,previous_repo_full_names,previous_slugs) values($1,$2,'Original name','notes-fixture',$3,$4,101,'owner/current',array['owner/old'],array['old-slug']),($5,$6,'Foreign','foreign','Foreign notes',$4,999,'owner/foreign','{}','{}')", [id, owner, original, stamp, foreign, other]);
  await db.exec("set role authenticated");
});
afterAll(async () => db?.close());
it("saves exact Unicode text with a compact owner/hash/version receipt and retains unrelated fields", async () => {
  const before = await read(), body = "Žluťoučký 🦊\n\nExact trailing spaces  ", result = await save(body), after = await read();
  expect(result).toMatchObject({ kind: "saved", id, user_id: owner, notes_hash: hash(body), source_notes_hash: hash(original) });
  expect(Object.keys(result).sort()).toEqual(["id", "kind", "notes_hash", "source_notes_hash", "source_updated_at", "updated_at", "user_id"]);
  expect(Date.parse(result.updated_at)).toBeGreaterThan(Date.parse(result.source_updated_at)); expect(after.notes).toBe(body);
  const metadata = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !["notes", "updated_at"].includes(key)));
  expect(metadata(after)).toEqual(metadata(before)); expect(JSON.stringify(result).length).toBeLessThan(500);
  for (const privateText of [original, body, "Original name", "owner/current"]) expect(JSON.stringify(result)).not.toContain(privateText);
});
it("preserves concurrent metadata and advances even a source version ahead of the database clock", async () => {
  await db.query("update projects set name='Edited elsewhere',is_active=false,updated_at='2026-10-25T00:00:00Z' where id=$1", [id]);
  const result = await save(), row = await read(); expect(row.name).toBe("Edited elsewhere"); expect(row.is_active).toBe(false); expect(row.notes).toBe("Saved");
  expect(Date.parse(result.updated_at)).toBe(Date.parse("2026-10-25T00:00:00Z") + 1);
});
it("returns conflicts without writing or revealing the changed text", async () => {
  await db.query("update projects set notes='Changed privately',updated_at='2026-10-24T11:00:00Z' where id=$1", [id]);
  const before = await read(), result = await save(); expect(result).toMatchObject({ kind: "conflict", notes_hash: hash("Changed privately"), source_notes_hash: hash("Changed privately") });
  expect(result.updated_at).toBe(result.source_updated_at); expect(await read()).toEqual(before); expect(JSON.stringify(result)).not.toContain("Changed privately");
});
it("makes identical retries and no-op edits repeatable without a new version, including empty notes", async () => {
  const first = await save("Saved"), before = await read(), repeated = await save("Saved"); expect(repeated.updated_at).toBe(first.updated_at); expect(await read()).toEqual(before);
  const cleared = await save("", hash("Saved")); expect((await read()).notes).toBe("");
  expect((await save("", "f".repeat(64))).updated_at).toBe(cleared.updated_at);
});
it("can shorten a legacy large note without resending its previous text", async () => {
  const large = "x".repeat(2097152); await db.query("update projects set notes=$2 where id=$1", [id, large]);
  expect((await save("Shortened", hash(large))).kind).toBe("saved"); expect((await read()).notes).toBe("Shortened");
});
it("accepts the exact UTF-8 boundary while keeping the acknowledgement small", async () => {
  const body = "é".repeat(524288), result = await save(body);
  expect(result.notes_hash).toBe(hash(body)); expect(JSON.stringify(result).length).toBeLessThan(500); expect((await read()).notes).toBe(body);
});
it("rejects invalid hashes, nulls and overbound UTF-8 notes before any write", async () => {
  const before = await read();
  for (const [notes, expected, target] of [[null, hash(original), id], ["x", null, id], ["x", "A".repeat(64), id], ["x", "a".repeat(63), id], ["x", hash(original), null], ["x".repeat(1048577), hash(original), id], ["🚀".repeat(262145), hash(original), id]] as const) await expect(save(notes, expected, target)).rejects.toThrow("Invalid project notes");
  expect(await read()).toEqual(before);
});
it("isolates foreign and missing project identities without exposing their notes", async () => {
  await expect(save("Replace", hash("Foreign notes"), foreign)).rejects.toThrow("Project not found");
  await expect(save("Replace", hash(original), "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).rejects.toThrow("Project not found");
  expect((await read()).notes).toBe(original);
});
it("rolls back suppressed or altered writes, including changes to unrelated metadata", async () => {
  const before = await read();
  await db.exec("reset role; create policy audit_note_suppression on projects as restrictive for update to authenticated using (false); set role authenticated");
  await expect(save()).rejects.toThrow(); expect(await read()).toEqual(before);
  await db.exec("reset role; drop policy audit_note_suppression on projects; create or replace function pg_temp.audit_note_trigger() returns trigger language plpgsql as $$ begin new.name:='Altered metadata'; return new; end $$; create trigger audit_note_trigger before update on projects for each row execute function pg_temp.audit_note_trigger(); set role authenticated");
  await expect(save()).rejects.toThrow("Project notes save not confirmed"); expect(await read()).toEqual(before);
  await db.exec("reset role; create or replace function pg_temp.audit_note_trigger() returns trigger language plpgsql as $$ begin return null; end $$; set role authenticated");
  await expect(save()).rejects.toThrow("Project notes save not confirmed"); expect(await read()).toEqual(before);
});
it("keeps invoker RLS, an empty search path, bounded locks and authenticated-only execution", async () => {
  const row = (await db.query<{ prosecdef: boolean; proconfig: string[]; anon: boolean; service: boolean; authenticated: boolean }>("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='save_project_notes(uuid,text,text)'::regprocedure")).rows[0];
  expect(row).toEqual({ prosecdef: false, proconfig: ['search_path=""', 'lock_timeout=5s'], anon: false, service: false, authenticated: true });
  await db.query("select set_config('request.jwt.claim.sub','',false)"); await expect(save()).rejects.toThrow("Authentication required");
  await db.exec("reset role; set role anon"); await expect(save()).rejects.toThrow("permission denied"); await db.exec("reset role; set role service_role"); await expect(save()).rejects.toThrow("permission denied");
});
