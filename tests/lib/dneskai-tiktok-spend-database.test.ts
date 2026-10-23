import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/** #167: the TikTok chart as a fourth kind in the topic spend ledger, in isolated PGlite; every value is synthetic. */
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111";
const migrations = ["20261013193104_marketing_control_surface", "20261013193105_marketing_durable_jobs", "20261013193108_marketing_staging_pilot_guard",
  "20261021124651_dneskai_daily_generation_budget", "20261023100100_dneskai_topic_spend", "20261023130300_dneskai_tiktok_spend"];
type Decision = { admitted: boolean; id?: string; spentUsd: number };
const reserve = async (kind: string, reservation: number, ceiling: number, ref = "tiktok:pending") =>
  (await db.query<{ r: Decision }>("select marketing_reserve_dneskai_topic_spend($1,$2,$3,$4,$5) r", [owner, kind, ref, reservation, ceiling])).rows[0]!.r;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table public.projects(id uuid primary key,user_id uuid not null); create table public.ai_links(id uuid primary key,user_id uuid not null);
  insert into auth.users values('${owner}');`);
  for (const migration of migrations) await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
}, 60000);
beforeEach(async () => { await db.exec("truncate marketing_private.dneskai_topic_spend"); });
afterAll(async () => { await db?.close(); });

describe("TikTok chart spend (20261023130300)", () => {
  it("caps the chart under its own ceiling, apart from transcripts and generation", async () => {
    expect((await reserve("tiktok", 0.1, 0.1)).admitted).toBe(true);
    expect(await reserve("tiktok", 0.1, 0.1)).toMatchObject({ admitted: false });
    expect((await reserve("transcript", 0.05, 0.5, "reel:x")).admitted).toBe(true);
    expect(Number((await db.query<{ v: string }>("select marketing_dneskai_generation_spent($1) v", [owner])).rows[0]!.v)).toBe(0);
  });
  it("binds the run ids once and lists the recent runs", async () => {
    const { id } = await reserve("tiktok", 0.1, 0.1);
    const bind = (ref: string) => db.query<{ r: boolean }>("select marketing_dneskai_tiktok_bind($1,$2,$3) r", [owner, id, ref]);
    expect((await bind("tiktok:run_1:dataset_1")).rows[0]!.r).toBe(true);
    expect((await bind("tiktok:run_2:dataset_2")).rows[0]!.r).toBe(false);
    await expect(bind("not-a-ref")).rejects.toThrow(/tiktok bind invalid/);
    const runs = await db.query<{ ref: string; settled: boolean }>("select ref,settled from marketing_dneskai_tiktok_runs($1)", [owner]);
    expect(runs.rows).toEqual([{ ref: "tiktok:run_1:dataset_1", settled: false }]);
  });
  it("is service-only", async () => {
    for (const fn of ["marketing_dneskai_tiktok_runs(uuid)", "marketing_dneskai_tiktok_bind(uuid,uuid,text)"]) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", [fn]);
      expect(rows[0], fn).toEqual({ anon: false, authenticated: false, service: true });
    }
  });
});
