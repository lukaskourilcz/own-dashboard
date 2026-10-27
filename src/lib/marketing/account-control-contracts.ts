import { z } from 'zod';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
export const MarketingAccountSwitchSchema = z.enum(['publishing', 'engagement']);
export type MarketingAccountSwitch = z.infer<typeof MarketingAccountSwitchSchema>;
export const MarketingAccountControlSchema = z.strictObject({ ownerId: z.uuid(), accountId: z.uuid(), expectedVersion: databaseTimestamp, enabled: z.boolean() });
export type MarketingAccountControl = z.infer<typeof MarketingAccountControlSchema>;
const receipt = z.strictObject({ ownerId: z.uuid(), id: z.uuid(), expectedVersion: databaseTimestamp, switch: MarketingAccountSwitchSchema, requestedEnabled: z.boolean() });
export const MarketingAccountControlReceiptSchema = z.discriminatedUnion('kind', [
    receipt.extend({ kind: z.literal('saved'), updatedAt: databaseTimestamp }),
    receipt.extend({ kind: z.literal('changed'), updatedAt: databaseTimestamp }),
    receipt.extend({ kind: z.literal('absent'), updatedAt: z.null() }),
    receipt.extend({ kind: z.literal('blocked'), updatedAt: databaseTimestamp, code: z.enum(['account-not-verified', 'access-token-missing', 'access-token-expired', 'engagement-scopes-unverified']) }),
]);
export type MarketingAccountControlReceipt = z.infer<typeof MarketingAccountControlReceiptSchema>;
/** Timestamp spelling may differ, but the full captured PostgreSQL microsecond may not. */
export function confirmMarketingAccountControl(value: unknown, input: MarketingAccountControl, kind: MarketingAccountSwitch): MarketingAccountControlReceipt {
    const intent = MarketingAccountControlSchema.parse(input), checked = MarketingAccountSwitchSchema.parse(kind), result = MarketingAccountControlReceiptSchema.parse(value), expected = databaseVersion(intent.expectedVersion), version = result.updatedAt === null ? null : databaseVersion(result.updatedAt);
    if (result.ownerId !== intent.ownerId || result.id !== intent.accountId || result.switch !== checked || result.requestedEnabled !== intent.enabled || databaseVersion(result.expectedVersion) !== expected
        || result.kind === 'saved' && (version === null || expected === null || version <= expected)
        || result.kind === 'changed' && version === expected
        || result.kind === 'blocked' && (!intent.enabled || version !== expected))
        throw new Error('Account control unconfirmed');
    return result;
}
