import { describe, expect, it } from 'vitest';
import { DNESKAI_AI_DISCLOSURE, dneskaiCaptionWithKeyword, dneskaiKeywordLine } from '@/lib/marketing/dneskai-caption';

const body = 'Adobe přidává do mobilního Lightroomu rychlou akci.\n\nZdarma jsou 2 použití.';
const tags = '#dneskai #adobe #lightroom';
const caption = [body, DNESKAI_AI_DISCLOSURE, tags].join('\n\n');

describe('the caption keyword line (#158)', () => {
  it('adds the line before the disclosure, replaces it for a new keyword and removes it for none', () => {
    const keyed = dneskaiCaptionWithKeyword(caption, 'SKILL');
    expect(keyed).toBe([body, dneskaiKeywordLine('SKILL'), DNESKAI_AI_DISCLOSURE, tags].join('\n\n'));
    expect(dneskaiCaptionWithKeyword(keyed, 'NAVOD')).toBe([body, dneskaiKeywordLine('NAVOD'), DNESKAI_AI_DISCLOSURE, tags].join('\n\n'));
    expect(dneskaiCaptionWithKeyword(keyed, null)).toBe(caption);
  });
  it('returns a caption that already matches character for character, so its hash does not move', () => {
    const odd = `${body}\n\n\n${DNESKAI_AI_DISCLOSURE}\n\n${tags}`;
    expect(dneskaiCaptionWithKeyword(odd, null)).toBe(odd);
    const keyed = dneskaiCaptionWithKeyword(caption, 'SKILL');
    expect(dneskaiCaptionWithKeyword(keyed, 'SKILL')).toBe(keyed);
  });
  it('without a disclosure puts the line before the closing hashtags, else at the end, and keeps one line only', () => {
    expect(dneskaiCaptionWithKeyword(`${body}\n\n${tags}`, 'AI')).toBe([body, dneskaiKeywordLine('AI'), tags].join('\n\n'));
    expect(dneskaiCaptionWithKeyword(body, 'AI')).toBe([body, dneskaiKeywordLine('AI')].join('\n\n'));
    const doubled = [body, dneskaiKeywordLine('A'), dneskaiKeywordLine('B'), DNESKAI_AI_DISCLOSURE].join('\n\n');
    expect(dneskaiCaptionWithKeyword(doubled, 'B')).toBe([body, dneskaiKeywordLine('B'), DNESKAI_AI_DISCLOSURE].join('\n\n'));
  });
  it('leaves an owner sentence that only resembles the line alone', () => {
    const own = `${body}\n\nNapište do komentáře, co vás zajímá.\n\n${DNESKAI_AI_DISCLOSURE}`;
    expect(dneskaiCaptionWithKeyword(own, null)).toBe(own);
  });
});
