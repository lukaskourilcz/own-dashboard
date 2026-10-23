import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase, setDatabaseTime } from "../helpers/supabase-pglite";

const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333", link = "44444444-4444-4444-8444-444444444444";
const foreignLink = "55555555-5555-4555-8555-555555555555", secondLink = "66666666-6666-4666-8666-666666666666";
const header = { name: "Synthetic prompt", description: "Synthetic description", body: "Review the supplied source", kind: "audit", project_id: null, is_public: false };
type Document = { prompt: { id: string; updated_at: string; name: string }; links: { id: string; ai_link_id: string; note: string }[] };
let db: PGlite, original: Document, foreignProject: string;
const save = async (creating: boolean, fields: object, links: object[], snapshot?: Document, promptId = id) =>
  (await db.query<{ document: Document }>("select save_prompt_document($1,$2,$3::jsonb,$4::jsonb,$5,$6::uuid[]) as document",
    [promptId, creating, JSON.stringify(fields), JSON.stringify(links), snapshot?.prompt.updated_at ?? null,
      snapshot?.links.map(row => row.id) ?? null])).rows[0].document;
const read = async (entity: string) => (await db.query<{ records: { id: string; user_id: string; occurred_on?: string }[] }>("select read_owned_collection($1) as records", [entity])).rows[0].records;
const current = async () => (await db.query<{ document: Document }>(`select jsonb_build_object('prompt',to_jsonb(p),'links',
  (select coalesce(jsonb_agg(to_jsonb(l) order by sort_order,created_at,id),'[]'::jsonb) from prompt_links l where l.prompt_id=p.id)) as document from prompts p where p.id=$1`, [id])).rows[0].document;

beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-23T12:00:00Z" });
  await db.query("insert into auth.users(id,email) values($1,'other@example.test')", [other]);
  await db.query("insert into ai_links(id,user_id,title,url) values($1,$2,'Synthetic resource','https://example.test/one'),($3,$4,'Foreign resource','https://example.test/foreign'),($5,$2,'Second resource','https://example.test/two')", [link, owner, foreignLink, other, secondLink]);
  foreignProject = (await db.query<{ id: string }>("insert into projects(user_id,name,slug) values($1,'Foreign prompt project','foreign-prompt-project') returning id", [other])).rows[0].id;
  await db.query("insert into transactions(user_id,kind,amount,currency,occurred_on) select $1,'expense',1.23,'CZK','2026-10-01'::date+(n%23) from generate_series(1,1201) n", [owner]);
  await db.query("insert into transactions(user_id,kind,amount) values($1,'expense',1)", [other]);
  await db.exec(`create function public.test_prompt_resource_failure() returns trigger language plpgsql as $$ begin
    if new.note='FAIL INSERT' then raise exception 'Synthetic resource storage failure'; end if; return new; end $$;
    create trigger test_prompt_resource_failure before insert or update on public.prompt_links for each row execute function public.test_prompt_resource_failure();`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("set role authenticated");
}, 120000);
afterAll(async () => { await db?.close(); });

