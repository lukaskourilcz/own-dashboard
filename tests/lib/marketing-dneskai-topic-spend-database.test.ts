import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/** The prepared topic spend ledger (#152) over the generation budget, in isolated PGlite; every value is synthetic. */
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const migrations = ["20261013193104_marketing_control_surface", "20261013193105_marketing_durable_jobs", "20261013193108_marketing_staging_pilot_guard",
  "20261021124651_dneskai_daily_generation_budget", "20261023100100_dneskai_topic_spend"];
type Decision = { admitted: boolean; id?: string; spentUsd: number };
const reserve = async (kind: string, reservation: number, ceiling: number, user = owner) =>
  (await db.query<{ r: Decision }>("select marketing_reserve_dneskai_topic_spend($1,$2,$3,$4,$5) r", [user, kind, `ref:${randomUUID()}`, reservation, ceiling])).rows[0]!.r;
const settle = async (id: string, cost: number, user = owner) => (await db.query<{ r: boolean }>("select marketing_settle_dneskai_topic_spend($1,$2,$3) r", [user, id, cost])).rows[0]!.r;
const generationSpent = async (user = owner) => Number((await db.query<{ v: string }>("select marketing_dneskai_generation_spent($1) v", [user])).rows[0]!.v);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table public.projects(id uuid primary key,user_id uuid not null); create table public.ai_links(id uuid primary key,user_id uuid not null);
  insert into auth.users values('${owner}'),('${other}');`);
  for (const migration of migrations) await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
}, 60000);
beforeEach(async () => { await db.exec("truncate marketing_private.dneskai_topic_spend; truncate marketing_jobs cascade"); });
afterAll(async () => { await db?.close(); });

describe("DNESKAi topic spend ledger (#152)", () => {
  it("is service-only", async () => {
    for (const fn of ["marketing_reserve_dneskai_topic_spend(uuid,text,text,numeric,numeric)", "marketing_settle_dneskai_topic_spend(uuid,uuid,numeric)", "marketing_dneskai_topic_spent(uuid,text[])"]) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", [fn]);
      expect(rows[0], fn).toEqual({ anon: false, authenticated: false, service: true });
    }
  });

  it("caps transcripts at their own ceiling: ten $0.05 reels fit in $0.50, the eleventh is refused and reserves nothing", async () => {
    for (let n = 0; n < 10; n++) expect((await reserve("transcript", 0.05, 0.5)).admitted).toBe(true);
    expect(await reserve("transcript", 0.05, 0.5)).toMatchObject({ admitted: false, spentUsd: 0.5 });
    expect(Number((await db.query<{ n: string }>("select count(*) n from marketing_private.dneskai_topic_spend")).rows[0]!.n)).toBe(10);
    // Transcripts never count against the $1 generation ceiling.
    expect(await generationSpent()).toBe(0);
  });

  it("counts a settled call at its cost, settles once, and keeps owners apart", async () => {
    const first = await reserve("transcript", 0.05, 0.5);
    expect(await settle(first.id!, 0.012)).toBe(true);
    expect(await settle(first.id!, 0.04)).toBe(false);
    expect(await settle(first.id!, 0.01, other)).toBe(false);
    expect((await reserve("transcript", 0.05, 0.5)).spentUsd).toBeCloseTo(0.012);
    expect((await reserve("transcript", 0.05, 0.5, other)).spentUsd).toBe(0);
  });

  it("shares the generation ceiling: topic model calls raise generation spend and a full day refuses them", async () => {
    const call = await reserve("classify", 0.01, 1);
    expect(call.admitted).toBe(true);
    expect(await generationSpent()).toBeCloseTo(0.01);
    await settle(call.id!, 0.002);
    expect(await generationSpent()).toBeCloseTo(0.002);
    const id = randomUUID(), fence = randomUUID();
    await db.query("insert into marketing_jobs(id,user_id,idempotency_key,request_hash,request,status,fence,lease_until) values($1,$2,$3,$4,$5,'running',$6,now()+interval '2 minutes')",
      [id, owner, randomUUID(), "a".repeat(64), JSON.stringify({ schemaVersion: "marketing-job/1", generation: { source: { brand: "dneskai" } } }), fence]);
    const job = (await db.query<{ r: Decision }>("select marketing_reserve_dneskai_generation($1,$2,$3,0.99,1) r", [owner, id, fence])).rows[0]!.r;
    expect(job).toMatchObject({ admitted: true });
    expect(await reserve("title", 0.02, 1)).toMatchObject({ admitted: false });
  });

  it("refuses malformed input", async () => {
    await expect(reserve("render", 0.05, 0.5)).rejects.toThrow(/topic reservation invalid/);
    await expect(reserve("transcript", 0, 0.5)).rejects.toThrow(/topic reservation invalid/);
    await expect(settle(randomUUID(), -1)).rejects.toThrow(/topic settlement invalid/);
  });
});
