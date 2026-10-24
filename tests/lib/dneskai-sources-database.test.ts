import type { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tickDneskaiCollection, type DneskaiCollectionDependencies, type DneskaiCollectResponse } from '@/lib/marketing/dneskai-collection';
import { candidate } from '@/lib/marketing/dneskai-providers';
import { createDneskaiCollectionStore } from '@/lib/marketing/dneskai-store';
import { scoutDneskaiTopics } from '@/lib/marketing/dneskai-scouting';
import { loadDneskaiSourceCatalog } from '@/lib/marketing/dneskai-source-catalog';
import { dneskaiSourceSeedRows, type DneskaiSourceRow } from '@/lib/marketing/dneskai-source-list';
import { contentHash } from '@/lib/marketing/hashes';
import { createMigratedDatabase, setDatabaseTime } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
vi.mock('server-only', () => ({}));

/**
 * marketing_dneskai_sources (#174) on every migration in isolated WASM Postgres: the owner functions, RLS, and the
 * acceptance path. A profile added in Zdroje is admitted by the next night's collection and its report becomes a
 * scouted topic; once removed, the following night does not read it. Fakes stand in for every provider.
 */
const OWNER = '7a1c0b52-3f5e-4c11-9b8e-2d4f6a8c0e11', OTHER = '9c3e2d10-1a2b-4c3d-8e4f-5a6b7c8d9e0f', PROJECT = '4b2e9d10-8c3a-4f6e-a1b5-c7d9e0f21a34';
const SUPABASE = 'https://sources-fixture.supabase.co', SERVICE_KEY = 'service-role-TEST-ONLY';
const night = new Date('2026-10-26T21:00:30.000Z'); // Monday 22:00:30 in Prague
const nextNight = new Date('2026-10-27T21:00:30.000Z');
const env = {
  MARKETING_DNESKAI_COLLECTION_ENABLED: 'true', MARKETING_DNESKAI_PAID_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', TYPESAFE_API_KEY: 'typesafe-TEST-ONLY',
  DNESKAI_SOURCES_TABLE_ENABLED: 'true', DNESKAI_TOPICS_ENABLED: 'true', DNESKAI_SCOUTING_ENABLED: 'true',
};
const added: DneskaiSourceRow = { sourceId: 'instagram:newprofile', kind: 'instagram', topic: 'education', handleOrUrl: 'newprofile', name: 'newprofile', tier: 0, weekdays: [0, 1, 2, 3, 4, 5, 6], maxItems: 10, enabled: true };
let db: PGlite; let emulator: SupabaseEmulator;
const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => emulator.sql<T>(text, params);

/** Runs one statement as an authenticated user, the way PostgREST would. */
async function as<T>(user: string, text: string, params: unknown[]): Promise<T[]> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
  try { return (await db.query<T>(text, params)).rows; } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
const save = (row: DneskaiSourceRow, user = OWNER) => as<{ result: { sourceId: string } }>(user, 'select public.marketing_dneskai_source_save($1,$2) as result', [PROJECT, JSON.stringify(row)]);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(night);
  db = await createMigratedDatabase({ owner: OWNER, instant: night });
  emulator = new SupabaseEmulator(db, SUPABASE, { service: SERVICE_KEY, users: {} }, () => new Date());
  await sql("insert into auth.users(id,email) values($1,'other@example.test')", [OTHER]);
  await sql("insert into public.projects(id,user_id,name,slug,repo_full_name,portfolio_key) values($1,$2,'DNESKAi','aifirst','lukaskourilcz/aifirst','aifirst')", [PROJECT, OWNER]);
}, 120_000);
afterAll(async () => { vi.useRealTimers(); await db?.close(); });

