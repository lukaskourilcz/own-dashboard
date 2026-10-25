import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ client: vi.fn(), rate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.rate }));
import { POST as ares } from '@/app/api/registry/ares/route';
import { POST as vies } from '@/app/api/registry/vies/route';
const owner = '11111111-1111-4111-8111-111111111111';
const subject = () => ({ ico: '27074358', obchodniJmeno: 'Synthetic legal name', dic: 'CZ27074358', sidlo: { nazevObce: 'Praha', psc: 14000, nazevStatu: 'Česká republika', nazevUlice: 'Test', cisloDomovni: 1 } });
const verdict = () => ({ countryCode: 'CZ', vatNumber: '27074358', valid: true, name: 'Synthetic legal name', address: 'Test 1\nPraha', requestDate: '2026-10-25T08:00:00Z' });
const routes = [{ kind: 'ares', route: ares, field: 'ico', input: '27074358' }, { kind: 'vies', route: vies, field: 'vatId', input: 'CZ27074358' }] as const;
function request(kind: string, body: unknown, options: { signal?: AbortSignal; origin?: string; headers?: Record<string, string> } = {}) { return new Request(`https://app.example/api/registry/${kind}`, { method: 'POST', signal: options.signal, headers: { origin: options.origin ?? 'https://app.example', 'content-type': 'application/json', ...options.headers }, body: JSON.stringify(body) }); }
let authError: { status?: number; message?: string } | null, user: { id: string } | null;
beforeEach(() => {
 vi.clearAllMocks(); authError = null; user = { id: owner }; m.client.mockImplementation(async () => ({ auth: { getUser: async () => ({ data: { user }, error: authError }) } })); m.rate.mockResolvedValue({ ok: true, retryAfter: 0 });
 vi.stubGlobal('fetch', vi.fn(async input => Response.json(String(input).startsWith('https://ares.gov.cz/') ? subject() : verdict())));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
for (const { kind, route, field, input } of routes) {
 it.each([null, { [field]: 123 }, { [field]: [] }])(`${kind}: refuses malformed JSON fields without throwing`, async body => {
  const response = await route(request(kind, body)); expect(response.status).toBe(400); expect(fetch).not.toHaveBeenCalled();
 });
 it(`${kind}: refuses a cached user after auth failure`, async () => {
  authError = { status: 500, message: 'PRIVATE TEST auth' }; const response = await route(request(kind, { [field]: input })); expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE'); expect(fetch).not.toHaveBeenCalled();
 });
 it(`${kind}: refuses a successful answer for a different registry identity`, async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(kind === 'ares' ? { ...subject(), ico: '45274649' } : { ...verdict(), vatNumber: '45274649' })));
  const response = await route(request(kind, { [field]: input })); expect(response.status).toBe(kind === 'ares' ? 502 : 200); if (kind === 'vies') expect(await response.json()).toMatchObject({ status: 'unavailable' });
 });
}
function fakeDeadlines() { vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const stop = new AbortController(); setTimeout(() => stop.abort(), ms); return stop.signal; }); }
for (const { kind, route, field, input } of routes) {
 it(`${kind}: returns a bounded owner receipt and projects away private provider metadata`, async () => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
   expect(init).toMatchObject({ redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal) }); expect(init?.headers).not.toHaveProperty('Authorization');
   if (kind === 'vies') expect(JSON.parse(String(init?.body))).toEqual({ countryCode: 'CZ', vatNumber: '27074358' });
   return Response.json({ ...(kind === 'ares' ? subject() : verdict()), extra: 'PRIVATE TEST metadata' });
  }); vi.stubGlobal('fetch', fetcher);
  const response = await route(request(kind, { [field]: input })), body = await response.json(); expect(response.status).toBe(200); expect(body.ownerId).toBe(owner); expect(body.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(JSON.stringify(body)).not.toContain('PRIVATE');
  expect(body).toMatchObject(kind === 'ares' ? { ico: '27074358', name: 'Synthetic legal name', address: 'Test 1', zip: '140 00' } : { vatId: 'CZ27074358', status: 'valid', address: 'Test 1, Praha' });
  expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toBe('Cookie'); expect(fetcher).toHaveBeenCalledOnce();
 });
 it(`${kind}: refuses unknown/oversized input before authentication or an outbound lookup`, async () => {
  for (const body of [{ [field]: input, extra: true }, { [field]: 'x'.repeat(1025) }]) { expect((await route(request(kind, body))).status).toBe(400); }
  expect(m.client).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
 });
 it(`${kind}: keeps CSRF, no-user, invalid-user and captured-owner refusal ahead of provider work`, async () => {
  const body = { [field]: input }; expect((await route(request(kind, body, { origin: 'https://foreign.example' }))).status).toBe(403); expect(m.client).not.toHaveBeenCalled();
  user = null; expect((await route(request(kind, body))).status).toBe(401); user = { id: 'invalid' }; expect((await route(request(kind, body))).status).toBe(503);
  user = { id: owner }; expect((await route(request(kind, body, { headers: { 'x-own-dashboard-owner': 'foreign' } }))).status).toBe(403); expect(fetch).not.toHaveBeenCalled();
 });
 it(`${kind}: retains explicit unauthenticated auth errors and rate admission`, async () => {
  authError = { status: 401 }; expect((await route(request(kind, { [field]: input }))).status).toBe(401); authError = null; m.rate.mockResolvedValue({ ok: false, retryAfter: 30 }); expect((await route(request(kind, { [field]: input }))).status).toBe(429); expect(fetch).not.toHaveBeenCalled();
 });
 it(`${kind}: bounds a stalled upload and releases the reader without awaiting cancellation`, async () => {
  fakeDeadlines(); const cancel = vi.fn(() => new Promise<void>(() => {})), body = new ReadableStream({ cancel });
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { origin: 'https://app.example' }, body, duplex: 'half' };
  const pending = route(new Request(`https://app.example/api/registry/${kind}`, init)); await vi.advanceTimersByTimeAsync(5_001); expect((await pending).status).toBe(408); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false); expect(m.client).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
 });
 it(`${kind}: bounds an uncooperative auth operation`, async () => {
  fakeDeadlines(); m.client.mockReturnValue(new Promise(() => {})); const pending = route(request(kind, { [field]: input })); await vi.advanceTimersByTimeAsync(8_001); expect((await pending).status).toBe(503); expect(fetch).not.toHaveBeenCalled();
 });
 it(`${kind}: bounds an uncooperative rate limiter before provider work`, async () => {
  fakeDeadlines(); m.rate.mockReturnValue(new Promise(() => {})); const pending = route(request(kind, { [field]: input })); await vi.advanceTimersByTimeAsync(2_001); expect((await pending).status).toBe(503); expect(fetch).not.toHaveBeenCalled();
 });
 it(`${kind}: releases late provider headers after its total phase deadline`, async () => {
  fakeDeadlines(); let release!: (response: Response) => void; const cancel = vi.fn(); vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
  const pending = route(request(kind, { [field]: input })); await vi.advanceTimersByTimeAsync(kind === 'ares' ? 10_001 : 15_001); const response = await pending;
  expect(response.status).toBe(kind === 'ares' ? 502 : 200); if (kind === 'vies') expect(await response.json()).toMatchObject({ status: 'unavailable' });
  release(new Response(new ReadableStream({ cancel }))); await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledOnce();
 });
 it(`${kind}: cancels a pending provider body on caller disconnect`, async () => {
  const stop = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {})), stream = new ReadableStream({ cancel }); vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)));
  const pending = route(request(kind, { [field]: input }, { signal: stop.signal })); await vi.waitFor(() => expect(stream.locked).toBe(true)); stop.abort('PRIVATE TEST reason'); const response = await pending;
  expect(response.status).toBe(kind === 'ares' ? 502 : 200); expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false); expect(await response.text()).not.toContain('PRIVATE');
 });
 it(`${kind}: discards HTTP error bodies and preserves absence separately from outage`, async () => {
  for (const status of [404, 500]) { const cancel = vi.fn(), pull = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { status })));
   const response = await route(request(kind, { [field]: input })); expect(response.status).toBe(kind === 'ares' ? status === 404 ? 404 : 502 : 200); if (kind === 'vies') expect(await response.json()).toMatchObject({ status: 'unavailable' }); expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  }
 });
 it(`${kind}: refuses actual response bytes above its bound even with an understated length`, async () => {
  const maximum = kind === 'ares' ? 256 * 1024 : 64 * 1024; vi.stubGlobal('fetch', vi.fn(async () => new Response('á'.repeat(maximum / 2 + 1), { headers: { 'content-length': '2' } })));
  const response = await route(request(kind, { [field]: input })); expect(response.status).toBe(kind === 'ares' ? 502 : 200); if (kind === 'vies') expect(await response.json()).toMatchObject({ status: 'unavailable' });
 });
 it(`${kind}: does not start provider work after a preexisting or just-completed admission disconnect`, async () => {
  const stop = new AbortController(); stop.abort(); expect((await route(request(kind, { [field]: input }, { signal: stop.signal }))).status).toBe(503); expect(m.client).not.toHaveBeenCalled();
  const current = new AbortController(); m.rate.mockImplementation(async () => { current.abort(); return { ok: true }; }); expect((await route(request(kind, { [field]: input }, { signal: current.signal }))).status).toBe(503); expect(fetch).not.toHaveBeenCalled();
 });
}
it.each([{ ...verdict(), countryCode: 'DE' }, { ...verdict(), vatNumber: undefined }, { valid: true }, { ...verdict(), valid: 'false' }, { actionSucceed: false, errorWrappers: [{ error: 'MS_UNAVAILABLE' }] }, { ...verdict(), valid: false, userError: 'MS_UNAVAILABLE' }])('VIES never records invalid or valid without exact identity and completed evidence', async raw => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(raw))); expect(await (await vies(request('vies', { vatId: 'CZ27074358' }))).json()).toMatchObject({ status: 'unavailable', name: '', address: '', vatId: 'CZ27074358', ownerId: owner });
});
it('VIES accepts a confirmed invalid result and a valid withheld trader name/address', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...verdict(), valid: false, name: '---', address: '---' }))); expect(await (await vies(request('vies', { vatId: 'CZ27074358' }))).json()).toMatchObject({ status: 'invalid', name: '', address: '' });
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...verdict(), name: null, address: null }))); expect(await (await vies(request('vies', { vatId: 'CZ27074358' }))).json()).toMatchObject({ status: 'valid', name: '', address: '' });
});
it('ARES accepts the primary contract maximum name without silently truncating it', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...subject(), obchodniJmeno: 'x'.repeat(2000) }))); expect((await (await ares(request('ares', { ico: '27074358' }))).json()).name).toHaveLength(2000);
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...subject(), obchodniJmeno: 'x'.repeat(2001) }))); expect((await ares(request('ares', { ico: '27074358' }))).status).toBe(502);
});
it('ARES refuses malformed projected fields rather than manufacturing registered text', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...subject(), obchodniJmeno: 123 }))); expect((await ares(request('ares', { ico: '27074358' }))).status).toBe(502);
});
