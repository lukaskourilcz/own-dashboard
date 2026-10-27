import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), admin: vi.fn(), limit: vi.fn(), verify: vi.fn(), subscription: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: (...args: unknown[]) => m.session(...args) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => m.admin(...args) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.limit }));
vi.mock('@/lib/marketing/meta-account', async (original) => ({ ...await original<typeof import('@/lib/marketing/meta-account')>(), verifyInstagramAccount: m.verify }));
vi.mock('@/lib/marketing/dneskai-engagement-ports', async (original) => ({ ...await original<typeof import('@/lib/marketing/dneskai-engagement-ports')>(), instagramCommentSubscription: m.subscription }));
import { GET } from '@/app/api/marketing/accounts/route';
import { POST as enable } from '@/app/api/marketing/accounts/enable/route';
import { POST as engagement } from '@/app/api/marketing/accounts/engagement/route';
import { POST as verify } from '@/app/api/marketing/accounts/verify/route';
import { POST as webhook } from '@/app/api/marketing/accounts/webhook/route';
const owner = '11111111-1111-4111-8111-111111111111', accountId = '33333333-3333-4333-8333-333333333333';
const routes = [{ name: 'read', handler: GET, body: null }, { name: 'enable', handler: enable, body: { accountId, enabled: false } }, { name: 'engagement', handler: engagement, body: { accountId, enabled: false } }, { name: 'verify', handler: verify, body: { brand: 'dneskai', platform: 'instagram' } }, { name: 'webhook', handler: webhook, body: { accountId, action: 'status' } }];
function request(route: typeof routes[number], signal?: AbortSignal) {
    return new Request('https://own.example/api/marketing/accounts/' + route.name, { method: route.body ? 'POST' : 'GET', headers: { Origin: 'https://own.example' }, ...(route.body ? { body: JSON.stringify(route.body) } : {}), signal });
}
beforeEach(() => {
    vi.clearAllMocks();
    m.session.mockResolvedValue({ auth: { getUser: m.user } });
    m.user.mockResolvedValue({ data: { user: { id: owner } }, error: { status: 401, message: 'TEST_ONLY_PRIVATE_AUTH_DETAIL' } });
    m.limit.mockResolvedValue({ ok: true });
    m.admin.mockImplementation(() => {
        throw new Error('TEST_ONLY_FORBIDDEN_PRIVILEGED_ADMISSION');
    });
    for (const [key, value] of Object.entries({
        MARKETING_OWNER_ID: owner, DNESKAI_ENGAGEMENT_ENABLED: 'true', MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'TEST_ONLY_WEBHOOK_VERIFICATION_VALUE', MARKETING_INSTAGRAM_APP_SECRET: 'TEST_ONLY_APP_SECRET_VALUE'
    }))
        vi.stubEnv(key, value);
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});
it.each(routes)('refuses a cached user with an authentication error before $name account work', async (route) => {
    const response = await route.handler(request(route));
    expect(response.status).toBe(401);
    expect(m.limit).not.toHaveBeenCalled();
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.subscription).not.toHaveBeenCalled();
});
it.each(routes.flatMap(route => [400, 403].map(status => ({ route, status }))))('refuses rejected identity $status for $route.name', async ({ route, status }) => {
    m.user.mockResolvedValueOnce({ data: { user: { id: owner } }, error: { status, message: 'TEST_ONLY_PRIVATE_AUTH_DETAIL' } });
    expect((await route.handler(request(route))).status).toBe(401);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.limit).not.toHaveBeenCalled();
});
it.each(routes.flatMap(route => [0, 429, 503].map(status => ({ route, status }))))('keeps unavailable auth $status distinct for $route.name', async ({ route, status }) => {
    m.user.mockResolvedValueOnce({ data: { user: { id: owner } }, error: { status, message: 'TEST_ONLY_PRIVATE_AUTH_DETAIL' } });
    const response = await route.handler(request(route));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('TEST_ONLY');
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.limit).not.toHaveBeenCalled();
});
it.each(routes)('starts no $name session after original retirement', async (route) => {
    const caller = new AbortController();
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    const response = await route.handler(request(route, caller.signal));
    expect(response.status).toBe(503);
    expect(m.session).not.toHaveBeenCalled();
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.limit).not.toHaveBeenCalled();
});
it.each(routes)('contains thrown and malformed $name identity before admission', async (route) => {
    m.user.mockRejectedValueOnce(new Error('TEST_ONLY_PRIVATE_AUTH_DETAIL'));
    expect((await route.handler(request(route))).status).toBe(503);
    m.user.mockResolvedValueOnce({ data: { user: { id: 'bad' } }, error: null });
    expect((await route.handler(request(route))).status).toBe(503);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.limit).not.toHaveBeenCalled();
});
it.each(routes)('bounds uncooperative $name authentication without later account work', async (route) => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 10000 ? deadline.signal : new AbortController().signal);
    m.user.mockImplementationOnce(() => new Promise(() => {
    }));
    const pending = route.handler(request(route));
    await vi.waitFor(() => expect(m.user).toHaveBeenCalledOnce());
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('TEST_ONLY');
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.limit).not.toHaveBeenCalled();
});
it.each(routes.filter(route => route.body))('starts no privileged $name phase after retirement during rate admission', async (route) => {
    const caller = new AbortController();
    m.user.mockResolvedValueOnce({ data: { user: { id: owner } }, error: null });
    m.limit.mockImplementationOnce(async () => {
        caller.abort('TEST_ONLY_PRIVATE_REASON');
        return { ok: true };
    });
    const input = request(route, caller.signal), response = await route.handler(input);
    expect(response.status).toBe(503);
    expect(input.bodyUsed).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.subscription).not.toHaveBeenCalled();
});
it.each(routes.filter(route => route.body))('settles a retired $name rate wait without admitting a late positive result', async (route) => {
    const caller = new AbortController();
    m.user.mockResolvedValueOnce({ data: { user: { id: owner } }, error: null });
    let resume!: (value: {
        ok: boolean;
    }) => void;
    m.limit.mockImplementationOnce(() => new Promise(done => {
        resume = done;
    }));
    const pending = route.handler(request(route, caller.signal));
    await vi.waitFor(() => expect(m.limit).toHaveBeenCalledOnce());
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    expect((await pending).status).toBe(503);
    resume({ ok: true });
    await Promise.resolve();
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.subscription).not.toHaveBeenCalled();
});
it('bounds the owner-scoped account list after authentication using the same captured session', async () => {
    const caller = new AbortController(), query = { select: () => query, eq: () => query, order: () => query, limit: () => new Promise(() => {
        }) };
    m.user.mockResolvedValueOnce({ data: { user: { id: owner } }, error: null });
    m.session.mockResolvedValueOnce({ auth: { getUser: m.user }, from: () => query, rpc: () => {const pending={retry:()=>pending,abortSignal:()=>pending,then:()=>new Promise(()=>{})};return pending;} });
    const pending = GET(request(routes[0], caller.signal));
    await vi.waitFor(() => expect(m.user).toHaveBeenCalledOnce());
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    expect((await pending).status).toBe(503);
    expect(m.session).toHaveBeenCalledOnce();
    expect(m.admin).not.toHaveBeenCalled();
});
