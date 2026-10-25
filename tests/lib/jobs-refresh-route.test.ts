import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient as createSdkClient, type User } from '@supabase/supabase-js';
const state = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), admin: vi.fn(), limit: vi.fn(), scrape: vi.fn(), preference: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: (...args: unknown[]) => state.client(...args) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => state.admin(...args) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...args: unknown[]) => state.limit(...args) }));
vi.mock('@/lib/jobs/scrape', () => ({ runJobScrape: (...args: unknown[]) => state.scrape(...args) }));
import { POST, maxDuration } from '@/app/api/jobs/refresh/route';
const owner = '11111111-1111-4111-8111-111111111111';
const summary = { startedAt: '2026-10-25T18:00:00Z', finishedAt: '2026-10-25T18:00:01Z', ok: true, inserted: 1, refreshed: 0, pruned: 0, sources: {} };
const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: () => query, retry: vi.fn(() => query), abortSignal: vi.fn(() => query), then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => state.preference().then(resolve, reject) };
const request = (headers: Record<string, string> = {}, signal?: AbortSignal) => new Request('https://own.example/api/jobs/refresh', { method: 'POST', headers: { origin: 'https://own.example', ...headers }, signal });
beforeEach(() => {
 vi.clearAllMocks(); state.auth.mockResolvedValue({ data: { user: { id: owner } }, error: null });
 state.client.mockResolvedValue({ auth: { getUser: state.auth }, from: () => query }); state.admin.mockReturnValue({ synthetic: true });
 state.preference.mockResolvedValue({ data: { show_czech_career: false }, error: null }); state.limit.mockResolvedValue({ ok: true }); state.scrape.mockResolvedValue(summary);
});
afterEach(() => { vi.restoreAllMocks(); });
it('keeps the function limit, one verification and legacy response shape', async () => {
 const result = await POST(request()); expect(maxDuration).toBe(60); expect(result.status).toBe(200); expect(await result.json()).toEqual(summary); expect(result.headers.get('cache-control')).toBe('private, no-store');
 expect(state.auth).toHaveBeenCalledOnce(); expect(state.limit).toHaveBeenCalledWith(owner, { key: 'jobs-refresh', limit: 2, windowSec: 600 }); expect(query.eq).toHaveBeenCalledWith('user_id', owner); expect(query.retry).toHaveBeenCalledWith(false); expect(state.scrape).toHaveBeenCalledWith({ synthetic: true }, { includeCzech: false });
});
it('refuses a cached user accompanied by an authentication error before any refresh admission', async () => {
 state.auth.mockResolvedValue({ data: { user: { id: owner } }, error: { status: 401, message: 'synthetic-private-auth-detail' } });
 expect((await POST(request())).status).toBe(401); expect(state.limit).not.toHaveBeenCalled(); expect(state.admin).not.toHaveBeenCalled(); expect(state.preference).not.toHaveBeenCalled(); expect(state.scrape).not.toHaveBeenCalled();
});
it.each([null, { id: '' }, { id: 'not-an-owner' }])('refuses an absent or malformed verified identity (%j)', async user => {
 state.auth.mockResolvedValue({ data: { user }, error: null }); expect((await POST(request())).status).toBe(401); expect(state.scrape).not.toHaveBeenCalled(); expect(state.admin).not.toHaveBeenCalled();
});
it('does not expose a verification outage as an accepted cached identity or private response', async () => {
 state.auth.mockResolvedValue({ data: { user: { id: owner } }, error: Error('synthetic-private-auth-detail') }); const result = await POST(request());
 expect(result.status).toBe(503); expect(await result.text()).not.toContain('synthetic-private'); expect(state.limit).not.toHaveBeenCalled(); expect(state.scrape).not.toHaveBeenCalled();
});
it.each(['bad', 'x'.repeat(1000)])('rejects a malformed captured-owner header before authentication (%s)', async value => {
 expect((await POST(request({ 'x-own-dashboard-owner': value }))).status).toBe(400); expect(state.auth).not.toHaveBeenCalled(); expect(state.scrape).not.toHaveBeenCalled();
});
it('refuses a different captured owner before cost or private preferences', async () => {
 expect((await POST(request({ 'x-own-dashboard-owner': '22222222-2222-4222-8222-222222222222' }))).status).toBe(409); expect(state.limit).not.toHaveBeenCalled(); expect(state.preference).not.toHaveBeenCalled(); expect(state.admin).not.toHaveBeenCalled(); expect(state.scrape).not.toHaveBeenCalled();
});
it('confirms a matching captured owner without another verification', async () => {
 const result = await POST(request({ 'x-own-dashboard-owner': owner })); expect(result.status).toBe(200); expect(await result.json()).toEqual({ ...summary, ownerId: owner }); expect(state.auth).toHaveBeenCalledOnce();
});
it.each(['error', 'rejected', 'invalid'])('does not infer a source choice from %s preference evidence', async kind => {
 if (kind === 'rejected') state.preference.mockRejectedValue(Error('synthetic-private-query-detail'));
 else state.preference.mockResolvedValue({ data: kind === 'invalid' ? { show_czech_career: 'true' } : null, error: kind === 'error' ? { message: 'synthetic-private-query-detail' } : null });
 const result = await POST(request()); expect(result.status).toBe(503); expect(await result.text()).not.toContain('synthetic-private'); expect(state.scrape).not.toHaveBeenCalled(); expect(state.admin).not.toHaveBeenCalled();
});
it.each([null, { show_czech_career: true }])('preserves explicit Czech choice and the absent-row default (%j)', async preference => {
 state.preference.mockResolvedValue({ data: preference, error: null }); expect((await POST(request())).status).toBe(200); expect(state.scrape).toHaveBeenCalledWith({ synthetic: true }, { includeCzech: preference?.show_czech_career === true });
});
it('retains the two-per-ten-minute rate limit before any service client or scrape', async () => {
 state.limit.mockResolvedValue({ ok: false, retryAfter: 30 }); const result = await POST(request()); expect(result.status).toBe(429); expect(result.headers.get('retry-after')).toBe('30'); expect(state.admin).not.toHaveBeenCalled(); expect(state.scrape).not.toHaveBeenCalled();
});
it('refuses a cross-origin request before verification', async () => {
 expect((await POST(request({ origin: 'https://unrelated.example' }))).status).toBe(403); expect(state.auth).not.toHaveBeenCalled(); expect(state.scrape).not.toHaveBeenCalled();
});
it.each(['authentication', 'preferences', 'rate-limit', 'scrape'])('bounds a stalled %s phase and ignores its late result', async phase => {
 const deadlines = new Map<number, AbortController>(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); deadlines.set(ms, controller); return controller.signal; });
 let finish!: (value: unknown) => void; const delayed = () => new Promise(resolve => { finish = resolve; });
 if (phase === 'authentication') state.auth.mockImplementation(delayed);
 if (phase === 'preferences') state.preference.mockImplementation(delayed);
 if (phase === 'rate-limit') state.limit.mockImplementation(delayed);
 if (phase === 'scrape') state.scrape.mockImplementation(delayed);
 const pending = POST(request()); await vi.waitFor(() => expect(typeof finish).toBe('function'));
 const ms = phase === 'authentication' ? 8000 : phase === 'scrape' ? 45000 : 5000;
 deadlines.get(ms)!.abort('synthetic-private-abort'); const result = await pending;
 expect(result.status).toBe(503); expect(await result.text()).not.toContain('synthetic-private');
 expect((state.client.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
 const calls = state.scrape.mock.calls.length;
 finish(phase === 'authentication' ? { data: { user: { id: owner } }, error: null } : phase === 'preferences' ? { data: { show_czech_career: true }, error: null } : phase === 'rate-limit' ? { ok: true } : summary);
 await Promise.resolve(); expect(state.scrape).toHaveBeenCalledTimes(calls);
});
it('refuses caller cancellation before verification with fixed text', async () => {
 const parent = new AbortController(); parent.abort('synthetic-private-abort'); const result = await POST(request({}, parent.signal)); expect(result.status).toBe(503); expect(await result.text()).not.toContain('synthetic-private'); expect(state.auth).not.toHaveBeenCalled(); expect(state.scrape).not.toHaveBeenCalled();
});
it('returns fixed unavailability when the service client or scrape fails', async () => {
 state.admin.mockImplementationOnce(() => { throw Error('synthetic-private-configuration'); }); let result = await POST(request()); expect(result.status).toBe(503); expect(await result.text()).not.toContain('synthetic-private');
 state.scrape.mockRejectedValueOnce(Error('synthetic-private-provider-detail')); result = await POST(request()); expect(result.status).toBe(503); expect(await result.text()).not.toContain('synthetic-private');
});
it.each([200, 503])('uses the installed SDK to read captured preferences once on HTTP %s', async status => {
 const reads: { url: URL; signal: AbortSignal | null | undefined }[] = [];
 const api = createSdkClient('https://offline.supabase.test', 'TEST-ONLY-public', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => { reads.push({ url: new URL(String(input)), signal: init?.signal }); return Response.json(status === 200 ? { show_czech_career: true } : { message: 'synthetic-private-database-detail' }, { status }); } } });
 const user: User = { id: owner, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T18:00:00Z' };
 vi.spyOn(api.auth, 'getUser').mockResolvedValue({ data: { user }, error: null }); state.client.mockResolvedValue(api);
 const result = await POST(request({ 'x-own-dashboard-owner': owner })); expect(result.status).toBe(status === 200 ? 200 : 503);
 expect(reads).toHaveLength(1); expect(reads[0].url.pathname).toBe('/rest/v1/user_preferences'); expect(reads[0].url.searchParams.get('user_id')).toBe(`eq.${owner}`); expect(reads[0].signal?.aborted).toBe(true);
 if (status === 200) expect(state.scrape).toHaveBeenCalledWith({ synthetic: true }, { includeCzech: true }); else { expect(state.scrape).not.toHaveBeenCalled(); expect(state.admin).not.toHaveBeenCalled(); }
});
