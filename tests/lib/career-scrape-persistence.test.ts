import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { ScrapedJob } from '@/lib/jobs/types';
import { JOB_SOURCES } from '@/lib/jobs/sources';
import { runJobScrape } from '@/lib/jobs/scrape';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const source = vi.hoisted(() => ({ id: 'apify-SyntheticTask', label: 'Synthetic completed task', fetch: vi.fn() }));
vi.mock('@/lib/jobs/sources', () => ({ JOB_SOURCES: [source] }));
vi.mock('@/lib/jobs/prune', () => ({ selectDeadUrls: async () => new Set<string>() }));
const owner = '11111111-1111-4111-8111-111111111111', now = '2026-10-25T12:00:00Z', latest = '2026-10-25T11:00:00Z';
const job = () => ({ source: source.id, externalId: 'one', title: 'Old React frontend version', company: 'Synthetic', url: 'https://thehub.io/jobs/synthetic', location: 'Oslo, Norway', role: 'frontend' as const, remote: true, salary: null, tags: ['React'], seniority: null, description: 'React frontend TypeScript', postedAt: null, observedAt: '2026-10-25T10:30:00Z' });
let db: PGlite, api: SupabaseClient, failRead: boolean, fault: string, requests: string[];
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: now }); }, 60_000);
beforeEach(async () => {
 vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now)); failRead = false; fault = ''; requests = [];
 await db.exec('truncate job_listings,job_scrape_runs,career_private.source_snapshots cascade');
 await db.query(`insert into job_listings(source,external_id,title,url,location,role,remote,tags,description,first_seen_at,last_seen_at) values($1,'one','Latest React frontend title','https://thehub.io/jobs/synthetic','Oslo, Norway','frontend',true,array['React'],'React TypeScript','2026-10-25T10:00:00Z',$2)`, [source.id, latest]);
 const emulator = new SupabaseEmulator(db, 'https://example.supabase.co', { service: 'TEST-ONLY-service', users: {} }, () => new Date(now));
 api = createClient('https://example.supabase.co', 'TEST-ONLY-service', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
  const request = new Request(input, init), url = new URL(request.url);
  if (failRead && request.method === 'GET' && url.pathname === '/rest/v1/job_listings' && url.searchParams.get('select') === 'source,external_id') return Response.json({ message: 'PRIVATE TEST read refused', code: 'SYNTHETIC' }, { status: 400 });
  requests.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`);
  if (fault === 'stall-db' && request.method === 'POST') return new Promise<Response>(() => {});
  if (fault === 'candidate' && request.method === 'GET' && url.searchParams.get('select') === 'id,source,url,last_seen_at') return Response.json({ message: 'PRIVATE TEST candidate read refused' }, { status: 400 });
  if (fault === 'filter' && request.method === 'GET' && url.searchParams.get('select')?.includes('title,tags')) return Response.json([{ id: 'invalid-row' }]);
  const actual = await emulator.fetch(request);
  if (fault === 'apply-ambiguous' && url.pathname.endsWith('/career_apply_source_snapshot')) return Response.json({ message: 'PRIVATE TEST uncertain write' }, { status: 400 });
  if (fault === 'apply-receipt' && url.pathname.endsWith('/career_apply_source_snapshot')) { const data = await actual.json(); return Response.json({ ...data, source: 'foreign-source' }); }
  if (fault === 'log' && request.method === 'POST' && url.pathname.endsWith('/job_scrape_runs')) return Response.json({ message: 'PRIVATE TEST uncertain log' }, { status: 400 });
  return actual;
 } } }); source.fetch.mockReset().mockResolvedValue([job()]);
});
afterEach(() => { JOB_SOURCES.splice(1); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); }); afterAll(async () => { await db?.close(); });
it('cannot overwrite a newer observed job with an older completed task snapshot', async () => {
 await runJobScrape(api, { includeCzech: true }); const result = await db.query<{ title: string; last_seen_at: string }>('select title,last_seen_at from job_listings where source=$1', [source.id]); expect(result.rows[0].title).toBe('Latest React frontend title'); expect(new Date(result.rows[0].last_seen_at).toISOString()).toBe(new Date(latest).toISOString());
});
it('never invents inserted rows when the preceding count snapshot is unavailable', async () => {
 failRead = true; source.fetch.mockResolvedValue([{ ...job(), observedAt: now }]); const result = await runJobScrape(api, { includeCzech: true }); expect(result.inserted).toBe(0);
});

it('preserves the owner permanent deletion marker when discovery-cache retention runs', async () => {
 const listing = (await db.query<{ id: string }>('select id from job_listings where external_id=$1', ['one'])).rows[0]; await db.query("update job_listings set last_seen_at='2026-08-01'"); await db.query("insert into job_user_state(user_id,listing_id,state) values($1,$2,'deleted')", [owner, listing.id]); source.fetch.mockResolvedValue([{ ...job(), externalId: 'other', observedAt: now }]);
 await runJobScrape(api, { includeCzech: true }); expect((await db.query('select listing_id,state from job_user_state')).rows).toEqual([{ listing_id: listing.id, state: 'deleted' }]);
});

it.each(['apply-ambiguous', 'apply-receipt', 'candidate', 'filter', 'log'])('refuses unconfirmed %s evidence without retries or raw diagnostics', async kind => {
 fault = kind; source.fetch.mockResolvedValue([{ ...job(), observedAt: now }]); const result = await runJobScrape(api, { includeCzech: true }); expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('PRIVATE TEST');
 expect(requests.filter(path => path.includes('/career_apply_source_snapshot'))).toHaveLength(1); expect(requests.filter(path => path.startsWith('POST /rest/v1/job_scrape_runs'))).toHaveLength(1);
 expect((await db.query('select title from job_listings where external_id=$1', ['one'])).rows[0]).toEqual({ title: job().title });
 if (kind.startsWith('apply')) expect(requests.some(path => path.includes('/career_prune_stale_listings'))).toBe(false);
});
it('retains an empty completed-task observation instead of renewing its freshness to this check', async () => {
 source.fetch.mockResolvedValue({ jobs: [], observedAt: '2026-10-25T10:30:00Z' }); const result = await runJobScrape(api, { includeCzech: true }); expect(result.ok).toBe(false); expect(result.sources[source.id].error).toBe('snapshot-unconfirmed'); expect((await db.query('select count(*)::int n from career_private.source_snapshots')).rows[0]).toEqual({ n: 0 });
});
it.each(['foreign', 'invalid', 'mixed-time', 'future'])('refuses %s source rows before a database write', async kind => {
 const valid = { ...job(), observedAt: now };
 source.fetch.mockResolvedValue(kind === 'foreign' ? [{ ...valid, source: 'foreign' }] : kind === 'invalid' ? [{ ...valid, role: 'invalid' }] : kind === 'future' ? [{ ...valid, observedAt: '2026-10-25T12:00:01Z' }] : [valid, { ...valid, externalId: 'other', observedAt: latest }]);
 const result = await runJobScrape(api, { includeCzech: true }); expect(result.ok).toBe(false); expect(requests.some(path => path.includes('/career_apply_source_snapshot'))).toBe(false); expect(JSON.stringify(result)).not.toContain('PRIVATE TEST');
});
it('captures Czech source choice before waiting for its source', async () => {
 let finish!: (value: unknown) => void; source.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const options = { includeCzech: true }; const pending = runJobScrape(api, options); options.includeCzech = false;
 await new Promise(resolve => setTimeout(resolve, 0)); finish([{ ...job(), location: 'Prague', observedAt: now }]); const result = await pending; expect(result.ok).toBe(true); expect((await db.query('select location from job_listings where external_id=$1', ['one'])).rows[0]).toEqual({ location: 'Prague' });
});
it('refuses parent cancellation before sources or database admission', async () => {
 const parent = new AbortController(); parent.abort(); await expect(runJobScrape(api, { includeCzech: true, signal: parent.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(source.fetch).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
});
it('cannot start a late write after an uncooperative source settles after cancellation', async () => {
 let finish!: (value: unknown) => void; source.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const parent = new AbortController(); const pending = runJobScrape(api, { includeCzech: true, signal: parent.signal }), check = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await new Promise(resolve => setTimeout(resolve, 0)); parent.abort(); await check; finish([{ ...job(), observedAt: now }]); await new Promise(resolve => setTimeout(resolve, 0)); expect(requests).toHaveLength(0);
});

it('copies a completed source before another pending source can mutate its original rows', async () => {
 const original = { ...job(), title: 'Captured React frontend title', observedAt: now }; source.fetch.mockResolvedValue([original]); let finish!: (value: ScrapedJob[]) => void;
 JOB_SOURCES.push({ id: 'held', label: 'Synthetic held source', fetch: () => new Promise<ScrapedJob[]>(resolve => { finish = resolve; }) });
 const pending = runJobScrape(api, { includeCzech: true }); await new Promise(resolve => setTimeout(resolve, 0)); original.title = 'Changed React frontend title'; original.tags.push('changed'); finish([]);
 expect((await pending).ok).toBe(true); expect((await db.query('select title,tags from job_listings where external_id=$1', ['one'])).rows[0]).toEqual({ title: 'Captured React frontend title', tags: ['React'] });
});
it('caps the combined source/database/journal wait at forty-five seconds without another attempt', async () => {
 vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(new Date(now)); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; });
 fault = 'stall-db'; let finish!: (value: unknown[]) => void; source.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const pending = runJobScrape(api, { includeCzech: true }), check = expect(pending).rejects.toThrow('career-scrape-unavailable'); await vi.advanceTimersByTimeAsync(29_000); finish([{ ...job(), observedAt: new Date().toISOString() }]); await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(16_001); await check;
 expect(requests.filter(path => path.includes('/career_apply_source_snapshot'))).toHaveLength(1); expect(requests.filter(path => path.includes('/job_scrape_runs'))).toHaveLength(1);
});
it('cannot begin cleanup or a journal write after cancellation during an uncooperative database call', async () => {
 fault = 'stall-db'; source.fetch.mockResolvedValue([{ ...job(), observedAt: now }]); const parent = new AbortController(); const pending = runJobScrape(api, { includeCzech: true, signal: parent.signal }), check = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
 await vi.waitFor(() => expect(requests.some(path => path.includes('/career_apply_source_snapshot'))).toBe(true)); parent.abort(); await check; expect(requests).toHaveLength(1);
});
