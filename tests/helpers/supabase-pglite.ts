import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * A fresh OwnDashboard database on an isolated WASM Postgres, built the way docs/migration-guide.md builds a new
 * installation: the frozen baseline `supabase/schema.sql`, the one owner in auth.users, then every file of
 * `supabase/migrations` in filename order, unchanged.
 *
 * Supabase provides some schemas and services that PGlite cannot load. The stand-ins below keep the call
 * signatures the migrations use and nothing more:
 * - roles anon, authenticated and service_role (bypassrls), and auth.uid()/auth.jwt()/auth.role() read from
 *   `request.jwt.claim.*` exactly as Supabase defines them;
 * - storage.buckets/storage.objects with storage.foldername(); objects carry their bytes for the storage emulator;
 * - pgcrypto in `extensions`, Vault (`vault.secrets` + `vault.decrypted_secrets`), pg_net's `net.http_post`
 *   (recorded, never sent) and pg_cron's `cron.schedule`/`cron.unschedule` (recorded, never run).
 *
 * The database clock is the test's: clock_timestamp() and now() read `marketing.test_time`, which the caller
 * sets (`setDatabaseTime`) before every statement it wants to run "at" a JavaScript instant.
 */
export const SUPABASE_STANDINS = `
-- Match Supabase/PostgREST UTC serialization regardless of the host process time zone.
set timezone = 'UTC';
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create schema extensions; create schema vault; create schema net; create schema cron;
create extension pgcrypto with schema extensions;
grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
grant execute on function auth.uid(),auth.role(),auth.jwt() to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[],created_at timestamptz default now(),updated_at timestamptz default now());
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner uuid,
  metadata jsonb default '{}',user_metadata jsonb default '{}',bytes bytea,created_at timestamptz default now(),updated_at timestamptz default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant execute on function storage.foldername(text) to anon,authenticated,service_role;
grant all on storage.objects,storage.buckets to service_role; grant select on storage.objects,storage.buckets to authenticated;
create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text not null,created_at timestamptz default now());
create view vault.decrypted_secrets as select id,name,secret as decrypted_secret,created_at from vault.secrets;
create table net.captured(id bigserial primary key,url text,body text,headers jsonb,timeout_milliseconds integer);
create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{"Content-Type": "application/json"}'::jsonb,timeout_milliseconds integer default 5000)
  returns bigint language sql as $$ insert into net.captured(url,body,headers,timeout_milliseconds) values(url,body::text,headers,timeout_milliseconds) returning id $$;
create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text);
create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $$
  insert into cron.job(jobname,schedule,command) values(job_name,schedule,command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ with removed as (delete from cron.job where jobname=job_name returning 1) select exists(select 1 from removed) $$;
create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$ select current_setting('marketing.test_time')::timestamptz $$;
create or replace function pg_catalog.now() returns timestamptz language sql stable as $$ select current_setting('marketing.test_time')::timestamptz $$;
`;

export const setDatabaseTime = (db: PGlite, instant: Date | string) =>
  db.query("select set_config('marketing.test_time',$1,false)", [typeof instant === 'string' ? instant : instant.toISOString()]);

export const MIGRATION_FILES = readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort();

/** Baseline, the single owner, then every migration in filename order. Returns the open database. */
export async function createMigratedDatabase(options: { owner: string; email?: string; instant: Date | string; /** Exclusive boundary for testing a real migration upgrade. */ beforeMigration?: string }): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STANDINS);
  await setDatabaseTime(db, options.instant);
  await db.query('insert into auth.users(id,email) values($1,$2)', [options.owner, options.email ?? 'owner@example.test']);
  await db.exec(readFileSync('supabase/schema.sql', 'utf8'));
  for (const file of MIGRATION_FILES) {
    if (options.beforeMigration && file >= options.beforeMigration) break;
    try { await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8')); }
    catch (error) { throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return db;
}
