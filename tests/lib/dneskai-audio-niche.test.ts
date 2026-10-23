import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { rankDneskaiNicheSounds } from '@/lib/marketing/dneskai-audio-niche';
import type { DneskaiCandidate } from '@/lib/marketing/dneskai-contracts';

const reel = (id: string, music: NonNullable<DneskaiCandidate['instagram']>['music'], plays?: number) =>
  ({ externalId: id, instagram: { mediaType: 'video', music, ...(plays !== undefined ? { plays } : {}) } }) as DneskaiCandidate;
const song = (audioId: string, extra: Partial<NonNullable<NonNullable<DneskaiCandidate['instagram']>['music']>> = {}) => ({ audioId, title: `Song ${audioId}`, artist: 'A', originalAudio: false, muted: false, ...extra });

describe('rankDneskaiNicheSounds', () => {
  it('counts distinct reels per reusable sound, weighted by plays, and ignores original or muted audio', () => {
    const ranked = rankDneskaiNicheSounds([
      reel('r1', song('1'), 1000), reel('r2', song('1'), 500), reel('r2', song('1'), 500),
      reel('r3', song('2'), 1_000_000),
      reel('r4', song('3', { originalAudio: true }), 9_999_999), reel('r5', song('4', { muted: true }), 9_999_999),
      { externalId: 'r6', instagram: { mediaType: 'carousel' } } as DneskaiCandidate,
    ]);
    expect(ranked.map((sound) => [sound.audioId, sound.reels, sound.plays])).toEqual([['1', 2, 1500], ['2', 1, 1_000_000]]);
    expect(ranked[0]).toMatchObject({ title: 'Song 1', artist: 'A' });
  });
});
