import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { readCompetitorRecords } from '@/lib/competitor-records';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stamp = '2026-10-25T11:00:00Z';
let db: PGlite;
const scope = () => ({ ownerId: owner, signal: new AbortController().signal });
const record = () => ({ id, user_id: owner, project_id: project, name: 'Synthetic research', url: null, summary: '', category: 'direct', useful_features: [], social_content: '', pricing_model: '', lessons: '', relevance_score: null, score_rationale: '', social_links: [], source_urls: [], reviewed_at: null, sort_order: 0, created_at: stamp, updated_at: stamp });
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
  await db.query("insert into projects(id,user_id,name,slug) values($1,$2,'Read project','competitor-read-fixture')", [project, owner]);
}, 120000);
beforeEach(async () => { await db.exec('reset role; delete from competitors'); });
afterEach(() => vi.restoreAllMocks());
afterAll(async () => db?.close());

it('returns 1,201 complete owned rows in one real SDK/RLS request', async () => {
  await db.query("insert into competitors(user_id,project_id,name) select $1,$2,'Research '||n from generate_series(1,1201)n", [owner, project]);
  const { api, emulator } = client();
  const result = await readCompetitorRecords(api, scope());
  expect(result.data).toHaveLength(1201);
  expect(result.data.every(row => row.user_id === owner && row.project_id === project)).toBe(true);
  expect(new Set(result.data.map(row => row.id)).size).toBe(1201);
  expect(emulator.requests).toHaveLength(1);
  expect(emulator.requests[0].path).toContain('/rpc/read_owned_collection');
});
it('refuses a different authenticated actor even when that actor has no rows', async () => {
  await expect(readCompetitorRecords(client(other).api, scope())).rejects.toThrow(/^Competition unavailable$/);
});
it('retains a confirmed empty owned collection', async () => {
  expect(await readCompetitorRecords(client().api, scope())).toEqual({ data: [], error: null });
});
it.each([null, {}, [null], [record(), record()], [{ ...record(), user_id: other }], [{ ...record(), project_id: 'invalid' }], [{ ...record(), relevance_score: 0 }], [{ ...record(), useful_features: [null] }], [{ ...record(), category: 'unknown' }], [{ ...record(), name: 'x'.repeat(121) }], [{ ...record(), reviewed_at: '2026-02-31' }], [{ ...record(), updated_at: 'infinity' }], [{ ...record(), extra: 'PRIVATE TEST' }]])('refuses malformed or expanded responses without leaking their data', async data => {
  await expect(readCompetitorRecords(wire(data).api, scope())).rejects.toThrow(/^Competition unavailable$/);
});
it('preserves typed legacy URL text and a future review date for deliberate editing', async () => {
  const value = { ...record(), url: 'Unsupported legacy address', reviewed_at: '2099-01-01' };
  expect((await readCompetitorRecords(wire([value]).api, scope())).data).toEqual([value]);
});
it('enforces the row bound when a transport violates the SQL contract', async () => {
  const rows = Array.from({ length: 10001 }, (_, index) => ({ ...record(), id: `${index.toString(16).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb` }));
  await expect(readCompetitorRecords(wire(rows).api, scope())).rejects.toThrow(/^Competition unavailable$/);
});
it('does not retry unavailable data or expose a database diagnostic', async () => {
  const { api, transport } = wire({ message: 'PRIVATE TEST database detail' }, 503);
  await expect(readCompetitorRecords(api, scope())).rejects.toThrow(/^Competition unavailable$/);
  expect(transport).toHaveBeenCalledOnce();
});
it('captures identity before an uncooperative caller mutates the scope object', async () => {
  let release!: (response: Response) => void;
  const { api } = wire(null, 200, () => new Promise(resolve => { release = resolve; }));
  const captured = scope();
  const pending = readCompetitorRecords(api, captured);
  const failed = expect(pending).rejects.toThrow(/^Competition unavailable$/);
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
  const pending = readCompetitorRecords(api, scope());
  const failed = expect(pending).rejects.toThrow(/^Competition unavailable$/);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
  stop.abort('PRIVATE TEST reason');
  await failed;
});
it('does not request data after owner disposal or malformed captured identity', async () => {
  const { api, transport } = wire([]), stop = new AbortController();
  stop.abort();
  await expect(readCompetitorRecords(api, { ownerId: owner, signal: stop.signal })).rejects.toMatchObject({ name: 'AbortError' });
  await expect(readCompetitorRecords(api, { ...scope(), ownerId: 'invalid' })).rejects.toThrow(/^Competition unavailable$/);
  expect(transport).not.toHaveBeenCalled();
});
