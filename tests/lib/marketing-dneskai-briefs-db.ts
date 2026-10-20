import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { candidate } from '@/lib/marketing/dneskai-providers';
import type { DneskaiCandidate } from '@/lib/marketing/dneskai-contracts';
import { contentHash } from '@/lib/marketing/hashes';
import { dneskaiCheapIdentity } from '@/lib/marketing/dneskai-registry';

/**
 * An isolated WASM Postgres with the Supabase roles, a storage stand-in and every migration the DNESKAi
 * briefs (#115) build on, executed unchanged and in order. The clock is simulated through `marketing.test_time`.
 * Every value is synthetic.
 */
export const BRIEF_MIGRATIONS = ['20261012225640_marketing_control_surface.sql', '20261012232949_marketing_durable_jobs.sql', '20261013001528_marketing_private_assets.sql',
  '20261013092409_marketing_staging_pilot_guard.sql', '20261013165236_marketing_dneskai_collection.sql', '20261013181506_dneskai_collection_pilot.sql',
  '20261020100000_dneskai_collection_cursor_limits.sql', '20261020120000_scope_retired_pilot_ledgers.sql', '20261020130000_dneskai_source_media.sql',
  '20261020140000_marketing_revision_media_identity.sql', '20261020150000_dneskai_events_briefs.sql'];

export async function createBriefsDatabase(users: readonly string[], projects: ReadonlyArray<{ id: string; owner: string }>, instant: string) {
  const db = new PGlite();
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
    create table public.projects(id uuid primary key,user_id uuid,portfolio_key text,repo_full_name text,parent_id uuid,previous_repo_full_names text[] default '{}');
    create table public.user_preferences(hidden_project_tabs text[] default '{}');
    create table public.ai_links(id uuid primary key,user_id uuid not null);
    create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$ select current_setting('marketing.test_time')::timestamptz $$;`);
  await setBriefsTestTime(db, instant);
  for (const user of users) await db.query('insert into auth.users values($1)', [user]);
  for (const project of projects) await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst')", [project.id, project.owner]);
  for (const file of BRIEF_MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  return db;
}

export const setBriefsTestTime = (db: PGlite, instant: string) => db.query("select set_config('marketing.test_time',$1,false)", [instant]);

/** A synthetic research candidate with optional classification fields. */
export function syntheticCandidate(sourceId: string, externalId: string, title: string, patch: Partial<DneskaiCandidate> = {}, text = `${title}. Synthetic test-only excerpt.`, url = `https://example.test/${encodeURIComponent(externalId)}`, at = '2026-10-20T18:00:00Z'): DneskaiCandidate {
  return { ...candidate(sourceId, externalId, title, text, url, at, at), ...patch };
}

/** Inserts candidates as a finished classification left them (status from the candidate). */
export async function insertCandidates(db: PGlite, owner: string, project: string, runId: string, items: readonly DneskaiCandidate[]) {
  for (const item of items) {
    const identity = dneskaiCheapIdentity(item);
    await db.query('insert into marketing_dneskai_candidates(id,user_id,project_id,run_id,candidate,canonical_url_hash,normalized_text_hash,content_hash,status,target_date) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [item.id, owner, project, runId, JSON.stringify(item), contentHash(identity.canonicalUrl), contentHash(identity.normalizedText), item.contentHash, item.status, item.targetDate]);
  }
}

/** Runs `select public.name(arg => value, …)` as service_role, the slice of the Supabase client the briefs use for RPCs. */
export function briefsRpcClient(db: PGlite) {
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
