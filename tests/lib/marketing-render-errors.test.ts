import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import heldQuestion from '../../templates/marketing/benchmarks/devshark-question.json';

const mocks = vi.hoisted(() => ({ mode: '' }));
vi.mock('server-only', () => ({}));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, readFile: async (file: string) => {
    if ((mocks.mode === 'logo' && file.endsWith('/logo.svg')) || (mocks.mode === 'font' && file.includes('/fonts/'))
      || (mocks.mode === 'design' && file.endsWith('/devshark-fin-clean-ink.svg'))) throw new Error('TEST PRIVATE FILE PATH /credential/value');
    return real.readFile(file);
  } };
});
vi.mock('@resvg/resvg-js', async importOriginal => {
  if (mocks.mode === 'rasterizer-module') throw new Error('TEST PRIVATE NATIVE MODULE PATH');
  const real = await importOriginal<typeof import('@resvg/resvg-js')>();
  return { ...real, Resvg: class extends real.Resvg {
    constructor(...args: ConstructorParameters<typeof real.Resvg>) {
      if (mocks.mode === 'raster') throw new Error('TEST PRIVATE RASTER SVG');
      super(...args);
    }
  } };
});
vi.mock('sharp', async importOriginal => {
  if (mocks.mode === 'jpeg-module') throw new Error('TEST PRIVATE JPEG MODULE PATH');
  const real = await importOriginal<typeof import('sharp')>();
  return { ...real, default: (...args: unknown[]) => {
    if (mocks.mode === 'jpeg') throw new Error('TEST PRIVATE JPEG PIXELS');
    return Reflect.apply(real.default, undefined, args);
  } };
});
beforeEach(() => { mocks.mode = ''; vi.resetModules(); });
describe('renderer stage classification without private filesystem/native error details', () => {
  it.each([
    ['logo', 'brand-asset-unavailable'], ['font', 'font-unavailable'], ['design', 'design-asset-unavailable'],
    ['raster', 'render-rasterization-failed'], ['jpeg', 'render-jpeg-encoding-failed'],
  ])('classifies %s before any storage call', async (mode, code) => {
    const renderer = await import('@/lib/marketing/render');
    const base = renderer.currentMarketingTemplate('devshark');
    const template = { ...base, approved: true, approval: { approvedBy: '11111111-1111-4111-8111-111111111111', approvedAt: new Date().toISOString(),
      templateSha256: base.templateSha256, designExportSha256: renderer.marketingTemplateDefinition('devshark').style.design.archiveSha256 } };
    const source = parseSourcePacket({ ...heldQuestion, eligible: true, eligibilityReason: 'OFFLINE ERROR CLASSIFICATION SIMULATION ONLY', observedAt: new Date().toISOString() });
    mocks.mode = mode;
    try {
      await renderer.renderAuthoredMarketingPreflight({ source, template, revisionId: '33333333-3333-4333-8333-333333333333', scheduledAt: new Date(Date.now() + 3600000).toISOString(), account: { id: 'TEST-ONLY', handle: 'test-only', platform: 'instagram' } });
      throw new Error('expected-offline-stage-failure');
    } catch (failure) {
      expect(failure).toBeInstanceOf(renderer.MarketingRenderError); expect(failure).toMatchObject({ code });
      expect(String(failure)).not.toContain('TEST PRIVATE'); expect(JSON.stringify(failure)).not.toContain('TEST PRIVATE');
      expect(failure).not.toHaveProperty('cause');
    }
    expect(heldQuestion.eligible).toBe(false); expect(renderer.currentMarketingTemplate('devshark').approved).toBe(false);
  });
});
