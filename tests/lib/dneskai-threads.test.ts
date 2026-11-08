import { describe, expect, it } from 'vitest';
import { parseContentRevision, revisionReadiness, type ContentRevision } from '@/lib/marketing/contracts';
import { DNESKAI_AI_DISCLOSURE, dneskaiKeywordLine } from '@/lib/marketing/dneskai-caption';
import { THREADS_TEXT_MAX, dneskaiThreadsText, dneskaiThreadsTwin } from '@/lib/marketing/dneskai-threads';
import { deck } from './marketing-dneskai-revision-fixture';

const caption = (body: string) => `${body}\n\n${dneskaiKeywordLine('NAVOD')}\n\n${DNESKAI_AI_DISCLOSURE}\n\n#dneskai #ai #novinky`;
function instagram(overrides: Partial<ContentRevision> = {}): ContentRevision {
  return parseContentRevision({ schemaVersion: 'marketing-content/2', brand: 'dneskai', title: 'Syntetický titulek', caption: caption('Krátký text o nástroji.'), format: 'reel',
    sources: [{ sourceId: 'a'.repeat(64), sourceRevision: 'b'.repeat(64), contentHash: 'c'.repeat(64) }], knowledgeIds: [],
    assets: [1, 2, 3].map((n) => ({ url: `https://assets.example.invalid/slide-${n}.jpg`, sha256: String(n).repeat(64), mimeType: 'image/jpeg', width: 1080, height: 1350, alt: `Slide ${n}` })),
    account: { id: '17841400000000001', platform: 'instagram', handle: 'dneskai' }, scheduledAt: '2026-11-08T07:00:00.000Z', timeZone: 'Europe/Prague',
    templateVersion: 'qa/1', promptVersion: 'qa/1', model: 'none-offline', traceId: null, deck: deck(),
    engagement: { keyword: 'NAVOD', replyMessage: 'Tady je návod.', publicReply: 'Posláno do zpráv.' }, ...overrides } as never);
}

describe('dneskaiThreadsText', () => {
  it('drops hashtags, the keyword line and the disclosure, and ends with the article\'s topic', () => {
    const text = dneskaiThreadsText(caption('Krátký text o #AI nástroji.'));
    expect(text).toBe('Krátký text o nástroji.\n\n#AI');
    expect(text).not.toContain(DNESKAI_AI_DISCLOSURE);
    expect(text).not.toContain('Napište do komentáře');
  });

  it('shortens a long caption to 500 characters and keeps the topic', () => {
    const long = Array.from({ length: 30 }, (_, index) => `Věta číslo ${index + 1} vysvětluje další krok.`).join(' ');
    const text = dneskaiThreadsText(caption(long));
    expect(text.length).toBeLessThanOrEqual(THREADS_TEXT_MAX);
    expect(text).toMatch(/\n\n#[\p{L}\p{N}_]+$/u);
    expect(text.startsWith('Věta číslo 1 vysvětluje')).toBe(true);
  });

  it('keeps only the first paragraph and ends with the deck topic as people write it (owner, 8 November 2026)', () => {
    const text = dneskaiThreadsText(caption('První odstavec o Fio bance.\n\nDruhý odstavec s podrobnostmi.'), 'FioBanka');
    expect(text).toBe('První odstavec o Fio bance.\n\n#FioBanka');
    // Without a deck topic the caption's first hashtag after #dneskai takes a capital letter.
    expect(dneskaiThreadsText('Text.\n\n#dneskai #alexa #amazon')).toBe('Text.\n\n#Alexa');
  });

  it('cuts a single run-on paragraph at a word with an ellipsis', () => {
    const text = dneskaiThreadsText(caption('slovo '.repeat(200).trim()));
    expect(text.length).toBeLessThanOrEqual(THREADS_TEXT_MAX);
    expect(text).toMatch(/slovo…\n\n/);
  });
});

describe('dneskaiThreadsTwin', () => {
  it('is a ready Threads carousel of the same slides without the Instagram-only parts', () => {
    const twin = dneskaiThreadsTwin(instagram(), { remote_account_id: '26000000000000001', handle: '@dneskai' });
    expect(twin.account).toEqual({ id: '26000000000000001', platform: 'threads', handle: 'dneskai' });
    expect(twin.format).toBe('carousel');
    expect(twin.engagement).toBeUndefined();
    expect(twin.assets).toEqual(instagram().assets);
    expect(twin.caption.length).toBeLessThanOrEqual(THREADS_TEXT_MAX);
    expect(revisionReadiness(twin)).toEqual([]);
  });

  it('never publishes a deck to Threads as a Reel', () => {
    const twin = dneskaiThreadsTwin(instagram(), { remote_account_id: '26000000000000001', handle: 'dneskai' });
    expect(() => parseContentRevision({ ...twin, format: 'reel' })).toThrow('a Threads deck revision is a carousel or a post');
  });

  it('refuses a source that is not an Instagram DNESKAi post', () => {
    const twin = dneskaiThreadsTwin(instagram(), { remote_account_id: '26000000000000001', handle: 'dneskai' });
    expect(() => dneskaiThreadsTwin(twin, { remote_account_id: '1', handle: 'x' })).toThrow('threads-twin-source-invalid');
  });
});
