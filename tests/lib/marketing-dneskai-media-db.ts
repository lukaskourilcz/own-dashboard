import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

/**
 * An isolated WASM Postgres with the Supabase roles, a storage schema stand-in and the migrations the
 * DNESKAi media tables depend on, executed unchanged. The clock is simulated through `marketing.test_time`.
 */
export const MEDIA_MIGRATIONS = ['20261012225640_marketing_control_surface.sql', '20261013001528_marketing_private_assets.sql', '20261013165236_marketing_dneskai_collection.sql', '20261020130000_dneskai_source_media.sql', '20261022020702_dneskai_richer_brief_evidence.sql'];

export async function createMediaDatabase(users: readonly string[], projects: ReadonlyArray<{ id: string; owner: string }>, instant: string) {
  const db = new PGlite();
  // Mirrors Supabase defaults: new tables and functions are granted to API roles unless revoked.
  await db.exec(`create schema auth; create schema storage; create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    grant usage on schema auth,storage,public to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb default '{}',unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant execute on function auth.uid(),storage.foldername(text) to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
    -- Deliberately broad pre-existing feature policy: the restrictive guards must still hold.
    create policy existing_feature_access on storage.objects for all to anon,authenticated using(true) with check(true);
    create table public.projects(id uuid primary key,user_id uuid,portfolio_key text,repo_full_name text,parent_id uuid,previous_repo_full_names text[] default '{}');
    create table public.user_preferences(hidden_project_tabs text[] default '{}');
    create table public.ai_links(id uuid primary key,user_id uuid not null);
    create schema marketing_private; create table marketing_private.generation_pilots(user_id uuid primary key,starts_at timestamptz,expires_at timestamptz);
    create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$ select current_setting('marketing.test_time')::timestamptz $$;`);
  await setTestTime(db, instant);
  for (const user of users) await db.query('insert into auth.users values($1)', [user]);
  for (const project of projects) await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst')", [project.id, project.owner]);
  for (const file of MEDIA_MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  return db;
}

export const setTestTime = (db: PGlite, instant: string) => db.query("select set_config('marketing.test_time',$1,false)", [instant]);

/**
 * The slice of a service-role Supabase client the media module uses, backed by the real functions:
 * `rpc(name, args)` runs `select public.name(arg => value, …)` as `service_role`, one call at a time.
 */
export function serviceRpcClient(db: PGlite) {
  let queue: Promise<unknown> = Promise.resolve();
  const calls: string[] = [];
  return {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push(name);
      const run = async () => {
        const keys = Object.keys(args);
        const values = keys.map((key) => { const value = args[key]; return value !== null && typeof value === 'object' ? JSON.stringify(value) : value; });
        await db.exec('set role service_role');
        try {
          const { rows } = await db.query<{ r: unknown }>(`select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(', ')}) as r`, values);
          return { data: rows[0]?.r ?? null, error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
        } finally { await db.exec('reset role'); }
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
