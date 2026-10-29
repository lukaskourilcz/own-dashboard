import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), limit: vi.fn(), resolve: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.admin() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.limit }));
vi.mock('@/lib/marketing/meta-credentials', () => ({ resolveMetaPublisherConfig: mocks.resolve }));
import { POST } from '@/app/api/marketing/accounts/webhook/route';

/** #161: the owner's comment-subscription read and request. Synthetic values only; Graph is a local stand-in. */
const owner = '11111111-1111-4111-8111-111111111111', accountId = '33333333-3333-4333-8333-333333333333';
const db = { from: () => { const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: accountId, user_id: owner, brand: 'dneskai', platform: 'instagram', remote_account_id: '17841400000000001' }, error: null }) }; return chain; } };
const post = (body: unknown) => new Request('https://own.example/api/marketing/accounts/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://own.example' }, body: JSON.stringify(body) });
const graph = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({ MARKETING_OWNER_ID: owner, DNESKAI_ENGAGEMENT_ENABLED: 'true', MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-token-TEST-ONLY-0000', MARKETING_INSTAGRAM_APP_SECRET: 'app-secret-TEST-ONLY-00000000' })) vi.stubEnv(key, value);
  mocks.user.mockResolvedValue({ data: { user: { id: owner } } }); mocks.limit.mockResolvedValue({ ok: true }); mocks.admin.mockReturnValue(db);
  mocks.resolve.mockResolvedValue({ loginMode: 'instagram', apiVersion: 'v24.0', accessToken: 'TEST-ONLY-TOKEN-0000000000', scopes: [], credentialHold: null });
  vi.stubGlobal('fetch', graph);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('POST /api/marketing/accounts/webhook', () => {
  it('is absent until the webhook is configured', async () => {
    vi.stubEnv('MARKETING_INSTAGRAM_APP_SECRET', '');
    expect((await POST(post({ accountId, action: 'status' }))).status).toBe(404);
    expect(graph).not.toHaveBeenCalled();
  });
  it('reads the subscription and subscribes the comments field with the token in the header only', async () => {
    graph.mockResolvedValueOnce(Response.json({ data: [{ subscribed_fields: ['messages'] }] })).mockResolvedValueOnce(Response.json({ success: true }));
    expect(await (await POST(post({ accountId, action: 'status' }))).json()).toEqual({ subscribed: false });
    expect(await (await POST(post({ accountId, action: 'subscribe' }))).json()).toEqual({ subscribed: true });
    const [statusUrl, statusInit] = graph.mock.calls[0]!; const [subscribeUrl, subscribeInit] = graph.mock.calls[1]!;
    expect(statusUrl).toBe('https://graph.instagram.com/v24.0/17841400000000001/subscribed_apps'); expect(statusInit.method).toBe('GET');
    expect(subscribeUrl).toBe('https://graph.instagram.com/v24.0/17841400000000001/subscribed_apps?subscribed_fields=comments'); expect(subscribeInit.method).toBe('POST');
    expect(String(subscribeUrl)).not.toContain('TOKEN'); expect(subscribeInit.headers.Authorization).toBe('Bearer TEST-ONLY-TOKEN-0000000000');
  });
  it('passes Graph refusals on as codes', async () => {
    graph.mockResolvedValueOnce(Response.json({ error: { code: 190 } }, { status: 400 }));
    const refused = await POST(post({ accountId, action: 'subscribe' }));
    expect(refused.status).toBe(409); expect(await refused.json()).toEqual({ error: 'access-token-invalid' });
  });
});
