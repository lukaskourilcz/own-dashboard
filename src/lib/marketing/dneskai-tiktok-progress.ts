import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
import { pragueMarketingDate } from './weekly-planning';
import { DneskaiAudioAccountSchema, type DneskaiAudioAccount } from './dneskai-audio-trends';
type Database = Pick<SupabaseClient, 'rpc'>;
const runRow = z.strictObject({
    id: z.uuid(), ref: z.string().regex(/^tiktok:(?:pending|[A-Za-z0-9_-]{1,100}:[A-Za-z0-9_-]{1,100})$/), reserved_at: databaseTimestamp, settled: z.boolean(), cost_usd: z.number().min(0).max(10).nullable(), reserved_usd: z.number().positive().max(1), processed: z.boolean()
});
export type DneskaiTikTokProgress = z.infer<typeof runRow>;
export const TikTokTerminalRunSchema = z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), actorId: z.literal('sDvA9jM4WRTDX4Syr'), datasetId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), startedAt: databaseTimestamp, finishedAt: databaseTimestamp, status: z.enum(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']), usageUsd: z.number().min(0).max(10).nullable()
});
export type DneskaiTikTokTerminalRun = z.infer<typeof TikTokTerminalRunSchema>;
const matchSchema = z.strictObject({ audioId: z.string().regex(/^\d{1,40}$/), title: z.string().min(1).max(300).refine(value => value.trim() === value), artist: z.string().max(300).nullable() });
export type DneskaiTikTokMatch = z.infer<typeof matchSchema>;
const proofSchema = z.strictObject({
    audioId: matchSchema.shape.audioId, outcome: z.enum(['stored', 'superseded']), sourceDay: z.iso.date(), observedAt: databaseTimestamp, accountId: z.uuid(), remoteAccountId: z.string().regex(/^\d{1,100}$/), verifiedAt: databaseTimestamp, spendId: z.uuid()
});
const receiptSchema = z.strictObject({
    ownerId: z.uuid(), accountId: z.uuid(), remoteAccountId: z.string().regex(/^\d{1,100}$/), verifiedAt: databaseTimestamp, spendId: z.uuid(), ref: z.string().min(1).max(300), reservedAt: databaseTimestamp, day: z.iso.date(), observedAt: databaseTimestamp, sourceDay: z.iso.date(), costUsd: z.number().min(0).max(10), completedAt: databaseTimestamp, rows: z.array(proofSchema).max(25)
});
/** Complete bounded three-day progress, with an explicit ceiling instead of a five-row prefix. */
export async function readDneskaiTikTokProgress(db: Database, owner: string, now: Date, signal: AbortSignal): Promise<DneskaiTikTokProgress[]> {
    try {
        z.uuid().parse(owner);
        const instant = now.getTime();
        if (!Number.isFinite(instant))
            throw new Error();
        const until = new Date(instant).toISOString(), upper = databaseVersion(until)!, lower = upper - BigInt(3 * 86400000) * BigInt(1000);
        signal.throwIfAborted();
        const reply = await awaitWithSignal(db.rpc('read_dneskai_tiktok_progress', { p_owner: owner, p_until: until }).retry(false).abortSignal(signal), signal);
        signal.throwIfAborted();
        if (reply.error)
            throw new Error();
        const snapshot = z.strictObject({ ownerId: z.uuid(), until: databaseTimestamp, rows: z.array(runRow).max(1000) }).parse(reply.data);
        const bound = snapshot.rows.filter(row => row.ref !== 'tiktok:pending').map(row => row.ref);
        if (snapshot.ownerId !== owner ||
            databaseVersion(snapshot.until) !== upper ||
            new Set(snapshot.rows.map(row => row.id)).size !== snapshot.rows.length ||
            new Set(bound).size !== bound.length ||
            snapshot.rows.some(row => databaseVersion(row.reserved_at)! <= lower ||
            databaseVersion(row.reserved_at)! > upper ||
            (row.cost_usd !== null) !== row.settled ||
            (row.processed && !row.settled)))
            throw new Error();
        return snapshot.rows;
    }
    catch {
        throw new Error('tiktok-budget-unavailable');
    }
}
/** Round known provider cost up to the ledger’s four decimals without binary-boundary drift. */
function ceilingCost(value: number): number {
    const [coefficient, exponent = '0'] = String(value).split('e'), fraction = coefficient.split('.')[1]?.length ?? 0;
    const digits = BigInt(coefficient.replace('.', '')), scale = fraction - Number(exponent), power = 4 - scale;
    if (power >= 0)
        return Number(digits * BigInt(10) ** BigInt(power)) / 10000;
    const divisor = BigInt(10) ** BigInt(-power), rounded = digits / divisor + (digits % divisor > BigInt(0) ? BigInt(1) : BigInt(0));
    return Number(rounded) / 10000;
}
/** Matches, dated proof and cost/progress complete together. No direct Boolean updates or separate settlement. */
export async function completeDneskaiTikTokRun(db: Database, owner: string, input: {
    account: DneskaiAudioAccount;
    row: DneskaiTikTokProgress;
    run: DneskaiTikTokTerminalRun;
    matches: readonly DneskaiTikTokMatch[];
    now: Date;
    signal: AbortSignal;
}): Promise<number> {
    try {
        z.uuid().parse(owner);
        const account = DneskaiAudioAccountSchema.parse(input.account), row = runRow.parse(input.row), run = TikTokTerminalRunSchema.parse(input.run), matches = z.array(matchSchema).max(25).parse(input.matches);
        const instant = input.now.getTime();
        if (!Number.isFinite(instant))
            throw new Error();
        const observedAt = new Date(instant).toISOString(), version = databaseVersion(observedAt)!, day = pragueMarketingDate(new Date(instant)), sourceDay = pragueMarketingDate(new Date(row.reserved_at));
        if (run.usageUsd === null ||
            account.user_id !== owner ||
            databaseVersion(account.verified_at)! > version ||
            databaseVersion(row.reserved_at)! > version ||
            row.ref !== `tiktok:${run.id}:${run.datasetId}` ||
            new Set(matches.map(item => item.audioId)).size !== matches.length ||
            databaseVersion(run.startedAt)! < databaseVersion(row.reserved_at)! - BigInt(300000000) ||
            databaseVersion(run.finishedAt)! < databaseVersion(run.startedAt)! ||
            databaseVersion(run.finishedAt)! > version - BigInt(10000000) ||
            (matches.length && (run.status !== 'SUCCEEDED' ||
            sourceDay < new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10))))
            throw new Error();
        const signal = input.signal;
        signal.throwIfAborted();
        const reply = await awaitWithSignal(db.rpc('complete_dneskai_tiktok_run', {
            p_owner: owner, p_account: account.id, p_remote: account.remote_account_id, p_verified_at: account.verified_at, p_enabled: account.enabled, p_spend: row.id, p_ref: row.ref, p_reserved_at: row.reserved_at, p_day: day, p_observed_at: observedAt, p_run: run, p_matches: matches
        }).retry(false).abortSignal(signal), signal);
        signal.throwIfAborted();
        if (reply.error)
            throw new Error();
        const receipt = receiptSchema.parse(reply.data), cost = row.settled ? row.cost_usd! : ceilingCost(run.usageUsd!);
        if (receipt.ownerId !== owner ||
            receipt.accountId !== account.id ||
            receipt.remoteAccountId !== account.remote_account_id ||
            databaseVersion(receipt.verifiedAt) !== databaseVersion(account.verified_at) ||
            receipt.spendId !== row.id ||
            receipt.ref !== row.ref ||
            databaseVersion(receipt.reservedAt) !== databaseVersion(row.reserved_at) ||
            receipt.day !== day ||
            databaseVersion(receipt.observedAt) !== version ||
            receipt.sourceDay !== sourceDay ||
            receipt.costUsd !== cost ||
            Math.abs(Date.parse(receipt.completedAt) - instant) > 300000 ||
            pragueMarketingDate(new Date(receipt.completedAt)) !== day ||
            receipt.rows.length !== matches.length ||
            new Set(receipt.rows.map(proof => proof.audioId)).size !== matches.length)
            throw new Error();
        let confirmed = 0;
        for (const proof of receipt.rows) {
            if (!matches.some(item => item.audioId === proof.audioId) ||
                proof.accountId !== account.id ||
                proof.remoteAccountId !== account.remote_account_id ||
                databaseVersion(proof.verifiedAt) !== databaseVersion(account.verified_at) ||
                proof.sourceDay < sourceDay ||
                proof.sourceDay > day ||
                databaseVersion(proof.verifiedAt)! > databaseVersion(proof.observedAt)! ||
                databaseVersion(proof.observedAt)! > version + BigInt(300000000))
                throw new Error();
            if (proof.outcome === 'stored') {
                if (proof.spendId !== row.id || proof.sourceDay !== sourceDay || databaseVersion(proof.observedAt) !== version)
                    throw new Error();
                confirmed++;
            }
            else if (proof.spendId === row.id || (proof.sourceDay === sourceDay && databaseVersion(proof.observedAt)! <= version))
                throw new Error();
        }
        return confirmed;
    }
    catch {
        throw new Error('tiktok-completion-unavailable');
    }
}
