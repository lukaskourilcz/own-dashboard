import { expect, it } from 'vitest';
import { confirmAccountVerification, type AccountVerificationIntent } from '@/lib/marketing/account-verification-contracts';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333', version = '2026-10-27T10:00:00.000001Z', advanced = '2026-10-27T10:00:00.000002Z';
const intent = (): AccountVerificationIntent => ({ ownerId: owner, accountId: id, expectedVersion: version, remoteAccountId: '17841400000000001', handle: 'dneskai', loginMode: 'instagram' });
const receipt = () => ({ kind: 'verified', ownerId: owner, expectedId: id, expectedVersion: version, id, updatedAt: advanced, result: { accountId: id, remoteAccountId: '17841400000000001', handle: 'dneskai', verifiedAt: version, enabled: true, tokenStored: true, token: { expiresAt: '2099-01-01T00:00:00Z', refreshedAt: version, scopes: ['instagram_business_basic', 'instagram_business_content_publish'], loginMode: 'instagram' } } });
it('accepts one exact captured existing verification and its finite positive metadata', () => expect(confirmAccountVerification(receipt(), intent())).toEqual(receipt()));
it('accepts a new account only for captured absence', () => {
 const value = { ...receipt(), expectedId: null, expectedVersion: null };
 expect(confirmAccountVerification(value, { ...intent(), accountId: null, expectedVersion: null })).toEqual(value);
});
it('retains full microseconds while accepting equivalent timezone spellings', () => {
 expect(confirmAccountVerification({ ...receipt(), expectedVersion: '2026-10-27T12:00:00.000001+02:00' }, intent()).kind).toBe('verified');
});
it.each([
 { ownerId: other }, { expectedId: other }, { expectedVersion: advanced }, { id: other }, { updatedAt: version }, { updatedAt: 'infinity' }, { extra: true },
 { result: { ...receipt().result, accountId: other } }, { result: { ...receipt().result, remoteAccountId: '999999999' } }, { result: { ...receipt().result, handle: 'another_handle' } },
 { result: { ...receipt().result, token: { ...receipt().result.token, loginMode: 'facebook' } } },
 { result: { ...receipt().result, token: { ...receipt().result.token, scopes: ['instagram_business_basic', 'instagram_business_basic'] } } },
 { result: { ...receipt().result, token: { ...receipt().result.token, expiresAt: 'infinity' } } },
 { result: { ...receipt().result, accessToken: 'TEST_ONLY_FORBIDDEN_RECEIPT_VALUE' } },
])('refuses a contradictory/partial/unsafe verification receipt: %#', patch => expect(() => confirmAccountVerification({ ...receipt(), ...patch }, intent())).toThrow());
it.each([{ id, updatedAt: version }, { id: other, updatedAt: advanced }, { id: null, updatedAt: null }])('accepts changed credential/account/absence without treating it as a save: %#', current => {
 const value = { kind: 'changed', ownerId: owner, expectedId: id, expectedVersion: version, ...current }; expect(confirmAccountVerification(value, intent())).toEqual(value);
});
it('does not accept a contradictory absent change for originally absent state', () => {
 expect(() => confirmAccountVerification({ kind: 'changed', ownerId: owner, expectedId: null, expectedVersion: null, id: null, updatedAt: null }, { ...intent(), accountId: null, expectedVersion: null })).toThrow();
});
it('refuses incomplete current identity/version pairs and missing capture versions', () => {
 expect(() => confirmAccountVerification({ kind: 'changed', ownerId: owner, expectedId: id, expectedVersion: version, id, updatedAt: null }, intent())).toThrow();
 expect(() => confirmAccountVerification(receipt(), { ...intent(), expectedVersion: null })).toThrow();
});
