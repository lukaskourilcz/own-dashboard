import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDneskaiSources, nextDneskaiSourceCheck, sourceExternalUrl } from '@/lib/marketing/dneskai-client';
const empty = { schemaVersion: 'dneskai-collection/1', timeZone: 'Europe/Prague', localTime: '22:00', dailyTarget: 4, approvalRequired: true, enabled: false, blockers: [], sources: [], sourceStates: [], candidates: [], runs: [] };
afterEach(() => { vi.unstubAllGlobals(); });
describe('route-scoped read-only DNESKAi source state', () => {
  it('uses exact project query, no-store and cancellation, and validates the server contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(empty)); vi.stubGlobal('fetch', fetcher); const signal = new AbortController().signal;
    expect(await loadDneskaiSources('a & b', signal)).toEqual(empty);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/marketing/dneskai/sources?projectId=a%20%26%20b', { cache: 'no-store', signal });
  });
  it.each([401, 403, 404, 503])('holds inaccessible source state (%s) without returning fabricated data', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ secret: 'not-for-ui' }, { status })));
    await expect(loadDneskaiSources('project')).rejects.toThrow('dneskai-source-state-unavailable');
  });
  it('rejects malformed versions and obsolete daily target instead of displaying them as current', async () => {
    for (const patch of [{ dailyTarget: 2 }, { timeZone: 'UTC' }, { approvalRequired: false }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...empty, ...patch })));
      await expect(loadDneskaiSources('project')).rejects.toThrow();
    }
  });
  it('computes next rotated 22:00 check by Prague date and DST, without claiming it ran', () => {
    expect(nextDneskaiSourceCheck({ weekdays: [2] }, new Date('2026-10-13T19:59:00Z'))).toBe('2026-10-13T20:00:00.000Z');
    expect(nextDneskaiSourceCheck({ weekdays: [2] }, new Date('2026-10-13T20:01:00Z'))).toBe('2026-10-20T20:00:00.000Z');
    expect(nextDneskaiSourceCheck({ weekdays: [0] }, new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25T21:00:00.000Z');
    expect(nextDneskaiSourceCheck({ weekdays: [0] }, new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29T20:00:00.000Z');
  });
  it('never creates credential-bearing or executable source links', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com', 'https://user:secret@example.com', 'invalid']) expect(sourceExternalUrl(value)).toBeNull();
    expect(sourceExternalUrl('https://example.com/feed')).toBe('https://example.com/feed');
  });
});
