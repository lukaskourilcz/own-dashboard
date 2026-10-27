import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createAdminClient } from '@/lib/supabase/admin';

// Offline only: Meta is a mocked fetch and Supabase is a mocked client.
const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), sessionRpc: vi.fn(), sessionFrom: vi.fn(), limit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, rpc: (...args: unknown[]) => {const query={retry:()=>query,abortSignal:()=>query,then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>mocks.sessionRpc(...args).then(resolve,reject)};return query;}, from: mocks.sessionFrom }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.admin() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.limit }));
import { verifyInstagramAccount } from '@/lib/marketing/meta-account';
import { POST } from '@/app/api/marketing/accounts/verify/route';
import { GET } from '@/app/api/marketing/accounts/route';

const owner = '11111111-1111-4111-8111-111111111111';
const accountId = '44444444-4444-4444-8444-444444444444';
const token = 'TEST-ONLY-BOOTSTRAP-TOKEN-0001';
const now = new Date('2026-10-20T12:00:00Z');
const env = (patch: Record<string, string | undefined> = {}) => ({ MARKETING_OWNER_ID: owner, MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: token,
  MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'instagram', MARKETING_DNESKAI_INSTAGRAM_API_VERSION: 'v99.0', MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: '2026-12-10T00:00:00Z',
  MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: 'instagram_business_basic,instagram_business_content_publish', ...patch });
const stored = { accountId, remoteAccountId: '17841400000000001', handle: 'dneskai', verifiedAt: '2026-10-20T12:00:00.123456+00:00', enabled: false, tokenStored: true,
  token: { expiresAt: '2026-12-10T00:00:00+00:00', refreshedAt: '2026-10-20T12:00:00.123456+00:00', scopes: ['instagram_business_basic', 'instagram_business_content_publish'], loginMode: 'instagram' } };
type StoredToken = { access_token: string; expires_at: string; refreshed_at: string; scopes: string[]; login_mode: string };
/** `store` is the existing account row and its stored token; by default nothing has been verified yet. */
function admin(result: { data: unknown; error: unknown } = { data: stored, error: null }, store: { token?: StoredToken | null; readError?: boolean; lookupError?: boolean } = {}) {
  const rpc = vi.fn(async (name: string) => name !== 'marketing_read_account_token' ? result
    : store.readError ? { data: null, error: { message: 'TEST-ONLY database detail' } } : { data: store.token ? [store.token] : [], error: null });
  const filters: Array<[string, unknown]> = [];
  const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    maybeSingle: async () => ({ data: store.token !== undefined || store.readError ? { id: accountId } : null, error: store.lookupError ? { message: 'TEST-ONLY database detail' } : null }) };
  const from = vi.fn(() => query);
  return { db: { rpc, from } as unknown as ReturnType<typeof createAdminClient>, rpc, from, filters };
}
const storedToken = (patch: Partial<StoredToken> = {}): StoredToken => ({ access_token: 'TEST-ONLY-REFRESHED-TOKEN-0002', expires_at: '2027-01-15T00:00:00+00:00', refreshed_at: '2026-11-16T00:00:00+00:00',
  scopes: ['instagram_business_basic', 'instagram_business_content_publish'], login_mode: 'instagram', ...patch });
