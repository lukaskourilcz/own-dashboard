import { describe, expect, it } from 'vitest';
import { BODY_MIN_SIZE, devsharkBodyLines, fitDevsharkBodySize, layoutDevsharkSlide } from '@/lib/design-studio/devshark-layout';
import { measureStudioText } from '@/lib/design-studio/metrics';
import type { DevsharkDeck } from '@/lib/marketing/devshark-deck';

const BODY_FACE = 'manrope-700';
const BODY_SIZE = 68;
const lineWords = (line: string) => line.trim().split(/\s+/).filter(Boolean);

describe('devShark body: no lone word on the last line (text-wrap: pretty)', () => {
  it('pulls a word down so the last line is not a single word', () => {
    // A width that holds "one two" (and "two three") but not "one two three": greedy would strand "three".
    const width = measureStudioText('two three', BODY_FACE, BODY_SIZE).width + 2;
    expect(width).toBeLessThan(measureStudioText('one two three', BODY_FACE, BODY_SIZE).width);
    expect(devsharkBodyLines('one two three', width, BODY_SIZE)).toEqual(['one', 'two three']);
  });

  it('keeps punctuation glued to its word when rebalancing', () => {
    // `[[two]].` makes "." a glued token; the trailing "two." group moves down together, never as a bare dot.
    const width = measureStudioText('two. three', BODY_FACE, BODY_SIZE).width + 2;
    expect(width).toBeLessThan(measureStudioText('one two. three', BODY_FACE, BODY_SIZE).width);
    const lines = devsharkBodyLines('one [[two]]. three', width, BODY_SIZE);
    expect(lines).toEqual(['one', 'two. three']);
  });

  it('leaves a single line and a short two-word body untouched', () => {
    expect(devsharkBodyLines('short enough', 920)).toEqual(['short enough']);
    expect(devsharkBodyLines('one', 920)).toEqual(['one']);
  });

  it('balances each paragraph of a multi-paragraph body independently', () => {
    const width = measureStudioText('two three', BODY_FACE, BODY_SIZE).width + 2;
    expect(devsharkBodyLines('one two three\nfour five six', width, BODY_SIZE)).toEqual([
      'one', 'two three', 'four', 'five six',
    ]);
  });

  it('does not strand the last word of a rendered body slide', () => {
    const width = measureStudioText('two three', BODY_FACE, BODY_SIZE).width + 2;
    const lines = devsharkBodyLines('one two three', width, BODY_SIZE);
    expect(lineWords(lines[lines.length - 1]!).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the full size when rebalancing alone clears the orphan', () => {
    const width = measureStudioText('two three', BODY_FACE, BODY_SIZE).width + 2;
    expect(fitDevsharkBodySize('one two three', width)).toBe(BODY_SIZE);
  });

  it('shrinks one step when a lone word cannot be pulled back at the full size', () => {
    // "alpha bravo" will not fit one line at 68 but fits at 64; neither word can be pulled back (each fills its line).
    const full = measureStudioText('alpha bravo', BODY_FACE, 68).width;
    const at64 = measureStudioText('alpha bravo', BODY_FACE, 64).width;
    const width = (full + at64) / 2; // holds the pair at 64 but not at 68
    expect(fitDevsharkBodySize('alpha bravo', width)).toBe(64);
  });

  it('never shrinks below the template minimum, even when the orphan cannot be cleared', () => {
    // A width too small for either word: a lone last word remains at every size, so the floor is kept.
    expect(fitDevsharkBodySize('alpha bravo', 10)).toBe(BODY_MIN_SIZE);
  });

  it('does not touch the headline: display text may end on a lone word', () => {
    const deck: DevsharkDeck = { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [
      { kind: 'cover', kicker: 'x', headline: 'A headline that wraps onto two lines here alone', body: 'In two lines of CSS.' },
      { kind: 'closing', headline: 'End.' },
    ] };
    // The headline renders through the display path; layout never throws and produces the slide SVG.
    expect(layoutDevsharkSlide(deck, 0, { finGreen: '/a', finInk: '/b', logoWhite: '/c' }).svg).toContain('<svg');
  });
});
