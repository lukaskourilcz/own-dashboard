import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lookupAres, lookupVies, RegistryLookupError } from '@/lib/tax-registry-client';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const ares = () => ({ ownerId: owner, ico: '27074358', name: 'Synthetic legal name', address: 'Test 1', city: 'Praha', zip: '140 00', country: 'Česká republika', vatId: 'CZ27074358', checkedAt: '2026-10-25T08:00:00Z' });
const vies = () => ({ ownerId: owner, vatId: 'CZ27074358', name: 'Synthetic legal name', address: 'Test 1', status: 'valid', checkedAt: '2026-10-25T08:00:00Z' });
const scope = () => ({ ownerId: owner, signal: new AbortController().signal });
const cases = [{ kind: 'ares', call: lookupAres, input: '27074358', data: ares }, { kind: 'vies', call: lookupVies, input: 'CZ27074358', data: vies }] as const;
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async input => Response.json(String(input).includes('/ares') ? ares() : vies()))));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
for (const { kind, call, input, data } of cases) {
 it(`${kind}: confirms an owner-stamped receipt with a bounded captured request`, async () => {
  expect(await call(scope(), input)).toEqual(data()); expect(fetch).toHaveBeenCalledWith(`/api/registry/${kind}`, expect.objectContaining({ method: 'POST', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal), headers: { 'Content-Type': 'application/json', 'x-own-dashboard-owner': owner } }));
 });
 it(`${kind}: refuses a foreign, incomplete or malformed receipt and never fabricates checkedAt`, async () => {
  for (const body of [{ ...data(), ownerId: other }, { ...data(), checkedAt: undefined }, { ...data(), checkedAt: '2026-02-30T08:00:00Z' }, { ...data(), name: 123 }, { ...data(), extra: 'PRIVATE TEST metadata' }]) {
   vi.stubGlobal('fetch', vi.fn(async () => Response.json(body))); await expect(call(scope(), input)).rejects.toThrow(/^Registry lookup unavailable$/);
  }
 });
 it(`${kind}: refuses a different registry number even under the correct owner`, async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...data(), ...(kind === 'ares' ? { ico: '45274649' } : { vatId: 'DE123456789' }) }))); await expect(call(scope(), input)).rejects.toBeInstanceOf(RegistryLookupError);
 });
 it(`${kind}: discards error bodies without reading/disclosing producer errors`, async () => {
  const cancel = vi.fn(), pull = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { status: 503 })));
  await expect(call(scope(), input)).rejects.toThrow(/^Registry lookup unavailable$/); expect(cancel).toHaveBeenCalledOnce(); expect(pull).not.toHaveBeenCalled();
 });
 it(`${kind}: rejects actual multibyte bytes above the browser bound`, async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('á'.repeat(16_385)))); await expect(call(scope(), input)).rejects.toThrow(/^Registry lookup unavailable$/);
 });
 it(`${kind}: bounds uncooperative headers and releases the late response`, async () => {
  vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const stop = new AbortController(); setTimeout(() => stop.abort(), ms); return stop.signal; });
  let release!: (response: Response) => void; const cancel = vi.fn(); vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
  const pending = call(scope(), input), failed = expect(pending).rejects.toThrow(/^Registry lookup unavailable$/); await vi.advanceTimersByTimeAsync(28_001); await failed; release(new Response(new ReadableStream({ cancel }))); await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledOnce();
 });
 it(`${kind}: performs no lookup for an invalid identity/input or disposed owner`, async () => {
  await expect(call({ ...scope(), ownerId: 'invalid' }, input)).rejects.toThrow(); await expect(call(scope(), 'invalid')).rejects.toMatchObject({ reason: 'invalid' });
  const stop = new AbortController(); stop.abort('PRIVATE TEST reason'); await expect(call({ ownerId: owner, signal: stop.signal }, input)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).not.toHaveBeenCalled();
 });
}
it('keeps VIES unavailability distinct from an invalid verdict', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...vies(), status: 'unavailable', name: '', address: '' }))); expect(await lookupVies(scope(), 'CZ27074358')).toMatchObject({ status: 'unavailable' });
});
it.each([400,404,429])('retains safe ARES recovery reasons for HTTP %s', async status => {
 vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status }))); await expect(lookupAres(scope(), '27074358')).rejects.toMatchObject({ reason: status === 400 ? 'invalid' : status === 404 ? 'not-found' : 'unavailable' });
});
