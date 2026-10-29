import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), limit: vi.fn(), resolve: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.session }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.limit }));
vi.mock('@/lib/marketing/meta-credentials', () => ({ resolveMetaPublisherConfig: m.resolve }));
import { instagramCommentSubscription } from '@/lib/marketing/dneskai-engagement-ports';
import { POST } from '@/app/api/marketing/accounts/webhook/route';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const account = { id, remoteAccountId: '17841400000000001' };
const settings = { loginMode: 'instagram', apiVersion: 'v24.0', accessToken: 'TEST-ONLY-TOKEN-0000000000', scopes: [], credentialHold: null };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const request = (signal?: AbortSignal) => new Request('https://own.example/api/marketing/accounts/webhook', { method: 'POST', headers: { Origin: 'https://own.example' }, body: JSON.stringify({ accountId: id, action: 'subscribe' }), signal });
beforeEach(() => {
 vi.clearAllMocks(); m.resolve.mockResolvedValue(settings);
 m.session.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) } }); m.limit.mockResolvedValue({ ok: true });
 for (const [key, value] of Object.entries({ MARKETING_OWNER_ID: owner, DNESKAI_ENGAGEMENT_ENABLED: 'true', MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'TEST_ONLY_WEBHOOK_VERIFICATION_VALUE', MARKETING_INSTAGRAM_APP_SECRET: 'TEST_ONLY_APP_SECRET_VALUE' })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('starts no credential or Graph work after original subscription retirement', async () => {
 const caller = new AbortController(); caller.abort('TEST_ONLY_PRIVATE_REASON'); const fetcher = vi.fn(async () => Response.json({ success: true }));
 await expect(instagramCommentSubscription({} as never, owner, account, 'subscribe', {}, fetcher, caller.signal)).rejects.toMatchObject({ code: 'meta-request-uncertain' });
 expect(m.resolve).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it('does not start a Graph mutation after retirement during credential resolution', async () => {
 const pending = deferred<typeof settings>(); m.resolve.mockReturnValue(pending.promise); const caller = new AbortController(), fetcher = vi.fn(async () => Response.json({ success: true }));
 const outcome = instagramCommentSubscription({} as never, owner, account, 'subscribe', {}, fetcher, caller.signal).catch(error => error);
 await vi.waitFor(() => expect(m.resolve).toHaveBeenCalledOnce()); caller.abort(); pending.resolve(settings);
 expect(await outcome).toMatchObject({ code: 'meta-request-uncertain' }); expect(fetcher).not.toHaveBeenCalled();
});
it('bounds provider response bytes before parsing a misleading successful prefix', async () => {
 let pulls = 0; const bytes = new TextEncoder().encode('{"success":true}' + ' '.repeat(1024 * 1024));
 const stream = new ReadableStream({ pull(controller) { const start = pulls++ * 512; if (start < bytes.length) controller.enqueue(bytes.slice(start, start + 512)); else controller.close(); } });
 const fetcher = vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }));
 await expect(instagramCommentSubscription({} as never, owner, account, 'subscribe', {}, fetcher)).rejects.toMatchObject({ code: 'meta-invalid-response' });
 expect(pulls).toBeLessThanOrEqual(34); expect(fetcher).toHaveBeenCalledOnce();
});
it('contains a thrown account read before starting any credential or Graph work', async () => {
 const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.reject(new Error('TEST_ONLY_PRIVATE_DATABASE_DETAIL')) }; m.admin.mockReturnValue({ from: () => chain });
 const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'account-store-failed' }); expect(m.resolve).not.toHaveBeenCalled();
});
it('does not start provider work after original retirement during the account read', async () => {
 const waiting = deferred<unknown>(), chain = { select: () => chain, eq: () => chain, maybeSingle: () => waiting.promise }; m.admin.mockReturnValue({ from: () => chain });
 const fetcher = vi.fn(async () => Response.json({ success: true })); vi.stubGlobal('fetch', fetcher); const caller = new AbortController(), outcome = POST(request(caller.signal));
 await vi.waitFor(() => expect(m.admin).toHaveBeenCalledOnce()); caller.abort(); waiting.resolve({ data: { id, brand: 'dneskai', platform: 'instagram', remote_account_id: account.remoteAccountId }, error: null });
 const response = await outcome; expect(response.status).toBe(503); expect(m.resolve).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it('captures the account selector before waiting for credentials', async () => {
 const pending = deferred<typeof settings>(); m.resolve.mockReturnValue(pending.promise); const selected = { ...account }, fetcher = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
 const outcome = instagramCommentSubscription({} as never, owner, selected, 'subscribe', {}, fetcher);
 selected.remoteAccountId = '999999'; pending.resolve(settings); expect(await outcome).toEqual({ subscribed: true });
 expect(fetcher.mock.calls[0][0]).toContain('/17841400000000001/subscribed_apps');
});
it.each([null, { id: 'not-an-id', remoteAccountId: '123' }, { ...account, remoteAccountId: 'not-numeric' }])('refuses malformed account intent before credentials: %#', async selected => {
 const fetcher = vi.fn(); await expect(instagramCommentSubscription({} as never, owner, selected as never, 'subscribe', {}, fetcher)).rejects.toMatchObject({ code: 'account-unavailable' });
 expect(m.resolve).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it('forwards original cancellation into the actual Graph request', async () => {
 const caller = new AbortController(); let signal!: AbortSignal;
 const fetcher = vi.fn(async (_url, init) => { signal = init!.signal!; return Response.json({ success: true }); }) as unknown as typeof fetch;
 expect(await instagramCommentSubscription({} as never, owner, account, 'subscribe', {}, fetcher, caller.signal)).toEqual({ subscribed: true });
 caller.abort(); expect(signal.aborted).toBe(true);
});
it.each([
 { id: '33333333-3333-4333-8333-333333333333', user_id: owner, brand: 'dneskai', platform: 'instagram', remote_account_id: '123' },
 { id, user_id: '33333333-3333-4333-8333-333333333333', brand: 'dneskai', platform: 'instagram', remote_account_id: '123' },
 { id, user_id: owner, brand: 'dneskai', platform: 'instagram', remote_account_id: 'bad' },
 [], undefined, false, 0,
])('holds a foreign/malformed account read rather than presenting absence or starting Graph: %#', async data => {
 const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data, error: null }) }; m.admin.mockReturnValue({ from: () => chain });
 const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'account-store-failed' }); expect(m.resolve).not.toHaveBeenCalled();
});
it('keeps a positive missing account distinct from an unavailable read', async () => {
 const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) }; m.admin.mockReturnValue({ from: () => chain });
 expect((await POST(request())).status).toBe(404); expect(m.resolve).not.toHaveBeenCalled();
});
