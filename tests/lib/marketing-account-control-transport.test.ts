import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { applyMarketingAccountControl } from '@/lib/marketing/account-control-server';
import { submitMarketingAccountControl } from '@/lib/marketing/accounts-client';
import type { MarketingAccountControl, MarketingAccountSwitch } from '@/lib/marketing/account-control-contracts';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333', version = '2026-10-27T10:00:00.000001Z';
const intent = (): MarketingAccountControl => ({ ownerId: owner, accountId: id, expectedVersion: version, enabled: true });
const receipt = () => ({ kind: 'saved', ownerId: owner, id, expectedVersion: version, switch: 'publishing', requestedEnabled: true, updatedAt: '2026-10-27T10:00:00.000002Z' });
const runners = [
    {
        name: 'server', failure: { message: 'Account control unavailable' }, call: (input: MarketingAccountControl, kind: MarketingAccountSwitch, fetcher: typeof fetch, signal?: AbortSignal) => applyMarketingAccountControl(createClient('https://account-control.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }), owner, input, kind, signal)
    },
    {
        name: 'browser', failure: { name: 'MarketingAccountRequestError', code: 'account-request-failed' }, call: (input: MarketingAccountControl, kind: MarketingAccountSwitch, fetcher: typeof fetch, signal?: AbortSignal) => {
            vi.stubGlobal('fetch', fetcher);
            return submitMarketingAccountControl(input, kind, signal);
        }
    },
];
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
const response = (runner: typeof runners[number], value: unknown) => Response.json(runner.name === 'browser' ? { receipt: value } : value);
it.each(runners.flatMap(runner => ['saved', 'changed', 'absent', 'blocked'].map(kind => ({ runner, kind }))))('$runner.name accepts an exact $kind scoped receipt', async ({ runner, kind }) => {
    const value = { ...receipt(), kind, ...(kind === 'absent' ? { updatedAt: null } : kind === 'blocked' ? { updatedAt: version, code: 'access-token-expired' } : {}) }, fetcher = vi.fn(async () => response(runner, value));
    expect(await runner.call(intent(), 'publishing', fetcher)).toEqual(value);
    expect(fetcher).toHaveBeenCalledOnce();
});
it.each(runners.flatMap(runner => [null, [], { ...receipt(), ownerId: other }, { ...receipt(), id: other }, { ...receipt(), switch: 'engagement' }, { ...receipt(), expectedVersion: '2026-10-27T10:00:00.000000Z' }, { ...receipt(), requestedEnabled: false }, { ...receipt(), updatedAt: version }, { ...receipt(), updatedAt: 'infinity' }, { ...receipt(), extra: true }, { ...receipt(), kind: 'changed', updatedAt: version }, { ...receipt(), kind: 'blocked', updatedAt: receipt().updatedAt, code: 'access-token-expired' }, { ...receipt(), kind: 'blocked', updatedAt: version, code: 'TEST_ONLY_PRIVATE_ERROR' }].map(value => ({ runner, value }))))('$runner.name refuses uncorrelated/malformed intent receipts: %#', async ({ runner, value }) => {
    const fetcher = vi.fn(async () => response(runner, value));
    await expect(runner.call(intent(), 'publishing', fetcher)).rejects.toMatchObject(runner.failure);
    expect(fetcher).toHaveBeenCalledOnce();
});
it.each(runners)('$name retains full PostgreSQL microseconds while accepting equivalent timezone spellings', async (runner) => {
    const value = { ...receipt(), expectedVersion: '2026-10-27T12:00:00.000001+02:00' }, fetcher = vi.fn(async () => response(runner, value));
    expect(await runner.call(intent(), 'publishing', fetcher)).toEqual(value);
});
it.each(runners)('$name starts no request for retired original intent', async (runner) => {
    const caller = new AbortController();
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    const fetcher = vi.fn();
    await expect(runner.call(intent(), 'publishing', fetcher, caller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    expect(fetcher).not.toHaveBeenCalled();
});
it.each(runners)('$name bounds a stalled transaction/response without retrying', async (runner) => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const fetcher = vi.fn(() => new Promise<Response>(() => {
    })), pending = runner.call(intent(), 'publishing', fetcher).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject(runner.failure);
    expect(fetcher).toHaveBeenCalledOnce();
});
it.each(runners)('$name fixes unavailable diagnostics and sends once', async (runner) => {
    const fetcher = vi.fn(async () => Response.json({ message: 'TEST_ONLY_PRIVATE_DATABASE_DETAIL', error: 'TEST_ONLY_PRIVATE_DETAIL' }, { status: 503 }));
    await expect(runner.call(intent(), 'publishing', fetcher)).rejects.toMatchObject(runner.failure);
    expect(fetcher).toHaveBeenCalledOnce();
});
it.each(runners)('$name captures immutable request intent before waiting', async (runner) => {
    const input = intent();
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => {
        finish = resolve;
    })), pending = runner.call(input, 'publishing', fetcher);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    input.accountId = other;
    input.enabled = false;
    finish(response(runner, receipt()));
    expect(await pending).toEqual(receipt());
});
it('sends one exact no-retry RPC under the original server lifetime', async () => {
    let query!: URL, options!: RequestInit;
    const fetcher = vi.fn(async (input, init) => {
        query = new URL(String(input));
        options = init!;
        return Response.json(receipt());
    }), caller = new AbortController();
    await runners[0].call(intent(), 'publishing', fetcher, caller.signal);
    expect(query.pathname).toBe('/rest/v1/rpc/toggle_owned_marketing_account');
    expect(JSON.parse(String(options.body))).toEqual({ p_owner: owner, p_id: id, p_expected_at: version, p_switch: 'publishing', p_enabled: true });
    expect(options.signal).toBeInstanceOf(AbortSignal);
});
it('sends no server request for foreign verified owner or invalid captured selectors', async () => {
    const fetcher = vi.fn();
    await expect(runners[0].call({ ...intent(), ownerId: other }, 'publishing', fetcher)).rejects.toMatchObject(runners[0].failure);
    await expect(runners[0].call({ ...intent(), expectedVersion: 'bad' }, 'publishing', fetcher)).rejects.toMatchObject(runners[0].failure);
    expect(fetcher).not.toHaveBeenCalled();
});
