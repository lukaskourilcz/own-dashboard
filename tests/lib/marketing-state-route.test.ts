import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { fetchWithSignal } from '@/lib/abortable';
import { planCampaignImport } from '@/lib/marketing/campaign-import';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import { MarketingSourceSummarySchema } from '@/lib/marketing/source-summary';
const m = vi.hoisted(() => ({ client: vi.fn(), auth: vi.fn(), query: vi.fn(), calls: [] as Array<{ table: string; columns: string; owner?: string; retry?: boolean; signal?: AbortSignal }> }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client }));
import { GET } from '@/app/api/marketing/state/route';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const request = (signal?: AbortSignal, captured?: string) => new Request('https://own.example/api/marketing/state', { signal, headers: captured ? { 'x-own-dashboard-owner': captured } : {} });
beforeEach(() => {
 vi.clearAllMocks(); m.calls.length = 0;
 m.auth.mockResolvedValue({ data: { user: { id: owner } }, error: null }); m.query.mockResolvedValue({ data: [], error: null });
 m.client.mockResolvedValue({ auth: { getUser: m.auth }, from: (table: string) => {
  const call = { table, columns: '' } as typeof m.calls[number]; m.calls.push(call);
  const query = { select: (columns: string) => { call.columns = columns; return query; }, eq: (field: string, value: string) => { if (field === 'user_id') call.owner = value; return query; },
   neq: () => query, in: () => query, order: () => query, limit: () => query, retry: (retry: boolean) => { call.retry = retry; return query; }, abortSignal: (signal: AbortSignal) => { call.signal = signal; return query; },
   then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(m.query(table)).then(resolve, reject) };
  return query;
 } });
});
afterEach(() => vi.restoreAllMocks());
it('returns an owner-stamped private snapshot with explicit field projections and original no-retry query scopes', async () => {
 const original = request(undefined, owner), response = await GET(original); expect(response.status).toBe(200);
 expect((await response.json()).ownerId).toBe(owner); expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(m.calls).toHaveLength(9); expect(m.calls.every(call => call.owner === owner && call.retry === false && call.signal?.aborted === true && !call.columns.split(',').includes('*'))).toBe(true);
 expect(m.client).toHaveBeenCalledWith(expect.any(AbortSignal)); expect(original.signal.aborted).toBe(false);
});
it.each([400, 401, 403, 0, 429, 503])('does not expose private state for a cached user accompanying auth error %i', async status => {
 m.auth.mockResolvedValue({ data: { user: { id: owner } }, error: { status, message: 'TEST_ONLY_PRIVATE_AUTH' } });
 const response = await GET(request()); expect(response.status).toBe([400, 401, 403].includes(status) ? 401 : 503); expect(m.calls).toEqual([]); expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it('contains session construction failures', async () => {
 m.client.mockRejectedValue(Error('TEST_ONLY_PRIVATE_SETUP'));
 const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE'); expect(m.calls).toEqual([]);
});
it.each(['bad-owner', '33333333-3333-4333-8333-333333333333'])('refuses invalid or changed captured owner %s', async captured => {
 const response = await GET(request(undefined, captured)); expect(response.status).toBe(captured === 'bad-owner' ? 400 : 409); expect(m.calls).toEqual([]);
});
it('never starts session work for a retired request', async () => {
 const controller = new AbortController(); controller.abort('TEST_ONLY_PRIVATE_REASON');
 expect((await GET(request(controller.signal))).status).toBe(503); expect(m.client).not.toHaveBeenCalled();
});
it('discards late read results after the original request retires', async () => {
 let finish!: (value: unknown) => void;
 m.query.mockReturnValue(new Promise(resolve => { finish = resolve; }));
 const controller = new AbortController(), pending = GET(request(controller.signal));
 await vi.waitFor(() => expect(m.query).toHaveBeenCalledTimes(9)); controller.abort('TEST_ONLY_PRIVATE_REASON'); finish({ data: [], error: null });
 const response = await pending; expect(response.status).toBe(503); expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it.each(['error', 'null', 'object', 'foreign', 'excess'])('refuses a %s family rather than returning a misleading successful snapshot', async kind => {
 m.query.mockImplementation(async (table: string) => table !== 'marketing_calendar_entries' ? { data: [], error: null } : {
  data: kind === 'null' ? null : kind === 'object' ? {} : kind === 'foreign' ? [{ id, user_id: '33333333-3333-4333-8333-333333333333' }] : kind === 'excess' ? Array.from({ length: 1001 }, () => ({ id, user_id: owner })) : [],
  error: kind === 'error' ? { message: 'TEST_ONLY_PRIVATE_DB' } : null,
 });
 const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it('omits duplicate authored entry bodies and unrelated future fields from the response', async () => {
 const entry = { id, user_id: owner, campaign_id: id, date: '2026-10-29', local_time: '09:00', bound_source_id: null, title: 'Reviewed slot', kind: 'task', platform: 'web', status: 'planned', needs_review: false };
 m.query.mockImplementation(async (table: string) => ({ data: table === 'marketing_calendar_entries' ? [{ ...entry, original: { body: 'TEST_ONLY_AUTHORED_SOURCE'.repeat(1000) }, future_private_field: 'TEST_ONLY_FUTURE_FIELD' }] : [], error: null }));
 const response = await GET(request()); expect(response.status).toBe(200); const value = await response.json();
 const expected = { id: entry.id, campaign_id: entry.campaign_id, date: entry.date, local_time: entry.local_time, bound_source_id: entry.bound_source_id, title: entry.title, kind: entry.kind, platform: entry.platform, status: entry.status, needs_review: entry.needs_review };
 expect(value.entries).toEqual([expected]); expect(JSON.stringify(value)).not.toContain('TEST_ONLY_');
});
it.each(['auth', 'queries'] as const)('ends an uncooperative %s consumer at its original phase', async phase => {
 const deadline = new AbortController();
 vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => milliseconds === (phase === 'auth' ? 10000 : 15000) ? deadline.signal : new AbortController().signal);
 const producer = phase === 'auth' ? m.auth : m.query; producer.mockReturnValue(new Promise(() => {}));
 const original = request(), pending = GET(original); await vi.waitFor(() => expect(producer).toHaveBeenCalledTimes(phase === 'auth' ? 1 : 9)); deadline.abort('TEST_ONLY_PRIVATE_REASON');
 const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'marketing-unavailable' }); expect(original.signal.aborted).toBe(false);
 if (phase === 'auth') expect(m.calls).toEqual([]); else expect(m.calls.every(call => call.signal?.aborted)).toBe(true);
});
it.each(['brand', 'source_id', 'source_revision', 'content_hash', 'summary_title', 'summary_evidence', 'summary_url'])('refuses mismatching or invalid source projection %s', async field => {
 const row = { user_id: owner, id, brand: 'devshark', source_id: 'source:owned', source_revision: 'v1', content_hash: 'a'.repeat(64), eligible: true, summary_brand: 'devshark', summary_source_id: 'source:owned', summary_revision: 'v1', summary_hash: 'a'.repeat(64), summary_url: 'https://example.test/source', summary_expires: null, summary_title: 'Reviewed source', summary_evidence: [] };
 Object.assign(row, { [field]: field === 'brand' ? 'dneskai' : field === 'content_hash' ? 'b'.repeat(64) : field === 'summary_title' ? 'x'.repeat(301) : field === 'summary_evidence' ? [{ url: 'javascript:alert(1)' }] : field === 'summary_url' ? 'https://test-only-user:test-only-password@example.test/source' : 'changed' });
 m.query.mockImplementation(async (table: string) => ({ data: table === 'marketing_sources' ? [row] : [], error: null }));
 expect((await GET(request())).status).toBe(503);
});

it('preserves displayed entry and source evidence through actual SDK projections with the full migrated database', async () => {
 const db = await createMigratedDatabase({ owner, instant: '2026-10-29T00:00:00Z' });
 try {
  const value = planCampaignImport(JSON.parse(readFileSync('fixtures/marketing-calendars/marketingshark.json', 'utf8')), '2026-10-29', []);
  await db.query('select marketing_import_campaign($1,$2,$3)', [owner, JSON.stringify(value.campaign), JSON.stringify(value.entries)]);
  const packet = parseSourcePacket({ schemaVersion: 'marketing-source/1', brand: 'devshark', kind: 'question', sourceId: 'source:owned', sourceRevision: 'v1', contentHash: 'a'.repeat(64), canonicalUrl: 'https://example.test/source', locale: 'en', observedAt: '2026-10-29T00:00:00Z', expiresAt: null, eligible: true, eligibilityReason: 'active', content: { title: 'Reviewed source', body: 'B'.repeat(30000), category: 'test-only', difficulty: null, code: 'C'.repeat(12000), options: ['Option A', 'Option B'], answer: 'Option A', explanation: 'E'.repeat(12000), evidence: [{ title: 'Reviewed evidence', url: 'https://example.test/evidence', excerpt: 'Shown in the workspace', checkedAt: '2026-10-29T00:00:00Z' }], image: null } });
  await db.query(`insert into marketing_sources(id,user_id,brand,source_id,source_revision,content_hash,packet,observed_at,eligible) values($1,$2,$3,$4,$5,$6,$7,'2026-10-29',true)`, [id, owner, packet.brand, packet.sourceId, packet.sourceRevision, packet.contentHash, JSON.stringify(packet)]);
  await db.query('insert into marketing_source_history(user_id,source_id,source_revision,packet) values($1,$2,$3,$4)', [owner, id, packet.sourceRevision, JSON.stringify(packet)]);
  const other = '99999999-9999-4999-8999-999999999999'; await db.query('insert into auth.users(id) values($1)', [other]);
  await db.query(`insert into marketing_campaigns(user_id,brand,name,starts_on,ends_on,source_snapshot,source_hash) values($1,'devshark','FOREIGN_SOURCE','2026-10-29','2026-11-04','{}',$2)`, [other, 'b'.repeat(64)]);
  const origin = 'https://marketing-state.supabase.test', emulator = new SupabaseEmulator(db, origin, { service: 'TEST-ONLY-SERVICE', users: { [owner]: 'TEST-ONLY-OWNER' } });
  const queried: URL[] = [];
  const fetcher: typeof fetch = (input, init) => { queried.push(new URL(input instanceof Request ? input.url : String(input))); return emulator.fetch(input, init); };
  m.client.mockImplementation((signal: AbortSignal) => {
   const sdk = createClient(origin, 'TEST-ONLY-PUBLISHABLE', { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: 'Bearer TEST-ONLY-OWNER' }, fetch: fetchWithSignal(signal, fetcher) } });
   vi.spyOn(sdk.auth, 'getUser').mockImplementation(() => m.auth()); return sdk;
  });
  const response = await GET(request(undefined, owner)); expect(response.status).toBe(200); const body = await response.json();
  expect(body.ownerId).toBe(owner); expect(body.entries).toHaveLength(156); expect(body.campaigns).toHaveLength(1); expect(JSON.stringify(body)).not.toContain('FOREIGN_SOURCE');
  const fields = ['id','campaign_id','date','local_time','bound_source_id','title','kind','platform','status','needs_review'];
  const originalEntries = (await db.query<{ row: Record<string, unknown> }>('select to_jsonb(e) as row from marketing_calendar_entries e order by date')).rows.map(value => value.row);
  expect(body.entries).toEqual(originalEntries.map(row => Object.fromEntries(fields.map(field => [field, row[field]]))));
  const summary = MarketingSourceSummarySchema.parse({ brand: packet.brand, sourceId: packet.sourceId, sourceRevision: packet.sourceRevision, contentHash: packet.contentHash, canonicalUrl: packet.canonicalUrl, expiresAt: packet.expiresAt, content: { title: packet.content.title, evidence: packet.content.evidence } });
  expect(body.sourceHistory).toEqual([summary]); expect(body.sources).toEqual([{ id, brand: packet.brand, source_id: packet.sourceId, eligible: true, packet: summary }]);
  expect(emulator.requests).toHaveLength(9);
  expect(queried.every(url => !url.searchParams.get('select')?.split(',').includes('*'))).toBe(true);
  const before = { entries: originalEntries, sources: [{ id, brand: packet.brand, source_id: packet.sourceId, source_revision: packet.sourceRevision, eligible: true, observed_at: '2026-10-29T00:00:00Z', packet }], sourceHistory: [packet] };
  const after = { entries: body.entries, sources: body.sources, sourceHistory: body.sourceHistory };
  expect(Buffer.byteLength(JSON.stringify(after))).toBeLessThan(Buffer.byteLength(JSON.stringify(before)));
  if (process.env.AUDIT_CAPTURE_STATE_METRICS === '1') writeFileSync('/tmp/app-audit-405-state-bytes.json', JSON.stringify({ fixture: 'marketingshark', entries: 156, sourcePackets: 2, beforeBytes: Buffer.byteLength(JSON.stringify(before)), afterBytes: Buffer.byteLength(JSON.stringify(after)), displayedFieldsEqual: true, sdkRequests: 9, scope: 'Three projected families in a local full-migration/actual-SDK fixture; not the full response, production latency or billing evidence.' }, null, 2) + '\n');
 } finally { await db.close(); }
}, 120_000);
