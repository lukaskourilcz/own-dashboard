import { expect, it } from 'vitest';
import { normalizeIco, parseVatId, vatCheckIsFresh } from '@/lib/tax-registry';
const now = new Date('2026-10-25T12:00:00Z');
const record = { vat_id: 'CZ27074358', vat_verification_status: 'valid' as const, vat_verified_at: '2026-10-25T11:00:00Z', vat_verified_id: 'CZ27074358' };
it.each([null, 123, true, [], {}, 'x'.repeat(100_000)])('bounds and refuses malformed registration input without throwing', raw => {
 expect(normalizeIco(raw)).toBe(''); expect(parseVatId(raw)).toBeNull();
});
it('never treats a future verdict as fresh', () => {
 expect(vatCheckIsFresh({ ...record, vat_verified_at: '2099-01-01T00:00:00Z' }, now)).toBe(false);
 expect(vatCheckIsFresh({ ...record, vat_verified_at: '2026-10-25T12:00:00.001Z' }, now)).toBe(false);
});
it.each([NaN, Infinity, -1])('refuses invalid freshness windows (%s)', days => { expect(vatCheckIsFresh(record, now, days)).toBe(false); });
it('refuses an invalid current clock and impossible stored calendar timestamp', () => {
 expect(vatCheckIsFresh(record, new Date(NaN))).toBe(false);
 expect(vatCheckIsFresh({ ...record, vat_verified_at: '2026-02-30T12:00:00Z' }, new Date('2026-03-03T12:00:00Z'))).toBe(false);
});
it.each(['IE9*12345AB', 'IE9+12345AB', 'IE12.3456AB'])('preserves significant VIES characters rather than checking a different number (%s)', vatId => {
 const parsed = parseVatId(vatId); expect(parsed).not.toBeNull(); expect(`${parsed!.countryCode}${parsed!.number}`).toBe(vatId);
});
it.each(['CZ<b>27074358</b>', 'CZ27074358?', 'CZ27074358/'])('refuses unsupported punctuation instead of deleting it (%s)', vatId => { expect(parseVatId(vatId)).toBeNull(); });
