import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
import { DneskaiAudioAccountSchema, type DneskaiAudioAccount } from './dneskai-audio-trends';
import { pragueMarketingDate } from './weekly-planning';
type Database = Pick<SupabaseClient, 'rpc'>;
export const DNESKAI_TIKTOK_ACTOR = Object.freeze({ id: 'sDvA9jM4WRTDX4Syr', name: 'clockworks~tiktok-trends-scraper' } as const);
/** 25 results estimate $0.0935 on Free / $0.076 on Starter (25 October); the charge cap stays $0.10. */
export const DNESKAI_TIKTOK_RESERVATION_USD = 0.1;
export const DNESKAI_TIKTOK_RESULTS = 25;
const chartInput = Object.freeze({
    adsScrapeSounds: true, adsSoundsCountryCode: 'CZ', adsRankType: 'surging', adsScrapeHashtags: false, adsScrapeCreators: false, adsScrapeVideos: false, resultsPerPage: DNESKAI_TIKTOK_RESULTS
} as const);
export const dneskaiTikTokInput = () => ({ ...chartInput });
const inputSchema = z.strictObject({
    adsScrapeSounds: z.literal(true), adsSoundsCountryCode: z.literal('CZ'), adsRankType: z.literal('surging'), adsScrapeHashtags: z.literal(false), adsScrapeCreators: z.literal(false), adsScrapeVideos: z.literal(false), resultsPerPage: z.literal(DNESKAI_TIKTOK_RESULTS)
});
const base = z.strictObject({
    ownerId: z.uuid(), accountId: z.uuid(), remoteAccountId: z.string().regex(/^\d{1,100}$/), verifiedAt: databaseTimestamp, enabled: z.boolean(), day: z.iso.date(), requestedAt: databaseTimestamp, actorId: z.literal(DNESKAI_TIKTOK_ACTOR.id), actorName: z.literal(DNESKAI_TIKTOK_ACTOR.name), input: inputSchema, reservationUsd: z.literal(DNESKAI_TIKTOK_RESERVATION_USD), ceilingUsd: z.number().positive().max(1), spentUsd: z.number().min(0).max(100000000)
});
const admittedSchema = base.extend({ admitted: z.literal(true), spendId: z.uuid(), reservedAt: databaseTimestamp });
const admissionSchema = z.discriminatedUnion('admitted', [admittedSchema, base.extend({ admitted: z.literal(false), spendId: z.null(), reservedAt: z.null() })]);
export type DneskaiTikTokAdmission = z.infer<typeof admittedSchema>;
export const DneskaiTikTokRegistrationSchema = z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), actorId: z.literal(DNESKAI_TIKTOK_ACTOR.id), datasetId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), startedAt: databaseTimestamp
});
export type DneskaiTikTokRegistration = z.infer<typeof DneskaiTikTokRegistrationSchema>;
const bindingSchema = z.strictObject({ admission: admittedSchema, provider: DneskaiTikTokRegistrationSchema, ref: z.string().regex(/^tiktok:[A-Za-z0-9_-]{1,100}:[A-Za-z0-9_-]{1,100}$/), boundAt: databaseTimestamp });
/** New paid starts need the current account and a positive owned reservation, not an unscoped UUID. */
export async function reserveDneskaiTikTokRun(db: Database, owner: string, input: {
    account: DneskaiAudioAccount;
    now: Date;
    ceilingUsd: number;
    signal: AbortSignal;
}): Promise<DneskaiTikTokAdmission | null> {
    try {
        z.uuid().parse(owner);
        const account = DneskaiAudioAccountSchema.parse(input.account), instant = input.now.getTime(), ceiling = z.number().positive().max(1).parse(input.ceilingUsd), signal = input.signal;
        if (!Number.isFinite(instant) || account.user_id !== owner)
            throw new Error();
        const requestedAt = new Date(instant).toISOString(), version = databaseVersion(requestedAt)!, day = pragueMarketingDate(new Date(instant));
        if (databaseVersion(account.verified_at)! > version)
            throw new Error();
        signal.throwIfAborted();
        const reply = await awaitWithSignal(db.rpc('reserve_dneskai_tiktok_run', {
            p_owner: owner, p_account: account.id, p_remote: account.remote_account_id, p_verified_at: account.verified_at, p_enabled: account.enabled, p_day: day, p_requested_at: requestedAt, p_ceiling: ceiling
        }).retry(false).abortSignal(signal), signal);
        signal.throwIfAborted();
        if (reply.error)
            throw new Error();
        const admission = admissionSchema.parse(reply.data);
        if (admission.ownerId !== owner || admission.accountId !== account.id || admission.remoteAccountId !== account.remote_account_id || databaseVersion(admission.verifiedAt) !== databaseVersion(account.verified_at) || admission.enabled !== account.enabled || admission.day !== day || databaseVersion(admission.requestedAt) !== version || admission.ceilingUsd !== ceiling)
            throw new Error();
        if (!admission.admitted)
            return null;
        if (admission.spentUsd + admission.reservationUsd > ceiling + 1e-10 || Math.abs(Date.parse(admission.reservedAt) - instant) > 300000 || pragueMarketingDate(new Date(admission.reservedAt)) !== day)
            throw new Error();
        return admission;
    }
    catch {
        throw new Error('tiktok-admission-unavailable');
    }
}
/** Confirm the already-started run against its original admission; an account switch must not lose its identity. */
export async function bindDneskaiTikTokRun(db: Database, owner: string, input: {
    admission: DneskaiTikTokAdmission;
    provider: DneskaiTikTokRegistration;
    now: Date;
    signal: AbortSignal;
}): Promise<void> {
    try {
        z.uuid().parse(owner);
        const admission = admittedSchema.parse(input.admission), provider = DneskaiTikTokRegistrationSchema.parse(input.provider), instant = input.now.getTime(), signal = input.signal;
        if (!Number.isFinite(instant) || admission.ownerId !== owner || databaseVersion(provider.startedAt)! < databaseVersion(admission.reservedAt)! - BigInt(300000000) || databaseVersion(provider.startedAt)! > BigInt(instant + 300000) * BigInt(1000))
            throw new Error();
        signal.throwIfAborted();
        const reply = await awaitWithSignal(db.rpc('bind_dneskai_tiktok_run', { p_owner: owner, p_admission: admission, p_provider: provider }).retry(false).abortSignal(signal), signal);
        signal.throwIfAborted();
        if (reply.error)
            throw new Error();
        const binding = bindingSchema.parse(reply.data);
        if (JSON.stringify(binding.admission) !== JSON.stringify(admission) || JSON.stringify(binding.provider) !== JSON.stringify(provider) || binding.ref !== `tiktok:${provider.id}:${provider.datasetId}` || Math.abs(Date.parse(binding.boundAt) - instant) > 300000 || databaseVersion(binding.boundAt)! < databaseVersion(admission.reservedAt)!)
            throw new Error();
    }
    catch {
        throw new Error('tiktok-bind-unavailable');
    }
}
