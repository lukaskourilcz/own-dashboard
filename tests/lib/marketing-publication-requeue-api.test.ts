import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The owner's "give up and re-queue" (approval-04). The session client is a mock: no database and no Meta request.
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), retry: vi.fn(), signal: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, rpc: (...args: unknown[]) => {
  const pending = Promise.resolve(mocks.rpc(...args));
  const query: Promise<unknown> & { retry: (enabled: boolean) => unknown; abortSignal: (signal: AbortSignal) => unknown } = Object.assign(pending, { retry: (enabled: boolean) => { mocks.retry(enabled); return query; }, abortSignal: (signal: AbortSignal) => { mocks.signal(signal); return query; } });
  return query;
} }) }));
import { POST } from '@/app/api/marketing/publications/route';
import { marketingPublicationRequeueable, marketingPublicationRequeueEnabled } from '@/lib/marketing/publication-requeue';

const owner = '11111111-1111-4111-8111-111111111111';
const publication = '33333333-3333-4333-8333-333333333333';
const call = (body: unknown, origin = 'https://own.example') => POST(new Request('https://own.example/api/marketing/publications', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }));
beforeEach(() => { mocks.user.mockResolvedValue({ data: { user: { id: owner } } }); mocks.rpc.mockReset(); mocks.retry.mockClear(); mocks.signal.mockClear(); vi.stubEnv('MARKETING_PUBLICATION_REQUEUE_ENABLED', 'true'); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('POST /api/marketing/publications requeue', () => {
  it('calls marketing_requeue_publication through the owner session and returns its result', async () => {
    mocks.rpc.mockResolvedValue({ data: 'queued-window-passed', error: null });
    const response = await call({ action: 'requeue', id: publication });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'queued-window-passed' });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('marketing_requeue_publication', { p_publication: publication });
    expect(mocks.retry).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.signal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
  it.each([null, undefined, false, {}, [], 'unknown', 'queued TEST_ONLY_PRIVATE'])('refuses an unconfirmed database result %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const response = await call({ action: 'requeue', id: publication });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'publication-requeue-failed' });
  });
  it('does not acknowledge a rejected transport or reflect its text', async () => {
    mocks.rpc.mockRejectedValue(new Error('TEST_ONLY_PRIVATE'));
    const response = await call({ action: 'requeue', id: publication });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'publication-requeue-failed' });
  });
  it('refuses an auth error even when a cached user accompanies it', async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: owner } }, error: new Error('TEST_ONLY_PRIVATE') });
    const response = await call({ action: 'requeue', id: publication });
    expect(response.status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('refuses an oversized body before an RPC and releases its stream', async () => {
    const input = new Request('https://own.example/api/marketing/publications', { method: 'POST', headers: { Origin: 'https://own.example' }, body: JSON.stringify({ action: 'requeue', id: publication }) + ' '.repeat(4097) });
    const response = await POST(input);
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); expect(input.body?.locked).toBe(false);
  });
  it('does no auth or RPC work for a pre-cancelled request', async () => {
    const controller = new AbortController(); controller.abort('TEST_ONLY_PRIVATE'); mocks.user.mockClear();
    const response = await POST(new Request('https://own.example/api/marketing/publications', { method: 'POST', headers: { Origin: 'https://own.example' }, signal: controller.signal, body: JSON.stringify({ action: 'requeue', id: publication }) }));
    expect(response.status).toBe(503); expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not confirm a late RPC after request cancellation', async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockReturnValue(new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const pending = POST(new Request('https://own.example/api/marketing/publications', { method: 'POST', headers: { Origin: 'https://own.example' }, signal: controller.signal, body: JSON.stringify({ action: 'requeue', id: publication }) }));
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    controller.abort('TEST_ONLY_PRIVATE');
    const response = await pending;
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'publication-requeue-failed' });
    expect(mocks.signal.mock.calls[0][0].aborted).toBe(true);
    resolve({ data: 'queued', error: null });
    await Promise.resolve();
  });
  it('returns an unavailable result for a body deadline without starting a write', async () => {
    vi.useFakeTimers();
    const input = new Request('https://own.example/api/marketing/publications', { method: 'POST', headers: { Origin: 'https://own.example' }, body: new ReadableStream(), duplex: 'half' } as RequestInit);
    const pending = POST(input);
    await vi.advanceTimersByTimeAsync(5001);
    const response = await pending;
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'publication-requeue-failed' });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(input.body?.locked).toBe(false);
  });
  it('is off by default and never calls the database while the server switch is off', async () => {
    vi.stubEnv('MARKETING_PUBLICATION_REQUEUE_ENABLED', '');
    const response = await call({ action: 'requeue', id: publication });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'publication-requeue-unavailable' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(marketingPublicationRequeueEnabled({})).toBe(false); expect(marketingPublicationRequeueEnabled({ MARKETING_PUBLICATION_REQUEUE_ENABLED: '1' })).toBe(false);
  });
  it('answers unavailable when the migration is not applied', async () => {
    for (const code of ['PGRST202', '42883']) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'Could not find the function public.marketing_requeue_publication' } });
      const response = await call({ action: 'requeue', id: publication });
      expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'publication-requeue-unavailable' });
    }
  });
  it.each([
    ['publication may be published', 409, 'publication-may-be-published'],
    ['publication not stranded', 409, 'publication-not-stranded'],
    ['approval changed', 409, 'publication-approval-changed'],
    ['publication unavailable', 404, 'publication-unavailable'],
    ['PRIVATE database detail', 409, 'publication-requeue-failed'],
    ['constructor', 409, 'publication-requeue-failed'],
  ] as const)('maps the SQL refusal %j to an owner code', async (message, status, error) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
    const response = await call({ action: 'requeue', id: publication });
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error });
  });
  it('refuses a signed-out caller, a foreign origin and a malformed body before any database call', async () => {
    expect((await call({ action: 'requeue', id: publication }, 'https://evil.example')).status).toBe(403);
    expect((await call({ action: 'requeue', id: 'not-a-uuid' })).status).toBe(400);
    expect((await call({ action: 'publish', id: publication })).status).toBe(400);
    mocks.user.mockResolvedValue({ data: { user: null } });
    expect((await call({ action: 'requeue', id: publication })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('marketingPublicationRequeueable mirrors the SQL guard', () => {
  const now = new Date('2026-10-22T08:00:00Z');
  const row = { status: 'reconciliation', remoteContainerId: null as string | null, remoteMediaId: null as string | null, remoteUrl: null as string | null, errorCode: null as string | null, leaseUntil: null as string | null };
  it('offers rows that never reached media_publish', () => {
    expect(marketingPublicationRequeueable({ ...row, remoteContainerId: `intent:${'a'.repeat(64)}`, errorCode: 'container-identity-unavailable' }, now)).toBe(true);
    expect(marketingPublicationRequeueable({ ...row, status: 'claimed', errorCode: 'container-retry', leaseUntil: '2026-10-22T07:59:59Z' }, now)).toBe(true);
  });
  it('never offers a row that may be published or is still being worked on', () => {
    expect(marketingPublicationRequeueable({ ...row, remoteContainerId: '17890000000000001' }, now)).toBe(false);
    expect(marketingPublicationRequeueable({ ...row, remoteMediaId: '90001' }, now)).toBe(false);
    expect(marketingPublicationRequeueable({ ...row, remoteUrl: 'https://www.instagram.com/p/x/' }, now)).toBe(false);
    expect(marketingPublicationRequeueable({ ...row, errorCode: 'publish-intent' }, now)).toBe(false);
    expect(marketingPublicationRequeueable({ ...row, status: 'claimed', leaseUntil: '2026-10-22T08:05:00Z' }, now)).toBe(false);
    expect(marketingPublicationRequeueable({ ...row, status: 'claimed', leaseUntil: null }, now)).toBe(false);
    for (const status of ['queued', 'failed', 'published', 'cancelled']) expect(marketingPublicationRequeueable({ ...row, status }, now)).toBe(false);
  });
});
