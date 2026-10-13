import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ admin: vi.fn(), preflight: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.admin() }));
vi.mock('@/lib/marketing/render-preflight', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/marketing/render-preflight')>(), runMarketingRenderPreflight: (...args: unknown[]) => mocks.preflight(...args) }));
import { POST } from '@/app/api/marketing/n8n/route';
const owner = '11111111-1111-4111-8111-111111111111', secret = 'TEST-ONLY-N8N-SECRET-'.repeat(3);
function request(body: unknown, auth = `Bearer ${secret}`) { return new Request('https://example.invalid/api/marketing/n8n', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
const body = { operation: 'render-preflight', brand: 'devshark', sourceId: 'TEST-ONLY-SOURCE', scheduledAt: '2026-10-14T12:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('MARKETING_OWNER_ID', owner); vi.stubEnv('MARKETING_N8N_SECRET', secret); mocks.admin.mockReturnValue({ readOnlyTestDatabase: true }); });
afterEach(() => { vi.unstubAllEnvs(); });
describe('existing authenticated n8n render diagnostic operation', () => {
  it('rejects unauthorized input before privileged access and disallows caller-supplied owners/templates/source packets', async () => {
    expect((await POST(request(body, 'Bearer wrong'))).status).toBe(401);
    for (const extra of [{ ownerId: owner }, { template: {} }, { source: {} }, { platform: 'threads' }, { generation: {} }]) expect((await POST(request({ ...body, ...extra }))).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.preflight).not.toHaveBeenCalled();
  });
  it('forwards exact authenticated owner/selection and returns only diagnostic metadata with no-store', async () => {
    const metadata = { diagnosticOnly: true, stage: 'render-complete', providerCalls: 0, storage: 'not-exercised', assetCount: 2, assets: [] };
    mocks.preflight.mockResolvedValue(metadata);
    const response = await POST(request(body));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(metadata); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.preflight).toHaveBeenCalledWith(expect.anything(), owner, { brand: body.brand, sourceId: body.sourceId, scheduledAt: body.scheduledAt }, { signal: expect.any(AbortSignal) });
  });
  it('returns only fixed safe render failure codes and discards arbitrary exception text', async () => {
    mocks.preflight.mockRejectedValueOnce(Object.assign(new Error('TEST PRIVATE MODULE PATH'), { code: 'render-rasterizer-unavailable' }));
    let response = await POST(request(body)); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'render-rasterizer-unavailable' });
    mocks.preflight.mockRejectedValueOnce(new Error('TEST PRIVATE SOURCE KEY PATH'));
    response = await POST(request(body)); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'marketing-operation-held' });
  });
});
