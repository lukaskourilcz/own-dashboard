import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { refreshSource, refreshMarketingSources } from '@/lib/marketing/source-refresh';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import { contentHash } from '@/lib/marketing/hashes';
vi.mock('server-only', () => ({}));
const now = new Date('2026-10-13T09:00:00Z'); const secret = 'synthetic-source-secret-only-at-least-32';
const content = { title: 'Synthetic QA question', body: 'QA only', category: 'javascript', difficulty: 'Easy', code: null,
  options: ['A', 'B'], answer: 'A', explanation: 'Synthetic QA explanation', evidence: [], image: null };
const packet = parseSourcePacket({ schemaVersion: 'marketing-source/1', brand: 'devshark', kind: 'question', sourceId: 'question:qa-only', sourceRevision: 'qa-daily-version', contentHash: contentHash(content), canonicalUrl: 'https://devshark.app/daily/2026-10-12', locale: 'en', observedAt: now.toISOString(), expiresAt: null, eligible: true, eligibilityReason: 'Synthetic QA only', content });
const config = { url: 'https://devshark.example.invalid/api/admin', secret };
describe('authoritative source refresh', () => {
  it('rechecks a dated daily URL by its canonical date and exact resource', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => { const query = new URL(String(url)).searchParams;
      expect(query.get('resource')).toBe('marketing-source'); expect(query.get('daily')).toBe('2026-10-12'); expect(query.has('sourceId')).toBe(false);
      return Response.json({ packets: [packet], nextCursor: null }); });
    expect(await refreshSource(packet, new AbortController().signal, { now, config, fetcher })).toEqual(packet);
  });
  it('uses direct effective-source lookup for a non-daily source', async () => {
    const generic = { ...packet, canonicalUrl: 'https://devshark.app/quiz?categories=javascript' };
    const fetcher = vi.fn<typeof fetch>(async url => { const query = new URL(String(url)).searchParams;
      expect(query.get('sourceId')).toBe(packet.sourceId); expect(query.has('daily')).toBe(false); return Response.json({ packets: [generic] }); });
    await refreshMarketingSources({ brand: 'devshark', config, sourceIds: [packet.sourceId], previousPackets: [generic], date: '2026-10-13', now, fetcher });
  });
  it('never substitutes a stored head after timeout, deletion or malformed response', async () => {
    for (const fetcher of [async () => { throw new Error('timeout'); }, async () => new Response(null, { status: 410 }), async () => Response.json({ packets: [] })]) {
      await expect(refreshSource(packet, new AbortController().signal, { now, config, fetcher })).rejects.toThrow();
    }
    await expect(refreshSource(packet, new AbortController().signal, { now, config, fetcher: async () => Response.json({ packets: [{ ...packet, observedAt: '2026-10-13T08:00:00Z' }] }) })).rejects.toThrow();
  });
  it('preserves current retirement and changed revisions for the worker to hold', async () => {
    const retired = { ...packet, sourceRevision: 'retired-version', eligible: false, eligibilityReason: 'retired' };
    const refreshed = await refreshSource(packet, new AbortController().signal, { now, config, fetcher: async () => Response.json({ packets: [retired] }) });
    expect(refreshed.eligible).toBe(false); expect(refreshed.sourceRevision).toBe('retired-version');
  });
  it('signs DNESKAi raw-body lookups and holds null or unapproved packets', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const body = String(options?.body); const headers = new Headers(options?.headers); const timestamp = headers.get('x-marketing-timestamp');
      expect(JSON.parse(body)).toEqual({ action: 'sources', sourceIds: ['2026-10-12-qa-only'] });
      expect(headers.get('x-marketing-signature')).toBe(createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex'));
      return Response.json({ schemaVersion: 'marketing-source-query/1', brand: 'dneskai', sources: [{ sourceId: '2026-10-12-qa-only', status: 'held', packet: null }], noEditionDates: ['2026-10-11'] });
    });
    const refreshed = await refreshMarketingSources({ brand: 'dneskai', sourceIds: ['2026-10-12-qa-only'], now, config: { url: 'https://quorum.example.invalid/admin/api/marketing-source', secret }, fetcher });
    expect(refreshed.packets).toEqual([]); expect(refreshed.held).toHaveLength(1); expect(refreshed.noEditionDates).toEqual(['2026-10-11']);
  });
  it('rejects content drift and wrong identities', async () => {
    for (const altered of [{ ...packet, content: { ...content, body: 'changed without hash' } }, { ...packet, sourceId: 'question:other' }]) {
      await expect(refreshSource(packet, new AbortController().signal, { now, config, fetcher: async () => Response.json({ packets: [altered] }) })).rejects.toThrow();
    }
  });
  it('keeps approved-article lookup independent from native social feed selection', async () => {
    const url = 'https://quorum.example.invalid/admin/api/marketing-source';
    const fetcher = vi.fn<typeof fetch>(async (requested, options) => {
      expect(String(requested)).toBe(url);
      expect(JSON.parse(String(options?.body))).toEqual({action:'sources',sourceIds:['daily-web-article']});
      return Response.json({schemaVersion:'marketing-source-query/1',brand:'dneskai',sources:[{sourceId:'daily-web-article',status:'held',packet:null}],noEditionDates:[]});
    });
    const result = await refreshMarketingSources({brand:'dneskai',sourceIds:['daily-web-article'],now,fetcher,
      env:{MARKETING_DNESKAI_FEED_PROVIDER:'native',MARKETING_DNESKAI_SOURCE_URL:url,MARKETING_DNESKAI_SOURCE_SECRET:secret}});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(result.packets).toEqual([]);expect(result.held).toHaveLength(1);
  });

});