describe('marketing_dneskai_sources (20261023110000)', () => {
  it('seeds the registry once, and never again once the owner has rows', async () => {
    const seed = dneskaiSourceSeedRows();
    const [first] = await as<{ count: number }>(OWNER, 'select public.marketing_dneskai_sources_seed($1,$2) as count', [PROJECT, JSON.stringify(seed)]);
    expect(first!.count).toBe(seed.length);
    const [again] = await as<{ count: number }>(OWNER, 'select public.marketing_dneskai_sources_seed($1,$2) as count', [PROJECT, JSON.stringify(seed)]);
    expect(again!.count).toBe(0);
    // The two profiles waiting for the owner's check (Astra #185) are seeded switched off.
    const pending = await sql<{ source_id: string; enabled: boolean }>("select source_id,enabled from public.marketing_dneskai_sources where source_id in('instagram:aimanie','instagram:digitalnihumanista') order by source_id");
    expect(pending).toEqual([{ source_id: 'instagram:aimanie', enabled: false }, { source_id: 'instagram:digitalnihumanista', enabled: false }]);
  });

  it('adds and changes a source through the owner function, and refuses a bad address, a changed address and another owner', async () => {
    expect((await save(added))[0]!.result).toMatchObject({ sourceId: 'instagram:newprofile' });
    expect((await save({ ...added, weekdays: [1, 2] }))[0]!.result).toMatchObject({ sourceId: 'instagram:newprofile' });
    const [row] = await sql<{ weekdays: number[] }>("select weekdays from public.marketing_dneskai_sources where source_id='instagram:newprofile'");
    expect(row!.weekdays).toEqual([1, 2]);
    await save({ ...added, weekdays: [0, 1, 2, 3, 4, 5, 6] });
    await expect(save({ ...added, sourceId: 'instagram:BadCase', handleOrUrl: 'BadCase' })).rejects.toThrow(/source invalid/);
    await expect(save({ ...added, sourceId: 'web-plain-000000', kind: 'rss', handleOrUrl: 'http://plain.example/feed' })).rejects.toThrow(/source invalid/);
    await expect(save({ ...added, kind: 'rss', handleOrUrl: 'https://example.com/feed' })).rejects.toThrow(/source address changed/);
    await expect(save(added, OTHER)).rejects.toThrow(/source unavailable/);
    // Reads are own-only, and the owner cannot write the table directly.
    expect(await as(OTHER, 'select source_id from public.marketing_dneskai_sources', [])).toEqual([]);
    await expect(as(OWNER, "update public.marketing_dneskai_sources set enabled=false where source_id='instagram:newprofile'", [])).rejects.toThrow(/permission denied/);
  });

  it('admits an added profile the next night and scouts its report into a topic', async () => {
    const admin = createClient(SUPABASE, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => emulator.fetch(input, init) } });
    const catalog = await loadDneskaiSourceCatalog(admin as never, OWNER, PROJECT, env);
    expect(catalog.origin).toBe('table');
    expect(catalog.due('2026-10-26', { education: true }).map((source) => source.id)).toContain('instagram:newprofile');
    const store = createDneskaiCollectionStore(admin as never);
    const feed = vi.fn<NonNullable<DneskaiCollectionDependencies['feed']>>(async () => ({ items: [], complete: true, errorCode: null }));
    const jev = vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async (items) => ({ items: items.map((item) => ({ ...item, category: 'tool' as const, relevance: 0.9, status: 'new' as const, duplicateOf: null })), costUsd: 0 }));
    let response: DneskaiCollectResponse | undefined;
    for (let tick = 0; tick < 30 && (!response || response.continue); tick++) {
      response = await tickDneskaiCollection(OWNER, { projectId: PROJECT, ...(response ? { runId: response.runId } : {}) }, { store, env, feed, jev, startInstagram: vi.fn(), pollInstagram: vi.fn() });
    }
    const stages = await sql<{ source_id: string }>('select source_id from public.marketing_dneskai_stages where run_id=$1', [response!.runId]);
    expect(stages.map((stage) => stage.source_id)).toContain('instagram:newprofile');
    expect(stages.map((stage) => stage.source_id)).not.toContain('instagram:aimanie');

    // Apify is off in this fixture, so the profile's report is written as the Instagram stage would write it.
    const report = candidate('instagram:newprofile', 'reel-42', 'Three shortcuts that make a coding agent review its own work', 'Three shortcuts…', 'https://www.instagram.com/reel/ABC42/', '2026-10-26T18:00:00.000Z', night.toISOString());
    await sql(`insert into public.marketing_dneskai_candidates(id,user_id,project_id,run_id,candidate,canonical_url_hash,normalized_text_hash,content_hash,status)
      values($1,$2,$3,$4,$5,$6,$7,$8,'new')`, [report.id, OWNER, PROJECT, response!.runId, JSON.stringify(report), contentHash(report.url), contentHash(report.text), contentHash(JSON.stringify(report))]);
    const scouted = await scoutDneskaiTopics(admin as never, OWNER, PROJECT, night, env);
    expect(scouted.inserted).toBeGreaterThanOrEqual(1);
    const [topic] = await sql<{ title_cs: string; handle: string }>("select title_cs,evidence->>'handle' as handle from public.marketing_dneskai_topics where source_ref=$1", [`report:${report.id}`]);
    expect(topic).toEqual({ title_cs: report.title, handle: 'newprofile' });
  }, 120_000);

  it('stops reading a removed source from the following night', async () => {
    const [removed] = await as<{ result: unknown }>(OWNER, 'select public.marketing_dneskai_source_remove($1,$2) as result', [PROJECT, 'instagram:newprofile']);
    expect(removed!.result).toEqual({ sourceId: 'instagram:newprofile', removed: true });
    await expect(as(OWNER, 'select public.marketing_dneskai_source_remove($1,$2)', [PROJECT, 'instagram:newprofile'])).rejects.toThrow(/source unavailable/);
    vi.setSystemTime(nextNight); await setDatabaseTime(db, nextNight);
    const admin = createClient(SUPABASE, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => emulator.fetch(input, init) } });
    const response = await tickDneskaiCollection(OWNER, { projectId: PROJECT }, { store: createDneskaiCollectionStore(admin as never), env,
      feed: async () => ({ items: [], complete: true, errorCode: null }), jev: async () => ({ items: [], costUsd: 0 }), startInstagram: vi.fn(), pollInstagram: vi.fn() });
    const stages = await sql<{ source_id: string }>('select source_id from public.marketing_dneskai_stages where run_id=$1', [response.runId]);
    expect(stages.length).toBeGreaterThan(0);
    expect(stages.map((stage) => stage.source_id)).not.toContain('instagram:newprofile');
  }, 120_000);
  it('keeps every removed source absent and starts no collection for an empty owned catalog', async () => {
    const rows=await as<{source_id:string}>(OWNER,'select source_id from public.marketing_dneskai_sources where project_id=$1',[PROJECT]);
    for(const row of rows)await as(OWNER,'select public.marketing_dneskai_source_remove($1,$2)',[PROJECT,row.source_id]);
    const admin=createClient(SUPABASE,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});
    const catalog=await loadDneskaiSourceCatalog(admin as never,OWNER,PROJECT,env);
    expect(catalog.due('2026-10-27',{education:true})).toEqual([]);expect(catalog.byId('openai-blog')).toBeUndefined();
    const before=emulator.requests.length,provider=vi.fn();
    await expect(tickDneskaiCollection(OWNER,{projectId:PROJECT},{store:createDneskaiCollectionStore(admin as never),env,feed:provider,startInstagram:provider,jev:provider})).rejects.toThrow('collection-no-enabled-sources');
    expect(provider).not.toHaveBeenCalled();expect(emulator.requests.slice(before).every(request=>request.method==='GET')).toBe(true);
    expect(await as(OWNER,'select source_id from public.marketing_dneskai_sources where project_id=$1',[PROJECT])).toEqual([]);
  });
});
