import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMarketingRenderPreflight } from '@/lib/marketing/render-preflight';
import { currentMarketingTemplate, renderAuthoredMarketingPreflight } from '@/lib/marketing/render';
import { marketingTemplateDefinition } from '@/lib/marketing/render';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import type { createAdminClient } from '@/lib/supabase/admin';
import heldQuestion from '../../templates/marketing/benchmarks/devshark-question.json';
import heldChallenge from '../../templates/marketing/benchmarks/devshark-coding-task.json';

vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-13T12:00:00Z');
const scheduledAt = '2026-10-14T12:00:00Z';
function environment() {
  const template = currentMarketingTemplate('devshark');
  return { VERCEL_ENV: 'preview', MARKETING_OWNER_ID: owner, MARKETING_AI_CONSENT: 'true', MARKETING_PILOT_OWNER_ID: owner,
    MARKETING_PILOT_STARTS_AT: '2026-10-13T10:00:00Z', MARKETING_PILOT_EXPIRES_AT: '2026-10-15T10:00:00Z',
    MARKETING_PILOT_TEMPLATE_APPROVALS: JSON.stringify([{ brand: 'devshark', approvedBy: owner, approvedAt: '2026-10-13T11:00:00Z',
      templateSha256: template.templateSha256, designExportSha256: marketingTemplateDefinition('devshark').style.design.archiveSha256 }]) };
}
function packet(fixture: typeof heldQuestion | typeof heldChallenge = heldQuestion) {
  // Actual retained producer fixtures stay false. Eligibility is an explicit offline operational simulation.
  return parseSourcePacket({ ...structuredClone(fixture), eligible: true, eligibilityReason: 'OFFLINE RENDER PREFLIGHT SIMULATION ONLY', observedAt: now.toISOString() });
}
function database(source = packet(), accountOwner = owner) {
  const queries: { table: string; filters: unknown[] }[] = [];
  const account = { user_id: accountOwner, brand: 'devshark', platform: 'instagram', remote_account_id: 'TEST-ONLY-ACCOUNT', handle: 'test-only', verified_at: now.toISOString(), enabled: false };
  const db = { from(table: string) {
    const trace = { table, filters: [] as unknown[] }; queries.push(trace);
    const query = { select: () => query, eq: (key: string, value: unknown) => { trace.filters.push([key, value]); return query; },
      not: (key: string, op: string, value: unknown) => { trace.filters.push([key, op, value]); return query; },
      single: async () => ({ data: account, error: null }), maybeSingle: async () => ({ data: { packet: source }, error: null }) };
    return query;
  } };
  for (const forbidden of ['rpc', 'storage']) Object.defineProperty(db, forbidden, { get() { throw new Error('TEST-ONLY-DB-WRITE-OR-STORAGE-FORBIDDEN'); } });
  return { db: db as unknown as ReturnType<typeof createAdminClient>, queries };
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('TEST-ONLY-NETWORK-FORBIDDEN'); })); });
afterEach(() => { vi.unstubAllGlobals(); });
describe('Preview-only authenticated authored render diagnostic, no model/job/storage writes', () => {
  it.each([heldQuestion, heldChallenge])('renders authentic held $kind bytes only under explicit offline eligibility/approval simulation', async fixture => {
    const source = packet(fixture), state = database(source), refresh = vi.fn(async () => source);
    const result = await runMarketingRenderPreflight(state.db, owner, { brand: 'devshark', sourceId: source.sourceId, scheduledAt }, { env: environment(), now: () => now, refresh });
    expect(result).toMatchObject({ diagnosticOnly: true, stage: 'render-complete', providerCalls: 0, storage: 'not-exercised', assetCount: fixture.kind === 'question' ? 4 : 3 });
    for (const asset of result.assets) expect(asset).toEqual({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/), svgSha256: expect.stringMatching(/^[a-f0-9]{64}$/), width: 1080, height: 1350, bytes: expect.any(Number) });
    expect(result.assets.every(asset => asset.bytes > 10000 && asset.bytes < 8 * 1024 * 1024)).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled();
    expect(state.queries).toHaveLength(2);
    for (const query of state.queries) expect(query.filters).toEqual(expect.arrayContaining([['user_id', owner], ['brand', 'devshark']]));
    const serialized = JSON.stringify(result);
    for (const privateValue of [source.canonicalUrl, source.content.title, source.content.body, source.content.code!, owner, 'TEST-ONLY-ACCOUNT']) if (privateValue) expect(serialized).not.toContain(privateValue);
    expect(fixture.eligible).toBe(false); expect(currentMarketingTemplate('devshark').approved).toBe(false);
  });
  it.each([
    [{ VERCEL_ENV: 'production' }, 'render-preflight-preview-required'], [{ VERCEL_ENV: undefined }, 'render-preflight-preview-required'],
    [{ MARKETING_OWNER_ID: other }, 'render-preflight-owner-mismatch'], [{ MARKETING_AI_CONSENT: 'false' }, 'render-preflight-consent-required'],
    [{ MARKETING_PILOT_EXPIRES_AT: '2026-10-13T11:00:00Z' }, 'pilot-outside-window'],
  ])('holds configuration before producer/DB work: %j', async (patch, code) => {
    const state = database(), refresh = vi.fn();
    await expect(runMarketingRenderPreflight(state.db, owner, { brand: 'devshark', sourceId: heldQuestion.sourceId, scheduledAt }, { env: { ...environment(), ...patch }, now: () => now, refresh })).rejects.toThrow(String(code));
    expect(refresh).not.toHaveBeenCalled(); expect(state.queries).toEqual([]);
  });
  it('holds absence of pilot, missing approval, invalid schedule and foreign account without model or uploads', async () => {
    const state = database(), refresh = vi.fn(); const input = { brand: 'devshark' as const, sourceId: heldQuestion.sourceId, scheduledAt };
    const ordinary = { VERCEL_ENV: 'preview', MARKETING_OWNER_ID: owner, MARKETING_AI_CONSENT: 'true' };
    await expect(runMarketingRenderPreflight(state.db, owner, input, { env: ordinary, now: () => now, refresh })).rejects.toThrow('render-preflight-pilot-required');
    await expect(runMarketingRenderPreflight(state.db, owner, input, { env: { ...environment(), MARKETING_PILOT_TEMPLATE_APPROVALS: '[]' }, now: () => now, refresh })).rejects.toThrow('claude-design-approval-required');
    for (const scheduledAt of ['2026-10-13T11:00:00Z', '2026-10-20T12:00:00Z']) await expect(runMarketingRenderPreflight(state.db, owner, { ...input, scheduledAt }, { env: environment(), now: () => now, refresh })).rejects.toThrow('render-preflight-schedule-invalid');
    await expect(runMarketingRenderPreflight(database(packet(), other).db, owner, input, { env: environment(), now: () => now, refresh })).rejects.toThrow('render-preflight-account-unavailable');
    expect(refresh).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('holds producer outage, wrong identity, withdrawal and post-render authority changes', async () => {
    const source = packet(), input = { brand: 'devshark' as const, sourceId: source.sourceId, scheduledAt };
    for (const refresh of [vi.fn().mockRejectedValue(new Error('TEST PRIVATE URL KEY')), vi.fn().mockResolvedValue({ ...source, sourceId: 'foreign-source' }), vi.fn().mockResolvedValue(heldQuestion)]) {
      await expect(runMarketingRenderPreflight(database(source).db, owner, input, { env: environment(), now: () => now, refresh })).rejects.toThrow(/render-preflight-(?:refresh-failed|source-unavailable)/);
      expect(fetch).not.toHaveBeenCalled();
    }
    const refresh = vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, canonicalUrl: 'https://example.invalid/changed-source' });
    await expect(runMarketingRenderPreflight(database(source).db, owner, input, { env: environment(), now: () => now, refresh })).rejects.toThrow('render-preflight-source-changed');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('never grants held sources or pending templates permission through the direct preflight helper', async () => {
    const input = { source: parseSourcePacket(heldQuestion), account: { id: 'TEST-ONLY', handle: 'test-only', platform: 'instagram' as const }, template: currentMarketingTemplate('devshark'), revisionId: owner, scheduledAt, now };
    await expect(renderAuthoredMarketingPreflight(input)).rejects.toThrow('render-preflight-source-unavailable');
    await expect(renderAuthoredMarketingPreflight({ ...input, source: packet() })).rejects.toThrow('claude-design-approval-required');
  });
});
