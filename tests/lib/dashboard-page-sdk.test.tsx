import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
const state = vi.hoisted(() => ({ api: null as SupabaseClient | null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.api }));
vi.mock('@/lib/user-prefs', () => ({ loadUserPreferences: async () => ({ language: 'cs' }) }));
vi.mock('@/lib/calendar-server', () => ({ fetchTodayWindowEvents: async () => ({ ok: true, events: [] }), fetchUpcomingWeekEvents: async () => ({ ok: true, events: [] }) }));
vi.mock('@/components/dashboard-shell', () => ({ DashboardShell: () => null }));
vi.mock('@/components/dashboard-data-unavailable', () => ({ DashboardDataUnavailable: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('404'); }, redirect: () => { throw Error('redirect'); } }));
import DashboardPage from '@/app/[[...slug]]/page';
import { DashboardShell } from '@/components/dashboard-shell';
import { DashboardDataUnavailable } from '@/components/dashboard-data-unavailable';
const user: User = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T12:00:00Z' };
let reads: { path: string; signal: AbortSignal | undefined }[], wire: (path: string) => Promise<Response>;
beforeEach(() => {
 reads = []; wire = async path => path.endsWith('/notes') ? Response.json({ message: 'PRIVATE TEST' }, { status: 503 }) : Response.json([]);
 state.api = createClient('https://offline.supabase.test', 'TEST-ONLY-public', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer TEST-ONLY-owner' }, fetch: (input, init) => { const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname; reads.push({ path, signal: init?.signal ?? undefined }); return wire(path); } } });
 vi.spyOn(state.api.auth, 'getUser').mockResolvedValue({ data: { user }, error: null });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
const page = (slug: string[]) => DashboardPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
it('does not hide an SDK retry behind a failed required read', async () => {
 const result = await page(['notes']); expect(result.type).toBe(DashboardDataUnavailable); expect(reads.filter(read => read.path.endsWith('/notes'))).toHaveLength(1); expect(reads.filter(read => read.path.endsWith('/read_owned_collection'))).toHaveLength(1); expect(state.api!.auth.getUser).toHaveBeenCalledOnce();
});
it('does not retry a failed lightweight navigation projection', async () => {
 wire = async () => Response.json({ message: 'PRIVATE TEST' }, { status: 503 });
 const result = await page(['marketing']); expect(result.type).toBe(DashboardDataUnavailable); expect(reads).toHaveLength(1); expect(reads[0].path).toBe('/rest/v1/projects');
});
it('retires an uncooperative actual SDK query at twenty seconds and observes its late response', async () => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => { const controller = new AbortController(); setTimeout(() => controller.abort(), delay); return controller.signal; }); let finish!: (value: Response) => void;
 wire = async path => path.endsWith('/notes') ? new Promise(resolve => { finish = resolve; }) : Response.json([]);
 const pending = page(['notes']); await vi.advanceTimersByTimeAsync(20001); const result = await pending; expect(result.type).toBe(DashboardDataUnavailable); expect(reads.find(read => read.path.endsWith('/notes'))!.signal!.aborted).toBe(true);
 finish(Response.json([])); await Promise.resolve(); expect(reads.filter(read => read.path.endsWith('/notes'))).toHaveLength(1);
});

it('loads Goals through one complete captured-owner RPC instead of a capped REST select', async () => {
 const rows = Array.from({ length: 1201 }, (_, index) => ({ id: `${index.toString(16).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, user_id: user.id, title: 'Synthetic plan', target_date: null, status: 'idea', recurrence: 'none', notes: null, last_completed_at: null, linked_calendar_event_id: null, created_at: '2026-10-25T17:00:00Z', updated_at: '2026-10-25T17:00:00Z' }));
 wire = async path => Response.json(path.endsWith('/read_owned_collection') ? rows : []);
 const result = await page(['goals']); expect(result.type).toBe(DashboardShell); expect(result.props.initialPlans).toHaveLength(1201);
 expect(reads.filter(read => read.path.endsWith('/read_owned_collection'))).toHaveLength(1); expect(reads.some(read => read.path.endsWith('/plans'))).toBe(false);
});

it('loads only the owner-stamped Career health record before explicit private activation', async () => {
 wire = async path => Response.json(path.endsWith('/read_career_records') ? { ownerId: user.id, collection: 'job_scrape_runs', rows: [] } : []);
 const result = await page(['career']);
 expect(result.type).toBe(DashboardShell);
 expect(result.props.initialJobLastRun).toBeNull();
 expect(result.props.initialDataKeys).toEqual(['jobLastRun']);
 expect(reads.map(read => read.path)).toEqual(['/rest/v1/projects', '/rest/v1/rpc/read_career_records']);
 expect(state.api!.auth.getUser).toHaveBeenCalledOnce();
});

it.each(['foreign-owner', 'unreadable'])('refuses an uncertain Career health read without private fallbacks: %s', async kind => {
 wire = async path => path.endsWith('/read_career_records')
  ? kind === 'unreadable' ? Response.json({ message: 'PRIVATE TEST' }, { status: 503 }) : Response.json({ ownerId: '22222222-2222-4222-8222-222222222222', collection: 'job_scrape_runs', rows: [] })
  : Response.json([]);
 expect((await page(['career'])).type).toBe(DashboardDataUnavailable);
 expect(reads.filter(read => read.path.endsWith('/read_career_records'))).toHaveLength(1);
 expect(reads.some(read => /\/(job_listings|saved_job_positions|job_applications)$/.test(read.path))).toBe(false);
});

it.each([
 { full_name: 42, avatar_url: {} },
 { full_name: { display: 'Synthetic name' }, avatar_url: [] },
 { full_name: ['Synthetic name'], avatar_url: 'javascript:alert(1)' },
 { full_name: '   ', avatar_url: 'http://cdn.example.test/avatar.png' },
 { full_name: 'x'.repeat(201), avatar_url: `https://cdn.example.test/${'x'.repeat(2048)}` },
 { full_name: null, avatar_url: 'https://synthetic-user:synthetic-password@cdn.example.test/avatar.png' },
 { full_name: false, avatar_url: 'https://cdn.example.test/avatar\u0000.png' },
])('keeps malformed display metadata out of the shell after actual SDK verification (%j)', async metadata => {
 vi.mocked(state.api!.auth.getUser).mockRestore();
 wire = async path => Response.json(path === '/auth/v1/user' ? { ...user, email: 'owner@example.test', user_metadata: metadata } : []);
 const result = await page(['marketing']);
 expect(result.type).toBe(DashboardShell);
 expect(result.props.user).toEqual({ id: user.id, email: 'owner@example.test', name: null, avatar_url: null });
 expect(reads.map(read => read.path)).toEqual(['/auth/v1/user', '/rest/v1/projects']);
});
it('projects only bounded display strings and preserves the verified owner independently of editable metadata', async () => {
 vi.mocked(state.api!.auth.getUser).mockRestore();
 wire = async path => Response.json(path === '/auth/v1/user' ? { ...user, email: 'owner@example.test', user_metadata: { id: '22222222-2222-4222-8222-222222222222', full_name: '  Žofie L.  ', avatar_url: ' https://cdn.example.test/avatar.png ', privateField: 'synthetic-private-note' } } : []);
 const result = await page(['marketing']);
 expect(result.type).toBe(DashboardShell);
 expect(result.props.user).toEqual({ id: user.id, email: 'owner@example.test', name: 'Žofie L.', avatar_url: 'https://cdn.example.test/avatar.png' });
 expect(reads.map(read => read.path)).toEqual(['/auth/v1/user', '/rest/v1/projects']);
});
it.each([null, { unexpected: true }])('keeps a malformed optional email out of the display DTO (%j)', async email => {
 vi.mocked(state.api!.auth.getUser).mockRestore();
 wire = async path => Response.json(path === '/auth/v1/user' ? { ...user, email } : []);
 const result = await page(['marketing']);
 expect(result.type).toBe(DashboardShell);
 expect(result.props.user).toEqual({ id: user.id, email: '', name: null, avatar_url: null });
});
