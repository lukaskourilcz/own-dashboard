import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { marketingPilotConfiguration } from "@/lib/marketing/pilot";

vi.mock("server-only", () => ({}));
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const now = new Date();
const pilot = { ownerId: owner, startsAt: new Date(now.getTime() - 60000).toISOString(), expiresAt: new Date(now.getTime() + 47 * 3600000).toISOString() };
// The tuple is read only on Vercel Preview (#113).
const env = { VERCEL_ENV: "preview", MARKETING_PILOT_OWNER_ID: owner, MARKETING_PILOT_STARTS_AT: pilot.startsAt, MARKETING_PILOT_EXPIRES_AT: pilot.expiresAt };
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.projects(id uuid primary key,user_id uuid not null); create table public.ai_links(id uuid primary key,user_id uuid not null);`);
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  for (const name of ["20261013193104_marketing_control_surface.sql", "20261013193105_marketing_durable_jobs.sql", "20261013193108_marketing_staging_pilot_guard.sql"])
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
async function enqueue(who: string, tuple: unknown = undefined, key: string = randomUUID()) {
  const args = [who, key, "a".repeat(64), JSON.stringify({ schemaVersion: "marketing-job/1" })];
  const result = tuple === undefined
    ? await db.query<{ value: { jobId: string; duplicate: boolean } }>("select marketing_enqueue_job($1,$2,$3,$4) as value", args)
    : await db.query<{ value: { jobId: string; duplicate: boolean } }>("select marketing_enqueue_job($1,$2,$3,$4,$5) as value", [...args, JSON.stringify(tuple)]);
  return result.rows[0].value;
}
describe("fixed pilot configuration", () => {
  it("leaves absent pilot configuration unchanged and accepts the exact active owner tuple", () => {
    expect(marketingPilotConfiguration(owner, {}, now)).toBeNull();
    expect(marketingPilotConfiguration(owner, env, now)).toEqual(pilot);
  });
  it("rejects partial, empty, malformed, foreign, future, expired and over-48-hour tuples", () => {
    const tuples = [
      { VERCEL_ENV: "preview", MARKETING_PILOT_OWNER_ID: owner }, { ...env, MARKETING_PILOT_EXPIRES_AT: "" },
      { ...env, MARKETING_PILOT_STARTS_AT: "yesterday" }, { ...env, MARKETING_PILOT_OWNER_ID: other },
      { ...env, MARKETING_PILOT_STARTS_AT: new Date(now.getTime() + 1000).toISOString() },
      { ...env, MARKETING_PILOT_EXPIRES_AT: now.toISOString() },
      { ...env, MARKETING_PILOT_EXPIRES_AT: new Date(Date.parse(pilot.startsAt) + 48 * 3600000 + 1).toISOString() },
    ];
    for (const values of tuples) expect(() => marketingPilotConfiguration(owner, values, now)).toThrow(/pilot-/);
    // Outside Preview the retired tuple, valid or not, is ignored and grants no pilot.
    for (const VERCEL_ENV of ["production", "development", undefined])
      for (const values of [env, ...tuples]) expect(marketingPilotConfiguration(owner, { ...values, VERCEL_ENV }, now)).toBeNull();
  });
});
describe("actual local Postgres pilot procedures; no provider calls", () => {
  let first: string;
  it("reserves exactly three queued requests and rolls back the fourth admission atomically", async () => {
    // Concurrent client promises use actual SQL transactions in PGlite's single-session engine.
    const keys = Array.from({ length: 4 }, () => randomUUID());
    const results = await Promise.allSettled(keys.map((key) => enqueue(owner, pilot, key)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    first = (results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{ jobId: string }>).value.jobId;
    const { rows } = await db.query<{ jobs: number; dollars: string }>("select count(*)::int jobs,sum(reserved_usd)::text dollars from marketing_private.generation_pilot_reservations where user_id=$1", [owner]);
    expect(rows[0]).toEqual({ jobs: 3, dollars: "0.75" });
    expect((await db.query("select id from marketing_jobs where user_id=$1", [owner])).rows).toHaveLength(3);
  });
  it("does not reserve twice for an idempotent retry, even at the exhausted cap", async () => {
    const { rows } = await db.query<{ idempotency_key: string }>("select idempotency_key from marketing_jobs where id=$1", [first]);
    expect(await enqueue(owner, pilot, rows[0].idempotency_key)).toEqual(expect.objectContaining({ jobId: first, duplicate: true }));
    expect((await db.query("select job_id from marketing_private.generation_pilot_reservations")).rows).toHaveLength(3);
  });
  it("requires the same owner window after env removal and refuses deadline/config reset", async () => {
    await expect(enqueue(owner)).rejects.toThrow("pilot configuration required");
    await expect(enqueue(owner, { ...pilot, expiresAt: new Date(Date.parse(pilot.expiresAt) + 1000).toISOString() })).rejects.toThrow("pilot configuration changed");
    await expect(enqueue(other, pilot)).rejects.toThrow("pilot configuration invalid");
    await expect(db.query("select marketing_claim_job($1,$2,$3)", [owner, first, randomUUID()])).rejects.toThrow("pilot configuration required");
  });
  it("checks every paid attempt against the exact active job fence, and retains failed/ambiguous reservations", async () => {
    const fence = randomUUID();
    await db.query("select marketing_claim_job($1,$2,$3,$4)", [owner, first, fence, JSON.stringify(pilot)]);
    expect((await db.query<{ value: boolean }>("select marketing_check_pilot_attempt($1,$2,$3,$4) value", [owner, first, fence, JSON.stringify(pilot)])).rows[0].value).toBe(true);
    await expect(db.query("select marketing_check_pilot_attempt($1,$2,$3,$4)", [owner, first, randomUUID(), JSON.stringify(pilot)])).rejects.toThrow("pilot fence lost");
    await db.query("select marketing_finish_job($1,$2,$3,null,'provider-failed')", [owner, first, fence]);
    await expect(db.query("select marketing_check_pilot_attempt($1,$2,$3,$4)", [owner, first, fence, JSON.stringify(pilot)])).rejects.toThrow("pilot fence lost");
    await expect(enqueue(owner, pilot)).rejects.toThrow("pilot budget exhausted");
    // Deletion of operational history cannot refund the independent ledger.
    await db.query("delete from marketing_jobs where id=$1", [first]);
    await expect(enqueue(owner, pilot)).rejects.toThrow("pilot budget exhausted");
  });
  it("keeps normal owners unchanged, refuses reserving old jobs retroactively, and checks real expiry", async () => {
    const normal = await enqueue(other);
    await expect(db.query("select marketing_claim_job($1,$2,$3,$4)", [other, normal.jobId, randomUUID(), JSON.stringify({ ...pilot, ownerId: other })])).rejects.toThrow("pilot reservation required");
    expect((await db.query<{ value: unknown }>("select marketing_claim_job($1,$2,$3) value", [other, normal.jobId, randomUUID()])).rows[0].value).toBeTruthy();
    const expired = { ...pilot, ownerId: other, startsAt: new Date(Date.now() - 2000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() };
    await expect(enqueue(other, expired)).rejects.toThrow("pilot outside window");
    await expect(enqueue(other, { ...expired, expiresAt: new Date(Date.now() + 49 * 3600000).toISOString() })).rejects.toThrow("pilot configuration invalid");
    expect((await db.query("select * from marketing_private.generation_pilots where user_id=$1", [other])).rows).toHaveLength(0);
  });
  it("protects ledger/config from browser access and service-role rewrites; private helpers are not public RPCs", async () => {
    const { rows } = await db.query<{ readable: boolean; writable: boolean; insertable: boolean; executable: boolean }>(`select
      has_table_privilege('authenticated','marketing_private.generation_pilot_reservations','select') readable,
      has_table_privilege('service_role','marketing_private.generation_pilot_reservations','delete') writable,
      has_table_privilege('service_role','marketing_private.generation_pilot_reservations','insert') insertable,
      has_function_privilege('authenticated','marketing_enqueue_job(uuid,uuid,text,jsonb,jsonb)','execute') executable`);
    expect(rows[0]).toEqual({ readable: false, writable: false, insertable: true, executable: false });
    expect((await db.query<{ value: string | null }>("select to_regprocedure('public.marketing_enqueue_job(uuid,uuid,text,jsonb)') value")).rows[0].value).toBeNull();
    await db.exec("set role service_role");
    try {
      expect(await enqueue(other)).toEqual(expect.objectContaining({ duplicate: false }));
      await expect(db.query("update marketing_private.generation_pilots set expires_at=expires_at+interval '1 minute' where user_id=$1", [owner])).rejects.toThrow("permission denied");
      await expect(db.query("delete from marketing_private.generation_pilot_reservations where user_id=$1", [owner])).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
  });
});
