import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createAdminClient } from '@/lib/supabase/admin';

// Offline only: Meta is a mocked fetch and Supabase is a mocked client.
const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), sessionRpc: vi.fn(), sessionFrom: vi.fn(), limit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.sessionRpc, from: mocks.sessionFrom }) }));
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
function admin(result: { data: unknown; error: unknown } = { data: stored, error: null }) {
  const rpc = vi.fn(async () => result);
  return { db: { rpc } as unknown as ReturnType<typeof createAdminClient>, rpc };
}
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
    ['Facebook Login', env({ MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'facebook' }), 'instagram-login-required'],
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
    const filters: Array<[string, unknown]> = [];
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, order: () => query,
      limit: async () => ({ data: [{ id: accountId, user_id: owner, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verified_at: stored.verifiedAt, enabled: false }], error: null }) };
    mocks.sessionFrom.mockReturnValue(query);
    mocks.sessionRpc.mockResolvedValue({ data: [{ account_id: accountId, brand: 'dneskai', platform: 'instagram', expires_at: stored.token.expiresAt, refreshed_at: stored.token.refreshedAt, scopes: stored.token.scopes, login_mode: 'instagram' }], error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accounts: [{ id: accountId, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verifiedAt: stored.verifiedAt, enabled: false, token: stored.token }] });
    expect(filters).toContainEqual(['user_id', owner]);
    expect(mocks.sessionRpc).toHaveBeenCalledWith('marketing_account_token_status');
    mocks.sessionRpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect((await GET()).status).toBe(503);
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET()).status).toBe(401);
  });
});
