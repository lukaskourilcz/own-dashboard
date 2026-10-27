import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), limit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.user } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.limit }));
import { POST as enable } from '@/app/api/marketing/accounts/enable/route';
import { POST as engagement } from '@/app/api/marketing/accounts/engagement/route';
import { POST as verify } from '@/app/api/marketing/accounts/verify/route';
import { POST as webhook } from '@/app/api/marketing/accounts/webhook/route';
const owner = '11111111-1111-4111-8111-111111111111', routes = [{ name: 'enable', handler: enable }, { name: 'engagement', handler: engagement }, { name: 'verify', handler: verify }, { name: 'webhook', handler: webhook }];
function request(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
    return new Request('https://own.example/api/marketing/accounts/test', { method: 'POST', headers: { Origin: 'https://own.example' }, body, signal, duplex: 'half' } as RequestInit);
}
beforeEach(() => {
    vi.clearAllMocks();
    m.user.mockResolvedValue({ data: { user: { id: owner } }, error: null });
    m.limit.mockResolvedValue({ ok: true });
    for (const [key, value] of Object.entries({
        MARKETING_OWNER_ID: owner, DNESKAI_ENGAGEMENT_ENABLED: 'true', MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'TEST_ONLY_WEBHOOK_VERIFICATION_VALUE', MARKETING_INSTAGRAM_APP_SECRET: 'TEST_ONLY_APP_SECRET_VALUE'
    }))
        vi.stubEnv(key, value);
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
});
it.each(routes)('$name refuses an oversized producer before consuming its tail or admitting privileged work', async ({ handler }) => {
    let pulls = 0;
    const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ pull(c) {
            if (++pulls <= 64)
                c.enqueue(new Uint8Array(65536).fill(65));
            else
                c.close();
        }, cancel }, { highWaterMark: 0 }), response = await handler(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid-request' });
    expect(pulls).toBeLessThanOrEqual(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
});
it.each(routes)('$name settles an original disconnect without waiting for producer cancellation', async ({ handler }) => {
    const caller = new AbortController(), pull = vi.fn(), cancel = vi.fn(() => new Promise<void>(() => {
    })), body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }), pending = handler(request(body, caller.signal));
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('TEST_ONLY');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
});
it.each(routes)('$name bounds the whole body upload at five seconds before privileged admission', async ({ handler }) => {
    vi.useFakeTimers();
    const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }), pending = handler(request(body));
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('TEST_ONLY');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
});
it.each(routes)('$name refuses malformed UTF-8 before privileged admission', async ({ handler }) => {
    const body = new ReadableStream<Uint8Array>({ start(c) {
            c.enqueue(new Uint8Array([0xc3]));
            c.close();
        } }), response = await handler(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid-request' });
    expect(body.locked).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
});
it.each(routes)('$name refuses an empty-chunk producer without admitting account work', async ({ handler }) => {
    let pulls = 0;
    const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ pull(c) {
            if (++pulls <= 70000)
                c.enqueue(new Uint8Array());
            else
                c.close();
        }, cancel }, { highWaterMark: 0 }), response = await handler(request(body));
    expect(response.status).toBe(400);
    expect(pulls).toBeLessThanOrEqual(65538);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
});
