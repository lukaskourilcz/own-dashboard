import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-13T12:00:00Z');
const marker = 'TEST-ONLY-PRIVATE-VALUE';
const generation = { MARKETING_PILOT_OWNER_ID: owner, MARKETING_PILOT_STARTS_AT: '2026-10-13T10:00:00Z', MARKETING_PILOT_EXPIRES_AT: '2026-10-14T10:00:00Z' };
const collection = { MARKETING_OWNER_ID: owner, MARKETING_DNESKAI_COLLECTION_PILOT_ENABLED: 'true', MARKETING_DNESKAI_COLLECTION_PILOT_OWNER_ID: owner,
  MARKETING_DNESKAI_COLLECTION_PILOT_PROJECT_ID: project, MARKETING_DNESKAI_COLLECTION_PILOT_STARTS_AT: '2026-10-13T10:00:00Z', MARKETING_DNESKAI_COLLECTION_PILOT_EXPIRES_AT: '2026-10-14T10:00:00Z' };
let warn: MockInstance<typeof console.warn>;
// A fresh module graph per test, so the once-per-process notice starts empty.
beforeEach(() => { vi.resetModules(); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });
const lines = () => warn.mock.calls.map(([line]) => JSON.parse(String(line)) as { event: string; family: string; vercelEnv: string | null; variables: string[] });

describe('retired preview pilot notice (#113)', () => {
  it('writes one structured pilot-retired line per family and process, with names and never values', async () => {
    const { previewPilotRetired } = await import('@/lib/marketing/preview-pilot');
    const env = { VERCEL_ENV: 'production', MARKETING_PILOT_OWNER_ID: marker, MARKETING_PILOT_STARTS_AT: marker };
    expect(previewPilotRetired('generation-pilot', env)).toBe(true);
    expect(previewPilotRetired('generation-pilot', env)).toBe(true);
    expect(previewPilotRetired('template-approvals', { MARKETING_PILOT_TEMPLATE_APPROVALS: marker })).toBe(true);
    expect(lines()).toEqual([
      { event: 'pilot-retired', family: 'generation-pilot', vercelEnv: 'production', variables: ['MARKETING_PILOT_OWNER_ID', 'MARKETING_PILOT_STARTS_AT'] },
      { event: 'pilot-retired', family: 'template-approvals', vercelEnv: null, variables: ['MARKETING_PILOT_TEMPLATE_APPROVALS'] },
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });

  it('keeps Preview unchanged and stays silent where no tuple is configured', async () => {
    const { previewPilotRetired } = await import('@/lib/marketing/preview-pilot');
    expect(previewPilotRetired('generation-pilot', { VERCEL_ENV: 'preview', ...generation })).toBe(false);
    expect(previewPilotRetired('collection-pilot', { VERCEL_ENV: 'production' })).toBe(true);
    expect(previewPilotRetired('source-preview', {})).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('routes every pilot reader through the notice and fails each pilot path closed outside Preview', async () => {
    const { marketingPilotConfiguration } = await import('@/lib/marketing/pilot');
    const { trustedMarketingTemplate } = await import('@/lib/marketing/template-registry');
    const { currentMarketingTemplate } = await import('@/lib/marketing/render');
    const { dneskaiCollectionPilotConfiguration, authenticateDneskaiCollectionPilot } = await import('@/lib/marketing/dneskai-pilot');
    const { sourceRefreshConfig } = await import('@/lib/marketing/source-refresh');
    const { assertMarketingOfflineImportConfiguration } = await import('@/lib/marketing/offline-import');
    const production = { VERCEL_ENV: 'production' };
    expect(marketingPilotConfiguration(owner, { ...production, ...generation }, now)).toBeNull();
    expect(trustedMarketingTemplate('dneskai', { ...production, MARKETING_PILOT_TEMPLATE_APPROVALS: '[]' })).toEqual(currentMarketingTemplate('dneskai'));
    expect(() => dneskaiCollectionPilotConfiguration(owner, project, { ...production, ...collection }, now)).toThrow('collection-pilot-invalid');
    const secret = 'offline-collection-only-secret'.repeat(2);
    expect(authenticateDneskaiCollectionPilot(new Request('https://own.example', { headers: { Authorization: `Bearer ${secret}` } }), project, { ...production, ...collection, MARKETING_DNESKAI_COLLECTION_SECRET: secret }, now)).toBeNull();
    expect(sourceRefreshConfig('dneskai', { ...production, MARKETING_DNESKAI_SOURCE_URL: 'https://quorum.example.invalid/admin/api/marketing-source', MARKETING_DNESKAI_SOURCE_SECRET: 'offline-bridge-secret'.repeat(2), MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN: marker })).toEqual({ url: 'https://quorum.example.invalid/admin/api/marketing-source', secret: 'offline-bridge-secret'.repeat(2) });
    expect(() => assertMarketingOfflineImportConfiguration(owner, { ...production, ...generation, MARKETING_OWNER_ID: owner, MARKETING_OFFLINE_IMPORT_ENABLED: 'true' }, now)).toThrow('offline-import-disabled');
    expect(lines().map(line => line.family).sort()).toEqual(['collection-pilot', 'generation-pilot', 'offline-import', 'source-preview', 'template-approvals']);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });

  it('shows the paid-pilot blocker only in Preview, where the interlock still applies', async () => {
    const { dneskaiCollectionBlockers } = await import('@/lib/marketing/dneskai-store');
    expect(dneskaiCollectionBlockers({ VERCEL_ENV: 'preview', ...generation })).toContain('collection-paid-pilot-blocked');
    expect(dneskaiCollectionBlockers({ VERCEL_ENV: 'production', ...generation })).not.toContain('collection-paid-pilot-blocked');
    expect(dneskaiCollectionBlockers({ VERCEL_ENV: 'production' })).not.toContain('collection-paid-pilot-blocked');
  });

  it('keeps ordinary collection on the direct signed bridge when a retired share is left outside Preview', async () => {
    const { collectDneskaiFeed } = await import('@/lib/marketing/dneskai-providers');
    const { DNESKAI_SOURCES } = await import('@/lib/marketing/dneskai-registry');
    const source = DNESKAI_SOURCES.find(item => item.id === 'openai-blog')!, origin = 'https://quorum-production.example.invalid';
    const env = { VERCEL_ENV: 'production', MARKETING_DNESKAI_SOURCE_URL: `${origin}/admin/api/marketing-source`, MARKETING_DNESKAI_SOURCE_SECRET: 'offline-bridge-secret'.repeat(2),
      MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN: marker, MARKETING_DNESKAI_SOURCE_PREVIEW_ORIGIN: 'https://quorum-isolated.vercel.app' };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ schemaVersion: 'dneskai-feed/1', sources: [{ sourceId: source.id, status: 'ok', errorCode: null, items: [] }] }));
    expect((await collectDneskaiFeed(source, '2026-10-12T00:00:00Z', { env, fetcher, signal: new AbortController().signal, now })).complete).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${origin}/admin/api/marketing-collection`); expect(new Headers(init?.headers).get('cookie')).toBeNull();
    expect(new Headers(init?.headers).get('x-marketing-signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(marker);
    expect(lines()).toEqual([{ event: 'pilot-retired', family: 'source-preview', vercelEnv: 'production', variables: ['MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN', 'MARKETING_DNESKAI_SOURCE_PREVIEW_ORIGIN'] }]);
  });
});
