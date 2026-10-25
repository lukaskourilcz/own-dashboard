import { expect, it } from 'vitest';
import { isOsloSnapshot } from '@/lib/jobs/filter';

it('keeps verified native Europe remote snapshots in the Norway view', () => {
 const saved = { source: 'ashby-sanity', location: 'Europe', remote: true };
 expect(isOsloSnapshot(saved)).toBe(true);
});
it('explicit onsite evidence overrides remote-only source and location fallbacks', () => {
 const saved = { source: 'remotive', location: 'Remote Europe', remote: false };
 expect(isOsloSnapshot(saved)).toBe(false);
});
it('keeps unknown legacy evidence conservative and Oslo local positions visible', () => {
 expect(isOsloSnapshot({ source: 'ashby-sanity', location: 'Europe', remote: null })).toBe(false);
 expect(isOsloSnapshot({ source: 'remotive', location: 'Europe', remote: null })).toBe(true);
 expect(isOsloSnapshot({ source: 'manual', location: 'Oslo', remote: false })).toBe(true);
});
