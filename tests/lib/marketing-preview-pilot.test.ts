import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-13T12:00:00Z');
const marker = 'TEST-ONLY-PRIVATE-VALUE';
const generation = { MARKETING_PILOT_OWNER_ID: owner, MARKETING_PILOT_STARTS_AT: '2026-10-13T10:00:00Z', MARKETING_PILOT_EXPIRES_AT: '2026-10-14T10:00:00Z' };
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
    expect(previewPilotRetired('offline-import', { VERCEL_ENV: 'production' })).toBe(true);
    expect(previewPilotRetired('source-preview', {})).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('routes every pilot reader through the notice and fails each pilot path closed outside Preview', async () => {
    const { marketingPilotConfiguration } = await import('@/lib/marketing/pilot');
    const { trustedMarketingTemplate } = await import('@/lib/marketing/template-registry');
    const { currentMarketingTemplate } = await import('@/lib/marketing/render');
    const { sourceRefreshConfig } = await import('@/lib/marketing/source-refresh');
    const { assertMarketingOfflineImportConfiguration } = await import('@/lib/marketing/offline-import');
    const production = { VERCEL_ENV: 'production' };
    expect(marketingPilotConfiguration(owner, { ...production, ...generation }, now)).toBeNull();
    expect(trustedMarketingTemplate('devshark', { ...production, MARKETING_PILOT_TEMPLATE_APPROVALS: '[]' })).toEqual(currentMarketingTemplate('devshark'));
    expect(sourceRefreshConfig('dneskai', { ...production, MARKETING_DNESKAI_SOURCE_URL: 'https://quorum.example.invalid/admin/api/marketing-source', MARKETING_DNESKAI_SOURCE_SECRET: 'offline-bridge-secret'.repeat(2), MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN: marker })).toEqual({ url: 'https://quorum.example.invalid/admin/api/marketing-source', secret: 'offline-bridge-secret'.repeat(2) });
    expect(() => assertMarketingOfflineImportConfiguration(owner, { ...production, ...generation, MARKETING_OWNER_ID: owner, MARKETING_OFFLINE_IMPORT_ENABLED: 'true' }, now)).toThrow('offline-import-disabled');
    expect(lines().map(line => line.family).sort()).toEqual(['generation-pilot', 'offline-import', 'source-preview', 'template-approvals']);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });

  it('keeps the render preflight a Preview-only diagnostic and reports the retired tuple it meets', async () => {
    const { runMarketingRenderPreflight } = await import('@/lib/marketing/render-preflight');
    const env = { VERCEL_ENV: 'production', ...generation, MARKETING_OWNER_ID: owner };
    // Rejected before any database read or source refresh.
    await expect(runMarketingRenderPreflight({} as never, owner, { brand: 'dneskai', sourceId: 'openai-blog', scheduledAt: '2026-10-14T08:00:00Z' }, { env, now: () => now })).rejects.toThrow('render-preflight-preview-required');
    expect(lines()).toEqual([{ event: 'pilot-retired', family: 'generation-pilot', vercelEnv: 'production', variables: ['MARKETING_PILOT_OWNER_ID', 'MARKETING_PILOT_STARTS_AT', 'MARKETING_PILOT_EXPIRES_AT'] }]);
  });

  it('shows the paid-pilot blocker only in Preview, where the interlock still applies', async () => {
    const { dneskaiCollectionBlockers } = await import('@/lib/marketing/dneskai-store');
    expect(dneskaiCollectionBlockers({ VERCEL_ENV: 'preview', ...generation })).toContain('collection-paid-pilot-blocked');
    expect(dneskaiCollectionBlockers({ VERCEL_ENV: 'production', ...generation })).not.toContain('collection-paid-pilot-blocked');
    expect(dneskaiCollectionBlockers({ VERCEL_ENV: 'production' })).not.toContain('collection-paid-pilot-blocked');
  });

  // The DNESKAi collection bridge (and its Preview share) was removed on 9 November 2026 — collection reads the free
  // feeds natively — so source-preview's retirement is now observed only through sourceRefreshConfig above.
});
