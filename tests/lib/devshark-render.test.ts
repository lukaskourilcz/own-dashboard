import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import sharp from 'sharp';
import { devsharkSlideTheme, devsharkTokens, renderDevsharkDeck, type DevsharkDeck } from '@/lib/marketing/devshark-render';

const deck: DevsharkDeck = { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [
  { kind: 'cover', kicker: 'JavaScript quiz', headline: 'typeof null', body: 'One line. [[What does it return?]]' },
  { kind: 'code', headline: 'Choose an answer', code: 'typeof null' },
  { kind: 'answer', headline: 'B. "object"', body: 'Test it with [[value === null]].' },
  { kind: 'closing', headline: 'Quizzes and [[coding tasks]].' },
] };

const slidesWithoutWarnings = (slides: Array<{ warnings: unknown[] }>) => slides.every((slide) => slide.warnings.length === 0);

describe('devShark social slides', () => {
  it('keeps the space before a green phrase and glues the full stop after it', () => {
    expect(devsharkTokens('and [[coding tasks]] for you.')[0]).toEqual([
      { text: 'and', green: false }, { text: 'coding', green: true }, { text: 'tasks', green: true }, { text: 'for', green: false }, { text: 'you.', green: false }]);
    expect(devsharkTokens('Use [[an id]].')[0]!.at(-1)).toEqual({ text: '.', green: false, glue: true });
  });

  it('alternates grounds from the cover, makes the answer green and the closer ink', () => {
    expect(deck.slides.map((_, index) => devsharkSlideTheme(deck, index))).toEqual(['light', 'dark', 'green', 'dark']);
  });

  it('renders 1080 x 1350 JPEGs without the corner fin or a page counter', async () => {
    const slides = await renderDevsharkDeck(deck);
    expect(slides).toHaveLength(4);
    const meta = await sharp(slides[0]!.jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1080, 1350]);
    for (const slide of slides) {
      expect(slide.svg).not.toMatch(/ \/ 4</);
      // One fin only: the large one at the bottom right.
      expect(slide.svg.match(/<image /g)?.length ?? 0).toBeLessThanOrEqual(slide === slides[3] ? 2 : 1);
    }
    expect(slides[0]!.alt).toBe('typeof null. One line. What does it return?');
    // The kicker and its waterline appear on the first slide only.
    expect(slides[0]!.svg).toContain('JAVASCRIPT QUIZ');
    expect(slides[0]!.svg).toContain('<pattern');
    for (const slide of slides.slice(1)) expect(slide.svg).not.toContain('<pattern');
  }, 60_000);

  it('renders text over the fin and only warns about text off the slide (7 November 2026)', async () => {
    const long = await renderDevsharkDeck({ ...deck, slides: [{ kind: 'cover', headline: 'Long', body: 'word '.repeat(80).trim() }, deck.slides[3]!] });
    expect(long).toHaveLength(2);
    expect(long[0]!.warnings).toContainEqual({ block: 'body', code: 'outside-slide' });
    expect(slidesWithoutWarnings(await renderDevsharkDeck(deck))).toBe(true);
  }, 60_000);
});

describe('the five devShark concepts of 7 November 2026', () => {
  it('parse and render without overflow', async () => {
    const { readFileSync } = await import('node:fs');
    const concepts = JSON.parse(readFileSync('content/devshark/concepts-2026-11-07.json', 'utf8')) as Array<{ title: string; caption: string; deck: DevsharkDeck }>;
    expect(concepts).toHaveLength(5);
    for (const concept of concepts) {
      expect(concept.caption.length).toBeLessThanOrEqual(2200);
      expect(concept.caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0).toBeLessThanOrEqual(10);
      expect((await renderDevsharkDeck(concept.deck)).length).toBe(concept.deck.slides.length);
    }
  }, 120_000);
});
