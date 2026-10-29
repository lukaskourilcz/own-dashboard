import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { completeDneskaiTikTokRun, readDneskaiTikTokProgress } from '@/lib/marketing/dneskai-tiktok-progress';
import { observationOwner as owner, observationAccount } from '../helpers/dneskai-audio-observation-fixtures';
vi.mock('server-only', () => ({}));
const now = new Date('2026-10-24T12:00:00Z'), spend = '44444444-4444-4444-8444-444444444444';
const row = { id: spend, ref: 'tiktok:run_1:dataset_1', reserved_at: '2026-10-23T12:00:00.000001Z', settled: false, cost_usd: null, reserved_usd: 0.1, processed: false };
const run = {
    id: 'run_1', actorId: 'sDvA9jM4WRTDX4Syr' as const, datasetId: 'dataset_1', startedAt: row.reserved_at, finishedAt: '2026-10-23T12:01:00Z', status: 'SUCCEEDED' as const, usageUsd: 0.076
};
const input = () => ({
    account: { ...observationAccount }, row: { ...row }, run: { ...run }, matches: [{ audioId: '1', title: 'Synthetic sound', artist: null }], now: new Date(now), signal: new AbortController().signal
});
function receipt(args: Record<string, unknown>) {
    return {
        ownerId: args.p_owner, accountId: args.p_account, remoteAccountId: args.p_remote, verifiedAt: args.p_verified_at, spendId: args.p_spend, ref: args.p_ref, reservedAt: args.p_reserved_at, day: args.p_day, observedAt: args.p_observed_at, sourceDay: '2026-10-23', costUsd: 0.076, completedAt: args.p_observed_at, rows: [{
                audioId: '1', outcome: 'stored', sourceDay: '2026-10-23', observedAt: args.p_observed_at, accountId: args.p_account, remoteAccountId: args.p_remote, verifiedAt: args.p_verified_at, spendId: args.p_spend
            }]
    };
}
function harness(wire?: (args: Record<string, unknown>, path: string) => Promise<Response>) {
    const calls: {
        args: Record<string, unknown>;
        signal?: AbortSignal | null;
        path: string;
    }[] = [];
    const db = createClient('https://offline.supabase.test', 'TEST-ONLY-public', {
        auth: { persistSession: false, autoRefreshToken: false }, global: {
            fetch: async (url, init) => {
                const args = JSON.parse(String(init?.body)) as Record<string, unknown>, path = new URL(String(url)).pathname;
                calls.push({ args, signal: init?.signal, path });
                return wire ? wire(args, path) : Response.json(path.endsWith('read_dneskai_tiktok_progress') ? { ownerId: owner, until: args.p_until, rows: [row] } : receipt(args));
            }
        }
    });
    return { db, calls };
}
afterEach(() => vi.restoreAllMocks());
it('validates one positive owner-bound completion request without a direct write or separate settlement', async () => {
    const h = harness();
    expect(await completeDneskaiTikTokRun(h.db, owner, input())).toBe(1);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].path).toBe('/rest/v1/rpc/complete_dneskai_tiktok_run');
    expect(h.calls[0].args).toMatchObject({
        p_owner: owner, p_account: observationAccount.id, p_verified_at: observationAccount.verified_at, p_spend: spend, p_reserved_at: row.reserved_at, p_matches: [{ audioId: '1', title: 'Synthetic sound', artist: null }]
    });
});
it.each([null, {}, true])('rejects missing completion evidence: %j', async (value) => {
    const h = harness(async () => Response.json(value));
    await expect(completeDneskaiTikTokRun(h.db, owner, input())).rejects.toThrow(/^tiktok-completion-unavailable$/);
    expect(h.calls).toHaveLength(1);
});
it.each([{ ownerId: '99999999-9999-4999-8999-999999999999' }, { accountId: '99999999-9999-4999-8999-999999999999' }, { remoteAccountId: '9' }, { verifiedAt: '2026-10-20T00:00:00.000002Z' }, { spendId: '99999999-9999-4999-8999-999999999999' }, { ref: 'tiktok:other:other' }, { reservedAt: '2026-10-23T12:00:00.000002Z' }, { day: '2026-10-25' }, { sourceDay: '2026-10-24' }, { observedAt: '2026-10-24T12:00:00.000001Z' }, { costUsd: 0.0759 }, { completedAt: '2026-10-24T11:54:59Z' }, { rows: [] }, { future_private: 'Synthetic unexpected detail' }])('refuses changed or incomplete completion receipts %j', async (patch) => {
    const h = harness(async (args) => Response.json({ ...receipt(args), ...patch }));
    await expect(completeDneskaiTikTokRun(h.db, owner, input())).rejects.toThrow('tiktok-completion-unavailable');
});
it.each([{ audioId: '9' }, { sourceDay: '2026-10-22' }, { spendId: '99999999-9999-4999-8999-999999999999' }, { accountId: '99999999-9999-4999-8999-999999999999' }, { observedAt: '2026-10-24T11:59:59Z' }, { outcome: 'superseded' }])('refuses inconsistent individual proofs %j', async (patch) => {
    const h = harness(async (args) => {
        const value = receipt(args);
        return Response.json({ ...value, rows: value.rows.map(proof => ({ ...proof, ...patch })) });
    });
    await expect(completeDneskaiTikTokRun(h.db, owner, input())).rejects.toThrow('tiktok-completion-unavailable');
});
it('does not report a newer existing proof as a newly stored match', async () => {
    const h = harness(async (args) => {
        const value = receipt(args);
        return Response.json({ ...value, rows: value.rows.map(proof => ({ ...proof, outcome: 'superseded', observedAt: '2026-10-24T12:00:00.000001Z', spendId: '99999999-9999-4999-8999-999999999999' })) });
    });
    expect(await completeDneskaiTikTokRun(h.db, owner, input())).toBe(0);
});
it('captures source/actor/matches and clock before an uncooperative transport wait', async () => {
    let finish!: (response: Response) => void;
    const h = harness(() => new Promise(resolve => {
        finish = resolve;
    })), args = input(), pending = completeDneskaiTikTokRun(h.db, owner, args);
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    args.account.remote_account_id = '9';
    args.account.verified_at = '2026-10-20T00:00:00.000002Z';
    args.row.ref = 'tiktok:other:other';
    args.run.usageUsd = 0.01;
    args.matches[0].title = 'Changed later';
    args.now.setUTCDate(25);
    finish(Response.json(receipt(h.calls[0].args)));
    expect(await pending).toBe(1);
    expect(h.calls[0].args.p_day).toBe('2026-10-24');
});
it.each(['read', 'complete'])('uses one actual SDK request and no retry for a refused %s', async (phase) => {
    const h = harness(async () => Response.json({ message: 'Synthetic private database failure' }, { status: 503 }));
    const pending = phase === 'read' ? readDneskaiTikTokProgress(h.db, owner, now, new AbortController().signal) : completeDneskaiTikTokRun(h.db, owner, input());
    await expect(pending).rejects.toThrow(phase === 'read' ? 'tiktok-budget-unavailable' : 'tiktok-completion-unavailable');
    expect(h.calls).toHaveLength(1);
});
it.each(['read', 'complete'])('cancels stalled %s transport and ignores a late receipt', async (phase) => {
    let finish!: (response: Response) => void;
    const h = harness(() => new Promise(resolve => {
        finish = resolve;
    })), parent = new AbortController(), pending = (phase === 'read' ? readDneskaiTikTokProgress(h.db, owner, now, parent.signal) : completeDneskaiTikTokRun(h.db, owner, { ...input(), signal: parent.signal })).catch(error => error);
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    parent.abort('Synthetic private reason');
    expect(await pending).toHaveProperty('message', phase === 'read' ? 'tiktok-budget-unavailable' : 'tiktok-completion-unavailable');
    expect(h.calls[0].signal?.aborted).toBe(true);
    finish(Response.json(phase === 'read' ? { ownerId: owner, until: now.toISOString(), rows: [row] } : receipt(h.calls[0].args)));
    await Promise.resolve();
    expect(h.calls).toHaveLength(1);
});
it.each([{ settled: true, cost_usd: null }, { processed: true }, { reserved_at: '2026-10-24T12:00:00.000001Z' }, { reserved_at: '2026-10-21T12:00:00Z' }, { reserved_usd: 0 }, { cost_usd: 0.01 }, { future_private: 'Synthetic unexpected' }])('refuses inconsistent complete progress rows %j', async (patch) => {
    const h = harness(async (args) => Response.json({ ownerId: owner, until: args.p_until, rows: [{ ...row, ...patch }] }));
    await expect(readDneskaiTikTokProgress(h.db, owner, now, new AbortController().signal)).rejects.toThrow('tiktok-budget-unavailable');
});
it('does not transport invalid, unmetered or already-cancelled intent', async () => {
    const h = harness(), parent = new AbortController();
    parent.abort();
    await expect(completeDneskaiTikTokRun(h.db, owner, { ...input(), run: { ...run, usageUsd: null } })).rejects.toThrow('tiktok-completion-unavailable');
    await expect(completeDneskaiTikTokRun(h.db, owner, { ...input(), signal: parent.signal })).rejects.toThrow('tiktok-completion-unavailable');
    await expect(readDneskaiTikTokProgress(h.db, owner, new Date(Number.NaN), parent.signal)).rejects.toThrow('tiktok-budget-unavailable');
    expect(h.calls).toHaveLength(0);
});
