import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Real migration SQL in an isolated WASM database; every value is synthetic.
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const migrations = ["20261012225640_marketing_control_surface", "20261012232949_marketing_durable_jobs", "20261013092409_marketing_staging_pilot_guard",
  "20261020170000_dneskai_daily_generation_budget"];
type Decision = { admitted: boolean; spentUsd: number; reservationUsd: number; ceilingUsd: number };

async function job(input: { brand?: string; status?: string; result?: unknown; user?: string } = {}) {
  const id = randomUUID(); const fence = randomUUID();
  const request = { schemaVersion: "marketing-job/1", generation: { source: { brand: input.brand ?? "dneskai" } } };
  await db.query("insert into marketing_jobs(id,user_id,idempotency_key,request_hash,request,status,fence,lease_until,result) values($1,$2,$3,$4,$5,$6,$7,now()+interval '2 minutes',$8)",
    [id, input.user ?? owner, randomUUID(), "a".repeat(64), JSON.stringify(request), input.status ?? "running", fence, input.result === undefined ? null : JSON.stringify(input.result)]);
  return { id, fence };
}
const reserve = async (target: { id: string; fence: string }, reservation = 0.25, ceiling = 1, user = owner) =>
  (await db.query<{ r: Decision }>("select marketing_reserve_dneskai_generation($1,$2,$3,$4,$5) r", [user, target.id, target.fence, reservation, ceiling])).rows[0]!.r;
const finish = (target: { id: string }, status: string, result: unknown) =>
  db.query("update marketing_jobs set status=$2,result=$3,fence=null,lease_until=null where id=$1", [target.id, status, result === null ? null : JSON.stringify(result)]);
const spent = async (user = owner) => Number((await db.query<{ v: string }>("select marketing_dneskai_generation_spent($1) v", [user])).rows[0]!.v);
const ledger = async () => (await db.query<{ job_id: string; calls: number; reserved_usd: string }>("select job_id,calls,reserved_usd from marketing_private.dneskai_generation_spend order by first_reserved_at")).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
  create table public.projects(id uuid primary key,user_id uuid not null); create table public.ai_links(id uuid primary key,user_id uuid not null);
  insert into auth.users values('${owner}'),('${other}');`);
  for (const migration of migrations) await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
}, 60000);
beforeEach(async () => { await db.exec("truncate marketing_jobs cascade"); });
afterAll(async () => { await db?.close(); });

describe("DNESKAi daily generation ceiling in SQL (#116)", () => {
  it("is service-only: the ledger and both functions are closed to anon and authenticated", async () => {
    for (const signature of ["marketing_reserve_dneskai_generation(uuid,uuid,uuid,numeric,numeric)", "marketing_dneskai_generation_spent(uuid,uuid)"]) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", [signature]);
      expect(rows[0], signature).toEqual({ anon: false, authenticated: false, service: true });
    }
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean; rls: boolean }>(`select has_table_privilege('anon','marketing_private.dneskai_generation_spend','SELECT') anon,
      has_table_privilege('authenticated','marketing_private.dneskai_generation_spend','SELECT') authenticated, has_table_privilege('service_role','marketing_private.dneskai_generation_spend','INSERT') service,
      (select relrowsecurity from pg_class where oid='marketing_private.dneskai_generation_spend'::regclass) rls`);
    expect(rows[0]).toEqual({ anon: false, authenticated: false, service: true, rls: true });
  });

  it("counts in-flight jobs at their full reservation and refuses the call that would pass the ceiling", async () => {
    const jobs = await Promise.all([1, 2, 3, 4, 5].map(() => job()));
    expect(await reserve(jobs[0]!)).toEqual({ admitted: true, spentUsd: 0, reservationUsd: 0.25, ceilingUsd: 1 });
    expect((await reserve(jobs[1]!)).spentUsd).toBe(0.25);
    expect((await reserve(jobs[2]!)).spentUsd).toBe(0.5);
    // 0.75 + 0.25 is exactly the ceiling: admitted.
    expect(await reserve(jobs[3]!)).toEqual({ admitted: true, spentUsd: 0.75, reservationUsd: 0.25, ceilingUsd: 1 });
    expect(await reserve(jobs[4]!)).toEqual({ admitted: false, spentUsd: 1, reservationUsd: 0.25, ceilingUsd: 1 });
    // A refused call reserves nothing.
    expect((await ledger()).map((row) => row.job_id)).toEqual(jobs.slice(0, 4).map((entry) => entry.id));
  });

  it("uses recorded usage once a job finished, and the full reservation when the outcome is unknown", async () => {
    const reviewed = await job(); const failedKnown = await job(); const failedUnknown = await job(); const reconciling = await job();
    for (const entry of [reviewed, failedKnown, failedUnknown, reconciling]) await reserve(entry, 0.25, 50);
    await finish(reviewed, "review", { usage: { attempts: 1, inputTokens: 3000, outputTokens: 1500, estimatedCostUsd: 0.021 } });
    await finish(failedKnown, "failed", { schemaVersion: "marketing-job-failure/1", usage: { attempts: 2, inputTokens: 6000, outputTokens: 3000, estimatedCostUsd: 0.042 } });
    await finish(failedUnknown, "failed", null);
    await finish(reconciling, "reconciliation", { usage: { estimatedCostUsd: 0.01 } });
    // 0.021 + 0.042 + 0.25 (failed, no usage) + 0.25 (reconciliation is never settled by its own report).
    expect(await spent()).toBeCloseTo(0.563, 6);
    // A non-numeric or negative recorded cost cannot lower the reservation.
    await finish(reviewed, "review", { usage: { estimatedCostUsd: "0.001" } });
    await finish(failedKnown, "failed", { usage: { estimatedCostUsd: -1 } });
    expect(await spent()).toBeCloseTo(1, 6);
  });

  it("does not count a job against its own retry and records each paid call", async () => {
    const first = await job();
    await reserve(first);
    expect(await reserve(first)).toEqual({ admitted: true, spentUsd: 0, reservationUsd: 0.25, ceilingUsd: 1 });
    expect(await ledger()).toEqual([{ job_id: first.id, calls: 2, reserved_usd: "0.2500" }]);
  });

  it("forgets reservations older than 24 hours and other owners' spend", async () => {
    const old = await job(); const foreign = await job({ user: other });
    await reserve(old, 0.25, 50); await reserve(foreign, 0.25, 50, other);
    await db.query("update marketing_private.dneskai_generation_spend set last_reserved_at=clock_timestamp()-interval '25 hours' where job_id=$1", [old.id]);
    expect(await spent()).toBe(0);
    expect(await spent(other)).toBe(0.25);
  });

  it("refuses without a live fence, for another brand and with out-of-range figures", async () => {
    const live = await job();
    await expect(reserve({ id: live.id, fence: randomUUID() })).rejects.toThrow("job fence lost");
    await expect(reserve(live, 0.25, 1, other)).rejects.toThrow("job fence lost");
    const devshark = await job({ brand: "devshark" });
    await expect(reserve(devshark)).rejects.toThrow("dneskai generation job required");
    const queued = await job({ status: "queued" });
    await expect(reserve(queued)).rejects.toThrow("job fence lost");
    for (const [reservation, ceiling] of [[0, 1], [1.5, 2], [0.25, 0], [0.25, 51]]) await expect(reserve(live, reservation, ceiling)).rejects.toThrow("generation reservation invalid");
    expect(await ledger()).toEqual([]);
  });
});
