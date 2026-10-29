import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { fetchWithSignal } from '@/lib/abortable';

const m = vi.hoisted(() => ({ client: vi.fn(), auth: vi.fn(), rpc: vi.fn(), retry: vi.fn(), signal: vi.fn(), result: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client }));
import { POST } from '@/app/api/marketing/campaigns/route';

const owner = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const input = { id, expectedHash: 'a'.repeat(64) };
function request(options: { headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}) {
 return new Request('https://own.example/api/marketing/campaigns', { method: 'POST', headers: { Origin: 'https://own.example', 'Content-Type': 'application/json', ...options.headers }, body: options.body ?? JSON.stringify(input), signal: options.signal });
}
beforeEach(() => {
 vi.clearAllMocks();
 const query = { retry: m.retry, abortSignal: m.signal, then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(m.result()).then(resolve, reject) };
 m.retry.mockReturnValue(query); m.signal.mockReturnValue(query); m.rpc.mockReturnValue(query);
 m.result.mockResolvedValue({ data: null, error: null });
 m.auth.mockResolvedValue({ data: { user: { id: owner } }, error: null });
 m.client.mockResolvedValue({ auth: { getUser: m.auth }, rpc: m.rpc });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
function controlledClock() {
 vi.useFakeTimers();
 vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
  const controller = new AbortController(); setTimeout(() => controller.abort(), milliseconds); return controller.signal;
 });
}

