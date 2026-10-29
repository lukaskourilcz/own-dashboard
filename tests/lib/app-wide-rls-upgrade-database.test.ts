import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";

const migration = "20261023164118_app_wide_rls_initplans.sql";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
type Policy = { tablename: string; policyname: string; roles: string[]; cmd: string; permissive: string; qual: string | null; with_check: string | null };
let before: Policy[], after: Policy[], beforePlan: unknown, afterPlan: unknown;
const policies = async () => (await db.query<Policy>("select tablename,policyname,roles,cmd,permissive,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname")).rows;
const normalize = (items: Policy[]) => items.map(policy => ({ ...policy,
  qual: policy.qual?.replace(/\( SELECT auth\.uid\(\) AS uid\)/g, "auth.uid()") ?? null,
  with_check: policy.with_check?.replace(/\( SELECT auth\.uid\(\) AS uid\)/g, "auth.uid()") ?? null,
}));
async function asOwner<T>(run: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("set role authenticated");
  try { return await run(); } finally { await db.exec("reset role"); }
}
const explain = () => asOwner(async () => (await db.query('explain (format json) select id from public.projects')).rows);
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-23T12:00:00Z", beforeMigration: migration });
  await db.query("insert into auth.users(id,email) values($1,'other@example.test')", [other]);
  await db.query("insert into public.projects(user_id,name,slug) values($1,'Owner','owned'),($2,'Foreign','foreign')", [owner, other]);
  before = await policies(); beforePlan = await explain();
  await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  after = await policies(); afterPlan = await explain();
  await db.exec(readFileSync("supabase/migrations/20261023170010_project_parent_rls_lookup.sql", "utf8"));
}, 120000);
afterAll(async () => { await db?.close(); });

describe("upgrade of existing ownership policies", () => {
  it("preserves every role, command, ownership and related-record predicate", () => {
    expect(after.length).toBe(before.length);
    expect(normalize(after)).toEqual(normalize(before));
    expect(after.filter((policy, i) => JSON.stringify(policy) !== JSON.stringify(before[i]))).toHaveLength(73);
  });
  it("turns repeated session evaluation into a statement init plan", () => {
    expect(JSON.stringify(beforePlan)).not.toContain('InitPlan');
    expect(JSON.stringify(afterPlan)).toContain('InitPlan');
    expect(after.some(policy => [policy.qual, policy.with_check].some(expression => expression && /(?<!SELECT )auth\.uid\(\)/.test(expression)))).toBe(false);
  });
  it("retains own-only reads and rejects foreign writes after the upgrade", async () => {
    await asOwner(async () => {
      expect((await db.query<{ slug: string }>("select slug from projects")).rows).toEqual([{ slug: "owned" }]);
      expect((await db.query("update projects set name='No' where slug='foreign' returning id")).rows).toEqual([]);
      expect((await db.query("delete from projects where slug='foreign' returning id")).rows).toEqual([]);
      await expect(db.query("insert into projects(user_id,name,slug) values($1,'No','foreign-write')", [other])).rejects.toThrow(/row-level security/);
      await expect(db.query("update projects set user_id=$1 where slug='owned'", [other])).rejects.toThrow(/row-level security/);
      expect((await db.query("insert into projects(user_id,name,slug) values($1,'Yes','new-owned') returning slug", [owner])).rows).toEqual([{ slug: "new-owned" }]);
    });
  });
  it("keeps foreign-related records unavailable and anonymous reads empty", async () => {
    const foreign = (await db.query<{ id: string }>("select id from projects where slug='foreign'")).rows[0]!.id;
    await asOwner(async () => {
      await expect(db.query("insert into notes(user_id,title,project_id) values($1,'No',$2)", [owner, foreign])).rejects.toThrow(/row-level security/);
    });
    await db.exec("select set_config('request.jwt.claim.sub','',false); set role anon");
    try { expect((await db.query("select id from projects")).rows).toEqual([]); } finally { await db.exec("reset role"); }
  });
  it("accepts an owned parent and rejects foreign or self parents without bypassing RLS", async () => {
    const rows = (await db.query<{ id: string; slug: string }>("select id,slug from projects")).rows;
    const own = rows.find(row => row.slug === "owned")!.id;
    const foreign = rows.find(row => row.slug === "foreign")!.id;
    await asOwner(async () => {
      expect((await db.query<{ own: boolean; foreign: boolean }>("select project_parent_is_owned($1) as own,project_parent_is_owned($2) as foreign", [own, foreign])).rows).toEqual([{ own: true, foreign: false }]);
      await expect(db.query("insert into projects(user_id,name,slug,parent_id) values($1,'No','foreign-parent',$2)", [owner, foreign])).rejects.toThrow(/row-level security/);
      expect((await db.query("insert into projects(user_id,name,slug,parent_id) values($1,'Child','owned-child',$2) returning slug", [owner, own])).rows).toEqual([{ slug: "owned-child" }]);
      await expect(db.query("update projects set parent_id=id where slug='owned'")).rejects.toThrow(/row-level security/);
    });
    const grants = await db.query<{ definer: boolean; config: string[]; anon: boolean; service: boolean }>("select prosecdef as definer,proconfig as config,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname='project_parent_is_owned'");
    expect(grants.rows).toEqual([{ definer: false, config: ['search_path=""'], anon: false, service: false }]);
  });
});
