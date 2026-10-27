import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), admin: vi.fn(), limited: vi.fn(), reel: vi.fn(), record: vi.fn(), after: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: m.after }));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.limited }));
vi.mock('@/lib/marketing/dneskai-reel', async (original) => ({ ...await original<typeof import('@/lib/marketing/dneskai-reel')>(), dneskaiReelForRevision: m.reel, recordDneskaiReel: m.record, createDneskaiReelStorage: () => ({}) }));
import { signAutomationBody } from '@/lib/marketing/automation-auth';
import { POST } from '@/app/api/marketing/dneskai/render-reel/route';
const owner = '11111111-1111-4111-8111-111111111111', revisionId = '33333333-3333-4333-8333-333333333333', url = 'https://reel-route.invalid/api/marketing/dneskai/render-reel';
const request = (signal?: AbortSignal) => new Request(url, { method: 'POST', signal, headers: { Origin: 'https://reel-route.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ revisionId }) });
beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED', 'true');
    m.client.mockResolvedValue({ auth: { getUser: m.user } });
    m.user.mockResolvedValue({ data: { user: { id: owner } }, error: null });
    m.admin.mockReturnValue({});
    m.limited.mockResolvedValue({ ok: true, retryAfter: 0 });
    m.reel.mockResolvedValue({
        reelKey: 'a'.repeat(64), url: 'https://example.supabase.co/signed', sha256: 'b'.repeat(64), bytes: 1000, durationSeconds: 9.5, silent: true, cached: false, revisionHash: 'c'.repeat(64), audioId: null
    });
    m.record.mockResolvedValue(undefined);
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
});
it.each([400, 401, 403])('refuses a cached user accompanying authentication error %s', async (status) => {
    m.user.mockResolvedValue({ data: { user: { id: owner } }, error: { status, message: 'TEST_ONLY_PRIVATE_AUTH_DETAIL' } });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.limited).not.toHaveBeenCalled();
    expect(m.reel).not.toHaveBeenCalled();
    expect(m.after).not.toHaveBeenCalled();
});
it.each([0, 429, 503])('keeps unavailable authentication distinct from a confirmed expired session: %s', async (status) => {
    m.user.mockResolvedValue({ data: { user: null }, error: { status, message: 'TEST_ONLY_PRIVATE_AUTH_DETAIL' } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'reel-request-unavailable' });
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.limited).not.toHaveBeenCalled();
});
function controlledTimeouts() {
    const timeouts = new Map<number, AbortController>();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
        const controller = new AbortController();
        timeouts.set(milliseconds, controller);
        return controller.signal;
    });
    return timeouts;
}
it('contains thrown auth and malformed owner results before privileged work', async () => {
    m.client.mockRejectedValueOnce(new Error('TEST_ONLY_PRIVATE_CLIENT_DETAIL'));
    let response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'reel-request-unavailable' });
    m.user.mockRejectedValueOnce(new Error('TEST_ONLY_PRIVATE_AUTH_DETAIL'));
    response = await POST(request());
    expect(response.status).toBe(503);
    m.user.mockResolvedValueOnce({ data: { user: { id: 'bad' } }, error: null });
    expect((await POST(request())).status).toBe(503);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.limited).not.toHaveBeenCalled();
});
it('bounds stalled authentication once and passes the original lifetime into its session transport', async () => {
    const timeouts = controlledTimeouts();
    m.user.mockImplementation(() => new Promise(() => {
    }));
    const pending = POST(request());
    await vi.waitFor(() => expect(m.user).toHaveBeenCalledOnce());
    timeouts.get(10000)!.abort('TEST_ONLY_PRIVATE_REASON');
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'reel-request-unavailable' });
    expect(m.client.mock.calls[0][0].aborted).toBe(true);
    expect(m.user).toHaveBeenCalledOnce();
    expect(m.admin).not.toHaveBeenCalled();
});
it('bounds a stalled rate admission without starting a render', async () => {
    const timeouts = controlledTimeouts();
    m.limited.mockImplementation(() => new Promise(() => {
    }));
    const pending = POST(request());
    await vi.waitFor(() => expect(m.limited).toHaveBeenCalledOnce());
    timeouts.get(15000)!.abort('TEST_ONLY_PRIVATE_REASON');
    expect((await pending).status).toBe(503);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.reel).not.toHaveBeenCalled();
});
it('stops after authentication when the original request retires', async () => {
    const controller = new AbortController();
    m.user.mockImplementation(async () => {
        controller.abort('TEST_ONLY_PRIVATE_REASON');
        return { data: { user: { id: owner } }, error: null };
    });
    const response = await POST(request(controller.signal));
    expect(response.status).toBe(503);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.limited).not.toHaveBeenCalled();
});
it('cancels a stalled body without waiting for its cancellation hook or performing authentication', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {
    })), body = new ReadableStream<Uint8Array>({ cancel });
    const pending = POST(new Request(url, { method: 'POST', headers: { Origin: 'https://reel-route.invalid' }, body, duplex: 'half' } as RequestInit));
    await vi.waitFor(() => expect(body.locked).toBe(true));
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pending;
    expect(response.status).toBe(408);
    expect(await response.json()).toEqual({ error: 'reel-request-unavailable' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(m.user).not.toHaveBeenCalled();
    expect(m.admin).not.toHaveBeenCalled();
});
it('retains UTF-8 size, syntax and cross-origin refusal before render admission', async () => {
    for (const body of ['界'.repeat(700), 'not JSON', new Uint8Array([0xc3, 0x28])]) {
        const response = await POST(new Request(url, { method: 'POST', headers: { Origin: 'https://reel-route.invalid' }, body }));
        expect(response.status).toBe(400);
    }
    const response = await POST(new Request(url, { method: 'POST', headers: { Origin: 'https://other.invalid' }, body: JSON.stringify({ revisionId }) }));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.reel).not.toHaveBeenCalled();
    expect(m.limited).not.toHaveBeenCalled();
});
it('creates a request-scoped service client only after verified admission', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(m.user).toHaveBeenCalledOnce();
    expect(m.admin).toHaveBeenCalledOnce();
    expect(m.admin.mock.calls[0][0]).toBe(m.reel.mock.calls[0][3].signal);
    expect(m.admin.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    expect(m.record).toHaveBeenCalledOnce();
});
it('bounds an uncooperative renderer and ignores its late completion before recording', async () => {
    const timeouts = controlledTimeouts();
    let finish!: (value: unknown) => void;
    m.reel.mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    const pending = POST(request());
    await vi.waitFor(() => expect(m.reel).toHaveBeenCalledOnce());
    timeouts.get(280000)!.abort('TEST_ONLY_PRIVATE_TIMEOUT');
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'reel-timeout' });
    finish({ reelKey: 'a'.repeat(64), revisionHash: 'b'.repeat(64), audioId: null, sha256: 'c'.repeat(64), bytes: 1000 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(m.record).not.toHaveBeenCalled();
});
it('bounds an unconfirmed record phase without reporting a successful Reel', async () => {
    const timeouts = controlledTimeouts();
    m.record.mockImplementation(() => new Promise(() => {
    }));
    const pending = POST(request());
    await vi.waitFor(() => expect(m.record).toHaveBeenCalledOnce());
    timeouts.get(280000)!.abort('TEST_ONLY_PRIVATE_TIMEOUT');
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'reel-timeout' });
    expect(m.record).toHaveBeenCalledOnce();
});
it('keeps a foreground cancellation distinct from an encoder failure', async () => {
    const controller = new AbortController();
    m.reel.mockImplementation(() => new Promise(() => {
    }));
    const pending = POST(request(controller.signal));
    await vi.waitFor(() => expect(m.reel).toHaveBeenCalledOnce());
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'reel-request-unavailable' });
    expect(m.record).not.toHaveBeenCalled();
});
it('starts signed asynchronous work under its own background scope after acknowledging admission', async () => {
    const secret = 'TEST_ONLY_SCHEDULER_SECRET_NOT_A_REAL_KEY';
    vi.stubEnv('MARKETING_OWNER_ID', owner);
    vi.stubEnv('MARKETING_SCHEDULER_SECRET', secret);
    const controller = new AbortController(), body = JSON.stringify({ revisionId, async: true });
    const response = await POST(new Request(url, { method: 'POST', headers: signAutomationBody(body, secret), body, signal: controller.signal }));
    expect(response.status).toBe(202);
    expect(m.after).toHaveBeenCalledOnce();
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.user).not.toHaveBeenCalled();
    expect(m.limited).not.toHaveBeenCalled();
    controller.abort('TEST_ONLY_ACKNOWLEDGED_CALLER_RETIREMENT');
    await m.after.mock.calls[0][0]();
    expect(m.admin).toHaveBeenCalledOnce();
    expect(m.admin.mock.calls[0][0].aborted).toBe(false);
    expect(m.admin.mock.calls[0][0]).toBe(m.reel.mock.calls[0][3].signal);
    expect(m.record).toHaveBeenCalledOnce();
});
it('allows no signed background work from a worker role or a cookie-only async body', async () => {
    const secret = 'TEST_ONLY_WORKER_SECRET_NOT_A_REAL_KEY';
    vi.stubEnv('MARKETING_OWNER_ID', owner);
    vi.stubEnv('MARKETING_WORKER_SECRET', secret);
    const body = JSON.stringify({ revisionId, async: true });
    expect((await POST(new Request(url, { method: 'POST', headers: signAutomationBody(body, secret), body }))).status).toBe(403);
    expect((await POST(new Request(url, { method: 'POST', headers: { Origin: 'https://reel-route.invalid' }, body }))).status).toBe(400);
    expect(m.after).not.toHaveBeenCalled();
    expect(m.admin).not.toHaveBeenCalled();
});
it('contains a background registration failure without exposing framework diagnostics', async () => {
    const secret = 'TEST_ONLY_SCHEDULER_SECRET_NOT_A_REAL_KEY';
    vi.stubEnv('MARKETING_OWNER_ID', owner);
    vi.stubEnv('MARKETING_SCHEDULER_SECRET', secret);
    m.after.mockImplementationOnce(() => {
        throw new Error('TEST_ONLY_PRIVATE_FRAMEWORK_DETAIL');
    });
    const body = JSON.stringify({ revisionId, async: true });
    const response = await POST(new Request(url, { method: 'POST', headers: signAutomationBody(body, secret), body }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'reel-request-unavailable' });
    expect(m.admin).not.toHaveBeenCalled();
});
it('bounds a signed background render and logs only the fixed failure code', async () => {
    const secret = 'TEST_ONLY_SCHEDULER_SECRET_NOT_A_REAL_KEY';
    vi.stubEnv('MARKETING_OWNER_ID', owner);
    vi.stubEnv('MARKETING_SCHEDULER_SECRET', secret);
    const timeouts = controlledTimeouts(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {
    });
    m.reel.mockImplementation(() => new Promise(() => {
    }));
    const body = JSON.stringify({ revisionId, async: true });
    expect((await POST(new Request(url, { method: 'POST', headers: signAutomationBody(body, secret), body }))).status).toBe(202);
    const pending = m.after.mock.calls[0][0]();
    await vi.waitFor(() => expect(m.reel).toHaveBeenCalledOnce());
    timeouts.get(280000)!.abort('TEST_ONLY_PRIVATE_REASON');
    await pending;
    expect(m.record).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: 'dneskai-reel-render-failed', code: 'reel-timeout' }));
});
