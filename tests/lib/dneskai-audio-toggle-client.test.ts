import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { qk } from '@/lib/queries/keys';
import { DEMO_DNESKAI_AUDIO_TRACKS, applyDneskaiAudioToggleReceipt, setDneskaiAudioTrackEnabled, loadDneskaiAudioOptions } from '@/lib/marketing/dneskai-audio-client';
vi.mock('@/lib/supabase/client', () => ({ createSignedStorageClient: vi.fn() }));
const owner = '11111111-1111-4111-8111-111111111111', row = DEMO_DNESKAI_AUDIO_TRACKS[0], intent = () => ({ action: 'toggle' as const, ownerId: owner, id: row.id, enabled: false, expectedVersion: row.updatedAt });
const receipt = () => ({ kind: 'saved' as const, ownerId: owner, id: row.id, requestedEnabled: false, expectedVersion: row.updatedAt, updatedAt: '2026-10-23T08:00:00.000001Z' });
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
it('sends the captured owner/version and accepts only its positive saved receipt', async () => {
    const captured = intent();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        expect(url).toBe('/api/marketing/dneskai/audio');
        expect(JSON.parse(String(init?.body))).toEqual(intent());
        return new Promise<Response>(resolve => {
            finish = resolve;
        });
    });
    vi.stubGlobal('fetch', fetcher);
    const pending = setDneskaiAudioTrackEnabled(captured);
    captured.ownerId = '22222222-2222-4222-8222-222222222222';
    captured.enabled = true;
    finish(Response.json({ receipt: receipt() }));
    expect(await pending).toEqual(receipt());
    expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
    {}, { ok: true }, { receipt: { ...receipt(), ownerId: '22222222-2222-4222-8222-222222222222' } }, { receipt: { ...receipt(), id: owner } }, { receipt: { ...receipt(), requestedEnabled: true } },
    { receipt: { ...receipt(), expectedVersion: '2026-10-23T08:00:00.000001Z' } }, { receipt: { ...receipt(), updatedAt: row.updatedAt } }, { receipt: { ...receipt(), kind: 'changed' } }, { receipt: { ...receipt(), kind: 'absent', updatedAt: null } }, { receipt: { ...receipt(), extra: true } },
])('never confirms an unscoped, stale or altered receipt: %#', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    await expect(setDneskaiAudioTrackEnabled(intent())).rejects.toHaveProperty('code', 'decision-failed');
});
it.each(['write', 'read'] as const)('discards a late %s response after the original lifetime is cancelled', async (kind) => {
    const parent = new AbortController(), cancel = vi.fn();
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => {
        finish = resolve;
    })));
    const pending = (kind === 'write' ? setDneskaiAudioTrackEnabled(intent(), parent.signal) : loadDneskaiAudioOptions(false, parent.signal)).catch(error => error);
    parent.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    finish(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
});
it('patches matching source copies without another read or changing unrelated tracks', () => {
    const client = new QueryClient(), key = [...qk.dneskaiAudio, false, 'pages'], page = { tracks: DEMO_DNESKAI_AUDIO_TRACKS, trends: [], nextOffset: null };
    client.setQueryData(key, { pages: [page], pageParams: [0] });
    client.setQueryData([...qk.dneskaiAudio, false, 'selected', row.id], { ...page, tracks: [row] });
    expect(applyDneskaiAudioToggleReceipt(client, intent(), receipt())).toEqual({ reconcile: false });
    const cached = client.getQueryData<{
        pages: Array<typeof page>;
    }>(key)!;
    expect(cached.pages[0].tracks[0]).toMatchObject({ enabled: false, updatedAt: receipt().updatedAt });
    expect(cached.pages[0].tracks[1]).toBe(DEMO_DNESKAI_AUDIO_TRACKS[1]);
    client.clear();
});
it('preserves a newer cached value and requests reconciliation instead of rolling it back', () => {
    const client = new QueryClient(), key = [...qk.dneskaiAudio, false, 'pages'], newer = { ...row, updatedAt: '2026-10-23T08:00:00.000002Z', enabled: true };
    client.setQueryData(key, { pages: [{ tracks: [newer] }], pageParams: [0] });
    expect(applyDneskaiAudioToggleReceipt(client, intent(), receipt())).toEqual({ reconcile: true });
    expect(client.getQueryData<{
        pages: Array<{
            tracks: typeof row[];
        }>;
    }>(key)!.pages[0].tracks[0]).toBe(newer);
    client.clear();
});
it('refuses a foreign receipt before touching either cache', () => {
    const client = new QueryClient(), key = [...qk.dneskaiAudio, false, 'pages'];
    client.setQueryData(key, { pages: [{ tracks: [row] }], pageParams: [0] });
    const before = client.getQueryData(key);
    expect(() => applyDneskaiAudioToggleReceipt(client, intent(), { ...receipt(), ownerId: '22222222-2222-4222-8222-222222222222' })).toThrow('decision-failed');
    expect(client.getQueryData(key)).toBe(before);
    client.clear();
});
