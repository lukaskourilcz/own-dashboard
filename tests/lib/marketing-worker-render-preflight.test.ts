import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMarketingWorkerJob } from '../../services/marketing-worker/protocol';
import { currentMarketingTemplate, marketingTemplateDefinition, renderAuthoredMarketingPreflight, renderMarketingAssets, MarketingRenderError } from '@/lib/marketing/render';
import heldQuestion from '../../templates/marketing/benchmarks/devshark-question.json';
import { parseSourcePacket } from '@/lib/marketing/contracts';

const mocks = vi.hoisted(() => ({ preflightFailure: null as Error | null, preparationFailure: null as Error | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/marketing/render', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/marketing/render')>();
  return { ...real, renderAuthoredMarketingPreflight: vi.fn(async (...args: Parameters<typeof real.renderAuthoredMarketingPreflight>) => {
    if (mocks.preflightFailure) throw mocks.preflightFailure;
    return real.renderAuthoredMarketingPreflight(...args);
  }), renderMarketingAssets: vi.fn(async (...args: Parameters<typeof real.renderMarketingAssets>) => {
    if (mocks.preparationFailure) throw mocks.preparationFailure;
    return real.renderMarketingAssets(...args);
  }) };
});
beforeEach(() => { vi.clearAllMocks(); mocks.preflightFailure = null; mocks.preparationFailure = null; });
function setup() {
  const source = parseSourcePacket({ ...heldQuestion, eligible: true, eligibilityReason: 'OFFLINE PRE-PAID RENDER GUARD SIMULATION ONLY', observedAt: new Date().toISOString() });
  const base = currentMarketingTemplate('devshark'), revisionId = '33333333-3333-4333-8333-333333333333', traceId = '44444444-4444-4444-8444-444444444444';
  const template = { ...base, approved: true, approval: { approvedBy: '11111111-1111-4111-8111-111111111111', approvedAt: new Date().toISOString(), templateSha256: base.templateSha256, designExportSha256: marketingTemplateDefinition('devshark').style.design.archiveSha256 } };
  const request = { schemaVersion: 'marketing-job/1' as const, idempotencyKey: revisionId, template, generation: { source, consent: true, revisionId, knowledge: [],
    templateVersion: base.version, account: { id: 'TEST-ONLY', handle: 'test-only', platform: 'instagram' as const }, scheduledAt: new Date(Date.now() + 3600000).toISOString() } };
  const invoke = vi.fn(async () => ({ copy: { title: 'Authored question', caption: 'Read the authored question.', locale: 'en', slides: [
    { headline: 'Question', body: 'Read the question.', code: null, evidenceIndexes: [] }, { headline: 'Explanation', body: 'Read the authored explanation.', code: null, evidenceIndexes: [] },
  ] }, usage: { inputTokens: 100, outputTokens: 100 } }));
  const put = vi.fn(async (input: { sha256: string }) => ({ sha256: input.sha256, url: 'https://assets.example.invalid/test-only.jpg' }));
  const recordPreparationFailure = vi.fn(async () => true), start = vi.fn(async () => ({ id: traceId, stage: vi.fn(async () => {}), finish: vi.fn(async () => {}) }));
  return { request, invoke, put, traceId, recordPreparationFailure, start, dependencies: { model: { model: 'claude-offline-render-preflight-test', pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 }, invoke },
    storage: { put }, reloadSource: vi.fn(async () => source), tracer: { start, recordPreparationFailure } } };
}
describe('authored renderer check before paid generation; truthful downstream failure diagnostics', () => {
  it('holds missing fonts before even starting generation/tracing/storage', async () => {
    const test = setup(); mocks.preflightFailure = new MarketingRenderError('font-unavailable');
    await expect(runMarketingWorkerJob(test.request, test.dependencies)).rejects.toThrow('font-unavailable');
    expect(renderAuthoredMarketingPreflight).toHaveBeenCalledTimes(1); expect(test.dependencies.reloadSource).toHaveBeenCalledTimes(1);
    expect(test.invoke).not.toHaveBeenCalled(); expect(test.start).not.toHaveBeenCalled(); expect(renderMarketingAssets).not.toHaveBeenCalled(); expect(test.put).not.toHaveBeenCalled();
  });
  it.each([['render-rasterization-failed', true], ['render-preparation-failed', false]])('binds %s after one successful simulated copy phase without leaking a raw failure', async (code, typed) => {
    const test = setup(); mocks.preparationFailure = typed ? new MarketingRenderError(code) : new Error('TEST PRIVATE SVG URL KEY PATH');
    await expect(runMarketingWorkerJob(test.request, test.dependencies)).rejects.toThrow(code);
    expect(test.invoke).toHaveBeenCalledTimes(1); expect(test.put).not.toHaveBeenCalled();
    expect(vi.mocked(renderAuthoredMarketingPreflight).mock.invocationCallOrder[0]).toBeLessThan(test.invoke.mock.invocationCallOrder[0]);
    expect(test.recordPreparationFailure).toHaveBeenCalledWith({ traceId: test.traceId, revisionId: test.request.generation.revisionId, code });
    expect(JSON.stringify(test.recordPreparationFailure.mock.calls)).not.toContain('TEST PRIVATE');
    expect(heldQuestion.eligible).toBe(false); expect(currentMarketingTemplate('devshark').approved).toBe(false);
  });
  it('does not retry or hide renderer failure when diagnostics fail', async () => {
    const test = setup(); mocks.preparationFailure = new MarketingRenderError('render-jpeg-encoding-failed');
    test.recordPreparationFailure.mockRejectedValue(new Error('TEST PRIVATE TRACE OUTAGE'));
    await expect(runMarketingWorkerJob(test.request, test.dependencies)).rejects.toThrow('render-jpeg-encoding-failed');
    expect(test.invoke).toHaveBeenCalledTimes(1); expect(test.put).not.toHaveBeenCalled();
  });
  it('preserves existing fixed Storage failure codes while discarding their raw messages', async () => {
    const test = setup(); mocks.preparationFailure = Object.assign(new Error('TEST PRIVATE STORAGE URL'), { code: 'stored-asset-metadata-mismatch' });
    await expect(runMarketingWorkerJob(test.request, test.dependencies)).rejects.toMatchObject({ code: 'stored-asset-metadata-mismatch', message: 'stored-asset-metadata-mismatch' });
    expect(test.recordPreparationFailure).toHaveBeenCalledWith({ traceId: test.traceId, revisionId: test.request.generation.revisionId, code: 'stored-asset-metadata-mismatch' });
    expect(test.invoke).toHaveBeenCalledTimes(1); expect(test.put).not.toHaveBeenCalled();
  });
});
