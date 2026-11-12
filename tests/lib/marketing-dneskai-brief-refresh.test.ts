import { describe, expect, it, vi } from 'vitest';
import { refreshMarketingSources, refreshSource } from '@/lib/marketing/source-refresh';
import { dneskaiBriefSourcePacket } from '@/lib/marketing/dneskai-brief-source';
import { buildDneskaiBrief } from '@/lib/marketing/dneskai-briefs';
import { dneskaiEventId, dneskaiEventMemberHash } from '@/lib/marketing/dneskai-events';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import { contentHash } from '@/lib/marketing/hashes';
import type { DneskaiBrief } from '@/lib/marketing/dneskai-brief';
import { syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

// Synthetic, test-only brief; the brief store is a fake RPC client and the bridge must never be called.
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', briefId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-10-20T21:00:00Z');
const blog = syntheticCandidate('openai-blog', 'blog', 'Synthetic launch of Model Nine', { status: 'selected', targetDate: '2026-10-21', category: 'ai-news', relevance: 0.95 });
const built = buildDneskaiBrief({ eventId: dneskaiEventId(blog.id), memberHash: dneskaiEventMemberHash([blog]), targetDate: '2026-10-21', category: 'ai-news', scheduledAt: '2026-10-21T06:00:00.000Z', observedAt: new Date('2026-10-20T20:45:00Z'), members: [{ candidate: blog, media: [] }] });
const brief = (built as { brief: DneskaiBrief }).brief;
const packet = dneskaiBriefSourcePacket(brief);
const row = (patch: Record<string, unknown> = {}) => ({ briefId, projectId: project, status: 'queued', code: null, brief, memberHash: brief.memberHash, currentMemberHash: brief.memberHash, memberCount: 1, currentMemberCount: 1, ...patch });
const db = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { expect(name).toBe('marketing_dneskai_brief_source'); expect(args).toEqual({ p_owner: owner, p_event: brief.eventId, p_target: '2026-10-21' }); return { data, error }; }) });
// No network request may leave the process for a brief.
const bridge = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('no request may be made for a brief'); });

describe('refreshSource for a DNESKAi brief (#115)', () => {
  it('re-reads the brief from the owner’s brief store with the same authority and a fresh observation', async () => {
    const store = db(row());
    const current = await refreshSource(packet, new AbortController().signal, { owner, db: store as never, now });
    expect(current).toEqual({ ...packet, observedAt: now.toISOString() });
    expect(contentHash(current.content)).toBe(packet.contentHash);
    expect(parseSourcePacket(current).brief).toEqual(brief);
    expect(bridge).not.toHaveBeenCalled();
  });

  it('makes a brief whose members changed, or that was skipped, ineligible', async () => {
    const changed = await refreshMarketingSources({ brand: 'dneskai', sourceIds: [packet.sourceId], previousPackets: [packet], owner, db: db(row({ currentMemberHash: 'f'.repeat(64) })) as never, now });
    expect(changed.packets[0]).toMatchObject({ eligible: false, eligibilityReason: 'brief-members-changed', sourceRevision: brief.memberHash });
    expect(changed.held).toEqual([{ sourceId: packet.sourceId, reason: 'source-ineligible' }]);
    const fewer = await refreshMarketingSources({ brand: 'dneskai', sourceIds: [packet.sourceId], previousPackets: [packet], owner, db: db(row({ currentMemberCount: 0 })) as never, now });
    expect(fewer.packets[0]).toMatchObject({ eligible: false, eligibilityReason: 'brief-members-changed' });
    const skipped = await refreshSource(packet, new AbortController().signal, { owner, db: db(row({ status: 'skipped', code: 'collection-already-covered' })) as never, now });
    expect(skipped).toMatchObject({ eligible: false, eligibilityReason: 'collection-already-covered' });
  });

  it('holds an expired brief and never substitutes a missing, unreadable or ownerless one', async () => {
    const expired = await refreshMarketingSources({ brand: 'dneskai', sourceIds: [packet.sourceId], previousPackets: [packet], owner, db: db(row()) as never, now: new Date('2026-10-23T00:00:00Z') });
    expect(expired.held).toEqual([{ sourceId: packet.sourceId, reason: 'source-expired' }]);
    await expect(refreshSource(packet, new AbortController().signal, { owner, db: db(null) as never, now })).rejects.toThrow('source-recheck-unavailable');
    await expect(refreshSource(packet, new AbortController().signal, { owner, db: db(row({ brief: { schemaVersion: 'dneskai-brief/1' } })) as never, now })).rejects.toThrow('source-recheck-unavailable');
    await expect(refreshSource(packet, new AbortController().signal, { owner, db: db(null, { message: 'down' }) as never, now })).rejects.toThrow('source-current-unavailable');
    const ownerless = await refreshMarketingSources({ brand: 'dneskai', sourceIds: [packet.sourceId], previousPackets: [packet], now });
    expect(ownerless).toMatchObject({ packets: [], dropped: 1, held: [{ sourceId: packet.sourceId, reason: 'brief-owner-required' }] });
    expect(bridge).not.toHaveBeenCalled();
  });

  it('refreshes the brief locally and holds a non-brief id without any bridge request', async () => {
    // The brief is re-read from the owner's store; the Quorum source bridge was removed on 9 November 2026, so the
    // leftover 'article:qa-only' id is held rather than fetched and nothing leaves the process.
    const fetcher = bridge;
    const result = await refreshMarketingSources({ brand: 'dneskai', sourceIds: [packet.sourceId, 'article:qa-only'], previousPackets: [packet], owner, db: db(row()) as never, now });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.packets.map((item) => item.sourceId)).toEqual([packet.sourceId]);
    expect(result.held).toEqual([{ sourceId: 'article:qa-only', reason: 'source-unavailable' }]);
  });
});
