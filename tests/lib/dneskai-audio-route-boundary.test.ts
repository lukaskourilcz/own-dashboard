import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), admin: vi.fn(), limited: vi.fn(), list: vi.fn(), selected: vi.fn(), prepare: vi.fn(), create: vi.fn(), toggle: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.limited }));
vi.mock('@/lib/marketing/dneskai-audio', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/marketing/dneskai-audio')>(),
  listDneskaiAudioPage: m.list, listDneskaiAudioTracks: m.selected, prepareDneskaiAudioUpload: m.prepare,
  createDneskaiAudioTrack: m.create, setDneskaiAudioTrackEnabled: m.toggle,
}));
import { GET, POST } from '@/app/api/marketing/dneskai/audio/route';
const owner = '11111111-1111-4111-8111-111111111111', id = '33333333-3333-4333-8333-333333333333';
const url = 'https://fixture.invalid/api/marketing/dneskai/audio';
const intent = { ownerId:owner, action: 'create', uploadId: id, contentType: 'audio/mpeg', title: 'Fixture', artist: 'Fixture', source: 'original', licenceNote: 'Own fixture', sourceUrl: 'https://example.test/audio', mood: [] };
const post = (value: unknown = { ownerId:owner, uploadId:id, action: 'prepare', contentType: 'audio/mpeg', bytes: 100 }) => new Request(url, { method: 'POST', headers: { Origin: 'https://fixture.invalid' }, body: JSON.stringify(value) });
const stalled = () => new Promise<never>(() => {});
function controlledTimeouts() {
  const timeouts = new Map<number, AbortController>();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    const controller = new AbortController(); timeouts.set(milliseconds, controller); return controller.signal;
  });
  return timeouts;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED', 'true'); vi.stubEnv('DNESKAI_AUDIO_TRENDS_ENABLED', 'false');
  m.client.mockImplementation(async () => ({ auth: { getUser: m.user } }));
  m.user.mockResolvedValue({ data: { user: { id: owner } }, error: null }); m.admin.mockReturnValue({}); m.limited.mockResolvedValue({ ok: true, retryAfter: 0 });
  m.list.mockResolvedValue({ tracks: [], nextOffset: null }); m.selected.mockResolvedValue([]); m.prepare.mockResolvedValue({ ownerId:owner, uploadId: id, path: `${owner}/${id}.mp3`, token: 'TEST-ONLY-upload-token' });
  m.create.mockResolvedValue({ id }); m.toggle.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each([400, 401, 403])('refuses a user returned alongside auth error %s', async status => {
  m.user.mockResolvedValue({ data: { user: { id: owner } }, error: { status, message: 'synthetic private detail' } });
  for (const response of [await GET(new Request(url)), await POST(post())]) {
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'unauthorized' }); expect(response.headers.get('cache-control')).toContain('no-store');
  }
  expect(m.admin).not.toHaveBeenCalled(); expect(m.limited).not.toHaveBeenCalled();
});
it.each([503, 429, 0])('keeps unavailable auth %s distinct from an expired session', async status => {
  m.user.mockResolvedValue({ data: { user: null }, error: { status, message: 'synthetic private detail' } });
  for (const response of [await GET(), await POST(post())]) { expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'audio-library-unavailable' }); }
  expect(m.admin).not.toHaveBeenCalled();
});
it('contains thrown auth/client failures and malformed owners before admin work', async () => {
  m.client.mockRejectedValueOnce(new Error('synthetic private detail')); const first = await GET(); expect(first.status).toBe(503); expect(await first.json()).toEqual({ error: 'audio-library-unavailable' });
  m.user.mockRejectedValueOnce(new Error('synthetic private detail')); expect((await POST(post())).status).toBe(503);
  m.user.mockResolvedValueOnce({ data: { user: { id: 'invalid-owner' } }, error: null }); expect((await POST(post())).status).toBe(503);
  expect(m.admin).not.toHaveBeenCalled();
});
it('expires stalled auth once and passes cancellation into its session transport', async () => {
  const timeouts = controlledTimeouts(); m.user.mockImplementation(stalled);
  const pending = POST(post()); await vi.waitFor(() => expect(m.user).toHaveBeenCalledOnce());
  timeouts.get(10_000)!.abort('synthetic private reason'); const response = await pending;
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'audio-library-unavailable' });
  expect((m.client.mock.calls[0]![0] as AbortSignal).aborted).toBe(true); expect(m.admin).not.toHaveBeenCalled();
});
it.each(['offset=1&offset=2', 'trackId=', `trackId=${id}&offset=0`, `trackId=${id}&trackId=${id}`, 'unknown=value'])('refuses ambiguous selectors before admin reads: %s', async query => {
  expect((await GET(new Request(`${url}?${query}`))).status).toBe(400); expect(m.admin).not.toHaveBeenCalled();
});
it('caps the whole GET and passes its signal to the isolated admin transport', async () => {
  const timeouts = controlledTimeouts(); m.list.mockImplementation(stalled);
  const pending = GET(new Request(url)); await vi.waitFor(() => expect(m.list).toHaveBeenCalledOnce());
  timeouts.get(18_000)!.abort('synthetic private reason'); const response = await pending;
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'audio-library-unavailable' }); expect((m.admin.mock.calls[0]![0] as AbortSignal).aborted).toBe(true);
});
it('bounds UTF-8 bytes rather than JavaScript string length before rate admission or Storage work', async () => {
  const value = { ...intent, extra: 'ž'.repeat(4500) }; const body = JSON.stringify(value);
  expect(body.length).toBeLessThan(8192); expect(new TextEncoder().encode(body).length).toBeGreaterThan(8192);
  expect((await POST(post(value))).status).toBe(400); expect(m.admin).not.toHaveBeenCalled(); expect(m.limited).not.toHaveBeenCalled();
});
it('cancels a stalled body after five seconds, even if its cancellation hook never resolves', async () => {
  vi.useFakeTimers(); const cancel = vi.fn(stalled), body = new ReadableStream<Uint8Array>({ cancel });
  const pending = POST(new Request(url, { method: 'POST', headers: { Origin: 'https://fixture.invalid' }, body, duplex: 'half' } as RequestInit));
  await vi.waitFor(() => expect(body.locked).toBe(true)); await vi.advanceTimersByTimeAsync(5000); const response = await pending;
  expect(response.status).toBe(408); expect(await response.json()).toEqual({ error: 'audio-library-unavailable' }); expect(cancel).toHaveBeenCalledOnce(); expect(m.limited).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
it('does not admit malformed UTF-8 or empty bodies', async () => {
  for (const body of [new Uint8Array([0xc3, 0x28]), '']) expect((await POST(new Request(url, { method: 'POST', headers: { Origin: 'https://fixture.invalid' }, body }))).status).toBe(400);
  expect(m.admin).not.toHaveBeenCalled(); expect(m.limited).not.toHaveBeenCalled();
});
it('does no work for switched-off, cross-origin or pre-cancelled requests', async () => {
  vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED', 'false'); expect((await POST(post())).status).toBe(404); expect(m.client).not.toHaveBeenCalled();
  vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED', 'true'); const cross = new Request(url, { method: 'POST', headers: { Origin: 'https://foreign.invalid' }, body: '{}' });
  expect((await POST(cross)).status).toBe(403); expect(m.client).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort('synthetic private reason');
  expect((await GET(new Request(url, { signal: controller.signal }))).status).toBe(503); expect(m.client).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
it('caps stalled rate admission before any admin client or upload is created', async () => {
  const timeouts = controlledTimeouts(); m.limited.mockImplementation(stalled); const pending = POST(post());
  await vi.waitFor(() => expect(m.limited).toHaveBeenCalledOnce()); timeouts.get(50_000)!.abort();
  expect((await pending).status).toBe(503); expect(m.admin).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled();
});
it('keeps known rate refusals and gives the creation/probe the same cancellable admin budget', async () => {
  m.limited.mockResolvedValueOnce({ ok: false, retryAfter: 31 }); const limited = await POST(post()); expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('31'); expect(m.admin).not.toHaveBeenCalled();
  const timeouts = controlledTimeouts(); m.create.mockImplementation(stalled); const pending = POST(post(intent));
  await vi.waitFor(() => expect(m.create).toHaveBeenCalledOnce()); const options = m.create.mock.calls[0]![3] as { signal: AbortSignal };
  expect(options.signal).toBe(m.admin.mock.calls[0]![0]); timeouts.get(50_000)!.abort('synthetic private reason');
  const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'audio-library-unavailable' }); expect(options.signal.aborted).toBe(true); expect(m.create).toHaveBeenCalledOnce();
});

it.each([
  'offset=200', `offset=200&afterId=${id}`, 'offset=200&afterCreatedAt=2026-10-23T08%3A00%3A00Z',
  `afterId=${id}&afterCreatedAt=2026-10-23T08%3A00%3A00Z`,
  `offset=200&afterId=${id}&afterCreatedAt=invalid`,
  `offset=200&afterId=${id}&afterCreatedAt=2026-10-23T08%3A00%3A00.0000001Z`,
  `offset=200&afterId=${id}&afterId=${id}&afterCreatedAt=2026-10-23T08%3A00%3A00Z`,
  `offset=200&afterId=${id}&afterCreatedAt=2026-10-23T08%3A00%3A00Z&trackId=${id}`,
])('refuses incomplete or ambiguous cursor input before service reads: %s',async query=>{
  expect((await GET(new Request(url+'?'+query))).status).toBe(400);expect(m.admin).not.toHaveBeenCalled();
});
it('forwards the captured complete cursor and never requests first-page optional trends',async()=>{
 const response=await GET(new Request(url+'?offset=200&afterId='+id+'&afterCreatedAt=2026-10-23T08%3A00%3A00.000001Z'));
 expect(response.status).toBe(200);expect(m.list).toHaveBeenCalledWith(expect.anything(),owner,200,expect.any(AbortSignal),{id,createdAt:'2026-10-23T08:00:00.000001Z'});
 expect(await response.json()).not.toHaveProperty('trendsStatus');
});

it('refuses a foreign captured toggle owner before rate or service work',async()=>{
 const response=await POST(post({action:'toggle',ownerId:'22222222-2222-4222-8222-222222222222',id,enabled:false,expectedVersion:'2026-10-27T10:00:00.000001Z'}));expect(response.status).toBe(401);expect(m.limited).not.toHaveBeenCalled();expect(m.admin).not.toHaveBeenCalled();
});
it('forwards the captured version and returns the positive saved receipt',async()=>{
 const expectedVersion='2026-10-27T10:00:00.000001Z',receipt={kind:'saved',ownerId:owner,id,expectedVersion,requestedEnabled:false,updatedAt:'2026-10-27T10:00:00.000002Z'};m.toggle.mockResolvedValue(receipt);
 const response=await POST(post({action:'toggle',ownerId:owner,id,enabled:false,expectedVersion}));expect(response.status).toBe(200);expect(await response.json()).toEqual({receipt});expect(m.toggle).toHaveBeenCalledWith(expect.anything(),owner,id,false,expectedVersion,expect.any(AbortSignal));
});
it('requires the owner and version instead of accepting a legacy bare toggle',async()=>{
 expect((await POST(post({action:'toggle',id,enabled:false}))).status).toBe(400);expect(m.limited).not.toHaveBeenCalled();expect(m.toggle).not.toHaveBeenCalled();
});

it.each(['prepare','create'] as const)('rejects a changed original owner before rate/service %s work',async action=>{
 const body=action==='prepare'?{action,ownerId:id,uploadId:id,contentType:'audio/mpeg',bytes:7}:{...intent,ownerId:id};const response=await POST(post(body));expect(response.status).toBe(401);expect(m.limited).not.toHaveBeenCalled();expect(m.admin).not.toHaveBeenCalled();
});
it('signs only the captured upload identity and stamps its original owner',async()=>{
 const response=await POST(post());expect(response.status).toBe(200);expect(m.prepare).toHaveBeenCalledWith({},owner,'audio/mpeg',id);expect(await response.json()).toMatchObject({ownerId:owner,uploadId:id,path:owner+'/'+id+'.mp3'});
});
it('passes captured create fields without transport-only owner metadata and stamps the receipt',async()=>{
 const response=await POST(post(intent));expect(response.status).toBe(200);const {ownerId,...captured}=intent;expect(m.create).toHaveBeenCalledWith({},owner,captured,expect.objectContaining({signal:expect.any(AbortSignal)}));expect(await response.json()).toEqual({ownerId,track:{id}});
});
it.each([{action:'prepare',contentType:'audio/mpeg',bytes:7},{...intent,ownerId:undefined},{action:'prepare',ownerId:owner,contentType:'audio/mpeg',bytes:7}])('refuses uncaptured legacy upload intent: %#',async value=>{
 expect((await POST(post(value))).status).toBe(400);expect(m.limited).not.toHaveBeenCalled();expect(m.admin).not.toHaveBeenCalled();
});
