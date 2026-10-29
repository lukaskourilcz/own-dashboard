import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ create: vi.fn(), auth: vi.fn(), rate: vi.fn(), fetcher: vi.fn(), read: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.create }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.rate }));
vi.mock('@/lib/github-token', () => ({ createGitHubFetcher: m.fetcher }));
vi.mock('@/lib/marketing-calendars-server', () => ({ readMarketingCalendars: m.read }));
import { GET } from '@/app/api/marketing/calendars/route';
const owner = '11111111-1111-4111-8111-111111111111';
const reply = { checkedAt: '2026-10-28T12:00:00Z', sources: [] };
const request = (signal?: AbortSignal) => new Request('https://own.example/api/marketing/calendars', { signal });
beforeEach(() => {
 vi.clearAllMocks();
 m.auth.mockResolvedValue({ data: { user: { id: owner } }, error: null });
 m.create.mockResolvedValue({ auth: { getUser: m.auth } });
 m.rate.mockResolvedValue({ ok: true, retryAfter: 0 });
 m.fetcher.mockReturnValue(vi.fn()); m.read.mockResolvedValue(reply);
});
afterEach(() => vi.restoreAllMocks());
it.each([401, 403, 503])('refuses a cached user accompanied by auth error %i before provider work', async status => {
 m.auth.mockResolvedValue({ data: { user: { id: owner } }, error: { status, message: 'TEST_ONLY_PRIVATE_AUTH' } });
 const response = await GET(request());
 expect(response.status).toBe(status === 503 ? 503 : 401);
 expect(m.rate).not.toHaveBeenCalled(); expect(m.fetcher).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
 expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it('contains failed client setup without provider work or private diagnostics', async () => {
 m.create.mockRejectedValue(Error('TEST_ONLY_PRIVATE_SETUP'));
 const response = await GET(request()); expect(response.status).toBe(503);
 expect(m.fetcher).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it('does not start client setup for a retired caller', async () => {
 const parent = new AbortController(); parent.abort('TEST_ONLY_PRIVATE_REASON');
 const response = await GET(request(parent.signal)); expect(response.status).toBe(503);
 expect(m.create).not.toHaveBeenCalled(); expect(m.rate).not.toHaveBeenCalled(); expect(m.fetcher).not.toHaveBeenCalled();
});
it('starts no provider read after retirement during quota admission', async () => {
 let finish!: (value: { ok: boolean; retryAfter: number }) => void;
 m.rate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const parent = new AbortController(), pending = GET(request(parent.signal));
 await vi.waitFor(() => expect(m.rate).toHaveBeenCalledOnce());
 parent.abort(); finish({ ok: true, retryAfter: 0 });
 expect((await pending).status).toBe(503); expect(m.read).not.toHaveBeenCalled();
});
it('does not return a provider result delivered after retirement', async () => {
 let finish!: (value: typeof reply) => void;
 m.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const parent = new AbortController(), pending = GET(request(parent.signal));
 await vi.waitFor(() => expect(m.read).toHaveBeenCalledOnce());
 parent.abort(); finish(reply); expect((await pending).status).toBe(503);
});
it('preserves the verified owner, rate policy and private success', async () => {
 const response = await GET(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual(reply);
 expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(m.rate).toHaveBeenCalledExactlyOnceWith(owner, { key: 'marketing-calendars', limit: 10, windowSec: 60 });
 expect(m.fetcher).toHaveBeenCalledWith(owner, expect.any(AbortSignal));
 expect(m.read).toHaveBeenCalledWith(m.fetcher.mock.results[0].value, undefined, undefined, m.fetcher.mock.calls[0][1]);
});
it('preserves explicit rate recovery without a provider read', async () => {
 m.rate.mockResolvedValue({ ok: false, retryAfter: 31 });
 const response = await GET(request()); expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('31'); expect(m.read).not.toHaveBeenCalled();
});

it('bounds held quota admission and never begins the calendar read', async () => {
 const quota = new AbortController();
 const timeout = AbortSignal.timeout;
 vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 3_000 ? quota.signal : timeout(ms));
 m.rate.mockReturnValue(new Promise(() => {}));
 const pending = GET(request()); await vi.waitFor(() => expect(m.rate).toHaveBeenCalledOnce());
 quota.abort(); expect((await pending).status).toBe(503); expect(m.fetcher).not.toHaveBeenCalled();
});
it('bounds a held provider consumer with the original thirty-second allowance', async () => {
 const original = new AbortController();
 const timeout = AbortSignal.timeout;
 const clock = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 30_000 ? original.signal : timeout(ms));
 m.read.mockReturnValue(new Promise(() => {}));
 const pending = GET(request()); await vi.waitFor(() => expect(m.read).toHaveBeenCalledOnce());
 original.abort(); expect((await pending).status).toBe(503);
 expect(clock).toHaveBeenCalledWith(30_000); expect(m.fetcher.mock.calls[0][1].aborted).toBe(true);
});
