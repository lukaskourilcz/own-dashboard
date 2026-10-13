import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import heldQuestion from '../../templates/marketing/benchmarks/devshark-question.json';
vi.mock('server-only', () => ({}));
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.doUnmock('@resvg/resvg-js'); vi.doUnmock('sharp'); vi.resetModules(); });
describe('missing deployed native renderer packages fail before provider or storage access', () => {
  it.each([['@resvg/resvg-js', 'render-rasterizer-unavailable'], ['sharp', 'render-jpeg-encoder-unavailable']])('classifies %s without module paths', async (module, code) => {
    vi.doMock(module, () => { throw new Error('TEST PRIVATE NATIVE MODULE /runtime/secret/path'); });
    const renderer = await import('@/lib/marketing/render');
    const { parseSourcePacket } = await import('@/lib/marketing/contracts');
    const base = renderer.currentMarketingTemplate('devshark');
    const template = { ...base, approved: true, approval: { approvedBy: '11111111-1111-4111-8111-111111111111', approvedAt: new Date().toISOString(),
      templateSha256: base.templateSha256, designExportSha256: renderer.marketingTemplateDefinition('devshark').style.design.archiveSha256 } };
    const source = parseSourcePacket({ ...heldQuestion, eligible: true, eligibilityReason: 'OFFLINE NATIVE IMPORT FAILURE SIMULATION ONLY', observedAt: new Date().toISOString() });
    await expect(renderer.renderAuthoredMarketingPreflight({ source, template, revisionId: '33333333-3333-4333-8333-333333333333',
      scheduledAt: new Date(Date.now() + 3600000).toISOString(), account: { id: 'TEST-ONLY', handle: 'test-only', platform: 'instagram' } })).rejects.toMatchObject({ code, message: code });
    expect(heldQuestion.eligible).toBe(false); expect(renderer.currentMarketingTemplate('devshark').approved).toBe(false);
  });
});
