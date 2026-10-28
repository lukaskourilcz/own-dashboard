import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), create: vi.fn(), from: vi.fn(), rpc: vi.fn(), admin: vi.fn(), generate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: (signal: AbortSignal) => m.create(signal) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/marketing/dneskai-paid-actions', () => ({ generateDneskaiBriefNow: m.generate, regenerateDneskaiRevision: vi.fn(), DNESKAI_REGENERATE_NOTE_MAX: 1000, DneskaiPaidActionError: class extends Error {} }));
import { POST as revisions } from '@/app/api/marketing/revisions/route';
import { POST as generate } from '@/app/api/marketing/dneskai/generate/route';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const runners = [
  { name: 'revision', call: revisions, body: { action: 'skipped', id }, unavailable: 'decision-unavailable', invalid: 'invalid-revision', limit: 131072 },
  { name: 'generate', call: generate, body: { action: 'generate-now', briefId: id }, unavailable: 'generate-now-unavailable', invalid: 'invalid-generate-request', limit: 4096 },
];
function request(runner: typeof runners[number], signal?: AbortSignal, body = JSON.stringify(runner.body)) {
  return new Request(`https://fixture.invalid/api/marketing/${runner.name}`, { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, signal, body });
}
beforeEach(() => {
  vi.resetAllMocks(); m.user.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  m.create.mockImplementation(() => ({ auth: { getUser: m.user }, from: m.from, rpc: m.rpc }));
  m.from.mockImplementation(() => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) }; return query; });
  m.rpc.mockResolvedValue({ data: null, error: null }); m.generate.mockResolvedValue({ jobId: id, status: 'queued' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(runners)('$name refuses a cached user with an authentication error', async runner => {
  m.user.mockResolvedValue({ data: { user: { id: owner } }, error: { status: 401, message: 'TEST_ONLY_PRIVATE_AUTH' } });
  const response = await runner.call(request(runner)); expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'unauthorized' });
  expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it.each(runners)('$name contains rejected authentication before admitting work', async runner => {
  m.user.mockRejectedValue(Error('TEST_ONLY_PRIVATE_AUTH'));
  const response = await runner.call(request(runner)); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: runner.unavailable });
  expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it.each(runners)('$name starts no identity or work for a retired request', async runner => {
  const parent = new AbortController(); parent.abort('TEST_ONLY_PRIVATE_REASON');
  const response = await runner.call(request(runner, parent.signal)); expect(response.status).toBe(503);
  expect(m.create).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it.each(runners)('$name bounds actual body bytes before admitting work', async runner => {
  const response = await runner.call(request(runner, undefined, ' '.repeat(runner.limit + 1) + JSON.stringify(runner.body)));
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: runner.invalid });
  expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it.each(runners)('$name distinguishes positive absence from an authentication outage', async runner => {
  m.user.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect((await runner.call(request(runner))).status).toBe(401);
  m.user.mockResolvedValueOnce({ data: { user: { id: owner } }, error: { status: 503, message: 'TEST_ONLY_PRIVATE_AUTH' } });
  const response = await runner.call(request(runner)); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: runner.unavailable });
  expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it.each(runners)('$name retires stalled authentication and never admits its late result', async runner => {
  const clocks = new Map<number, AbortController>(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); clocks.set(ms, controller); return controller.signal; });
  let finish!: (value: unknown) => void; m.user.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = runner.call(request(runner)); await vi.waitFor(() => expect(m.user).toHaveBeenCalledOnce()); clocks.get(10_000)!.abort();
  const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: runner.unavailable });
  expect(m.create.mock.calls[0]![0].aborted).toBe(true); finish({ data: { user: { id: owner } }, error: null }); await Promise.resolve();
  expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it.each(runners)('$name starts its original allowance before stalled client setup', async runner => {
  const clocks = new Map<number, AbortController>(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); clocks.set(ms, controller); return controller.signal; });
  let finish!: (value: unknown) => void; m.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = runner.call(request(runner)); await vi.waitFor(() => expect(m.create).toHaveBeenCalledOnce()); clocks.get(60_000)!.abort();
  const response = await pending; expect(response.status).toBe(503); expect(m.user).not.toHaveBeenCalled();
  finish({ auth: { getUser: m.user } }); await Promise.resolve(); expect(m.user).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
function heldRequest(runner: typeof runners[number], body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const init = { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, body, signal, duplex: 'half' };
  return new Request(`https://fixture.invalid/api/marketing/${runner.name}`, init);
}
it.each(runners)('$name cancels a held body before work even if its cancellation never resolves', async runner => {
  const parent = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {})), body = new ReadableStream<Uint8Array>({ cancel });
  const pending = runner.call(heldRequest(runner, body, parent.signal)); await vi.waitFor(() => expect(body.locked).toBe(true)); parent.abort('TEST_ONLY_PRIVATE_REASON');
  const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: runner.unavailable }); expect(cancel).toHaveBeenCalledOnce();
  expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it.each(runners)('$name bounds body consumption to five seconds inside its original allowance', async runner => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ cancel });
  const pending = runner.call(heldRequest(runner, body)); await vi.waitFor(() => expect(body.locked).toBe(true)); await vi.advanceTimersByTimeAsync(5000);
  const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: runner.unavailable }); expect(cancel).toHaveBeenCalledOnce();
  expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it.each(runners)('$name rejects malformed UTF-8 and declared oversized bodies before work', async runner => {
  const init = { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, body: new Uint8Array([0xc3, 0x28]) };
  expect((await runner.call(new Request('https://fixture.invalid/api/marketing', init))).status).toBe(400);
  const declared = request(runner); declared.headers.set('Content-Length', String(runner.limit + 1));
  expect((await runner.call(declared)).status).toBe(400); expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it.each(runners)('$name preserves same-origin refusal before authentication', async runner => {
  const cross = request(runner); cross.headers.set('Origin', 'https://foreign.invalid');
  expect((await runner.call(cross)).status).toBe(403); expect(m.create).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
