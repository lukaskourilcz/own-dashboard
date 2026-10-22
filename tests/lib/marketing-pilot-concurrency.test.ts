import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Explicit opt-in targets a disposable NETWORKLESS LOCAL container; no cloud endpoints or keys.
const container = process.env.MARKETING_PILOT_TEST_POSTGRES_CONTAINER;
const run = promisify(execFile);
const databaseName = `marketing_pilot_test_${randomUUID().replaceAll("-", "")}`;
const owner = "11111111-1111-4111-8111-111111111111";
let created = false;
function query(sql: string, database = databaseName) {
  return run("docker", ["exec", container!, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], { maxBuffer: 2 * 1024 * 1024 });
}
describe.skipIf(!container)("LOCAL PostgreSQL independent-session pilot contention (opt-in)", () => {
  beforeAll(async () => {
    const mode = await run("docker", ["inspect", "--format", "{{.HostConfig.NetworkMode}}", container!]);
    if (mode.stdout.trim() !== "none") throw new Error("pilot-proof-requires-disposable-networkless-container");
    await query(`create database ${databaseName}`, "postgres"); created = true;
    // Only the explicitly isolated test instance and its disposable database are changed.
    await query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
      end $$;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.projects(id uuid primary key,user_id uuid not null); create table public.ai_links(id uuid primary key,user_id uuid not null);
      insert into auth.users values('${owner}');`);
    for (const filename of ["20261013193104_marketing_control_surface.sql", "20261013193105_marketing_durable_jobs.sql", "20261013193108_marketing_staging_pilot_guard.sql"])
      await query(readFileSync(`supabase/migrations/${filename}`, "utf8"));
  }, 30000);
  afterAll(async () => { if (created) await query(`drop database ${databaseName} with (force)`, "postgres"); });
  it("serializes four overlapping queue transactions into three permanent reservations and permits only one claim", async () => {
    const now = Date.now();
    const pilot = JSON.stringify({ ownerId: owner, startsAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString() });
    const keys = Array.from({ length: 4 }, () => randomUUID());
    const results = await Promise.allSettled(keys.map((key) => query(`begin;
      select marketing_enqueue_job('${owner}','${key}','${"a".repeat(64)}','{"schemaVersion":"marketing-job/1"}','${pilot}');
      select pg_sleep(0.15); commit;`)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.stderr).toContain("pilot budget exhausted");
    expect((await query(`select count(*)||':'||sum(reserved_usd) from marketing_private.generation_pilot_reservations where user_id='${owner}'`)).stdout.trim()).toBe("3:0.75");
    expect((await query(`select count(*) from marketing_jobs where user_id='${owner}'`)).stdout.trim()).toBe("3");
    const job = (await query(`select id from marketing_jobs where user_id='${owner}' limit 1`)).stdout.trim();
    const claims = await Promise.all([randomUUID(), randomUUID()].map((fence) => query(`begin;
      select marketing_claim_job('${owner}','${job}','${fence}','${pilot}') is not null;
      select pg_sleep(0.15); commit;`)));
    expect(claims.map(({ stdout }) => stdout.split("\n").includes("t")).filter(Boolean)).toHaveLength(1);
    expect((await query(`select count(*)||':'||sum(reserved_usd) from marketing_private.generation_pilot_reservations where user_id='${owner}'`)).stdout.trim()).toBe("3:0.75");
  }, 30000);
});
