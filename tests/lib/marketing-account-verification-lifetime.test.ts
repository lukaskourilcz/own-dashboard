import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { verifyInstagramAccount } from '@/lib/marketing/meta-account';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', remote = '17841400000000001';
const scopes = ['instagram_business_basic', 'instagram_business_content_publish'];
const env = { MARKETING_OWNER_ID: owner, MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: 'TEST-ONLY-BOOTSTRAP-TOKEN-000001', MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: '2099-01-01T00:00:00Z', MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: scopes.join(','), MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'instagram', MARKETING_DNESKAI_INSTAGRAM_API_VERSION: 'v24.0' };
const profile = { user_id: remote, username: 'dneskai', account_type: 'BUSINESS' };
const stored = () => ({ accountId: id, remoteAccountId: remote, handle: 'dneskai', verifiedAt: '2026-10-27T10:00:00.123456Z', enabled: false, tokenStored: true, token: { expiresAt: '2099-01-01T00:00:00Z', refreshedAt: '2026-10-27T10:00:00.123456Z', scopes, loginMode: 'instagram' } });
const read = vi.fn(), rpc = vi.fn();
const chain = { select: () => chain, eq: () => chain, abortSignal: () => chain, retry: () => chain, maybeSingle: read };
const db = { from: vi.fn(() => chain), rpc: (...args: unknown[]) => { const query = { abortSignal: () => query, retry: () => query, then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => rpc(...args).then(resolve, reject) }; return query; } };
beforeEach(() => { vi.clearAllMocks(); read.mockResolvedValue({ data: null, error: null }); rpc.mockResolvedValue({ data: stored(), error: null }); });
it('starts no account/provider/store work for original retired verification intent', async () => {
 const caller = new AbortController(); caller.abort('TEST_ONLY_PRIVATE_REASON'); const fetcher = vi.fn(async () => Response.json(profile));
 await expect(verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher, signal: caller.signal })).rejects.toMatchObject({ code: 'meta-request-failed' });
 expect(read).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
it('cannot write after cancellation while the provider resolves', async () => {
 const caller = new AbortController(), fetcher = vi.fn(async () => { caller.abort(); return Response.json(profile); });
 await expect(verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher, signal: caller.signal })).rejects.toMatchObject({ code: 'meta-request-failed' }); expect(rpc).not.toHaveBeenCalled();
});
it('refuses an oversized provider response before recording verification', async () => {
 const fetcher = vi.fn(async () => new Response(JSON.stringify(profile) + ' '.repeat(1024 * 1024), { headers: { 'Content-Type': 'application/json' } }));
 await expect(verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher })).rejects.toMatchObject({ code: 'meta-invalid-response' }); expect(rpc).not.toHaveBeenCalled();
});
it('refuses a store receipt for a different remote identity', async () => {
 rpc.mockResolvedValue({ data: { ...stored(), remoteAccountId: '999999999', handle: 'another_handle' }, error: null });
 await expect(verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher: async () => Response.json(profile) })).rejects.toMatchObject({ code: 'account-store-failed' });
});
it('refuses a store receipt with nonfinite token metadata', async () => {
 rpc.mockResolvedValue({ data: { ...stored(), token: { ...stored().token, expiresAt: 'infinity' } }, error: null });
 await expect(verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher: async () => Response.json(profile) })).rejects.toMatchObject({ code: 'account-store-failed' });
});
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
it('returns one positive bounded secret-free verification without automatically retrying', async () => {
 const fetcher = vi.fn(async () => Response.json(profile)), result = await verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher });
 expect(result).toMatchObject({ accountId: id, handle: 'dneskai', tokenStored: true, token: stored().token }); expect(fetcher).toHaveBeenCalledOnce(); expect(rpc).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain('TEST-ONLY');
});
it.each([undefined, false, 0, [], {}, { id: 'not-a-uuid' }])('does not treat a malformed account lookup as no stored token: %#', async data => {
 read.mockResolvedValue({ data, error: null }); const fetcher = vi.fn(async () => Response.json(profile));
 await expect(verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher })).rejects.toMatchObject({ code: 'credential-store-unavailable' }); expect(fetcher).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
it('stops after a held account lookup is retired, even if it later resolves', async () => {
 const waiting = deferred<unknown>(); read.mockReturnValue(waiting.promise); const caller = new AbortController(), fetcher = vi.fn(async () => Response.json(profile));
 const outcome = verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher, signal: caller.signal }).catch(error => error);
 await vi.waitFor(() => expect(read).toHaveBeenCalledOnce()); caller.abort(); expect(await outcome).toMatchObject({ code: 'credential-store-unavailable' }); waiting.resolve({ data: null, error: null }); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
it('holds a retired original write without claiming or repeating its late success', async () => {
 const waiting = deferred<unknown>(); rpc.mockReturnValue(waiting.promise); const caller = new AbortController(), fetcher = vi.fn(async () => Response.json(profile));
 const outcome = verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher, signal: caller.signal }).catch(error => error);
 await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce()); caller.abort('TEST_ONLY_PRIVATE_REASON'); expect(await outcome).toMatchObject({ code: 'account-store-failed' }); waiting.resolve({ data: stored(), error: null }); await Promise.resolve(); expect(rpc).toHaveBeenCalledOnce();
});
it('captures the configured handle before awaiting the account lookup', async () => {
 const waiting = deferred<unknown>(), configuration = { ...env, MARKETING_DNESKAI_INSTAGRAM_HANDLE: 'dneskai' }; read.mockReturnValue(waiting.promise);
 const outcome = verifyInstagramAccount(db as never, owner, 'dneskai', { env: configuration, fetcher: async () => Response.json(profile) }); configuration.MARKETING_DNESKAI_INSTAGRAM_HANDLE = 'replacement'; waiting.resolve({ data: null, error: null });
 expect(await outcome).toMatchObject({ handle: 'dneskai' });
});
it('refuses duplicated declared permissions before calling the provider or store', async () => {
 const fetcher = vi.fn(async () => Response.json(profile));
 await expect(verifyInstagramAccount(db as never, owner, 'dneskai', { env: { ...env, MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: [...scopes, scopes[0]].join(',') }, fetcher })).rejects.toMatchObject({ code: 'verified-scopes-invalid' }); expect(fetcher).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
it.each([
 { ...stored(), verifiedAt: 'invalid' }, { ...stored(), extra: true },
 { ...stored(), token: { ...stored().token, scopes: [...scopes, scopes[0]] } },
 { ...stored(), token: { ...stored().token, refreshedAt: 'infinity' } },
 { ...stored(), token: { ...stored().token, loginMode: 'facebook' } },
])('contains malformed or unrelated store receipts: %#', async data => {
 rpc.mockResolvedValue({ data, error: null });
 await expect(verifyInstagramAccount(db as never, owner, 'dneskai', { env, fetcher: async () => Response.json(profile) })).rejects.toMatchObject({ code: 'account-store-failed' }); expect(rpc).toHaveBeenCalledOnce();
});
