import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createMigratedDatabase, setDatabaseTime } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
const note = async (body = "Original fixture") => (await db.query<{ row: Record<string, unknown> }>("insert into repo_notes(user_id,repo_id,repo_full_name,body) values($1,'123','owner/fixture',$2) returning to_jsonb(repo_notes) as row", [owner, body])).rows[0].row;
const read = async (id: unknown) => (await db.query<{ row: Record<string, unknown> }>("select to_jsonb(n) as row from repo_notes n where id=$1", [id])).rows[0]?.row;
const consume = async (entity: string, rows: unknown[]) => (await db.query<{ receipt: { deleted_ids: string[]; retained_ids: string[] } }>("select consume_repository_records($1,$2::jsonb) as receipt", [entity, JSON.stringify(rows)])).rows[0].receipt;
const save = async (expected: Record<string, unknown>, body: string) => (await db.query<{ row: Record<string, unknown> }>("select save_repository_note($1,$2::jsonb,$3) as row", [expected.id, JSON.stringify(expected), body])).rows[0].row;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-24T04:00:00Z" });
  await db.query("insert into auth.users(id) values($1)", [other]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("set role authenticated");
}, 120000);
afterAll(async () => db?.close());
it("keeps changed and newly added notes when clearing a captured publication", async () => {
  const unchanged = await note(), changed = await note(), added = await note();
  await db.query("update repo_notes set body='Edited during publication' where id=$1", [changed.id]);
  const receipt = await consume("repo_notes", [unchanged, changed]);
  expect(receipt).toEqual({ deleted_ids: [unchanged.id], retained_ids: [changed.id] });
  expect(await read(added.id)).toBeDefined(); expect((await read(changed.id))?.body).toBe("Edited during publication");
});
it("keeps reopened tasks and removes only unchanged finished GitHub tasks", async () => {
  const rows = (await db.query<{ row: Record<string, unknown> }>("insert into todos(user_id,title,done,source,repo_id) values($1,'Fixture one',true,'github','123'),($1,'Fixture two',true,'github','123'),($1,'Fixture manual',true,null,null) returning to_jsonb(todos) as row", [owner])).rows.map(row => row.row);
  await db.query("update todos set done=false where id=$1", [rows[1].id]);
  const receipt = await consume("todos", rows); expect(receipt.deleted_ids).toEqual([rows[0].id]); expect(new Set(receipt.retained_ids)).toEqual(new Set([rows[1].id, rows[2].id]));
});
it("confirms versioned note writes and identical retries but refuses stale changes", async () => {
  const original = await note(); await setDatabaseTime(db, "2026-10-24T04:01:00Z");
  const saved = await save(original, "Confirmed text"); expect(saved.body).toBe("Confirmed text"); expect(saved.updated_at).not.toBe(original.updated_at);
  expect(await save(original, "Confirmed text")).toEqual(saved);
  await expect(save(original, "Stale text")).rejects.toThrow("Repository note changed"); expect(await read(original.id)).toEqual(saved);
});
it("refuses foreign or malformed requests without deleting any source", async () => {
  const original = await note();
  await expect(consume("repo_notes", [original, original])).rejects.toThrow("Duplicate repository source");
  await expect(consume("repo_notes", [{ ...original, user_id: other }])).rejects.toThrow("Invalid repository source");
  await expect(consume("repo_links", [original])).rejects.toThrow("Unsupported repository collection");
  await expect(consume("repo_notes", Array.from({ length: 251 }, () => original))).rejects.toThrow("Invalid repository batch");
  await expect(save(original, "x".repeat(262145))).rejects.toThrow("Invalid repository note");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]); await expect(save(original, "Foreign")).rejects.toThrow("Invalid repository source");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); expect(await read(original.id)).toEqual(original);
});
it("rolls back the whole batch when a trigger suppresses a deletion or alters a saved body", async () => {
  const first = await note(), suppressed = await note("Suppress fixture"), altered = await note("Alter fixture");
  await db.exec(`reset role; create function test_repository_suppression() returns trigger language plpgsql as $$ begin
    if tg_op='DELETE' then if old.body='Suppress fixture' then return null; end if; return old; end if;
    if new.body='Alter fixture write' then new.body='Altered'; end if; return new; end $$;
    create trigger test_repository_suppression before delete or update on repo_notes for each row execute function test_repository_suppression(); set role authenticated;`);
  await expect(consume("repo_notes", [first, suppressed])).rejects.toThrow("Repository removal not confirmed"); expect(await read(first.id)).toEqual(first);
  await expect(save(altered, "Alter fixture write")).rejects.toThrow("Repository note save not confirmed"); expect(await read(altered.id)).toEqual(altered);
});
it("reads complete owner collections beyond the REST row cap", async () => {
  await db.query("insert into repo_notes(user_id,repo_id,repo_full_name,body) select $1,'123','owner/fixture','Bulk fixture' from generate_series(1,1201)", [owner]);
  const records = (await db.query<{ rows: { user_id: string }[] }>("select read_owned_collection('repo_notes') as rows")).rows[0].rows;
  expect(records.length).toBeGreaterThan(1201); expect(records.every(row => row.user_id === owner)).toBe(true);
  for (const entity of ["todos", "repo_links"]) expect((await db.query<{ rows: unknown[] }>("select read_owned_collection($1) as rows", [entity])).rows[0].rows).toBeInstanceOf(Array);
});
it("retains invoker rights, empty search paths and authenticated-only execution", async () => {
  const functions = (await db.query<{ proname: string; prosecdef: boolean; proconfig: string[]; anon: boolean; service: boolean }>("select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname in ('save_repository_note','consume_repository_records') order by proname")).rows;
  expect(functions).toHaveLength(2);
  for (const fn of functions) { expect(fn.prosecdef).toBe(false); expect(fn.anon).toBe(false); expect(fn.service).toBe(false); expect(fn.proconfig).toEqual(['search_path=""']); }
});
