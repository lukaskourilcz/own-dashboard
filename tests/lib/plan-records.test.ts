import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { readPlanRecords } from '@/lib/plan-records';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stamp = '2026-10-25T11:00:00Z';
let db: PGlite;
const scope = () => ({ ownerId: owner, signal: new AbortController().signal });
const record = () => ({ id, user_id: owner, title: 'Synthetic plan', target_date: null, status: 'idea', recurrence: 'none', notes: null, last_completed_at: null, linked_calendar_event_id: null, created_at: stamp, updated_at: stamp });
function client(actor = owner) {
  const emulator = new SupabaseEmulator(db, 'https://offline.supabase.test', { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner', [other]: 'TEST-ONLY-other' } }, () => new Date(stamp));
  const api = createClient('https://offline.supabase.test', 'TEST-ONLY-public', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${actor === owner ? 'TEST-ONLY-owner' : 'TEST-ONLY-other'}` }, fetch: (input, init) => emulator.fetch(new Request(input, init)) } });
  return { api, emulator };
}
function wire(data: unknown, status = 200, fetcher?: typeof fetch) {
  const transport = fetcher ?? vi.fn<typeof fetch>(async () => Response.json(data, { status }));
  const api = createClient('https://example.supabase.co', 'TEST-ONLY-public', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport } });
  return { api, transport };
}
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: stamp });
  await db.query('insert into auth.users(id) values($1)', [other]);
}, 120000);
beforeEach(async () => { await db.exec('reset role; delete from plans'); });
afterEach(() => vi.restoreAllMocks());
afterAll(async () => db?.close());

it('returns 1,201 complete owned rows in one real SDK/RLS request', async () => {
  await db.query("insert into plans(user_id,title) select $1,'Plan '||n from generate_series(1,1201)n", [owner]);
  const { api, emulator } = client();
  const result = await readPlanRecords(api, scope());
  expect(result.data).toHaveLength(1201);
  expect(result.data.every(row => row.user_id === owner)).toBe(true);
  expect(new Set(result.data.map(row => row.id)).size).toBe(1201);
  expect(emulator.requests).toHaveLength(1);
  expect(emulator.requests[0].path).toContain('/rpc/read_owned_collection');
});
it('refuses a different authenticated actor even when that actor has no rows', async () => {
  await expect(readPlanRecords(client(other).api, scope())).rejects.toThrow(/^Plans unavailable$/);
});
it('retains a confirmed empty owned collection', async () => {
  expect(await readPlanRecords(client().api, scope())).toEqual({ data: [], error: null });
});
it.each([null, {}, [null], [record(), record()], [{ ...record(), user_id: other }], [{ ...record(), target_date: '2026-02-31' }], [{ ...record(), status: 'unknown' }], [{ ...record(), recurrence: 'daily' }], [{ ...record(), last_completed_at: 'not-a-time' }], [{ ...record(), notes: {} }], [{ ...record(), updated_at: 'infinity' }], [{ ...record(), extra: 'PRIVATE TEST' }]])('refuses malformed or expanded responses without leaking their data', async data => {
 await expect(readPlanRecords(wire(data).api, scope())).rejects.toThrow(/^Plans unavailable$/);
});
it('preserves legacy long titles, notes and Calendar ids for deliberate review', async () => {
 const value = { ...record(), title: 'x'.repeat(501), notes: 'Retained legacy note', linked_calendar_event_id: 'Legacy event text' };
 expect((await readPlanRecords(wire([value]).api, scope())).data).toEqual([value]);
});
it('enforces the row bound when a transport violates the SQL contract', async () => {
  const rows = Array.from({ length: 10001 }, (_, index) => ({ ...record(), id: `${index.toString(16).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb` }));
  await expect(readPlanRecords(wire(rows).api, scope())).rejects.toThrow(/^Plans unavailable$/);
});
it('does not retry unavailable data or expose a database diagnostic', async () => {
  const { api, transport } = wire({ message: 'PRIVATE TEST database detail' }, 503);
  await expect(readPlanRecords(api, scope())).rejects.toThrow(/^Plans unavailable$/);
  expect(transport).toHaveBeenCalledOnce();
});
it('captures identity before an uncooperative caller mutates the scope object', async () => {
  let release!: (response: Response) => void;
  const { api } = wire(null, 200, () => new Promise(resolve => { release = resolve; }));
  const captured = scope();
  const pending = readPlanRecords(api, captured);
  const failed = expect(pending).rejects.toThrow(/^Plans unavailable$/);
  captured.ownerId = other;
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  release(Response.json([{ ...record(), user_id: other }]));
  await failed;
});
it('ends an uncooperative complete read at the one reader deadline', async () => {
  const stop = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 15000 ? stop.signal : new AbortController().signal);
  const transport = vi.fn<typeof fetch>(() => new Promise(() => undefined));
  const { api } = wire(null, 200, transport);
  const pending = readPlanRecords(api, scope());
  const failed = expect(pending).rejects.toThrow(/^Plans unavailable$/);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
  stop.abort('PRIVATE TEST reason');
  await failed;
});
it('does not request data after owner disposal or malformed captured identity', async () => {
  const { api, transport } = wire([]), stop = new AbortController();
  stop.abort();
  await expect(readPlanRecords(api, { ownerId: owner, signal: stop.signal })).rejects.toMatchObject({ name: 'AbortError' });
  await expect(readPlanRecords(api, { ...scope(), ownerId: 'invalid' })).rejects.toThrow(/^Plans unavailable$/);
  expect(transport).not.toHaveBeenCalled();
});
