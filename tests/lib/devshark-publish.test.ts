import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readFileSync } from 'node:fs';
import { devsharkThreadsText } from '@/lib/marketing/devshark-publish';
import { devsharkDraftPacket } from '@/lib/marketing/devshark-source';
import { parseContentRevision } from '@/lib/marketing/contracts';

const concepts = JSON.parse(readFileSync('content/devshark/concepts-2026-11-07.json', 'utf8')) as Array<{ title: string; caption: string; deck: never }>;
const now = new Date('2026-11-08T08:00:00Z');

describe('devShark publishing (7 November 2026)', () => {
  it('writes a Threads text without hashtags, under 500 characters, with one topic tag', () => {
    for (const concept of concepts) {
      const text = devsharkThreadsText(concept.caption);
      expect(text.length).toBeLessThanOrEqual(500);
      expect(text.endsWith('#devshark')).toBe(true);
      expect(text.match(/#[\p{L}\p{N}_]+/gu)).toEqual(['#devshark']);
    }
    expect(devsharkThreadsText('word '.repeat(200)).length).toBeLessThanOrEqual(500);
  });

  it('cites the approved concept as an English coding-task source that a revision accepts', () => {
    const draft = { id: '11111111-1111-4111-8111-111111111111', title: concepts[0]!.title, caption: concepts[0]!.caption, deck: concepts[0]!.deck, status: 'planned' };
    const packet = devsharkDraftPacket(draft, now);
    expect(packet).toMatchObject({ brand: 'devshark', kind: 'coding-task', locale: 'en', eligible: true, sourceId: `devshark-draft:${draft.id}` });
    expect(devsharkDraftPacket({ ...draft, status: 'draft' }, now).eligible).toBe(false);
    // Editing the concept changes the source revision, so revisions made from the old text stop.
    expect(devsharkDraftPacket({ ...draft, caption: 'Changed' }, now).sourceRevision).not.toBe(packet.sourceRevision);
    const revision = parseContentRevision({ schemaVersion: 'marketing-content/1', brand: 'devshark', title: draft.title, caption: draft.caption, format: 'carousel',
      sources: [{ sourceId: packet.sourceId, sourceRevision: packet.sourceRevision, contentHash: packet.contentHash }], knowledgeIds: [],
      assets: [1, 2].map((n) => ({ url: `https://assets.example.invalid/${n}.jpg`, sha256: String(n).repeat(64), mimeType: 'image/jpeg', width: 1080, height: 1350, alt: `Slide ${n}` })),
      account: { id: '17841415307083311', platform: 'instagram', handle: 'devshark.app' }, scheduledAt: now.toISOString(), timeZone: 'Europe/Prague',
      templateVersion: 'devshark-social/1', promptVersion: 'devshark-concept/1', model: 'owner-approved-concept', traceId: null });
    expect(revision.brand).toBe('devshark');
  });
});
