import type { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tickDneskaiCollection, type DneskaiCollectionDependencies, type DneskaiCollectResponse } from '@/lib/marketing/dneskai-collection';
import { candidate } from '@/lib/marketing/dneskai-providers';
import { createDneskaiCollectionStore } from '@/lib/marketing/dneskai-store';
import { dueDneskaiSources } from '@/lib/marketing/dneskai-registry';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
vi.mock('server-only', () => ({}));

/**
 * The owner's current production posture: Jev on (PAID_ENABLED and consent), Apify configured but switched off.
 * One night on every migration in isolated WASM Postgres, through the real collection store and its SQL, with
 * local fakes for the free feed and Jev. Nothing reaches a network and nothing is paid.
 */
const OWNER = '7a1c0b52-3f5e-4c11-9b8e-2d4f6a8c0e11', PROJECT = '4b2e9d10-8c3a-4f6e-a1b5-c7d9e0f21a34';
const SUPABASE = 'https://apify-switch-fixture.supabase.co', SERVICE_KEY = 'service-role-TEST-ONLY';
const instant = new Date('2026-10-26T21:00:30.000Z'); // 22:00:30 in Prague
const env = {
  MARKETING_DNESKAI_COLLECTION_ENABLED: 'true', MARKETING_DNESKAI_PAID_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', TYPESAFE_API_KEY: 'typesafe-TEST-ONLY',
  APIFY_TOKEN: 'apify_api_TEST_ONLY', MARKETING_DNESKAI_APIFY_ACTOR_ID: 'shu8hvrXbJbY3Eb9W', MARKETING_DNESKAI_APIFY_BUILD: '0.0.517',
};
let db: PGlite; let emulator: SupabaseEmulator;
const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => emulator.sql<T>(text, params);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
  db = await createMigratedDatabase({ owner: OWNER, instant });
  emulator = new SupabaseEmulator(db, SUPABASE, { service: SERVICE_KEY, users: {} }, () => new Date());
  await sql("insert into public.projects(id,user_id,name,slug,repo_full_name,portfolio_key) values($1,$2,'DNESKAi','aifirst','lukaskourilcz/aifirst','aifirst')", [PROJECT, OWNER]);
}, 120_000);
afterAll(async () => { vi.useRealTimers(); await db?.close(); });

describe('DNESKAi collection with MARKETING_DNESKAI_APIFY_ENABLED unset', () => {
  it('holds every Instagram stage at zero cost, classifies the free-feed reports with Jev and selects events', async () => {
    const admin = createClient(SUPABASE, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => emulator.fetch(input, init) } });
    const store = createDneskaiCollectionStore(admin as never);
    const due = dueDneskaiSources('2026-10-26'), feedSource = due.find((source) => source.kind !== 'instagram')!;
    expect(due.some((source) => source.kind === 'instagram')).toBe(true);
    const published = '2026-10-26T18:00:00.000Z';
    const reports = [
      ['model', 'Synthetic lab ships a smaller open model for laptops'],
      ['chips', 'Synthetic chipmaker reports a new inference accelerator'],
      ['tool', 'Synthetic notebook tool adds offline dataset previews'],
    ].map(([id, title]) => candidate(feedSource.id, `OFFLINE-${id}`, title!, `${title}. Synthetic test-only report ${id}.`, `https://example.test/${id}`, published, instant.toISOString()));
    const feed = vi.fn<NonNullable<DneskaiCollectionDependencies['feed']>>(async (source) => ({ items: source.id === feedSource.id ? reports : [], complete: true, errorCode: null }));
    const categories = ['ai-news', 'tech-news', 'tool'] as const;
    const jev = vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async (items) => ({ items: items.map((item, index) => ({ ...item, category: categories[index % 3]!, relevance: 0.95, status: 'new' as const, duplicateOf: null })), costUsd: 0.0001 }));
    const startInstagram = vi.fn(), pollInstagram = vi.fn();

    // The scheduler's loop: admit, then pass the run id while the tick asks to continue.
    let response: DneskaiCollectResponse | undefined;
    for (let tick = 0; tick < 30 && (!response || response.continue); tick++) {
      response = await tickDneskaiCollection(OWNER, { projectId: PROJECT, ...(response ? { runId: response.runId } : {}) }, { store, env, feed, jev, startInstagram, pollInstagram });
    }
    expect(response).toMatchObject({ status: 'partial', continue: false });
    expect(startInstagram).not.toHaveBeenCalled(); expect(pollInstagram).not.toHaveBeenCalled();
    expect(jev).toHaveBeenCalledTimes(1);

    const stages = await sql<{ kind: string; status: string; reserved_usd: string; cost_usd: string | null; error_code: string | null }>(
      'select kind,status,reserved_usd::text,cost_usd::text,error_code from public.marketing_dneskai_stages where run_id=$1 order by source_id', [response!.runId]);
    const instagram = stages.filter((stage) => stage.kind === 'instagram');
    expect(instagram.length).toBe(due.filter((source) => source.kind === 'instagram').length);
    expect(instagram.every((stage) => stage.status === 'held' && Number(stage.reserved_usd) === 0 && Number(stage.cost_usd) === 0 && stage.error_code === 'collection-apify-disabled')).toBe(true);
    expect(stages.filter((stage) => stage.kind === 'jev').map((stage) => stage.status)).toEqual(['ok']);

    const [run] = await sql<{ status: string; error_code: string | null; cost_usd: string | null; target_date: string }>('select status,error_code,cost_usd::text,target_date::text from public.marketing_dneskai_runs where id=$1', [response!.runId]);
    expect(run).toMatchObject({ status: 'partial', error_code: 'collection-review-incomplete', target_date: '2026-10-27' });
    expect(Number(run!.cost_usd)).toBeCloseTo(0.0001, 10);
    const selected = await sql<{ id: string; target_date: string }>("select id,target_date::text from public.marketing_dneskai_candidates where user_id=$1 and status='selected' order by id", [OWNER]);
    expect(selected.map((row) => row.id).sort()).toEqual(reports.map((report) => report.id).sort());
    expect(selected.every((row) => row.target_date === '2026-10-27')).toBe(true);
    const [state] = await sql<{ status: string; error_code: string | null }>("select status,error_code from public.marketing_dneskai_source_states where user_id=$1 and source_id like 'instagram:%' limit 1", [OWNER]);
    expect(state).toMatchObject({ status: 'held', error_code: 'collection-apify-disabled' });
  }, 120_000);
});
