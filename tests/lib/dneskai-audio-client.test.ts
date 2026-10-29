import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn(), factory: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createSignedStorageClient: mocks.factory }));
import { DEMO_DNESKAI_AUDIO_TRACKS, dneskaiAudioFileProblem, loadDneskaiAudioOptions, setDneskaiAudioTrackEnabled, createDneskaiAudioUploadSession } from '@/lib/marketing/dneskai-audio-client';
const id = '33333333-3333-4333-8333-333333333333', owner = '11111111-1111-4111-8111-111111111111';
const prepared = () => ({ ownerId: owner, uploadId: id, path: `${owner}/${id}.mp3`, token: 'set' });
const fields = () => ({ title: 'Captured track', artist: 'Fixture artist', source: 'original' as const, licenceNote: 'Own fixture recording', sourceUrl: 'https://example.test/audio', mood: ['calm'] });
const file = () => new File(['fixture'], 'fixture.mp3', { type: 'audio/mpeg' });
const track = () => ({ ...DEMO_DNESKAI_AUDIO_TRACKS[0]!, id, ...fields(), enabled: false });
async function uploadDneskaiAudioTrack(file:File,metadata:ReturnType<typeof fields>,parent?:AbortSignal){return createDneskaiAudioUploadSession({ownerId:owner,signal:parent ?? new AbortController().signal},file,metadata).run();}
beforeEach(() => { vi.spyOn(crypto,'randomUUID').mockReturnValue(id); mocks.upload.mockReset().mockResolvedValue({ error: null }); mocks.factory.mockReset().mockImplementation(() => ({ from: () => ({ uploadToSignedUrl: mocks.upload }) })); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const outcome = (pending: Promise<unknown>) => pending.then(() => 'unexpected-success', error => ({ code: error.code, name: error.name, message: error.message }));
function stalledBudget() { const controller = new AbortController(); const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal); return { controller, timeout }; }

describe('audio request/body bounds and safe recovery', () => {
  it('keeps preview offline', async () => { const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); expect((await loadDneskaiAudioOptions(true))!.tracks).toHaveLength(2); expect(fetcher).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled(); });
  it.each([-1, 1.5, 1_000_001, NaN])('refuses an invalid page before HTTP (%s)', async offset => { const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await expect(loadDneskaiAudioOptions(false, undefined, offset)).rejects.toHaveProperty('code', 'decision-failed'); expect(fetcher).not.toHaveBeenCalled(); });
  it.each(['constructor', 'synthetic-private-detail'])('does not expose unknown or inherited error codes (%s)', async code => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: code }, { status: 503 })));
    expect(await outcome(loadDneskaiAudioOptions(false))).toMatchObject({ code: 'decision-failed', message: 'decision-failed' });
  });
  it('recognizes only a strict known refusal and rate-limited responses', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'unauthorized' }, { status: 401 })).mockResolvedValueOnce(Response.json({ error: 'unauthorized', detail: 'synthetic-private-detail' }, { status: 401 })).mockResolvedValueOnce(Response.json({ error: 'decision-failed' }, { status: 429 })); vi.stubGlobal('fetch', fetcher);
    await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code', 'unauthorized'); await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code', 'decision-failed'); await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code', 'rate-limited');
  });
  it('hides only a confirmed disabled feature and refuses unverified 404 responses', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'not-found' }, { status: 404 })).mockResolvedValueOnce(Response.json({ error: 'audio-track-unavailable' }, { status: 404 })).mockResolvedValueOnce(new Response('not an API reply', { status: 404 })); vi.stubGlobal('fetch', fetcher);
    expect(await loadDneskaiAudioOptions(false)).toBeNull(); await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code', 'audio-track-unavailable'); await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code', 'decision-failed');
  });
  it('recognizes a rate limit without trusting an HTML or stalled response body', async () => {
    const cancel = vi.fn(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 429 })));
    await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code', 'rate-limited'); expect(cancel).toHaveBeenCalledOnce();
  });
  it('refuses a malformed selection before HTTP', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await expect(loadDneskaiAudioOptions(false, undefined, 0, 'constructor')).rejects.toHaveProperty('code', 'decision-failed'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses duplicate trend identities', async () => {
    const trend = { audioId: '9', title: 'Fixture sound', artist: null, type: 'music', durationMs: 1000, coverUrl: null, daysSeen: 1, nicheCount: 0, tiktok: false, attachable: true };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ tracks: [], trends: [trend, trend] }))); await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code', 'decision-failed');
  });
  it.each(['duplicate', 'cycle', 'skipped-page', 'wrong-selection'])('refuses an inconsistent page (%s)', async kind => {
    const row = track(), body = { tracks: kind === 'duplicate' ? [row, row] : [row], nextOffset: kind === 'cycle' ? 0 : kind === 'skipped-page' ? 200 : null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    await expect(loadDneskaiAudioOptions(false, undefined, 0, kind === 'wrong-selection' ? owner : undefined)).rejects.toHaveProperty('code', 'decision-failed');
  });
  it('cancels an oversized list body', async () => {
    const cancel = vi.fn(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(2_097_153))); }, cancel }))));
    await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code', 'decision-failed'); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(['fetch', 'body'])('applies one read deadline to a stalled %s without retries', async kind => {
    const { controller, timeout } = stalledBudget(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }));
    const fetcher = vi.fn().mockImplementation(() => kind === 'fetch' ? new Promise(() => {}) : Promise.resolve(response)); vi.stubGlobal('fetch', fetcher);
    const result = outcome(loadDneskaiAudioOptions(false)); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); if (kind === 'body') await vi.waitFor(() => expect(response.body!.locked).toBe(true)); controller.abort('synthetic-private-reason');
    expect(await result).toMatchObject({ code: 'decision-failed', message: 'decision-failed' }); expect(timeout).toHaveBeenCalledWith(20_000); expect(fetcher).toHaveBeenCalledOnce(); if (kind === 'body') expect(cancel).toHaveBeenCalledOnce();
  });
  it('honors caller cancellation without exposing its reason', async () => {
    const parent = new AbortController(); parent.abort('synthetic-private-reason'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await outcome(loadDneskaiAudioOptions(false, parent.signal))).toMatchObject({ name: 'AbortError', message: 'Request aborted' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{}, { ok: false }, { ok: true, extra: true }])('refuses a malformed toggle acknowledgement (%j)', async body => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body))); await expect(setDneskaiAudioTrackEnabled({action:'toggle',ownerId:owner,id,enabled:true,expectedVersion:track().updatedAt})).rejects.toHaveProperty('code', 'decision-failed'); });
});

