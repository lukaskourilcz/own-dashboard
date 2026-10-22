import { describe, expect, it, vi } from 'vitest';
import type { createAdminClient } from '@/lib/supabase/admin';
import { bootstrapMetaCredential, chooseMetaCredential, instagramTokenRefreshDue, listMetaTokenMetadata, refreshInstagramToken, resolveMetaPublisherConfig, type StoredMetaToken } from '@/lib/marketing/meta-credentials';
vi.mock('server-only', () => ({}));

// Offline only: the store is a mocked RPC client and Meta is a mocked fetch.
const now = new Date('2026-10-20T12:00:00Z');
const owner = '11111111-1111-4111-8111-111111111111';
const account = { id: '44444444-4444-4444-8444-444444444444', user_id: owner, brand: 'dneskai' as const, platform: 'instagram' as const };
const day = 86_400_000;
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();
const stored = (patch: Partial<StoredMetaToken> = {}): StoredMetaToken => ({ accessToken: 'TEST-ONLY-STORED-TOKEN-000001', expiresAt: at(5 * day), refreshedAt: at(-55 * day),
  scopes: ['instagram_business_basic', 'instagram_business_content_publish'], loginMode: 'instagram', ...patch });
const env = (patch: Record<string, string | undefined> = {}) => ({ MARKETING_PUBLISH_ENABLED: 'true', MARKETING_DNESKAI_PUBLISH_ENABLED: 'false',
  MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: 'TEST-ONLY-BOOTSTRAP-TOKEN-0001', MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: at(50 * day),
  MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'instagram', MARKETING_DNESKAI_INSTAGRAM_API_VERSION: 'v99.0', MARKETING_DNESKAI_INSTAGRAM_API_VERSION_VERIFIED_AT: at(-day),
  MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: 'instagram_business_basic, instagram_business_content_publish', MARKETING_APPROVED_ASSET_HOSTS: 'storage.example.invalid', ...patch });
const row = (token: StoredMetaToken) => ({ access_token: token.accessToken, expires_at: token.expiresAt, refreshed_at: token.refreshedAt, scopes: token.scopes, login_mode: token.loginMode });
function database(token: StoredMetaToken | null, options: { readError?: boolean; storeError?: boolean } = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'marketing_read_account_token') return options.readError ? { data: null, error: { message: 'down' } } : { data: token ? [row(token)] : [], error: null };
    if (name === 'marketing_store_account_token') return options.storeError ? { data: null, error: { message: 'token changed' } }
      : { data: { accountId: args.p_account, token: { expiresAt: args.p_expires_at, refreshedAt: now.toISOString(), scopes: args.p_scopes, loginMode: args.p_login_mode } }, error: null };
    if (name === 'marketing_account_token_metadata') return { data: [{ account_id: account.id, brand: 'dneskai', platform: 'instagram', expires_at: at(5 * day), refreshed_at: at(-55 * day), scopes: ['instagram_business_basic'], login_mode: 'instagram' }], error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
  return { db: { rpc } as unknown as ReturnType<typeof createAdminClient>, rpc };
}

