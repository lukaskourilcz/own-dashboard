import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ client: vi.fn(), traffic: vi.fn(), configured: true, allowed: true }));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client }));
vi.mock('@/lib/vercel', () => ({ getProjectTraffic: m.traffic, vercelTrafficConfigured: () => m.configured, vercelTrafficOwner: () => m.allowed }));
import { GET } from '@/app/api/vercel/analytics/route';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
let auth: { data: { user: { id: string } | null }; error: { status?: number; message?: string } | null }, row: { data: unknown; error: unknown };
const eq = vi.fn(), from = vi.fn(), read = vi.fn(), retry = vi.fn(), select = vi.fn();
const request = (query = 'repo=owner/repo&repoId=123', identity: string | null = owner, signal?: AbortSignal) => new Request(`https://app.example/api/vercel/analytics?${query}`, { signal, headers: identity ? { 'x-own-dashboard-owner': identity } : {} });
beforeEach(() => {
 vi.clearAllMocks(); m.configured = true; m.allowed = true;
 auth = { data: { user: { id: owner } }, error: null }; row = { data: { id: other, user_id: owner, repo_full_name: 'renamed/repo', repo_id: 123 }, error: null };
 const query = { select, eq, limit: vi.fn(() => query), retry, abortSignal: vi.fn(() => query), maybeSingle: read };
 select.mockReturnValue(query); eq.mockReturnValue(query); retry.mockReturnValue(query); from.mockReturnValue(query); read.mockImplementation(async () => row);
 m.client.mockImplementation(async () => ({ auth: { getUser: async () => auth }, from })); m.traffic.mockResolvedValue({ kind: 'not-found' });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('confirms an owned permanent repository before provider access, using its stored canonical name', async () => {
 const response = await GET(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ownerId: owner, traffic: { kind: 'not-found' } });
 expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toBe('Cookie');
 expect(select).toHaveBeenCalledWith('id,user_id,repo_full_name,repo_id'); expect(eq.mock.calls).toEqual([['user_id', owner], ['repo_id', 123]]); expect(retry).toHaveBeenCalledWith(false);
 expect(m.traffic).toHaveBeenCalledWith('renamed/repo', 123, { ownerId: owner, signal: expect.any(AbortSignal) });
});
it('checks the full repository name for a legacy project without its permanent id', async () => {
 row.data = { id: other, user_id: owner, repo_full_name: 'owner/repo', repo_id: null };
 expect((await GET(request('repo=owner/repo'))).status).toBe(200); expect(eq).toHaveBeenCalledWith('repo_full_name', 'owner/repo');
});
it.each(['repo=x', 'repo=owner/repo&repo=other/repo', 'repo=owner/repo&repoId=0', 'repo=owner/repo&repoId=9007199254740992', 'repo=owner/repo&repoId=1.5', 'repo=owner/repo&repoId=1&repoId=2', 'repo=owner/repo&teamId=untrusted', 'repo=owner/repo&repoId='])('refuses malformed or duplicated selectors before auth (%s)', async query => {
 expect((await GET(request(query))).status).toBe(400); expect(m.client).not.toHaveBeenCalled(); expect(m.traffic).not.toHaveBeenCalled();
});
it.each([null, other])('refuses a missing or changed captured owner (%s)', async identity => {
 expect((await GET(request(undefined, identity))).status).toBe(403); expect(from).not.toHaveBeenCalled(); expect(m.traffic).not.toHaveBeenCalled();
});
it.each([400, 401, 403, 429, 500, undefined])('does not trust a cached user when auth fails (%s)', async status => {
 auth.error = { status, message: 'PRIVATE TEST auth' }; const response = await GET(request()); expect(response.status).toBe([400,401,403].includes(status ?? 0) ? 401 : 503); expect(await response.text()).not.toContain('PRIVATE'); expect(from).not.toHaveBeenCalled();
});
it('refuses unauthenticated users and malformed successful identity', async () => {
 auth.data.user = null; expect((await GET(request())).status).toBe(401); auth.data.user = { id: 'malformed' }; expect((await GET(request())).status).toBe(503); expect(from).not.toHaveBeenCalled();
});
it('does not query projects without configured analytics or for another deployment owner', async () => {
 m.configured = false; expect(await (await GET(request())).json()).toEqual({ ownerId: owner, traffic: { kind: 'unconfigured' } }); expect(from).not.toHaveBeenCalled();
 m.configured = true; m.allowed = false; expect((await GET(request())).status).toBe(404); expect(from).not.toHaveBeenCalled(); expect(m.traffic).not.toHaveBeenCalled();
});
it.each([null, { id: other, user_id: other, repo_full_name: 'owner/repo', repo_id: 123 }, { id: other, user_id: owner, repo_full_name: 'owner/repo', repo_id: 124 }, { id: other, user_id: owner, repo_full_name: 'owner/repo', repo_id: '123' }])('refuses absent, foreign, stale or malformed project receipts (%j)', async data => {
 row.data = data; expect((await GET(request())).status).toBe(data === null ? 404 : 503); expect(m.traffic).not.toHaveBeenCalled();
});
it('does not treat a database outage as absence or disclose its text', async () => {
 row.error = { message: 'PRIVATE TEST database' }; const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE'); expect(m.traffic).not.toHaveBeenCalled();
});
it('returns unavailable for provider failures and malformed success DTOs', async () => {
 m.traffic.mockResolvedValue({ kind: 'error' }); expect((await GET(request())).status).toBe(503); m.traffic.mockResolvedValue({ kind: 'ok', lifetime: { pageviews: 0, visitors: 0 } }); expect((await GET(request())).status).toBe(503);
});
it('bounds an uncooperative auth operation', async () => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { const stop = new AbortController(); setTimeout(() => stop.abort(), ms); return stop.signal; }); m.client.mockReturnValue(new Promise(() => {})); const pending = GET(request()); await vi.advanceTimersByTimeAsync(10_001); expect((await pending).status).toBe(503); expect(m.traffic).not.toHaveBeenCalled();
});
it('bounds an uncooperative owned read and never starts provider work afterward', async () => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { const stop = new AbortController(); setTimeout(() => stop.abort(), ms); return stop.signal; }); read.mockReturnValue(new Promise(() => {})); const pending = GET(request()); await vi.advanceTimersByTimeAsync(5_001); expect((await pending).status).toBe(503); expect(m.traffic).not.toHaveBeenCalled();
});
it('refuses provider work after an in-flight caller disconnect', async () => {
 const stop = new AbortController(); read.mockImplementation(async () => { stop.abort('PRIVATE TEST reason'); return row; }); expect((await GET(request(undefined, owner, stop.signal))).status).toBe(503); expect(m.traffic).not.toHaveBeenCalled();
});
