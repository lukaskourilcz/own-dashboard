import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
import { buildNeededRows } from "@/lib/needed-sync";
import type { GithubRepo } from "@/lib/github";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const repo = { id: 123, owner: "owner", name: "fixture", full_name: "owner/fixture", html_url: "https://github.com/owner/fixture" } as GithubRepo;
const fresh = (text: string) => buildNeededRows(owner, repo, `- [ ] ${text}`, repo.html_url, "2026-10-24T04:30:00Z");
type Row = Record<string, unknown>;
let db: PGlite;
const sync = async (rows: object[], remove: Row[] = [], scanned = ["123"]) => (await db.query<{ result: { inserted: Row[]; deleted_ids: string[]; retained_ids: string[] } }>("select sync_repository_tasks($1::jsonb,$2::jsonb,$3::text[]) as result", [JSON.stringify(rows), JSON.stringify(remove), scanned])).rows[0].result;
const read = async (id: unknown) => (await db.query<{ row: Row }>("select to_jsonb(t) as row from todos t where id=$1", [id])).rows[0]?.row;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-24T04:30:00Z" });
  await db.query("insert into auth.users(id) values($1)", [other]); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("set role authenticated");
}, 120000);
afterAll(async () => db?.close());
it("deduplicates both repeated inputs and retried imports without replacing owner edits", async () => {
  const rows = [...fresh("First fixture"), ...fresh("Second fixture")];
  const first = await sync([...rows, rows[0]]); expect(first.inserted).toHaveLength(2);
  await db.query("update todos set title='Customized owner title' where id=$1", [first.inserted[0].id]);
  expect((await sync(rows)).inserted).toEqual([]); expect((await read(first.inserted[0].id))?.title).toBe("Customized owner title");
});
it("removes only captured unchanged open tasks while retaining edited or newly completed tasks", async () => {
  const original = (await sync([...fresh("Stale unchanged"), ...fresh("Stale edited"), ...fresh("Stale completed")])).inserted;
  const unchanged = original.find(row => row.title === "Stale unchanged")!, edited = original.find(row => row.title === "Stale edited")!, completed = original.find(row => row.title === "Stale completed")!;
  await db.query("update todos set title='Edited while loading' where id=$1", [edited.id]); await db.query("update todos set done=true where id=$1", [completed.id]);
  const result = await sync(fresh("Fresh replacement"), original);
  expect(result.deleted_ids).toEqual([unchanged.id]); expect(new Set(result.retained_ids)).toEqual(new Set([edited.id, completed.id])); expect(result.inserted).toHaveLength(1);
});
it("does not remove a captured line still present in the same synchronization", async () => {
  const rows = fresh("Still in source"), original = (await sync(rows)).inserted;
  const result = await sync(rows, original); expect(result.inserted).toEqual([]); expect(result.deleted_ids).toEqual([]); expect(result.retained_ids).toEqual([original[0].id]);
});
it("rolls back removals and earlier inserts when any inserted row fails", async () => {
  const original = (await sync(fresh("Rollback source"))).inserted;
  await db.exec(`reset role; create function test_repository_task_failure() returns trigger language plpgsql as $$ begin
    if new.title='Synthetic reject' then raise exception 'Synthetic insertion failure'; end if; return new; end $$;
    create trigger test_repository_task_failure before insert on todos for each row execute function test_repository_task_failure(); set role authenticated;`);
  await expect(sync([...fresh("Rollback new row"), ...fresh("Synthetic reject")], original)).rejects.toThrow("Synthetic insertion failure");
  expect(await read(original[0].id)).toEqual(original[0]); expect((await db.query("select id from todos where title='Rollback new row'")).rows).toEqual([]);
});
it("refuses foreign sources, unknown fields, unscanned removals and invalid dates before changes", async () => {
  const original = (await sync(fresh("Validation source"))).inserted;
  for (const rows of [[{ ...fresh("Foreign")[0], user_id: other }], [{ ...fresh("Extra field")[0], project_id: other }], [{ ...fresh("Invalid date")[0], due_date: "2026-02-30" }], [{ ...fresh("Invalid time")[0], estimated_minutes: 100001 }]]) await expect(sync(rows, original)).rejects.toThrow();
  await expect(sync([], original, [])).rejects.toThrow("Invalid stale task source"); expect(await read(original[0].id)).toEqual(original[0]);
});
it("preserves and recognizes legacy imports with no raw source line", async () => {
  const legacy = (await db.query<{ row: Row }>("insert into todos(user_id,title,source,repo_id) values($1,'Legacy task','github','123') returning to_jsonb(todos) as row", [owner])).rows[0].row;
  expect((await sync(fresh("Legacy task"), [legacy])).inserted).toEqual([]); expect(await read(legacy.id)).toEqual(legacy);
});
it("retains continuation-line assignees and complete matching beyond 1000 existing rows", async () => {
  await db.query("insert into todos(user_id,title,source,repo_id,needed_raw) select $1,'Bulk '||n,'github','123','- [ ] Bulk '||n from generate_series(1,1201) n", [owner]);
  expect((await sync(fresh("Bulk 1201"))).inserted).toEqual([]);
  const rows = buildNeededRows(owner, repo, "- [ ] Continuation owner\n  [owner:ai]", repo.html_url, "2026-10-24T04:30:00Z");
  expect((await sync(rows)).inserted[0].needed_assignee).toBe("ai");
});
it("rolls back suppressed deletion and altered insertion receipts", async () => {
  const original = (await sync(fresh("Suppressed task"))).inserted;
  await db.exec(`reset role; create function test_repository_task_receipt() returns trigger language plpgsql as $$ begin
    if tg_op='DELETE' then if old.title='Suppressed task' then return null; end if; return old; end if;
    if new.title='Altered fixture' then new.title='Unexpected title'; end if; return new; end $$;
    create trigger test_repository_task_receipt before insert or delete on todos for each row execute function test_repository_task_receipt(); set role authenticated;`);
  await expect(sync(fresh("Must roll back"), original)).rejects.toThrow("Task removal not confirmed"); expect(await read(original[0].id)).toEqual(original[0]);
  await expect(sync(fresh("Altered fixture"))).rejects.toThrow("Task insertion not confirmed"); expect((await db.query("select id from todos where title='Unexpected title'")).rows).toEqual([]);
});
it("retains invoker ownership and authenticated-only grants", async () => {
  const result = (await db.query<{ prosecdef: boolean; anon: boolean; service: boolean; proconfig: string[] }>("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname='sync_repository_tasks'")).rows[0];
  expect(result).toEqual({ prosecdef: false, proconfig: ['search_path=""'], anon: false, service: false });
});
