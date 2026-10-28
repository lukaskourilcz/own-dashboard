import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { contentHash } from '@/lib/marketing/hashes';
const m = vi.hoisted(() => ({ client: vi.fn(), auth: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), limit: vi.fn(), retry: vi.fn(), querySignal: vi.fn(), knowledge: vi.fn(), writeResult: vi.fn(), writeRetry: vi.fn(), writeSignal: vi.fn(), reader: vi.fn(), factory: vi.fn(), fetcher: vi.fn(), prepare: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/github-token', () => ({ createGitHubFetcher: m.factory }));
vi.mock('@/lib/marketing/calendar-source', () => ({ readFullMarketingCalendar: m.reader, MARKETING_CALENDAR_IMPORT_TIMEOUT_MS: 20_000 }));
vi.mock('@/lib/marketing/campaign-import', () => ({ planCampaignImport: m.prepare }));
import { POST } from '@/app/api/marketing/import/route';
const owner = '11111111-1111-4111-8111-111111111111', hash = 'b'.repeat(64);
const plan = { schemaVersion: 'marketing-calendar/1', project: 'devshark', entries: [] };
const preparedFixture = () => ({ campaign: { brand: 'devshark', starts_on: '2026-11-01', ends_on: '2026-11-07', source_hash: hash, source_snapshot: { private: 'TEST_ONLY_AUTHORED_COPY' } }, entries: [{ original: { body: 'TEST_ONLY_AUTHORED_COPY' } }], report: { inputCount: 0, outputCount: 0, shiftDays: 0, held: 0, backlog: 0, completed: 0, unmatchedTipTitles: [], ambiguousTipTitles: [] } });
const request = (kind: 'repository' | 'inline', apply: boolean, signal?: AbortSignal) => new Request('https://own.example/api/marketing/import', { method: 'POST', headers: { Origin: 'https://own.example', 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ ...(kind === 'repository' ? { source: 'repository', brand: 'devshark', expectedHash: hash, ...(process.env.AUDIT_ORIGINAL_IMPORT_FINGERPRINT === '1' ? {} : { expectedImportHash: contentHash({ ownerId: owner, ...preparedFixture() }) }) } : { plan }), startsOn: '2026-11-01', apply }) });
beforeEach(() => {
 vi.clearAllMocks();
 const query = { select: m.select, eq: m.eq, limit: m.limit, retry: m.retry, abortSignal: m.querySignal, then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(m.knowledge()).then(resolve, reject) };
 for (const method of [m.select, m.eq, m.limit, m.retry, m.querySignal]) method.mockReturnValue(query);
 m.auth.mockResolvedValue({ data: { user: { id: owner } }, error: null }); m.from.mockReturnValue(query);
 m.client.mockResolvedValue({ auth: { getUser: m.auth }, from: m.from });
 m.knowledge.mockResolvedValue({ data: [], error: null, count: 0 }); m.reader.mockResolvedValue(plan); m.factory.mockReturnValue(m.fetcher);
 m.prepare.mockImplementation(preparedFixture);
 const write = { retry: m.writeRetry, abortSignal: m.writeSignal, then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(m.writeResult()).then(resolve, reject) };
 m.writeRetry.mockReturnValue(write); m.writeSignal.mockReturnValue(write); m.rpc.mockReturnValue(write);
 m.admin.mockReturnValue({ rpc: m.rpc }); m.writeResult.mockResolvedValue({ data: '22222222-2222-4222-8222-222222222222', error: null });
});
afterEach(() => vi.restoreAllMocks());
it.each(['repository', 'inline'] as const)('does not plan or write after request retirement during %s input work', async kind => {
 let finish!: (value: unknown) => void;
 const controlled = kind === 'repository' ? m.reader : m.knowledge;
 controlled.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
 const parent = new AbortController(), input = request(kind, true, parent.signal), pending = POST(input);
 await vi.waitFor(() => expect(controlled).toHaveBeenCalledOnce());
 parent.abort('TEST_ONLY_PRIVATE_REASON'); finish(kind === 'repository' ? plan : { data: [], error: null });
 const response = await pending; expect(response.status).toBe(503);
 expect(m.prepare).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
 expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it('passes the original request through GitHub setup and the complete reader for a read-only preview', async () => {
 const input = request('repository', false), response = await POST(input);
 expect(response.status).toBe(200);
 const captured = m.factory.mock.calls[0][1] as AbortSignal;
 expect(captured).toBeInstanceOf(AbortSignal); expect(captured.aborted).toBe(true); expect(input.signal.aborted).toBe(false);
 expect(m.factory).toHaveBeenCalledExactlyOnceWith(owner, captured);
 expect(m.reader).toHaveBeenCalledExactlyOnceWith(m.fetcher, 'devshark', captured);
 expect(m.prepare).toHaveBeenCalledOnce(); expect(m.admin).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});

it('retires only GitHub work before an active request continues to its write phase', async () => {
 const input = request('repository', true), response = await POST(input);
 expect(response.status).toBe(200); expect(m.factory.mock.calls[0][1].aborted).toBe(true); expect(input.signal.aborted).toBe(false);
 expect(m.admin).toHaveBeenCalledOnce(); expect(m.rpc).toHaveBeenCalledExactlyOnceWith('marketing_import_campaign', expect.objectContaining({ p_owner: owner }));
});


it.each([401, 403, 503])('does not grant import work to a cached user with auth error %i', async status => {
 m.auth.mockResolvedValue({ data: { user: { id: owner } }, error: { status, message: 'TEST_ONLY_PRIVATE_AUTH' } });
 const response = await POST(request('repository', false)); expect(response.status).toBe(status === 503 ? 503 : 401);
 expect(m.from).not.toHaveBeenCalled(); expect(m.factory).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
 expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it('contains setup failures before knowledge or service access', async () => {
 m.client.mockRejectedValue(Error('TEST_ONLY_PRIVATE_SETUP'));
 const response = await POST(request('repository', false)); expect(response.status).toBe(503);
 expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');
});
it('does not start setup for a previously retired request', async () => {
 const parent = new AbortController(); parent.abort();
 const response = await POST(request('repository', false, parent.signal)); expect(response.status).toBe(503);
 expect(m.client).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled();
});
it.each(['claimed', 'actual'] as const)('refuses %s excess body bytes before knowledge reads', async kind => {
 const input = new Request('https://own.example/api/marketing/import', { method: 'POST', headers: { Origin: 'https://own.example', 'Content-Type': 'application/json', ...(kind === 'claimed' ? { 'Content-Length': '1200000' } : {}) }, body: JSON.stringify({ plan: { padding: kind === 'actual' ? 'x'.repeat(1_100_000) : '' }, startsOn: '2026-11-01', apply: false }) });
 const response = await POST(input); expect(response.status).toBe(413); expect(m.from).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
it.each(['not-an-owner', '33333333-3333-4333-8333-333333333333'])('refuses a malformed or changed captured owner %s', async captured => {
 const input = request('repository', false); input.headers.set('x-own-dashboard-owner', captured);
 const response = await POST(input); expect(response.status).toBe(captured === 'not-an-owner' ? 400 : 409);
 expect(m.from).not.toHaveBeenCalled(); expect(m.factory).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
const idea = { id: '44444444-4444-4444-8444-444444444444', user_id: owner, title: 'Known idea' };
it.each([
 { data: [], error: null, count: null },
 { data: [], error: null, count: 1 },
 { data: [idea, idea], error: null, count: 2 },
 { data: [{ ...idea, user_id: '33333333-3333-4333-8333-333333333333' }], error: null, count: 1 },
 { data: [{ ...idea, title: {} }], error: null, count: 1 },
 { data: [idea], error: null, count: 1001 },
])('refuses incomplete or malformed knowledge instead of inventing absent references %#', async result => {
 m.knowledge.mockResolvedValue(result);
 const response = await POST(request('repository', false)); expect(response.status).toBe(503);
 expect(m.factory).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
it('returns only the owner-bound preview fields used by the UI', async () => {
 const response = await POST(request('repository', false)); expect(response.status).toBe(200);
 const value = await response.json(); expect(value.ownerId).toBe(owner);
 expect(value.campaign).toEqual({ brand: 'devshark', starts_on: '2026-11-01', ends_on: '2026-11-07', source_hash: hash });
 expect(value.entries).toBeUndefined(); expect(JSON.stringify(value)).not.toContain('TEST_ONLY_AUTHORED_COPY');
});
it('does not acknowledge an invalid import id returned by a write', async () => {
 m.writeResult.mockResolvedValue({ data: null, error: null });
 const response = await POST(request('repository', true)); expect(response.status).toBe(503);
});
it('keeps one original scope for knowledge and the service write with SDK retries disabled', async () => {
 const input = request('repository', true), response = await POST(input); expect(response.status).toBe(200);
 expect(m.select).toHaveBeenCalledWith('id,user_id,title', { count: 'exact' });
 expect(m.eq).toHaveBeenCalledWith('user_id', owner); expect(m.eq).toHaveBeenCalledWith('record_type', 'idea');
 expect(m.retry).toHaveBeenCalledExactlyOnceWith(false); expect(m.writeRetry).toHaveBeenCalledExactlyOnceWith(false);
 expect(m.querySignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal); expect(m.writeSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
 expect(m.admin).toHaveBeenCalledWith(expect.any(AbortSignal)); expect(m.client).toHaveBeenCalledWith(expect.any(AbortSignal));
 expect(response.headers.get('cache-control')).toBe('private, no-store');
});

it('keeps every displayed field while sending a summary of a real 156-entry calendar fixture', async () => {
 const original = JSON.parse(readFileSync('fixtures/marketing-calendars/marketingshark.json', 'utf8'));
 const actual = await vi.importActual<typeof import('@/lib/marketing/campaign-import')>('@/lib/marketing/campaign-import');
 m.reader.mockResolvedValue(original); m.prepare.mockImplementation(actual.planCampaignImport);
 const prepared = actual.planCampaignImport(original, '2026-11-01', []), response = await POST(request('repository', false));
 expect(response.status).toBe(200); const bytes = await response.text(), value = JSON.parse(bytes);
 expect(value).toEqual({ ownerId: owner, importHash: contentHash({ ownerId: owner, ...prepared }), campaign: { brand: prepared.campaign.brand, starts_on: prepared.campaign.starts_on, ends_on: prepared.campaign.ends_on, source_hash: prepared.campaign.source_hash }, report: prepared.report });
 expect(value.report.inputCount).toBe(156); expect(value.report.outputCount).toBe(156); expect(m.rpc).not.toHaveBeenCalled();
 if (process.env.AUDIT_CAPTURE_IMPORT_METRICS === '1') writeFileSync('/tmp/app-audit-396-preview-bytes.json', JSON.stringify({ fixture: 'marketingshark', inputCount: 156, fullPreparedBytes: Buffer.byteLength(JSON.stringify(prepared)), previewBytes: Buffer.byteLength(bytes), allDisplayedFieldsEqual: true, metric: 'local fixture response bytes; not latency, production or billing evidence' }, null, 2) + '\n');
});

it('binds preview and apply to the complete owner-stamped planned result', async () => {
 const expected = contentHash({ ownerId: owner, ...preparedFixture() });
 const preview = await POST(request('repository', false)); expect((await preview.json()).importHash).toBe(expected);
 const saved = await POST(request('repository', true)); expect(saved.status).toBe(200); expect((await saved.json()).importHash).toBe(expected);
});
it.each(['missing', 'wrong', 'changed-matches', 'changed-report'] as const)('refuses %s preview identity before any write', async kind => {
 const input = await request('repository', true).json();
 if (kind === 'missing') delete input.expectedImportHash;
 if (kind === 'wrong') input.expectedImportHash = 'a'.repeat(64);
 if (kind === 'changed-matches') m.prepare.mockReturnValueOnce({ ...preparedFixture(), entries: [{ ...preparedFixture().entries[0], knowledge_ids: [owner] }] });
 if (kind === 'changed-report') m.prepare.mockReturnValueOnce({ ...preparedFixture(), report: { ...preparedFixture().report, ambiguousTipTitles: ['TEST_ONLY_CHANGED_MATCH'] } });
 const response = await POST(new Request('https://own.example/api/marketing/import', { method: 'POST', headers: { Origin: 'https://own.example', 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
 expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'calendar-import-preview-changed' }); expect(m.admin).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
