import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
vi.mock('server-only', () => ({}));
import { listDneskaiAudioTrends } from '@/lib/marketing/dneskai-audio-trends';
import { DneskaiAudioLibrarySchema } from '@/lib/marketing/dneskai-audio-contracts';

const owner = '11111111-1111-4111-8111-111111111111';
const row = (id: number, patch = {}) => ({ user_id: owner, audio_id: String(id), title: `Sound ${id}`, display_artist: null, audio_type: 'music', duration_ms: 1000, cover_artwork_thumbnail_url: null, days_seen: 1, niche_count: 0, tiktok: false, last_seen: '2026-10-25', ...patch });
const niche = (id: number) => ({ audioId: String(id), title: `Niche ${id}`, artist: null, reels: 1, plays: 1, score: 1 });
function database(rows: unknown[], wire?: () => Promise<Response>) {
 const calls: { url: URL; signal: AbortSignal | null | undefined }[] = [];
 const db = createClient('https://offline.supabase.test', 'TEST-ONLY-public', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => { calls.push({ url: new URL(String(input)), signal: init?.signal }); return wire ? wire() : Response.json(rows); } } });
 return { db, calls };
}
afterEach(() => { vi.restoreAllMocks(); });
it('keeps fifty Meta sounds plus fifteen niche hints inside the shared fifty-result client contract', async () => {
 const h = database(Array.from({ length: 50 }, (_, i) => row(i + 1)));
 const result = await listDneskaiAudioTrends(h.db, owner, '2026-10-25', Array.from({ length: 15 }, (_, i) => niche(i + 100)));
 expect(result).toHaveLength(50); expect(result.every(sound => sound.attachable)).toBe(true);
 expect(DneskaiAudioLibrarySchema.safeParse({ tracks: [], trends: result }).success).toBe(true);
 expect(h.calls).toHaveLength(1);
});
it('keeps Meta priority, fills only remaining hint slots and orders ties deterministically without mutating inputs', async () => {
 const rows = Array.from({ length: 45 }, (_, i) => row(i + 1)), hints = Array.from({ length: 15 }, (_, i) => niche(i + 100));
 const first = await listDneskaiAudioTrends(database(rows).db, owner, '2026-10-25', hints);
 const second = await listDneskaiAudioTrends(database([...rows].reverse()).db, owner, '2026-10-25', [...hints].reverse());
 expect(first).toEqual(second); expect(first).toHaveLength(50); expect(first.filter(sound => sound.attachable)).toHaveLength(45); expect(first.slice(45).map(sound => sound.audioId)).toEqual(['100', '101', '102', '103', '104']);
 expect(hints[0].audioId).toBe('100'); expect(rows[0].audio_id).toBe('1');
});
it('projects owned fresh metadata and preserves the niche join in one bounded query', async () => {
 const h = database([row(1), row(2, { days_seen: 5 })]);
 const result = await listDneskaiAudioTrends(h.db, owner, '2026-10-25', [{ ...niche(1), reels: 4 }]);
 expect(result.map(sound => sound.audioId)).toEqual(['1', '2']); expect(result[0].nicheCount).toBe(4);
 const params = h.calls[0].url.searchParams;
 expect(params.get('user_id')).toBe(`eq.${owner}`); expect(params.get('last_seen')).toBe('gte.2026-10-24'); expect(params.getAll('last_seen')).toEqual(['gte.2026-10-24', 'lte.2026-10-25']); expect(params.get('limit')).toBe('50'); expect(params.get('order')).toBe('days_seen.desc,audio_id.asc'); expect(params.get('select')).toContain('user_id');
});
it.each(['2026-02-30', 'not-a-date'])('refuses an invalid calendar day before requesting (%s)', async day => {
 const h = database([]); await expect(listDneskaiAudioTrends(h.db, owner, day)).rejects.toThrow('audio-trends-store-failed'); expect(h.calls).toHaveLength(0);
});
it.each([
 ['foreign', [row(1, { user_id: '22222222-2222-4222-8222-222222222222' })]],
 ['future', [row(1, { last_seen: '2026-10-26' })]],
 ['stale', [row(1, { last_seen: '2026-10-23' })]],
 ['duplicate', [row(1), row(1)]],
 ['invalid-count', [row(1, { days_seen: -1 })]],
 ['unsafe-artwork', [row(1, { cover_artwork_thumbnail_url: 'https://synthetic:synthetic@cdn.example.test/a.png' })]],
 ['invalid-type', [row(1, { audio_type: 'podcast' })]],
 ['missing-title', [row(1, { title: null })]],
 ['overflow', Array.from({ length: 51 }, (_, i) => row(i + 1))],
] as const)('refuses %s evidence instead of casting it into a successful list', async (_label, rows) => {
 const h = database([...rows]); await expect(listDneskaiAudioTrends(h.db, owner, '2026-10-25')).rejects.toThrow('audio-trends-store-failed'); expect(h.calls).toHaveLength(1);
});
it.each([{ hints: [niche(1), niche(1)] }, { hints: [{ ...niche(1), reels: -1 }] }])('refuses inconsistent niche evidence before the read (%j)', async ({ hints }) => {
 const h = database([]); await expect(listDneskaiAudioTrends(h.db, owner, '2026-10-25', hints)).rejects.toThrow('audio-trends-store-failed'); expect(h.calls).toHaveLength(0);
});
it('returns a fixed database refusal with no hidden SDK retry', async () => {
 const h = database([], async () => Response.json({ message: 'synthetic-private-database-detail' }, { status: 503 }));
 await expect(listDneskaiAudioTrends(h.db, owner, '2026-10-25')).rejects.toThrow(/^audio-trends-store-failed$/); expect(h.calls).toHaveLength(1);
});
it('stops a stalled actual SDK read at its deadline and ignores the late result', async () => {
 const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
 let finish!: (response: Response) => void;
 const h = database([], () => new Promise(resolve => { finish = resolve; }));
 const result = listDneskaiAudioTrends(h.db, owner, '2026-10-25').catch(error => error);
 await vi.waitFor(() => expect(h.calls).toHaveLength(1)); deadline.abort();
 expect(await result).toHaveProperty('message', 'audio-trends-store-failed'); expect(h.calls[0].signal?.aborted).toBe(true); expect(AbortSignal.timeout).toHaveBeenCalledWith(15000);
 finish(Response.json([row(1)])); await Promise.resolve(); expect(h.calls).toHaveLength(1);
});
it('rejects an already cancelled caller before transport without exposing its reason', async () => {
 const h = database([]), parent = new AbortController(); parent.abort('synthetic-private-abort');
 await expect(listDneskaiAudioTrends(h.db, owner, '2026-10-25', [], parent.signal)).rejects.toThrow(/^audio-trends-store-failed$/); expect(h.calls).toHaveLength(0);
});
