import { expect, it } from 'vitest';
import { applyMarketingAccountControlReceipt, type MarketingAccountStatus } from '@/lib/marketing/accounts-client';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const version = '2026-10-27T10:00:00.000001Z', next = '2026-10-27T10:00:00.000002Z';
const input = { ownerId: owner, accountId: id, expectedVersion: version, enabled: true };
const account = (): MarketingAccountStatus => ({ id, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verifiedAt: version, updatedAt: version, enabled: false, token: null,
  engagement: { enabled: false, blockedCode: 'engagement-messaging-disabled', blockedAt: version, webhook: true } });
const receipt = (kind = 'publishing') => ({ kind: 'saved', ownerId: owner, id, expectedVersion: version, switch: kind, requestedEnabled: true, updatedAt: next });
it('patches the exact captured row and preserves all unrelated metadata and rows', () => {
  const original = account(), other = { ...account(), id: '33333333-3333-4333-8333-333333333333', brand: 'devshark' as const }, rows = [original, other];
  const result = applyMarketingAccountControlReceipt(rows, input, 'publishing', receipt());
  expect(result.reconcile).toBe(false);
  expect(result.accounts).toEqual([{ ...original, updatedAt: next, enabled: true }, other]);
  expect(result.accounts?.[1]).toBe(other);
  expect(rows[0]).toBe(original); expect(original.enabled).toBe(false);
});
it('clears engagement blocks only for an exact positive enable and preserves the webhook configuration', () => {
  const original = account(), result = applyMarketingAccountControlReceipt([original], input, 'engagement', receipt('engagement'));
  expect(result.accounts?.[0]).toEqual({ ...original, updatedAt: next, engagement: { ...original.engagement, enabled: true, blockedCode: null, blockedAt: null } });
});
it('preserves diagnostic fields when disabling engagement', () => {
  const original = account(), captured = { ...input, enabled: false }, result = applyMarketingAccountControlReceipt([original], captured, 'engagement', { ...receipt('engagement'), requestedEnabled: false });
  expect(result.accounts?.[0]?.engagement).toEqual(original.engagement);
});
it.each([undefined, [], [{ ...account(), id: '33333333-3333-4333-8333-333333333333' }], [{ ...account(), updatedAt: undefined }], [{ ...account(), updatedAt: next }]])('holds absent or newer cache instead of replacing it: %#', rows => {
  const result = applyMarketingAccountControlReceipt(rows, input, 'publishing', receipt());
  expect(result.reconcile).toBe(true); expect(result.accounts).toBe(rows);
});
it('compares PostgreSQL microseconds using equivalent timezone spellings', () => {
  const result = applyMarketingAccountControlReceipt([{ ...account(), updatedAt: '2026-10-27T12:00:00.000001+02:00' }], input, 'publishing', receipt());
  expect(result.reconcile).toBe(false);
});
it('does not invent an engagement record when the feature is absent', () => {
  const rows = [{ ...account(), engagement: undefined }], result = applyMarketingAccountControlReceipt(rows, input, 'engagement', receipt('engagement'));
  expect(result.reconcile).toBe(true); expect(result.accounts).toBe(rows);
});
it.each(['changed', 'absent', 'blocked'])('keeps the cache intact after a %s business outcome', kind => {
  const rows = [account()], value = { ...receipt(), kind, ...(kind === 'absent' ? { updatedAt: null } : kind === 'blocked' ? { updatedAt: version, code: 'access-token-expired' } : {}) };
  const result = applyMarketingAccountControlReceipt(rows, input, 'publishing', value);
  expect(result.reconcile).toBe(true); expect(result.accounts).toBe(rows);
});
it('refuses a contradictory receipt before patching anything', () => {
  const rows = [account()];
  expect(() => applyMarketingAccountControlReceipt(rows, input, 'publishing', { ...receipt(), requestedEnabled: false })).toThrow();
  expect(rows[0].enabled).toBe(false);
});
