import { afterEach, expect, it, vi } from 'vitest';
import { loadMarketingAccounts, submitMarketingAccountControl, marketingCommentSubscription, verifyMarketingAccount } from '@/lib/marketing/accounts-client';
const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const expectedVersion='2026-10-27T10:00:00.000001Z',ownerId='33333333-3333-4333-8333-333333333333';
const intent=(accountId:string,enabled:boolean)=>({ownerId,accountId,expectedVersion,enabled});
const controlReceipt=(kind:'publishing'|'engagement',enabled:boolean)=>({ownerId,id,expectedVersion,switch:kind,requestedEnabled:enabled,kind:'saved',updatedAt:'2026-10-27T10:00:00.000002Z'});
const setMarketingAccountEnabled=(accountId:string,enabled:boolean,signal?:AbortSignal)=>submitMarketingAccountControl(intent(accountId,enabled),'publishing',signal);
const setMarketingAccountEngagement=(accountId:string,enabled:boolean,signal?:AbortSignal)=>submitMarketingAccountControl(intent(accountId,enabled),'engagement',signal);
const account = () => ({
    id, updatedAt:expectedVersion, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verifiedAt: '2026-10-27T10:00:00Z', enabled: false, token: null, engagement: { enabled: false, blockedCode: null, blockedAt: null }
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
it('refuses a switch receipt naming another account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({receipt:{...controlReceipt('publishing',true),id:other}})));
    await expect(setMarketingAccountEnabled(id, true)).rejects.toMatchObject({ name: 'MarketingAccountRequestError', code: 'account-request-failed' });
});
it('refuses a switch receipt with the opposite publishing state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({receipt:controlReceipt('publishing',false)})));
    await expect(setMarketingAccountEnabled(id, true)).rejects.toMatchObject({ name: 'MarketingAccountRequestError', code: 'account-request-failed' });
});
it('refuses a switch receipt with the opposite engagement state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({receipt:controlReceipt('engagement',false)})));
    await expect(setMarketingAccountEngagement(id, true)).rejects.toMatchObject({ name: 'MarketingAccountRequestError', code: 'account-request-failed' });
});
it('refuses verification naming a different brand', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ account: { ...account(), brand: 'devshark' }, accountType: 'BUSINESS', tokenStored: true })));
    await expect(verifyMarketingAccount('dneskai', 'instagram')).rejects.toMatchObject({ name: 'MarketingAccountRequestError', code: 'account-request-failed' });
});
it('requires a positive subscription receipt after requesting subscribe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ subscribed: false })));
    await expect(marketingCommentSubscription(id, 'subscribe')).rejects.toMatchObject({ name: 'MarketingAccountRequestError', code: 'account-request-failed' });
});
const operations = [
    { name: 'load', budget: 20000, call: (signal?: AbortSignal) => loadMarketingAccounts(signal), reply: () => ({ accounts: [account()] }) },
    {
        name: 'verify', budget: 35000, call: (signal?: AbortSignal) => verifyMarketingAccount('dneskai', 'instagram', signal), reply: () => ({ account: account(), accountType: 'BUSINESS', tokenStored: false })
    },
    { name: 'publishing', budget: 35000, call: (signal?: AbortSignal) => setMarketingAccountEnabled(id, false, signal), reply: () => ({receipt:controlReceipt('publishing',false)}) },
    { name: 'engagement', budget: 35000, call: (signal?: AbortSignal) => setMarketingAccountEngagement(id, false, signal), reply: () => ({receipt:controlReceipt('engagement',false)}) },
    { name: 'subscription', budget: 35000, call: (signal?: AbortSignal) => marketingCommentSubscription(id, 'status', signal), reply: () => ({ subscribed: false }) },
];
it.each(operations)('$name returns a positive exact reply once within the original caller scope', async ({ call, reply }) => {
    const caller = new AbortController(), fetcher = vi.fn(async () => Response.json(reply()));
    vi.stubGlobal('fetch', fetcher);
    await expect(call(caller.signal)).resolves.toBeDefined();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.length).toBe(2);
});
it.each(operations)('$name refuses prior retirement without sending a request', async ({ call }) => {
    const caller = new AbortController();
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(call(caller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    expect(fetcher).not.toHaveBeenCalled();
});
it.each(operations)('$name bounds an uncooperative fetch without retry or private diagnostics', async ({ call, budget }) => {
    const deadline = new AbortController(), timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal), fetcher = vi.fn(() => new Promise<Response>(() => {
    }));
    vi.stubGlobal('fetch', fetcher);
    const pending = call().catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledWith(budget);
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ name: 'MarketingAccountRequestError', code: 'account-request-failed', message: 'account-request-failed' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it.each(operations)('$name discards a late successful body after original retirement', async ({ call, reply }) => {
    const caller = new AbortController();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => {
        resolve = done;
    }));
    vi.stubGlobal('fetch', fetcher);
    const pending = call(caller.signal).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ start(c) {
            c.enqueue(new TextEncoder().encode(JSON.stringify(reply())));
        }, cancel }), { headers: { 'content-type': 'application/json' } }));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});
