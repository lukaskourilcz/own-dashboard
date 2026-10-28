import { z } from 'zod';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';

export const VerifiedAccountRecordSchema = z.strictObject({
  accountId: z.uuid(), remoteAccountId: z.string().regex(/^\d{1,100}$/), handle: z.string().regex(/^[A-Za-z0-9._]{1,30}$/),
  verifiedAt: databaseTimestamp, enabled: z.boolean(), tokenStored: z.boolean(),
  token: z.strictObject({ expiresAt: databaseTimestamp, refreshedAt: databaseTimestamp,
    scopes: z.array(z.string().regex(/^[a-z_]{1,64}$/)).max(20).refine(values => new Set(values).size === values.length),
    loginMode: z.enum(['instagram', 'facebook']),
  }),
});
const Intent = z.strictObject({ ownerId: z.uuid(), accountId: z.uuid().nullable(), expectedVersion: databaseTimestamp.nullable(),
  remoteAccountId: z.string().regex(/^\d{1,100}$/), handle: z.string().regex(/^[A-Za-z0-9._]{1,30}$/), loginMode: z.enum(['instagram', 'facebook']),
}).refine(value => (value.accountId === null) === (value.expectedVersion === null));
export type AccountVerificationIntent = z.infer<typeof Intent>;
const shared = { ownerId: z.uuid(), expectedId: z.uuid().nullable(), expectedVersion: databaseTimestamp.nullable() };
const Receipt = z.discriminatedUnion('kind', [
  z.strictObject({ ...shared, kind: z.literal('verified'), id: z.uuid(), updatedAt: databaseTimestamp, result: VerifiedAccountRecordSchema }),
  z.strictObject({ ...shared, kind: z.literal('changed'), id: z.uuid().nullable(), updatedAt: databaseTimestamp.nullable() }),
]);
const sameVersion = (a: string | null, b: string | null) => a === null || b === null ? a === b : databaseVersion(a) === databaseVersion(b);

/** Non-secret proof only. Private credential capture never enters this receipt. */
export function confirmAccountVerification(value: unknown, input: AccountVerificationIntent) {
  const intent = Intent.parse(input), receipt = Receipt.parse(value);
  if (receipt.ownerId !== intent.ownerId || receipt.expectedId !== intent.accountId || !sameVersion(receipt.expectedVersion, intent.expectedVersion)) {
    throw new Error('Account verification receipt unavailable');
  }
  if (receipt.kind === 'changed') {
    if ((receipt.id === null) !== (receipt.updatedAt === null) || intent.accountId === null && receipt.id === null) throw new Error('Account verification receipt unavailable');
    return receipt;
  }
  const current = databaseVersion(receipt.updatedAt), previous = intent.expectedVersion === null ? null : databaseVersion(intent.expectedVersion);
  const advances = current !== null && (intent.expectedVersion === null || previous !== null && current > previous);
  if (!advances || receipt.id !== receipt.result.accountId || intent.accountId !== null && receipt.id !== intent.accountId
    || receipt.result.remoteAccountId !== intent.remoteAccountId || receipt.result.handle !== intent.handle || receipt.result.token.loginMode !== intent.loginMode) {
    throw new Error('Account verification receipt unavailable');
  }
  return receipt;
}