describe('Meta token resolution', () => {
  it('prefers an unexpired stored token, then the environment bootstrap, and holds with a precise code', () => {
    const bootstrap = bootstrapMetaCredential('dneskai', 'instagram', env());
    expect(bootstrap.scopes).toEqual(['instagram_business_basic', 'instagram_business_content_publish']);
    expect(chooseMetaCredential(stored(), bootstrap, now)).toMatchObject({ source: 'database', accessToken: 'TEST-ONLY-STORED-TOKEN-000001' });
    expect(chooseMetaCredential(stored({ expiresAt: at(-1) }), bootstrap, now)).toMatchObject({ source: 'environment', accessToken: 'TEST-ONLY-BOOTSTRAP-TOKEN-0001' });
    expect(chooseMetaCredential(null, bootstrap, now)).toMatchObject({ source: 'environment' });
    const expiredEnv = bootstrapMetaCredential('dneskai', 'instagram', env({ MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: at(-day) }));
    expect(chooseMetaCredential(stored({ expiresAt: at(-1) }), expiredEnv, now)).toEqual({ hold: 'access-token-expired' });
    expect(chooseMetaCredential(null, expiredEnv, now)).toEqual({ hold: 'access-token-expired' });
    expect(chooseMetaCredential(null, bootstrapMetaCredential('dneskai', 'instagram', env({ MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: undefined })), now)).toEqual({ hold: 'access-token-missing' });
    expect(chooseMetaCredential(null, bootstrapMetaCredential('dneskai', 'instagram', env({ MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: undefined })), now)).toEqual({ hold: 'access-token-expiry-unverified' });
    expect(chooseMetaCredential(null, bootstrapMetaCredential('dneskai', 'instagram', env({ MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: undefined })), now)).toEqual({ hold: 'meta-login-mode-required' });
  });
  it('builds the publisher configuration from the stored token without the environment token', async () => {
    const { db, rpc } = database(stored());
    const config = await resolveMetaPublisherConfig(db, owner, account, env(), now);
    expect(config).toMatchObject({ accessToken: 'TEST-ONLY-STORED-TOKEN-000001', tokenExpiresAt: at(5 * day), loginMode: 'instagram', credentialSource: 'database', apiVersion: 'v99.0', enabled: false, approvedAssetHosts: ['storage.example.invalid'] });
    expect(config.credentialHold).toBeUndefined();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('marketing_read_account_token', { p_owner: owner, p_account: account.id });
  });
  it('holds without any token when the store fails, the token expired or the account is foreign', async () => {
    const failed = await resolveMetaPublisherConfig(database(stored(), { readError: true }).db, owner, account, env(), now);
    expect(failed).toMatchObject({ accessToken: '', tokenExpiresAt: '', scopes: [], credentialHold: 'credential-store-unavailable' });
    const expired = await resolveMetaPublisherConfig(database(stored({ expiresAt: at(-1) })).db, owner, account, env({ MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: undefined }), now);
    expect(expired).toMatchObject({ accessToken: '', credentialHold: 'access-token-expired' });
    const foreign = database(stored());
    expect(await resolveMetaPublisherConfig(foreign.db, owner, { ...account, user_id: '22222222-2222-4222-8222-222222222222' }, env(), now)).toMatchObject({ credentialHold: 'credential-owner-mismatch', accessToken: '' });
    expect(foreign.rpc).not.toHaveBeenCalled();
  });
  it('flags only old-enough Instagram Login tokens with fewer than ten days left', async () => {
    expect(instagramTokenRefreshDue({ expiresAt: at(9 * day), refreshedAt: at(-2 * day), loginMode: 'instagram' }, now)).toBe(true);
    expect(instagramTokenRefreshDue({ expiresAt: at(11 * day), refreshedAt: at(-2 * day), loginMode: 'instagram' }, now)).toBe(false);
    expect(instagramTokenRefreshDue({ expiresAt: at(9 * day), refreshedAt: at(-23 * 3_600_000), loginMode: 'instagram' }, now)).toBe(false);
    expect(instagramTokenRefreshDue({ expiresAt: at(-1), refreshedAt: at(-2 * day), loginMode: 'instagram' }, now)).toBe(false);
    // #166: a Facebook Login token is renewed by the same window; Threads is not.
    expect(instagramTokenRefreshDue({ expiresAt: at(9 * day), refreshedAt: at(-2 * day), loginMode: 'facebook' }, now)).toBe(true);
    expect(instagramTokenRefreshDue({ expiresAt: at(9 * day), refreshedAt: at(-2 * day), loginMode: 'threads' }, now)).toBe(false);
    expect(await listMetaTokenMetadata(database(null).db, owner)).toEqual([{ accountId: account.id, brand: 'dneskai', platform: 'instagram', expiresAt: at(5 * day), refreshedAt: at(-55 * day), scopes: ['instagram_business_basic'], loginMode: 'instagram' }]);
  });
});

