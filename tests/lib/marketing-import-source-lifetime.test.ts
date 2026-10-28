import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ client: vi.fn(), knowledge: vi.fn(), reader: vi.fn(), factory: vi.fn(), fetcher: vi.fn(), prepare: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/github-token', () => ({ createGitHubFetcher: m.factory }));
vi.mock('@/lib/marketing/calendar-source', () => ({ readFullMarketingCalendar: m.reader, MARKETING_CALENDAR_IMPORT_TIMEOUT_MS: 20_000 }));
vi.mock('@/lib/marketing/campaign-import', () => ({ planCampaignImport: m.prepare }));
import { POST } from '@/app/api/marketing/import/route';
const owner = '11111111-1111-4111-8111-111111111111', hash = 'b'.repeat(64);
const plan = { schemaVersion: 'marketing-calendar/1', project: 'devshark', entries: [] };
const request = (kind: 'repository' | 'inline', apply: boolean, signal?: AbortSignal) => new Request('https://own.example/api/marketing/import', { method: 'POST', headers: { Origin: 'https://own.example', 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ ...(kind === 'repository' ? { source: 'repository', brand: 'devshark', expectedHash: hash } : { plan }), startsOn: '2026-11-01', apply }) });
beforeEach(() => {
 vi.clearAllMocks();
 const query = { select: () => query, eq: () => query, limit: m.knowledge };
 m.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) }, from: () => query });
 m.knowledge.mockResolvedValue({ data: [], error: null }); m.reader.mockResolvedValue(plan); m.factory.mockReturnValue(m.fetcher);
 m.prepare.mockReturnValue({ campaign: { source_hash: hash }, entries: [], report: { inputCount: 0 } });
 m.admin.mockReturnValue({ rpc: m.rpc }); m.rpc.mockResolvedValue({ data: '22222222-2222-4222-8222-222222222222', error: null });
});
afterEach(() => vi.restoreAllMocks());
it.each(['repository', 'inline'] as const)('does not plan or write after request retirement during %s input work', async kind => {
 let finish!: (value: unknown) => void;
 const controlled = kind === 'repository' ? m.reader : m.knowledge;
 controlled.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
 const parent = new AbortController(), input = request(kind, true, parent.signal), pending = POST(input);
 await vi.waitFor(() => expect(controlled).toHaveBeenCalledOnce());
 parent.abort('TEST_ONLY_PRIVATE_REASON'); finish(kind === 'repository' ? plan : { data: [], error: null });
 const response = await pending; expect(response.status).toBe(400);
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
