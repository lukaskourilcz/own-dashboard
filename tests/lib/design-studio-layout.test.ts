import { describe, expect, it } from 'vitest';
import { devsharkAutoBoxes, layoutDevsharkSlide } from '@/lib/design-studio/devshark-layout';
import type { DevsharkDeck } from '@/lib/marketing/devshark-deck';

const assets = { finGreen: '/fin-green.svg', finInk: '/fin-ink.svg', logoWhite: '/logo.svg' };
const deck: DevsharkDeck = { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [
  { kind: 'cover', kicker: 'CSS layout', headline: 'Center a div.', body: 'In [[two lines]] of CSS.' },
  { kind: 'code', headline: 'The two lines', code: '.parent {\\n  display: grid;\\n}' },
] };

describe('the shared devShark layout (Design Studio, 7 November 2026)', () => {
  it('flows the blocks automatically and places the kicker only on the first slide', () => {
    const first = layoutDevsharkSlide(deck, 0, assets);
    expect(first.blocks.map((block) => block.key)).toEqual(['kicker', 'headline', 'body']);
    expect(layoutDevsharkSlide(deck, 1, assets).blocks.map((block) => block.key)).toEqual(['headline', 'code']);
    expect(first.svg).toContain('CSS LAYOUT');
    expect(first.svg).toContain('xlink:href="/fin-green.svg"');
  });

  it('puts a block exactly at its box, with its size and alignment', () => {
    const moved: DevsharkDeck = { ...deck, slides: [{ ...deck.slides[0]!, layout: { headline: { x: 100, y: 600, w: 880, size: 90, align: 'center' } } }, deck.slides[1]!] };
    const slide = layoutDevsharkSlide(moved, 0, assets);
    const headline = slide.blocks.find((block) => block.key === 'headline')!;
    expect(headline.box).toEqual({ x: 100, y: 600, w: 880, size: 90, align: 'center' });
    expect(slide.svg).toContain('x="540" y="672" text-anchor="middle"');
    // Other blocks keep their automatic place.
    expect(slide.blocks.find((block) => block.key === 'body')!.box).toEqual(devsharkAutoBoxes(moved.slides[0]!, 0).body);
  });

  it('warns about a block off the slide or a character the fonts lack, and never refuses', () => {
    const off: DevsharkDeck = { ...deck, slides: [{ ...deck.slides[0]!, headline: 'Ahoj 🚀', layout: { body: { x: 900, y: 1300, w: 400, size: 68, align: 'left' } } }, deck.slides[1]!] };
    const warnings = layoutDevsharkSlide(off, 0, assets).warnings;
    expect(warnings).toContainEqual({ block: 'body', code: 'outside-slide' });
    expect(warnings).toContainEqual({ block: 'headline', code: 'unsupported-character' });
  });
});
