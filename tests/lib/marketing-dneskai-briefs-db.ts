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
  '20261020140000_marketing_revision_media_identity.sql', '20261020150000_dneskai_events_briefs.sql', '20261022020702_dneskai_richer_brief_evidence.sql', '20261022020759_dneskai_brief_v2_compatibility.sql', '20261022021835_dneskai_release_lapsed_reports.sql'];

export async function createBriefsDatabase(users: readonly string[], projects: ReadonlyArray<{ id: string; owner: string }>, instant: string) {
  const db = new PGlite();
  await db.exec(`set timezone = 'UTC';
    create schema auth; create schema storage; create role anon; create role authenticated; create role service_role bypassrls;
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

/**
 * A minimal PostgREST stand-in over PGlite for plain-column reads: `from(table).select(columns)` with eq, neq, in,
 * gte, gt, lte, lt, not(…,'is',null), order, limit, maybeSingle and single. Rows come back through to_jsonb, so
 * dates and timestamps have the JSON shapes Supabase returns. Embedded relations are not supported.
 */
export function pgliteRestClient(db: PGlite) {
  const rpc = briefsRpcClient(db);
  const from = (table: string) => {
    let columns = '*'; const where: string[] = []; const values: unknown[] = []; const orders: string[] = []; let limit: number | null = null; let single: 'maybe' | 'one' | null = null;
    const add = (sql: (index: number) => string, value: unknown) => { values.push(value); where.push(sql(values.length)); return builder; };
    const run = async () => {
      const sql = `select to_jsonb(x) as row from (select ${columns} from public.${table}${where.length ? ` where ${where.join(' and ')}` : ''}${orders.length ? ` order by ${orders.join(',')}` : ''}${limit !== null ? ` limit ${limit}` : ''}) x`;
      try {
        const rows = (await db.query<{ row: Record<string, unknown> }>(sql, values)).rows.map((row) => row.row);
        if (single === 'one' && rows.length !== 1) return { data: null, error: { message: 'not exactly one row' } };
        return { data: single ? rows[0] ?? null : rows, error: null };
      } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
    };
    const builder = {
      select(value: string) { if (/[()!]/.test(value)) throw new Error(`embedded select unsupported: ${value}`); columns = value; return builder; },
      eq: (column: string, value: unknown) => add((index) => `${column}=$${index}`, value),
      neq: (column: string, value: unknown) => add((index) => `${column}<>$${index}`, value),
      in: (column: string, value: unknown[]) => add((index) => `${column}::text=any($${index}::text[])`, value.map(String)),
      gte: (column: string, value: unknown) => add((index) => `${column}>=$${index}`, value),
      gt: (column: string, value: unknown) => add((index) => `${column}>$${index}`, value),
      lte: (column: string, value: unknown) => add((index) => `${column}<=$${index}`, value),
      lt: (column: string, value: unknown) => add((index) => `${column}<$${index}`, value),
      not(column: string, operator: string, value: unknown) { if (operator !== 'is' || value !== null) throw new Error('unsupported not'); where.push(`${column} is not null`); return builder; },
      order(column: string, options: { ascending?: boolean } = {}) { orders.push(`${column} ${options.ascending === false ? 'desc' : 'asc'}`); return builder; },
      limit(value: number) { limit = value; return builder; },
      maybeSingle() { single = 'maybe'; return builder; },
      single() { single = 'one'; return builder; },
      then<T>(resolve: (value: Awaited<ReturnType<typeof run>>) => T, reject?: (reason: unknown) => T) { return run().then(resolve, reject); },
    };
    return builder;
  };
  return { from, rpc: rpc.rpc, calls: rpc.calls };
}