describe('captured and bounded audio upload', () => {
  it('checks type, size and fields before any prepare request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(dneskaiAudioFileProblem({ type: 'constructor', size: 1 })).toBe('fileType'); expect(dneskaiAudioFileProblem({ type: 'audio/mpeg', size: NaN })).toBe('fileSize');
    await expect(uploadDneskaiAudioTrack(file(), { ...fields(), title: ' ' })).rejects.toHaveProperty('code', 'invalid-request'); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['https://fixture-only@example.test/audio', 'https://example.test/\nfile', 'https://example.test/\\file', 'http://example.test/audio'])('refuses unsafe source-page fields before any prepare (%#)', async sourceUrl => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await expect(uploadDneskaiAudioTrack(file(), { ...fields(), sourceUrl })).rejects.toHaveProperty('code', 'invalid-request'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses valid but oversized UTF-8 metadata before preparing or transferring a file', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const value = { ...fields(), title: '界'.repeat(120), artist: '界'.repeat(120), licenceNote: '界'.repeat(500), sourceUrl: 'https://example.test/' + '界'.repeat(1900), mood: Array.from({ length: 5 }, () => '界'.repeat(30)) };
    await expect(uploadDneskaiAudioTrack(file(), value)).rejects.toHaveProperty('code', 'invalid-request'); expect(fetcher).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('cancels an oversized prepare response before transferring any file', async () => {
    const cancel = vi.fn(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(16_385))); }, cancel }))));
    await expect(uploadDneskaiAudioTrack(file(), fields())).rejects.toHaveProperty('code', 'decision-failed'); expect(cancel).toHaveBeenCalledOnce(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it.each(['wrong-id', 'traversal', 'wrong-extension', 'extra-folder'])('refuses an uncorrelated prepared path before Storage (%s)', async kind => {
    const path = kind === 'wrong-id' ? `${owner}/${owner}.mp3` : kind === 'traversal' ? `../${id}.mp3` : kind === 'wrong-extension' ? `${owner}/${id}.wav` : `${owner}/extra/${id}.mp3`;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...prepared(), path })); vi.stubGlobal('fetch', fetcher);
    await expect(uploadDneskaiAudioTrack(file(), fields())).rejects.toHaveProperty('code', 'decision-failed'); expect(fetcher).toHaveBeenCalledOnce(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it.each(['id', 'title', 'artist', 'source', 'sourceUrl', 'licenceNote', 'mood'])('requires a matching created track %s', async key => {
    const changed = { ...track(), [key]: key === 'id' ? owner : key === 'source' ? 'pixabay' : key === 'mood' ? ['other'] : key === 'sourceUrl' ? 'https://example.test/other' : 'Other' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(prepared())).mockResolvedValueOnce(Response.json({ ownerId:owner, track: changed })));
    await expect(uploadDneskaiAudioTrack(file(), fields())).rejects.toHaveProperty('code', 'decision-failed');
  });
  it('captures fields before prepare, reuses one whole-flow signal and preserves a later disable', async () => {
    const captured = fields(), calls: Array<Record<string, unknown>> = []; let release!: () => void;
    mocks.upload.mockImplementation(() => new Promise(resolve => { release = () => resolve({ error: null }); }));
    const signals: Array<AbortSignal | null | undefined> = [], fetcher = vi.fn(async (_url, init) => { signals.push(init.signal); const body = JSON.parse(init.body); calls.push(body); return Response.json(body.action === 'prepare' ? prepared() : { ownerId:owner, track: track() }); }); vi.stubGlobal('fetch', fetcher);
    const result = uploadDneskaiAudioTrack(file(), captured); await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce()); captured.title = 'Changed during upload'; captured.mood.push('bright'); release();
    const saved = await result; expect(saved.id).toBe(id); expect(saved.enabled).toBe(false); expect(calls[1]).toMatchObject({ title: 'Captured track', mood: ['calm'] }); expect(signals[0]).toBe(signals[1]); expect(mocks.factory.mock.calls[0]![0]).toBe(signals[0]);
  });
  it.each(['prepare', 'storage', 'create'])('applies one 55-second budget across a stalled %s phase', async phase => {
    const { controller, timeout } = stalledBudget();
    if (phase === 'storage') mocks.upload.mockImplementation(() => new Promise(() => {}));
    const fetcher = vi.fn(async (_url, init) => { const body = JSON.parse(init.body); if (body.action === phase) return new Promise<Response>(() => {}); return Response.json(prepared()); }); vi.stubGlobal('fetch', fetcher);
    const result = outcome(uploadDneskaiAudioTrack(file(), fields())); await vi.waitFor(() => expect(phase === 'storage' ? mocks.upload.mock.calls.length : fetcher.mock.calls.length).toBe(phase === 'create' ? 2 : 1)); controller.abort('synthetic-private-reason');
    expect(await result).toMatchObject({ code: 'decision-failed', message: 'decision-failed' }); expect(timeout).toHaveBeenCalledExactlyOnceWith(55_000); expect(fetcher.mock.calls.length).toBe(phase === 'create' ? 2 : 1);
  });
  it('does not expose Storage exceptions or claim a failed file transfer was confirmed missing', async () => {
    mocks.upload.mockResolvedValue({ error: new Error('synthetic-private-storage-detail') }); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(prepared())));
    expect(await outcome(uploadDneskaiAudioTrack(file(), fields()))).toMatchObject({ code: 'decision-failed', message: 'decision-failed' });
  });
});