const bearer = (fetcher: ReturnType<typeof fetcherFor>) => ((fetcher.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).Authorization;
const profile = (patch: Record<string, unknown> = {}) => Response.json({ id: '1234567', user_id: '17841400000000001', username: 'dneskai', account_type: 'BUSINESS', ...patch });
const fetcherFor = (response: Response | (() => never)) => vi.fn(async () => typeof response === 'function' ? response() : response) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('verifyInstagramAccount', () => {
  it('reads /me through Instagram Login and stores the professional ID, handle and token as one disabled account', async () => {
    const { db, rpc } = admin(); const fetcher = fetcherFor(profile());
    const verified = await verifyInstagramAccount(db, owner, 'dneskai', { env: env(), fetcher, now });
    expect(verified).toEqual({ accountId, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', accountType: 'BUSINESS', verifiedAt: stored.verifiedAt, enabled: false, tokenStored: true, token: stored.token });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.instagram.com/v99.0/me?fields=user_id%2Cusername%2Caccount_type');
    expect(url).not.toContain(token);
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` } });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('marketing_verify_account', { p_owner: owner, p_brand: 'dneskai', p_platform: 'instagram', p_remote_account_id: '17841400000000001',
      p_handle: 'dneskai', p_token: token, p_expires_at: '2026-12-10T00:00:00.000Z', p_scopes: ['instagram_business_basic', 'instagram_business_content_publish'], p_login_mode: 'instagram' });
    expect(JSON.stringify(verified)).not.toContain(token);
  });
  it('accepts a creator account and an owner-configured handle', async () => {
    const { db } = admin({ data: { ...stored, handle: 'dneskai.cz' }, error: null });
    expect(await verifyInstagramAccount(db, owner, 'dneskai', { env: env({ MARKETING_DNESKAI_INSTAGRAM_HANDLE: '@DneskAI.cz' }), now, fetcher: fetcherFor(profile({ username: 'dneskai.cz', account_type: 'MEDIA_CREATOR' })) })).toMatchObject({ accountType: 'MEDIA_CREATOR', handle: 'dneskai.cz' });
  });
  it.each([
    ['a different owner', env({ MARKETING_OWNER_ID: '22222222-2222-4222-8222-222222222222' }), 'marketing-owner-required'],
    // #166: Facebook Login is a second mode; it needs its own scopes, and an unknown mode is still refused.
    ['Facebook Login without its scopes', env({ MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'facebook' }), 'publishing-scopes-unverified'],
    ['an unknown login mode', env({ MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'basic-display' }), 'instagram-login-required'],
    ['no API version', env({ MARKETING_DNESKAI_INSTAGRAM_API_VERSION: 'latest' }), 'api-version-unverified'],
    ['no token', env({ MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: undefined }), 'access-token-missing'],
    ['no token expiry', env({ MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: undefined }), 'access-token-expiry-unverified'],
    ['an expired token', env({ MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: '2026-10-20T11:59:59Z' }), 'access-token-expired'],
    ['a missing publishing scope', env({ MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: 'instagram_business_basic' }), 'publishing-scopes-unverified'],
    ['more scopes than the store accepts', env({ MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: ['instagram_business_basic', 'instagram_business_content_publish', ...Array.from({ length: 19 }, (_, index) => `scope_${String.fromCharCode(97 + index)}`)].join(',') }), 'verified-scopes-invalid'],
  ] as const)('refuses %s before calling Meta', async (_label, configured, code) => {
    const { db, rpc } = admin(); const fetcher = fetcherFor(profile());
    await expect(verifyInstagramAccount(db, owner, 'dneskai', { env: configured, fetcher, now })).rejects.toMatchObject({ code });
    expect(fetcher).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['a personal account', profile({ account_type: 'PERSONAL' }), 'professional-account-required'],
    ['another account', profile({ username: 'someone_else' }), 'remote-account-handle-mismatch'],
    ['a rejected token', new Response('{"error":{"message":"TEST-ONLY provider text"}}', { status: 400 }), 'meta-http-400'],
    ['a response without the professional ID', Response.json({ id: '1234567', username: 'dneskai', account_type: 'BUSINESS' }), 'meta-invalid-response'],
    ['a network failure', () => { throw new TypeError('offline'); }, 'meta-request-failed'],
  ] as const)('records nothing for %s and calls Meta once', async (_label, response, code) => {
    const { db, rpc } = admin(); const fetcher = fetcherFor(response as Response | (() => never));
    await expect(verifyInstagramAccount(db, owner, 'dneskai', { env: env(), fetcher, now })).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(rpc).not.toHaveBeenCalled();
  });
  it('verifies with a refreshed stored token once the environment token has expired', async () => {
    const later = new Date('2026-12-20T12:00:00Z');
    const { db, rpc, filters } = admin(undefined, { token: storedToken() }); const fetcher = fetcherFor(profile());
    await verifyInstagramAccount(db, owner, 'dneskai', { env: env(), fetcher, now: later });
    expect(bearer(fetcher)).toBe('Bearer TEST-ONLY-REFRESHED-TOKEN-0002');
    expect(filters).toEqual([['user_id', owner], ['brand', 'dneskai'], ['platform', 'instagram']]);
    expect(rpc).toHaveBeenCalledWith('marketing_read_account_token', { p_owner: owner, p_account: accountId });
    expect(rpc).toHaveBeenLastCalledWith('marketing_verify_account', expect.objectContaining({ p_token: 'TEST-ONLY-REFRESHED-TOKEN-0002', p_expires_at: '2027-01-15T00:00:00.000Z' }));
    const missing = fetcherFor(profile());
    await verifyInstagramAccount(admin(undefined, { token: storedToken() }).db, owner, 'dneskai', { env: env({ MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: undefined }), fetcher: missing, now });
    expect(bearer(missing)).toBe('Bearer TEST-ONLY-REFRESHED-TOKEN-0002');
  });
  it('uses whichever valid token expires later, so a newly installed environment token is verified and stored', async () => {
    const newer = fetcherFor(profile()); const older = admin(undefined, { token: storedToken({ expires_at: '2026-11-01T00:00:00+00:00' }) });
    await verifyInstagramAccount(older.db, owner, 'dneskai', { env: env(), fetcher: newer, now });
    expect(bearer(newer)).toBe(`Bearer ${token}`);
    expect(older.rpc).toHaveBeenLastCalledWith('marketing_verify_account', expect.objectContaining({ p_token: token, p_expires_at: '2026-12-10T00:00:00.000Z' }));
    const refreshed = fetcherFor(profile());
    await verifyInstagramAccount(admin(undefined, { token: storedToken() }).db, owner, 'dneskai', { env: env(), fetcher: refreshed, now });
    expect(bearer(refreshed)).toBe('Bearer TEST-ONLY-REFRESHED-TOKEN-0002');
  });
  it.each([
    ['an expired stored token and no environment token', { token: storedToken({ expires_at: '2026-10-01T00:00:00+00:00' }) }, { MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: undefined }, 'access-token-expired', 409],
    ['an unreadable token store', { readError: true }, {}, 'credential-store-unavailable', 503],
    ['an unreadable account row', { lookupError: true }, {}, 'credential-store-unavailable', 503],
  ] as const)('refuses %s before calling Meta', async (_label, store, patch, code, status) => {
    const { db, rpc } = admin(undefined, store); const fetcher = fetcherFor(profile());
    await expect(verifyInstagramAccount(db, owner, 'dneskai', { env: env(patch), fetcher, now })).rejects.toMatchObject({ code, status });
    expect(fetcher).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain('marketing_verify_account');
  });
  it('reports a failed store without leaking the database error', async () => {
    const { db } = admin({ data: null, error: { message: 'TEST-ONLY database detail' } });
    await expect(verifyInstagramAccount(db, owner, 'dneskai', { env: env(), fetcher: fetcherFor(profile()), now })).rejects.toMatchObject({ code: 'account-store-failed', status: 503 });
  });
});

describe('owner account routes', () => {
  const post = (body: unknown, origin = 'https://own.example') => new Request('https://own.example/api/marketing/accounts/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries(env({ MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: '2099-01-01T00:00:00Z' }))) vi.stubEnv(key, value);
    mocks.user.mockResolvedValue({ data: { user: { id: owner } } });
    mocks.limit.mockResolvedValue({ ok: true, retryAfter: 0 });
    mocks.admin.mockReturnValue(admin().db);
    vi.stubGlobal('fetch', fetcherFor(profile()));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it('verifies for the configured owner and returns only non-secret metadata', async () => {
    const response = await POST(post({ brand: 'dneskai', platform: 'instagram' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toEqual({ accountType: 'BUSINESS', tokenStored: true, account: { id: accountId, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verifiedAt: stored.verifiedAt, enabled: false, token: stored.token } });
    expect(JSON.stringify(body)).not.toContain(token);
    expect(mocks.limit).toHaveBeenCalledWith(owner, { key: 'marketing-account-verify', limit: 5, windowSec: 600 });
  });
  it('refuses anonymous, cross-origin, rate-limited, non-owner and malformed requests before Meta', async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(post({ brand: 'dneskai', platform: 'instagram' }))).status).toBe(401);
    expect((await POST(post({ brand: 'dneskai', platform: 'instagram' }, 'https://evil.example'))).status).toBe(403);
    mocks.limit.mockResolvedValueOnce({ ok: false, retryAfter: 42 });
    const limited = await POST(post({ brand: 'dneskai', platform: 'instagram' }));
    expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('42');
    mocks.user.mockResolvedValueOnce({ data: { user: { id: '22222222-2222-4222-8222-222222222222' } } });
    expect(await (await POST(post({ brand: 'dneskai', platform: 'instagram' }))).json()).toEqual({ error: 'marketing-owner-required' });
    for (const body of [{ brand: 'devshark', platform: 'instagram' }, { brand: 'dneskai', platform: 'threads' }, { brand: 'dneskai', platform: 'instagram', ownerId: owner }]) expect((await POST(post(body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('maps verification failures to codes and hides unexpected errors', async () => {
    vi.stubGlobal('fetch', fetcherFor(profile({ account_type: 'PERSONAL' })));
    const refused = await POST(post({ brand: 'dneskai', platform: 'instagram' }));
    expect(refused.status).toBe(409); expect(await refused.json()).toEqual({ error: 'professional-account-required' });
    mocks.admin.mockImplementation(() => { throw new Error('TEST-ONLY service role detail'); });
    vi.stubGlobal('fetch', fetcherFor(profile()));
    const failed = await POST(post({ brand: 'dneskai', platform: 'instagram' }));
    expect(failed.status).toBe(503); expect(await failed.json()).toEqual({ error: 'account-verification-unavailable' });
  });
  it('lists own accounts with token metadata through the session client', async () => {
    mocks.sessionRpc.mockResolvedValue({ data: {ownerId:owner,accounts:[{id:accountId,user_id:owner,brand:'dneskai',platform:'instagram',handle:'dneskai',verified_at:stored.verifiedAt,enabled:false}],tokens:[{account_id:accountId,brand:'dneskai',platform:'instagram',expires_at:stored.token.expiresAt,refreshed_at:stored.token.refreshedAt,scopes:stored.token.scopes,login_mode:'instagram'}]}, error: null });
    const response = await GET(new Request("https://own.example/api/marketing/accounts"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accounts: [{ id: accountId, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verifiedAt: stored.verifiedAt, enabled: false, token: stored.token }] });
    expect(mocks.sessionFrom).not.toHaveBeenCalled();
    expect(mocks.sessionRpc).toHaveBeenCalledWith('read_owned_marketing_accounts',{p_owner:owner});
    mocks.sessionRpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect((await GET(new Request("https://own.example/api/marketing/accounts"))).status).toBe(503);
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET(new Request("https://own.example/api/marketing/accounts"))).status).toBe(401);
  });
});

describe('verifyInstagramAccount with Facebook Login (#166)', () => {
  const fbEnv = (patch: Record<string, string | undefined> = {}) => env({ MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'facebook',
    MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: 'instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list', ...patch });
  const fbStored = { ...stored, token: { ...stored.token, scopes: ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_show_list'], loginMode: 'facebook' } };
  const page = (username = 'dneskai') => ({ id: '1010', name: 'DNESKAi', instagram_business_account: { id: '17841400000000001', username } });

  it('finds the Page linked to @dneskai through /me/accounts and stores the Instagram id in facebook mode', async () => {
    const { db, rpc } = admin({ data: fbStored, error: null });
    const fetcher = fetcherFor(Response.json({ data: [{ id: '2020', name: 'Other page' }, page()] }));
    const verified = await verifyInstagramAccount(db, owner, 'dneskai', { env: fbEnv(), fetcher, now });
    expect(verified).toMatchObject({ handle: 'dneskai', accountType: 'PAGE_LINKED', page: { id: '1010', name: 'DNESKAi' }, token: { loginMode: 'facebook' } });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v99.0/me/accounts?fields=id%2Cname%2Cinstagram_business_account%7Bid%2Cusername%7D&limit=25');
    expect(url).not.toContain(token);
    expect(init).toMatchObject({ headers: { Authorization: `Bearer ${token}` } });
    expect(rpc).toHaveBeenCalledWith('marketing_verify_account', expect.objectContaining({ p_remote_account_id: '17841400000000001', p_handle: 'dneskai', p_login_mode: 'facebook' }));
  });

  it('reads the Page itself when the token is a Page token', async () => {
    const { db } = admin({ data: fbStored, error: null });
    const fetcher = vi.fn(async (url: string) => url.includes('/me/accounts') ? new Response('{}', { status: 400 }) : Response.json(page())) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    expect(await verifyInstagramAccount(db, owner, 'dneskai', { env: fbEnv(), fetcher, now })).toMatchObject({ page: { id: '1010' } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no Page linked to Instagram', { data: [{ id: '2020', name: 'Other page' }] }, 'facebook-page-link-required'],
    ['a Page linked to another account', { data: [page('someone.else')] }, 'remote-account-handle-mismatch'],
  ] as const)('refuses %s and stores nothing', async (_label, body, code) => {
    const { db, rpc } = admin({ data: fbStored, error: null });
    await expect(verifyInstagramAccount(db, owner, 'dneskai', { env: fbEnv(), fetcher: fetcherFor(Response.json(body)), now })).rejects.toMatchObject({ code });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain('marketing_verify_account');
  });
});
