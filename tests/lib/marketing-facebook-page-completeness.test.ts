import { expect, it, vi } from 'vitest';
import { resolveFacebookPage } from '@/lib/marketing/meta-facebook-page';
import { verifyInstagramAccount } from '@/lib/marketing/meta-account';
vi.mock('server-only', () => ({}));
const remote = '17841400000000001', owner = '11111111-1111-4111-8111-111111111111', token = 'TEST-ONLY-USER-TOKEN-00000001', pageToken = 'TEST-ONLY-PAGE-TOKEN-00000001';
const settings = { loginMode: 'facebook' as const, apiVersion: 'v24.0', accessToken: token };
const linked = (id = '1010') => ({ id, name: 'DNESKAi fixture Page', access_token: pageToken, instagram_business_account: { id: remote, username: 'dneskai' } });
const next = (after: string) => ({ next: `https://graph.facebook.com/v24.0/123/accounts?after=${after}`, cursors: { after } });
it('finds the linked Page after a valid empty first page with continuation', async () => {
 const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [], paging: next('cursorA') })).mockResolvedValueOnce(Response.json({ data: [linked()] }));
 expect(await resolveFacebookPage(settings, remote, { fetcher })).toEqual({ pageId: '1010', pageToken }); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('refuses multiple linked Pages instead of selecting the first candidate', async () => {
 const fetcher = vi.fn(async () => Response.json({ data: [linked(), linked('2020')] }));
 await expect(resolveFacebookPage(settings, remote, { fetcher })).rejects.toMatchObject({ code: 'meta-invalid-response' });
});
it('does not mask a failed Page list with a fallback success', async () => {
 const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: 2 } }, { status: 500 })).mockResolvedValueOnce(Response.json(linked()));
 await expect(resolveFacebookPage(settings, remote, { fetcher })).rejects.toMatchObject({ code: 'meta-http-500' }); expect(fetcher).toHaveBeenCalledOnce();
});
it('verification finds the configured handle beyond the first Page response', async () => {
 const scopes = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_show_list'];
 const env = { MARKETING_OWNER_ID: owner, MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: token, MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: '2099-01-01T00:00:00Z', MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: scopes.join(','), MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'facebook', MARKETING_DNESKAI_INSTAGRAM_API_VERSION: 'v24.0' };
 const lookup = { select: () => lookup, eq: () => lookup, retry: () => lookup, abortSignal: () => lookup, maybeSingle: async () => ({ data: null, error: null }) };
 const stored = { accountId: '22222222-2222-4222-8222-222222222222', remoteAccountId: remote, handle: 'dneskai', verifiedAt: '2026-10-27T10:00:00Z', enabled: false, tokenStored: true, token: { expiresAt: '2099-01-01T00:00:00Z', refreshedAt: '2026-10-27T10:00:00Z', scopes, loginMode: 'facebook' } };
 const write = { retry: () => write, abortSignal: () => write, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: {kind:'verified',ownerId:owner,expectedId:null,expectedVersion:null,id:stored.accountId,updatedAt:'2026-10-27T10:00:00.000001Z',result:stored}, error: null }).then(resolve) }, db = { from: () => lookup, rpc: vi.fn(() => write) };
 const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [], paging: next('cursorA') })).mockResolvedValueOnce(Response.json({ data: [linked()] }));
 expect(await verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher })).toMatchObject({ handle: 'dneskai', page: { id: '1010', name: 'DNESKAi fixture Page' } }); expect(fetcher).toHaveBeenCalledTimes(2); expect(db.rpc).toHaveBeenCalledOnce();
});
it('does not mask a later Page-list refusal with Page-token fallback', async () => {
 const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [], paging: next('cursorA') })).mockResolvedValueOnce(Response.json({ error: { code: 100 } }, { status: 400 })).mockResolvedValueOnce(Response.json(linked()));
 await expect(resolveFacebookPage(settings, remote, { fetcher })).rejects.toMatchObject({ code: 'meta-http-400' }); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('refuses duplicate matching identities across pages after reading the continuation', async () => {
 const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [linked()], paging: next('cursorA') })).mockResolvedValueOnce(Response.json({ data: [linked('2020')] }));
 await expect(resolveFacebookPage(settings, remote, { fetcher })).rejects.toMatchObject({ code: 'meta-invalid-response' }); expect(fetcher).toHaveBeenCalledTimes(2);
});