it.each([200, 503])('bounds response bytes before consuming the tail for HTTP %s', async (status) => {
    let pulls = 0;
    const cancel = vi.fn(), response = new Response(new ReadableStream<Uint8Array>({ pull(c) {
            if (++pulls <= 64)
                c.enqueue(new Uint8Array(4096).fill(32));
            else
                c.close();
        }, cancel }, { highWaterMark: 0 }), { status, headers: { 'content-type': 'application/json' } }), fetcher = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetcher);
    await expect(loadMarketingAccounts()).rejects.toMatchObject({ name: 'MarketingAccountRequestError', code: 'account-request-failed' });
    expect(pulls).toBeLessThanOrEqual(status === 200 ? 5 : 2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
});
it('bounds stalled response collection without waiting for cancellation', async () => {
    const caller = new AbortController(), pull = vi.fn(), cancel = vi.fn(() => new Promise<void>(() => {
    })), response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const pending = loadMarketingAccounts(caller.signal).catch(error => error);
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
});
it.each([{ status: 200, body: { accounts: [account(), account()] } }, { status: 200, body: { accounts: [{ ...account(), verifiedAt: 'infinity' }] } }, { status: 200, body: { accounts: [{ ...account(), token: { expiresAt: '2026-12-01T10:00:00Z', refreshedAt: '2026-10-27T10:00:00Z', scopes: ['scope', 'scope'], loginMode: 'instagram' } }] } }, { status: 201, body: { accounts: [account()] } }, { status: 503, body: { error: 'TEST_ONLY_PRIVATE_DETAIL' } }])('refuses malformed/non-complete response contracts: %#', async ({ status, body }) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })));
    await expect(loadMarketingAccounts()).rejects.toMatchObject({ name: 'MarketingAccountRequestError', code: 'account-request-failed' });
});
it('returns rate-limited without consuming an untrusted error body', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 429 })));
    await expect(loadMarketingAccounts()).rejects.toMatchObject({ code: 'rate-limited' });
    expect(cancel).toHaveBeenCalledOnce();
});
it('refuses invalid action selectors before sending a request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(setMarketingAccountEnabled('bad', true)).rejects.toHaveProperty('code', 'invalid-request');
    await expect(setMarketingAccountEnabled(id, undefined as never)).rejects.toHaveProperty('code', 'invalid-request');
    await expect(setMarketingAccountEngagement(id, 'true' as never)).rejects.toHaveProperty('code', 'invalid-request');
    await expect(marketingCommentSubscription(id, 'bad' as never)).rejects.toHaveProperty('code', 'invalid-request');
    expect(fetcher).not.toHaveBeenCalled();
});
