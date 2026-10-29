import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { reserveDneskaiTikTokRun, bindDneskaiTikTokRun, type DneskaiTikTokAdmission } from '@/lib/marketing/dneskai-tiktok-admission';
import { observationOwner as owner, observationAccount as account } from '../helpers/dneskai-audio-observation-fixtures';
import { tikTokAdmissionReceipt, tikTokBindingReceipt } from '../helpers/dneskai-tiktok-admission-fixtures';
vi.mock('server-only', () => ({}));
const now = new Date('2026-10-24T12:00:00Z'), signal = () => new AbortController().signal;
const admission = () => tikTokAdmissionReceipt({
    p_owner: owner, p_account: account.id, p_remote: account.remote_account_id, p_verified_at: account.verified_at, p_enabled: false, p_day: '2026-10-24', p_requested_at: now.toISOString(), p_ceiling: 0.1
}) as DneskaiTikTokAdmission;
const provider = { id: 'run_1', actorId: 'sDvA9jM4WRTDX4Syr' as const, datasetId: 'dataset_1', startedAt: now.toISOString() };
function harness(wire?: (args: Record<string, unknown>, path: string) => Promise<Response>) {
    const calls: {
        args: Record<string, unknown>;
        path: string;
        signal?: AbortSignal | null;
    }[] = [];
    const db = createClient('https://offline.supabase.test', 'TEST-ONLY-public', {
        auth: { persistSession: false, autoRefreshToken: false }, global: {
            fetch: async (url, init) => {
                const args = JSON.parse(String(init?.body)) as Record<string, unknown>, path = new URL(String(url)).pathname;
                calls.push({ args, path, signal: init?.signal });
                return wire ? wire(args, path) : Response.json(path.endsWith('reserve_dneskai_tiktok_run') ? tikTokAdmissionReceipt(args) : tikTokBindingReceipt(args));
            }
        }
    });
    return { db, calls };
}
const reserve = (h: ReturnType<typeof harness>, parent = signal()) => reserveDneskaiTikTokRun(h.db, owner, { account, now, ceilingUsd: 0.1, signal: parent });
const bind = (h: ReturnType<typeof harness>, parent = signal()) => bindDneskaiTikTokRun(h.db, owner, { admission: admission(), provider, now, signal: parent });
afterEach(() => vi.restoreAllMocks());
it('accepts one scoped positive admission and one persisted binding without extra reads', async () => {
    const h = harness();
    expect(await reserve(h)).toMatchObject({ admitted: true, ownerId: owner, accountId: account.id, reservationUsd: 0.1 });
    await bind(h);
    expect(h.calls.map(call => call.path)).toEqual(['/rest/v1/rpc/reserve_dneskai_tiktok_run', '/rest/v1/rpc/bind_dneskai_tiktok_run']);
    expect(h.calls[0].args).toMatchObject({
        p_owner: owner, p_account: account.id, p_remote: account.remote_account_id, p_verified_at: account.verified_at, p_day: '2026-10-24', p_requested_at: now.toISOString(), p_ceiling: 0.1
    });
});
it('accepts explicit refusal without accepting a reservation identity', async () => {
    const h = harness(async (args) => Response.json(tikTokAdmissionReceipt(args, { admitted: false })));
    expect(await reserve(h)).toBeNull();
    expect(h.calls).toHaveLength(1);
});
it.each([null, true, { admitted: true, id: '44444444-4444-4444-8444-444444444444' }])('rejects unscoped admission %j', async (value) => {
    const h = harness(async () => Response.json(value));
    await expect(reserve(h)).rejects.toThrow('tiktok-admission-unavailable');
});
it.each([{ ownerId: '99999999-9999-4999-8999-999999999999' }, { accountId: '99999999-9999-4999-8999-999999999999' }, { remoteAccountId: '9' }, { verifiedAt: '2026-10-20T00:00:00.000002Z' }, { enabled: true }, { day: '2026-10-25' }, { requestedAt: '2026-10-24T12:00:00.000001Z' }, { reservationUsd: 0.2 }, { ceilingUsd: 1 }, { spentUsd: 0.01 }, { reservedAt: '2026-10-24T12:05:01Z' }, { actorId: 'different' }, { actorName: 'different' }, { input: { resultsPerPage: 100 } }, { future_private: 'Synthetic unexpected' }])('refuses changed admission context or scope %j', async (patch) => {
    const h = harness(async (args) => Response.json({ ...tikTokAdmissionReceipt(args), ...patch }));
    await expect(reserve(h)).rejects.toThrow('tiktok-admission-unavailable');
});
it.each([true, null, {}, { ref: 'tiktok:run_1:dataset_1' }])('rejects unscoped binding %j', async (value) => {
    const h = harness(async () => Response.json(value));
    await expect(bind(h)).rejects.toThrow('tiktok-bind-unavailable');
});
it.each([{ ref: 'tiktok:other:other' }, { boundAt: '2026-10-24T11:59:59Z' }, { boundAt: '2026-10-24T12:05:01Z' }, { provider: { ...provider, id: 'other' } }, { admission: { ...admission(), remoteAccountId: '9' } }])('refuses conflicting persisted binding %j', async (patch) => {
    const h = harness(async (args) => Response.json({ ...tikTokBindingReceipt(args), ...patch }));
    await expect(bind(h)).rejects.toThrow('tiktok-bind-unavailable');
});
it.each(['reserve', 'bind'])('makes one actual SDK attempt for a refused %s', async (phase) => {
    const h = harness(async () => Response.json({ message: 'Synthetic private database detail' }, { status: 503 }));
    await expect(phase === 'reserve' ? reserve(h) : bind(h)).rejects.toThrow(phase === 'reserve' ? 'tiktok-admission-unavailable' : 'tiktok-bind-unavailable');
    expect(h.calls).toHaveLength(1);
});
it.each(['reserve', 'bind'])('cancels a stalled %s and ignores its late receipt', async (phase) => {
    let finish!: (value: Response) => void;
    const h = harness(() => new Promise(resolve => {
        finish = resolve;
    })), parent = new AbortController(), pending = (phase === 'reserve' ? reserve(h, parent.signal) : bind(h, parent.signal)).catch(error => error);
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    parent.abort('Synthetic private reason');
    expect(await pending).toHaveProperty('message', phase === 'reserve' ? 'tiktok-admission-unavailable' : 'tiktok-bind-unavailable');
    expect(h.calls[0].signal?.aborted).toBe(true);
    finish(Response.json(phase === 'reserve' ? tikTokAdmissionReceipt(h.calls[0].args) : tikTokBindingReceipt(h.calls[0].args)));
    await Promise.resolve();
    expect(h.calls).toHaveLength(1);
});
it('captures owner, account, clock and ceiling before admission waits', async () => {
    let finish!: (value: Response) => void;
    const h = harness(() => new Promise(resolve => {
        finish = resolve;
    })), input = { account: { ...account }, now: new Date(now), ceilingUsd: 0.1, signal: signal() }, pending = reserveDneskaiTikTokRun(h.db, owner, input);
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    input.account.remote_account_id = '9';
    input.account.verified_at = '2026-10-20T00:00:00.000002Z';
    input.now.setUTCDate(25);
    input.ceilingUsd = 1;
    finish(Response.json(tikTokAdmissionReceipt(h.calls[0].args)));
    expect(await pending).toMatchObject({ remoteAccountId: account.remote_account_id, ceilingUsd: 0.1, day: '2026-10-24' });
});
it('does not transport invalid or already-cancelled intent', async () => {
    const h = harness(), parent = new AbortController();
    parent.abort();
    await expect(reserve(h, parent.signal)).rejects.toThrow('tiktok-admission-unavailable');
    await expect(bind(h, parent.signal)).rejects.toThrow('tiktok-bind-unavailable');
    await expect(reserveDneskaiTikTokRun(h.db, owner, { account, now: new Date(Number.NaN), ceilingUsd: 0.1, signal: signal() })).rejects.toThrow('tiktok-admission-unavailable');
    expect(h.calls).toHaveLength(0);
});