describe('independent optional trend availability',()=>{
 it.each(['ready','unavailable','disabled'] as const)('retains owned library data and the explicit %s state',async trendsStatus=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({tracks:[track()],trends:[],trendsStatus,nextOffset:null})));expect(await loadDneskaiAudioOptions(false)).toMatchObject({tracks:[track()],trends:[],trendsStatus});});
 it.each([{trendsStatus:'ready'},{trendsStatus:'unknown',trends:[]},{trendsStatus:'unavailable',trends:[{audioId:'9',title:'Synthetic',artist:null,type:'music',durationMs:null,coverUrl:null,daysSeen:1,nicheCount:0,tiktok:false,attachable:true}]}])('refuses contradictory or unverified optional metadata %j',async optional=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({tracks:[track()],...optional})));await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code','decision-failed');});
});

describe('captured Music cursor continuation', () => {
  const cursor = () => ({id, createdAt: '2026-10-23T08:00:00.000001Z'});
  it.each([
    {after: undefined, offset: 1},
    {after: cursor(), offset: 0},
    {after: {...cursor(), id: 'invalid'}, offset: 1},
    {after: {...cursor(), createdAt: '2026-10-23T08:00:00.0000001Z'}, offset: 1},
    {after: {...cursor(), extra: true}, offset: 1},
  ])('refuses an invalid cursor selector before HTTP: %#', async ({after, offset}) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(loadDneskaiAudioOptions(false, undefined, offset, undefined, after)).rejects.toHaveProperty('code', 'decision-failed');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['missing','wrong-id','wrong-time','extra','terminal'] as const)('requires a correlated next cursor: %s', async kind => {
    const row = track(), boundary = {id:row.id, createdAt:row.createdAt};
    const nextCursor = kind === 'missing' ? undefined : kind === 'wrong-id' ? {...boundary,id:owner} : kind === 'wrong-time' ? {...boundary,createdAt:'2026-10-23T08:00:01Z'} : kind === 'extra' ? {...boundary,extra:true} : boundary;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({tracks:[row],nextOffset:kind==='terminal'?null:1,...(nextCursor?{nextCursor}:{}),trendsStatus:'disabled'})));
    await expect(loadDneskaiAudioOptions(false)).rejects.toHaveProperty('code', 'decision-failed');
  });
  it('captures the boundary before waiting and encodes both complete sort columns', async () => {
    const captured=cursor();let finish!:(value:Response)=>void;const fetcher=vi.fn((url:RequestInfo|URL)=>{expect(String(url)).toContain('offset=1');return new Promise<Response>(resolve=>{finish=resolve;});});vi.stubGlobal('fetch',fetcher);
    const pending=loadDneskaiAudioOptions(false,undefined,1,undefined,captured);captured.createdAt='2026-10-24T00:00:00Z';captured.id=owner;
    const url=new URL(String(fetcher.mock.calls[0]?.[0]),'https://example.test');expect(url.searchParams.get('afterCreatedAt')).toBe('2026-10-23T08:00:00.000001Z');expect(url.searchParams.get('afterId')).toBe(id);
    finish(Response.json({tracks:[{...track(),createdAt:'2026-10-23T08:00:00.000002Z'}],nextOffset:null}));expect((await pending)?.tracks).toHaveLength(1);
  });
  it.each(['older-time','equal-boundary','failed','disabled'] as const)('keeps a later-page %s failure available for explicit whole-library recovery',async kind=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(kind==='failed'?Response.json({error:'audio-library-unavailable'},{status:503}):kind==='disabled'?Response.json({error:'not-found'},{status:404}):Response.json({tracks:[{...track(),createdAt:kind==='older-time'?'2026-10-23T08:00:00Z':cursor().createdAt}],nextOffset:null})));
    await expect(loadDneskaiAudioOptions(false,undefined,1,undefined,cursor())).rejects.toHaveProperty('code','audio-page-unavailable');
  });
  it('keeps caller cancellation distinct from a continuation refusal',async()=>{
    const parent=new AbortController(),fetcher=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetcher);
    const pending=outcome(loadDneskaiAudioOptions(false,parent.signal,1,undefined,cursor()));parent.abort('TEST_ONLY_PRIVATE_REASON');expect(await pending).toMatchObject({name:'AbortError',message:'Request aborted'});
  });
});