it('activates only through the verified original session with no automatic RPC retry', async () => {
 const original = request({ headers: { 'x-own-dashboard-owner': owner } });
 const response = await POST(original);
 expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
 expect(m.rpc).toHaveBeenCalledExactlyOnceWith('marketing_activate_campaign', { p_campaign: id, p_hash: input.expectedHash });
 expect(m.retry).toHaveBeenCalledExactlyOnceWith(false);
 expect(m.client).toHaveBeenCalledWith(expect.any(AbortSignal)); expect(m.signal).toHaveBeenCalledWith(expect.any(AbortSignal));
 expect(m.signal.mock.calls[0][0].aborted).toBe(true); expect(original.signal.aborted).toBe(false);
 expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it.each([400, 401, 403, 0, 429, 503])('refuses a cached user accompanying auth error %i before activation', async status => {
 m.auth.mockResolvedValue({ data: { user: { id: owner } }, error: { status, message: 'TEST_ONLY_PRIVATE_AUTH' } });
 const response = await POST(request()); expect(response.status).toBe([400, 401, 403].includes(status) ? 401 : 503);
 expect(m.rpc).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it('contains session construction failures without disclosing them', async () => {
 m.client.mockRejectedValue(Error('TEST_ONLY_PRIVATE_SETUP'));
 const response = await POST(request()); expect(response.status).toBe(503); expect(m.rpc).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it.each(['bad-owner', '33333333-3333-4333-8333-333333333333'])('refuses invalid or changed captured owner %s', async captured => {
 const response = await POST(request({ headers: { 'x-own-dashboard-owner': captured } })); expect(response.status).toBe(captured === 'bad-owner' ? 400 : 409); expect(m.rpc).not.toHaveBeenCalled();
});
it.each(['claimed', 'actual'] as const)('refuses %s excess input bytes before activation', async kind => {
 const response = await POST(request({ headers: kind === 'claimed' ? { 'Content-Length': '5000' } : {}, body: kind === 'actual' ? ' '.repeat(4096) + JSON.stringify(input) : undefined }));
 expect(response.status).toBe(413); expect(m.rpc).not.toHaveBeenCalled();
});
it.each(['invalid-json', 'extra-field', 'invalid-id', 'invalid-hash'])('refuses %s without an activation', async kind => {
 const body = kind === 'invalid-json' ? '{' : JSON.stringify({ ...input, ...(kind === 'extra-field' ? { extra: true } : kind === 'invalid-id' ? { id: 'bad' } : { expectedHash: 'bad' }) });
 expect((await POST(request({ body }))).status).toBe(400); expect(m.rpc).not.toHaveBeenCalled();
});
it('refuses cross-origin work before constructing a session', async () => {
 expect((await POST(request({ headers: { Origin: 'https://foreign.example' } }))).status).toBe(403); expect(m.client).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
it('does not construct a session for a previously retired request', async () => {
 const controller = new AbortController(); controller.abort('TEST_ONLY_PRIVATE_REASON');
 expect((await POST(request({ signal: controller.signal }))).status).toBe(503); expect(m.client).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
it('does not activate after retirement during verification', async () => {
 let finish!: (value: unknown) => void;
 m.auth.mockReturnValue(new Promise(resolve => { finish = resolve; }));
 const controller = new AbortController(), pending = POST(request({ signal: controller.signal }));
 await vi.waitFor(() => expect(m.auth).toHaveBeenCalledOnce()); controller.abort('TEST_ONLY_PRIVATE_REASON'); finish({ data: { user: { id: owner } }, error: null });
 expect((await pending).status).toBe(503); expect(m.rpc).not.toHaveBeenCalled();
});
it('never confirms a late admitted write after original retirement', async () => {
 let finish!: (value: unknown) => void;
 m.result.mockReturnValue(new Promise(resolve => { finish = resolve; }));
 const controller = new AbortController(), pending = POST(request({ signal: controller.signal }));
 await vi.waitFor(() => expect(m.result).toHaveBeenCalledOnce()); controller.abort('TEST_ONLY_PRIVATE_REASON'); finish({ data: null, error: null });
 const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'campaign-unconfirmed' }); expect(m.rpc).toHaveBeenCalledOnce();
});
it.each(['network', 'throw'] as const)('preserves uncertainty for a %s failure after write admission', async kind => {
 if (kind === 'network') m.result.mockResolvedValue({ data: null, error: { code: '', message: 'TEST_ONLY_PRIVATE_NETWORK' } });
 else m.result.mockRejectedValue(Error('TEST_ONLY_PRIVATE_NETWORK'));
 const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'campaign-unconfirmed' }); expect(m.rpc).toHaveBeenCalledOnce();
});
it('retains a known database refusal without exposing its private detail', async () => {
 m.result.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'TEST_ONLY_PRIVATE_CHANGED' } });
 const response = await POST(request()); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'campaign-unavailable' });
});
it.each(['auth', 'write'] as const)('ends an uncooperative %s consumer at its original phase limit', async phase => {
 controlledClock();
 const producer = phase === 'auth' ? m.auth : m.result;
 producer.mockReturnValue(new Promise(() => {}));
 const pending = POST(request()); await vi.waitFor(() => expect(producer).toHaveBeenCalledOnce());
 await vi.advanceTimersByTimeAsync(phase === 'auth' ? 10001 : 15001);
 const response = await pending; expect(response.status).toBe(503);
 expect(await response.json()).toEqual({ error: phase === 'auth' ? 'campaign-unavailable' : 'campaign-unconfirmed' });
 expect(m.rpc).toHaveBeenCalledTimes(phase === 'auth' ? 0 : 1);
});
it('ends a held upload without admitting an activation and releases its reader', async () => {
 controlledClock();
 const cancelled = vi.fn();
 const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel: cancelled });
 const original = new Request('https://own.example/api/marketing/campaigns', { method: 'POST', headers: { Origin: 'https://own.example' }, body: stream, duplex: 'half' } as RequestInit);
 const pending = POST(original); await vi.waitFor(() => expect(original.body?.locked).toBe(true));
 await vi.advanceTimersByTimeAsync(5001);
 const response = await pending; expect(response.status).toBe(408); expect(m.rpc).not.toHaveBeenCalled(); expect(cancelled).toHaveBeenCalledOnce(); expect(original.body?.locked).toBe(false);
});
it('accepts the exact body byte ceiling and refuses unexpected non-void success data', async () => {
 const body = JSON.stringify(input).padEnd(4096, ' ');
 expect((await POST(request({ body }))).status).toBe(200);
 m.result.mockResolvedValue({ data: { unexpected: true }, error: null });
 const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'campaign-unconfirmed' });
});
it('uses the actual SDK and authenticated grants for one void RPC without touching another owner or brand', async () => {
 const db = await createMigratedDatabase({ owner, instant: '2026-10-29T00:00:00Z' });
 try {
  const other = '33333333-3333-4333-8333-333333333333';
  await db.query('insert into auth.users(id) values($1)', [other]);
  await db.query(`insert into marketing_campaigns(id,user_id,brand,name,starts_on,ends_on,source_snapshot,source_hash,status)
   values($1,$2,'devshark','Selected','2026-10-29','2026-11-04','{}',$3,'draft'),
   ('44444444-4444-4444-8444-444444444444',$2,'devshark','Previous','2026-10-22','2026-10-28','{}',$3,'active'),
   ('55555555-5555-4555-8555-555555555555',$2,'dneskai','Other brand','2026-10-29','2026-11-04','{}',$3,'active'),
   ('66666666-6666-4666-8666-666666666666',$4,'devshark','Other owner','2026-10-29','2026-11-04','{}',$3,'active')`, [id, owner, input.expectedHash, other]);
  const origin = 'https://activation.supabase.test';
  const emulator = new SupabaseEmulator(db, origin, { service: 'TEST-ONLY-SERVICE', users: { [owner]: 'TEST-ONLY-OWNER' } });
  m.client.mockImplementation((signal: AbortSignal) => {
   const sdk = createClient(origin, 'TEST-ONLY-PUBLISHABLE', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchWithSignal(signal, emulator.fetch.bind(emulator)), headers: { Authorization: 'Bearer TEST-ONLY-OWNER' } } });
   vi.spyOn(sdk.auth, 'getUser').mockImplementation(() => m.auth()); return sdk;
  });
  const response = await POST(request({ headers: { 'x-own-dashboard-owner': owner } }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true }); expect(emulator.requests).toHaveLength(1);
  expect((await db.query('select name,status from marketing_campaigns order by name')).rows).toEqual([{ name: 'Other brand', status: 'active' }, { name: 'Other owner', status: 'active' }, { name: 'Previous', status: 'archived' }, { name: 'Selected', status: 'active' }]);
  const changed = await POST(request({ body: JSON.stringify({ ...input, expectedHash: 'b'.repeat(64) }) }));
  expect(changed.status).toBe(409); expect(await changed.json()).toEqual({ error: 'campaign-unavailable' }); expect(emulator.requests).toHaveLength(2);
  expect((await db.query<{ count: number }>('select count(*)::int as count from marketing_publications')).rows[0].count).toBe(0);
 } finally { await db.close(); }
}, 120_000);
