import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createSignedStorageClient: () => ({ from: () => ({ uploadToSignedUrl: m.upload }) }) }));
import { createDneskaiAudioUploadSession, DEMO_DNESKAI_AUDIO_TRACKS } from '@/lib/marketing/dneskai-audio-client';
const owner = '11111111-1111-4111-8111-111111111111', id = '33333333-3333-4333-8333-333333333333';
const fields = { title: 'Captured track', artist: 'Fixture artist', source: 'original' as const, licenceNote: 'Own fixture', sourceUrl: 'https://example.test/audio', mood: ['calm'] };
beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);
    m.upload.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
it('checks the original upload instead of transferring it again after a lost create acknowledgement', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);
    m.upload.mockReset().mockResolvedValue({ error: null });
    let creates = 0;
    const phases: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        phases.push(body.action);
        if (body.action === 'prepare')
            return Response.json({ ownerId: owner, uploadId: id, path: owner + '/' + id + '.mp3', token: 'set' });
        if (++creates === 1)
            return Response.json({ error: 'audio-library-unavailable' }, { status: 503 });
        return Response.json({ ownerId: owner, track: { ...DEMO_DNESKAI_AUDIO_TRACKS[0], ...fields, id } });
    }));
    const file = new File(['fixture'], 'fixture.mp3', { type: 'audio/mpeg' });
    const session = createDneskaiAudioUploadSession({ ownerId: owner, signal: new AbortController().signal }, file, fields);
    await expect(session.run()).rejects.toHaveProperty('code', 'audio-library-unavailable');
    await session.run();
    expect(m.upload).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['prepare', 'create', 'create']);
});
const make = (controller = new AbortController(), metadata = { ...fields, mood: [...fields.mood] }) => createDneskaiAudioUploadSession({ ownerId: owner, signal: controller.signal }, new File(['fixture'], 'fixture.mp3', { type: 'audio/mpeg' }), metadata);
const saved = () => ({ ownerId: owner, track: { ...DEMO_DNESKAI_AUDIO_TRACKS[0], ...fields, id, enabled: false } });
const prepared = () => ({ ownerId: owner, uploadId: id, path: owner + '/' + id + '.mp3', token: 'set' });
it('captures metadata and original owner before preparing, preserving later disabled state', async () => {
    const metadata = { ...fields, mood: [...fields.mood] }, scope = { ownerId: owner, signal: new AbortController().signal };
    const session = createDneskaiAudioUploadSession(scope, new File(['fixture'], 'fixture.mp3', { type: 'audio/mpeg' }), metadata);
    metadata.title = 'Later title';
    metadata.mood.push('bright');
    scope.ownerId = id;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        return Response.json(body.action === 'prepare' ? prepared() : saved());
    }));
    expect((await session.run()).enabled).toBe(false);
    expect(bodies).toEqual([{ action: 'prepare', ownerId: owner, uploadId: id, contentType: 'audio/mpeg', bytes: 7 }, { ...fields, action: 'create', ownerId: owner, uploadId: id, contentType: 'audio/mpeg' }]);
    expect(Object.keys(session).sort()).toEqual(['ownerId', 'run', 'uploadId']);
    expect(Object.isFrozen(session)).toBe(true);
});
it.each(['audio-library-unavailable', 'audio-track-write-failed', 'decision-failed', 'rate-limited', 'unauthorized'])('does not transfer again after unconfirmed retry: %s', async (error) => {
    const session = make(), phases: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        phases.push(body.action);
        return body.action === 'prepare' ? Response.json(prepared()) : Response.json({ error }, { status: 503 });
    }));
    await expect(session.run()).rejects.toHaveProperty('code', error);
    await expect(session.run()).rejects.toHaveProperty('code', error);
    expect(m.upload).toHaveBeenCalledOnce();
    expect(phases).toEqual(['prepare', 'create', 'create']);
});
it('retransfers the same identity only after positive missing-file confirmation', async () => {
    const session = make(), phases: string[] = [], ids: string[] = [];
    let creates = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        phases.push(body.action);
        ids.push(body.uploadId);
        if (body.action === 'prepare')
            return Response.json(prepared());
        if (++creates < 3)
            return Response.json({ error: creates === 1 ? 'audio-library-unavailable' : 'audio-upload-missing' }, { status: 503 });
        return Response.json(saved());
    }));
    await expect(session.run()).rejects.toHaveProperty('code', 'audio-library-unavailable');
    expect((await session.run()).id).toBe(id);
    expect(m.upload).toHaveBeenCalledTimes(2);
    expect(phases).toEqual(['prepare', 'create', 'create', 'prepare', 'create']);
    expect(new Set(ids)).toEqual(new Set([id]));
});
it('checks an ambiguous failed transfer before another transfer', async () => {
    m.upload.mockResolvedValueOnce({ error: { message: 'TEST_ONLY_PRIVATE_DETAIL' } });
    const session = make(), phases: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        phases.push(body.action);
        return Response.json(body.action === 'prepare' ? prepared() : saved());
    }));
    await expect(session.run()).rejects.toHaveProperty('code', 'decision-failed');
    await session.run();
    expect(m.upload).toHaveBeenCalledOnce();
    expect(phases).toEqual(['prepare', 'create']);
});
it('reprepares the original identity after a failure before transfer', async () => {
    const session = make();
    let requests = 0;
    const ids: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        ids.push(body.uploadId);
        if (++requests === 1)
            return Response.json({ error: 'audio-library-unavailable' }, { status: 503 });
        return Response.json(body.action === 'prepare' ? prepared() : saved());
    }));
    await expect(session.run()).rejects.toHaveProperty('code', 'audio-library-unavailable');
    await session.run();
    expect(m.upload).toHaveBeenCalledOnce();
    expect(ids).toEqual([id, id, id]);
});
it.each([{ ownerId: id }, { uploadId: owner }, { path: id + '/' + id + '.mp3' }])('refuses a prepared receipt for another original intent: %#', async (patch) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...prepared(), ...patch })));
    await expect(make().run()).rejects.toHaveProperty('code', 'decision-failed');
    expect(m.upload).not.toHaveBeenCalled();
});
it('refuses a creation receipt from another owner without another transfer', async () => {
    const session = make();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => Response.json(JSON.parse(init.body).action === 'prepare' ? prepared() : { ...saved(), ownerId: id })));
    await expect(session.run()).rejects.toHaveProperty('code', 'decision-failed');
    await expect(session.run()).rejects.toHaveProperty('code', 'decision-failed');
    expect(m.upload).toHaveBeenCalledOnce();
});
it('admits one run synchronously and never resumes a retired original owner', async () => {
    const controller = new AbortController(), session = make(controller);
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => {
        finish = resolve;
    }));
    vi.stubGlobal('fetch', fetcher);
    const first = session.run();
    await expect(session.run()).rejects.toHaveProperty('code', 'decision-failed');
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    await expect(first).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    finish(Response.json(prepared()));
    await expect(session.run()).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(m.upload).not.toHaveBeenCalled();
});
