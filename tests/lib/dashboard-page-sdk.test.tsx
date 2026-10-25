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
