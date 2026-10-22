import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Audit finding cost-06: the two n8n entry points answer 410 and reach no credential, body, database or provider.
const mocks = vi.hoisted(() => ({ downstream: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.downstream }));
vi.mock('@/lib/marketing/http', () => ({ authenticateN8n: mocks.downstream, boundedRequestText: mocks.downstream }));
vi.mock('@/lib/marketing/dneskai-collection', () => ({ tickDneskaiCollection: mocks.downstream, DneskaiCollectInput: { parse: mocks.downstream } }));
vi.mock('@/lib/marketing/orchestrator', () => ({ executeOrchestratedMarketingJob: mocks.downstream, publishDueMarketing: mocks.downstream, synchronizeMarketingSources: mocks.downstream, enqueueCalendarMarketingJob: mocks.downstream, reconcileStoredMarketingPublication: mocks.downstream }));
vi.mock('@/lib/marketing/knowledge-runner', () => ({ runQueuedKnowledgeAnalysis: mocks.downstream, pollQueuedKnowledgeAnalysis: mocks.downstream, abortQueuedKnowledgeAnalysis: mocks.downstream, createKnowledgeDiagnostics: mocks.downstream }));
import * as collect from '@/app/api/marketing/dneskai/collect/route';
import * as n8n from '@/app/api/marketing/n8n/route';

const secret = 'test-only-retired-route-secret-'.repeat(2);
const owner = '11111111-1111-4111-8111-111111111111';
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const bodies: Record<'collect' | 'n8n', Array<Record<string, unknown>>> = {
  collect: [{ projectId: owner, runId: owner }, { projectId: owner, manual: true, runId: owner }, { projectId: owner, pilot: true }],
  n8n: [{ operation: 'execute', jobId: owner }, { operation: 'knowledge-run', sourceId: owner }, { operation: 'publish', brand: 'dneskai', dryRun: false }, { operation: 'discover', brand: 'dneskai' }, { operation: 'weekly-report', brand: 'devshark', weekStartsOn: '2026-10-18' }],
};
type Handler = (request: Request) => Response | Promise<Response>;
const routes: Array<[string, Record<(typeof methods)[number], Handler>, Array<Record<string, unknown>>]> = [['/api/marketing/dneskai/collect', collect, bodies.collect], ['/api/marketing/n8n', n8n, bodies.n8n]];
let transport: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mocks.downstream.mockReset();
  transport = vi.fn(async () => new Response(null, { status: 200 })); vi.stubGlobal('fetch', transport);
  for (const [key, value] of Object.entries({ MARKETING_OWNER_ID: owner, MARKETING_N8N_SECRET: secret, MARKETING_DNESKAI_COLLECTION_SECRET: secret, MARKETING_DNESKAI_MANUAL_SECRET: secret, MARKETING_DNESKAI_COLLECTION_ENABLED: 'true', MARKETING_AI_CONSENT: 'true' })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(routes)('%s is retired', (path, route, payloads) => {
  it.each(methods)('answers %s with 410 and only the code', async (method) => {
    const handler = route[method];
    expect(typeof handler).toBe('function');
    const response = await handler(new Request(`https://own.example${path}`, { method: method === 'HEAD' || method === 'GET' ? method : 'POST' }));
    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'route-retired' });
  });
  it.each(payloads)('refuses %j with a valid secret before reading the body or calling anything', async (payload) => {
    const request = new Request(`https://own.example${path}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const response = await route.POST(request);
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ code: 'route-retired' });
    expect(request.bodyUsed).toBe(false);
    expect(mocks.downstream).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});