describe('refreshInstagramToken', () => {
  const meta = (response: Response | (() => never)) => vi.fn(async () => typeof response === 'function' ? response() : response) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  it('exchanges an old, unexpired token once and stores it with a compare-and-set', async () => {
    const current = stored(); const { db, rpc } = database(current);
    const fetcher = meta(Response.json({ access_token: 'TEST-ONLY-REFRESHED-TOKEN-0002', token_type: 'bearer', expires_in: 5_184_000 }));
    const outcome = await refreshInstagramToken(db, owner, account, { env: env(), now, fetcher });
    expect(outcome).toEqual({ status: 'refreshed', accountId: account.id, expiresAt: at(60 * day), refreshedAt: now.toISOString() });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://graph.instagram.com/refresh_access_token');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ grant_type: 'ig_refresh_token', access_token: current.accessToken });
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(rpc).toHaveBeenLastCalledWith('marketing_store_account_token', { p_owner: owner, p_account: account.id, p_expected_refreshed_at: current.refreshedAt,
      p_token: 'TEST-ONLY-REFRESHED-TOKEN-0002', p_expires_at: at(60 * day), p_scopes: current.scopes, p_login_mode: 'instagram' });
    expect(JSON.stringify(outcome)).not.toContain('TEST-ONLY');
  });
  it('refreshes the environment bootstrap when nothing is stored yet, estimating its age from the 60-day lifetime', async () => {
    const { db, rpc } = database(null);
    const fetcher = meta(Response.json({ access_token: 'TEST-ONLY-REFRESHED-TOKEN-0003', expires_in: 5_184_000 }));
    expect(await refreshInstagramToken(db, owner, account, { env: env(), now, fetcher })).toMatchObject({ status: 'refreshed' });
    expect(rpc).toHaveBeenLastCalledWith('marketing_store_account_token', expect.objectContaining({ p_expected_refreshed_at: null, p_scopes: ['instagram_business_basic', 'instagram_business_content_publish'] }));
    const young = meta(Response.json({}));
    expect(await refreshInstagramToken(db, owner, account, { env: env({ MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: at(59.5 * day) }), now, fetcher: young })).toMatchObject({ status: 'skipped', code: 'access-token-too-new' });
    expect(young).not.toHaveBeenCalled();
  });
  it('refreshes a live bootstrap into the row of an expired stored token, as the publisher would use it', async () => {
    const expired = stored({ expiresAt: at(-1), scopes: ['instagram_business_basic'] }); const { db, rpc } = database(expired);
    const fetcher = meta(Response.json({ access_token: 'TEST-ONLY-REFRESHED-TOKEN-0005', expires_in: 5_184_000 }));
    expect(await refreshInstagramToken(db, owner, account, { env: env(), now, fetcher })).toMatchObject({ status: 'refreshed', expiresAt: at(60 * day) });
    expect(new URL((fetcher.mock.calls[0] as [string])[0]).searchParams.get('access_token')).toBe('TEST-ONLY-BOOTSTRAP-TOKEN-0001');
    expect(rpc).toHaveBeenLastCalledWith('marketing_store_account_token', expect.objectContaining({ p_expected_refreshed_at: expired.refreshedAt, p_token: 'TEST-ONLY-REFRESHED-TOKEN-0005',
      p_scopes: ['instagram_business_basic', 'instagram_business_content_publish'] }));
    expect(chooseMetaCredential(expired, bootstrapMetaCredential('dneskai', 'instagram', env()), now)).toMatchObject({ source: 'environment' });
  });
  it.each([
    ['a token younger than 24 hours', stored({ refreshedAt: at(-23 * 3_600_000) }), {}, 'skipped', 'access-token-too-new'],
    ['an expired token with an expired bootstrap', stored({ expiresAt: at(-1) }), { MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: at(-day) }, 'held', 'access-token-expired'],
    ['an expired token without a bootstrap', stored({ expiresAt: at(-1) }), { MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: undefined }, 'held', 'access-token-expired'],
    ['a Facebook Login token without the app id and secret', stored({ loginMode: 'facebook' }), {}, 'held', 'refresh-app-credentials-missing'],
    ['no token at all', null, { MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: undefined }, 'held', 'access-token-missing'],
    ['scopes the store would refuse', null, { MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: Array.from({ length: 21 }, (_, index) => `scope_${String.fromCharCode(97 + index)}`).join(',') }, 'held', 'verified-scopes-invalid'],
    ['a malformed scope', null, { MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: 'instagram_business_basic,Instagram-Business-Content-Publish' }, 'held', 'verified-scopes-invalid'],
  ] as const)('does not call Meta for %s', async (_label, token, patch, status, code) => {
    const fetcher = meta(Response.json({}));
    expect(await refreshInstagramToken(database(token).db, owner, account, { env: env(patch), now, fetcher })).toEqual({ status, accountId: account.id, code });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ['a network failure', () => { throw new TypeError('offline'); }, 'uncertain', 'refresh-request-uncertain'],
    ['a rejected request', new Response('{}', { status: 400 }), 'failed', 'refresh-http-400'],
    ['a server error', new Response('{}', { status: 503 }), 'uncertain', 'refresh-http-503'],
    ['an unreadable answer', Response.json({ access_token: 'short', expires_in: 10 }), 'uncertain', 'refresh-response-invalid'],
  ] as const)('reports %s once, without retrying or storing', async (_label, response, status, code) => {
    const { db, rpc } = database(stored()); const fetcher = meta(response as Response | (() => never));
    expect(await refreshInstagramToken(db, owner, account, { env: env(), now, fetcher })).toEqual({ status, accountId: account.id, code });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['marketing_read_account_token']);
  });
  it('reports a lost store write as uncertain and never returns the new token', async () => {
    const outcome = await refreshInstagramToken(database(stored(), { storeError: true }).db, owner, account, { env: env(), now, fetcher: meta(Response.json({ access_token: 'TEST-ONLY-REFRESHED-TOKEN-0004', expires_in: 5_184_000 })) });
    expect(outcome).toEqual({ status: 'uncertain', accountId: account.id, code: 'refresh-store-failed' });
  });
  it('holds Threads accounts, foreign accounts and an unavailable store', async () => {
    const fetcher = meta(Response.json({}));
    expect(await refreshInstagramToken(database(stored()).db, owner, { ...account, platform: 'threads' }, { env: env(), now, fetcher })).toMatchObject({ status: 'held', code: 'refresh-instagram-only' });
    expect(await refreshInstagramToken(database(stored()).db, owner, { ...account, user_id: '22222222-2222-4222-8222-222222222222' }, { env: env(), now, fetcher })).toMatchObject({ status: 'held', code: 'credential-owner-mismatch' });
    expect(await refreshInstagramToken(database(stored(), { readError: true }).db, owner, account, { env: env(), now, fetcher })).toMatchObject({ status: 'held', code: 'credential-store-unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Facebook Login tokens (#166)', () => {
  const fb = (patch: Record<string, string | undefined> = {}) => env({ MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'facebook', MARKETING_META_APP_ID: '123456789',
    MARKETING_META_APP_SECRET: 'TEST-ONLY-APP-SECRET-0001', ...patch });
  it('renews a due token through fb_exchange_token with the app id and secret and stores it in facebook mode', async () => {
    const { db, rpc } = database(stored({ loginMode: 'facebook', scopes: ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'] }));
    const fetcher = vi.fn(async () => Response.json({ access_token: 'TEST-ONLY-EXCHANGED-TOKEN-01', token_type: 'bearer', expires_in: 60 * 86_400 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    expect(await refreshInstagramToken(db, owner, account, { env: fb(), now, fetcher })).toMatchObject({ status: 'refreshed' });
    const url = new URL((fetcher.mock.calls[0] as [string])[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://graph.facebook.com/v99.0/oauth/access_token');
    expect(Object.fromEntries(url.searchParams)).toEqual({ grant_type: 'fb_exchange_token', client_id: '123456789', client_secret: 'TEST-ONLY-APP-SECRET-0001', fb_exchange_token: 'TEST-ONLY-STORED-TOKEN-000001' });
    expect(rpc).toHaveBeenCalledWith('marketing_store_account_token', expect.objectContaining({ p_token: 'TEST-ONLY-EXCHANGED-TOKEN-01', p_login_mode: 'facebook' }));
  });
  it('publishes through graph.facebook.com with the Facebook Login scopes', async () => {
    const { db } = database(stored({ loginMode: 'facebook', expiresAt: at(30 * day), scopes: ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'] }));
    const config = await resolveMetaPublisherConfig(db, owner, account, fb(), now);
    expect(config).toMatchObject({ loginMode: 'facebook', credentialSource: 'database', scopes: ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'] });
  });
});