it("reads 1201 complete, ordered financial records and only the owner's allowed collections", async () => {
  const records = await read("transactions"); expect(records).toHaveLength(1201);
  expect(records.every(row => row.user_id === owner)).toBe(true);
  expect(records.every((row, index) => index === 0 || row.occurred_on! <= records[index - 1].occurred_on!)).toBe(true);
  for (const entity of ["invoices", "invoice_items", "prompts", "prompt_links", "project_links", "ai_links", "ai_categories"]) {
    expect((await read(entity)).every(row => row.user_id === owner)).toBe(true);
  }
  expect((await read("ai_links")).some(row => row.id === foreignLink)).toBe(false);
  await expect(read("marketing_account_tokens")).rejects.toThrow("Unsupported collection");
  await expect(read("prompts; select 1")).rejects.toThrow("Unsupported collection");
});
it("creates one complete prompt and safely retries its identity", async () => {
  original = await save(true, header, [{ ai_link_id: link, note: "Read this source" }]);
  expect(original.prompt.id).toBe(id); expect(original.links[0].ai_link_id).toBe(link);
  expect(await save(true, header, [{ ai_link_id: link, note: "Read this source" }])).toEqual(original);
  await expect(save(true, { ...header, name: "Changed retry" }, [])).rejects.toThrow("Prompt changed");
  expect((await db.query<{ count: number }>("select count(*)::int as count from prompts where id=$1", [id])).rows[0].count).toBe(1);
});
it("rolls back header and link changes when resource persistence fails", async () => {
  await expect(save(false, { ...header, name: "Must roll back" }, [{ ai_link_id: secondLink, note: "FAIL INSERT" }], original)).rejects.toThrow("Synthetic resource storage failure");
  expect(await current()).toEqual(original);
  await expect(save(true, header, [{ ai_link_id: secondLink, note: "FAIL INSERT" }], undefined,
    "77777777-7777-4777-8777-777777777777")).rejects.toThrow("Synthetic resource storage failure");
  expect((await db.query<{ count: number }>("select count(*)::int as count from prompts where id=$1", ["77777777-7777-4777-8777-777777777777"])).rows[0].count).toBe(0);
});
it("rejects incomplete and stale sources, preserves existing link ids and retries an identical edit", async () => {
  await expect(save(false, { ...header, name: "Incomplete" }, [], { ...original, links: [] })).rejects.toThrow("Prompt changed");
  await setDatabaseTime(db, "2026-10-23T12:01:00Z");
  const links = [{ ai_link_id: link, note: "Updated instruction" }, { ai_link_id: secondLink, note: "Second instruction" }];
  const updated = await save(false, { ...header, name: "Confirmed update" }, links, original);
  expect(updated.links[0].id).toBe(original.links[0].id);
  expect(await save(false, { ...header, name: "Confirmed update" }, links, original)).toEqual(updated);
  await expect(save(false, { ...header, name: "Stale edit" }, [], original)).rejects.toThrow("Prompt changed");
  expect(await current()).toEqual(updated);
});
it("retains own-only related-resource and project policies, rejecting owner injection", async () => {
  const before = await current();
  await expect(save(false, header, [{ ai_link_id: foreignLink, note: "Foreign" }], before)).rejects.toThrow("row-level security");
  await expect(save(false, { ...header, project_id: foreignProject }, [], before)).rejects.toThrow("row-level security");
  await expect(save(false, { ...header, user_id: other }, [], before)).rejects.toThrow("Invalid prompt fields");
  await expect(save(false, header, [{ ai_link_id: link, note: "A" }, { ai_link_id: link, note: "B" }], before)).rejects.toThrow("Duplicate prompt resources");
  expect(await current()).toEqual(before);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  await expect(save(false, header, [], before)).rejects.toThrow("Prompt not found");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
});
it("keeps the read/write functions invoker-only and unavailable to anonymous or service callers", async () => {
  const rows = (await db.query("select proname,prosecdef as definer,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname in ('read_owned_collection','save_prompt_document','add_curated_prompts') order by proname")).rows;
  expect(rows).toEqual([
    { proname: "add_curated_prompts", definer: false, anon: false, service: false },
    { proname: "read_owned_collection", definer: false, anon: false, service: false },
    { proname: "save_prompt_document", definer: false, anon: false, service: false },
  ]);
});
it("imports curated names against the complete owner library, skipping repeats and preserving custom prompts", async () => {
  const templates = [{ name: "Confirmed update", description: "Do not replace", body: "Different body", kind: "design" },
    { name: "New curated prompt", description: "Curated", body: "Synthetic curated body", kind: "audit" },
    { name: " NEW CURATED PROMPT ", description: "Duplicate", body: "Duplicate body", kind: "audit" }];
  const insert = async () => (await db.query<{ records: { name: string; is_public: boolean }[] }>("select add_curated_prompts($1::jsonb) as records", [JSON.stringify(templates)])).rows[0].records;
  expect(await insert()).toEqual([expect.objectContaining({ name: "New curated prompt", is_public: true })]);
  expect(await insert()).toEqual([]);
  expect((await current()).prompt.name).toBe("Confirmed update");
});
it("rejects an oversized collection rather than truncating a financial report", async () => {
  await db.query("insert into transactions(user_id,kind,amount) select $1,'expense',1 from generate_series(1202,20001)", [owner]);
  await expect(read("transactions")).rejects.toThrow("Collection exceeds the complete read bound");
  expect((await db.query<{ count: number }>("select count(*)::int as count from transactions")).rows[0].count).toBe(20_001);
});
it("bounds encoded JSON bytes as well as row counts", async () => {
  await db.query("insert into prompts(user_id,name,body) select $1,'Synthetic large '||n,repeat('ž',30000) from generate_series(1,200) n", [owner]);
  await expect(read("prompts")).rejects.toThrow("Collection exceeds the complete read bound");
});
