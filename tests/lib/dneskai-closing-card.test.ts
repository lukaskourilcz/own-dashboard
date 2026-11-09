import { describe, expect, it } from 'vitest';
import { dneskaiClosingText, dneskaiClosingWords, DNESKAI_CLOSING_DEFAULTS, renderDneskaiClosingCard } from '@/lib/marketing/dneskai-closing-card';
import { dneskaiClosingSlide } from '@/lib/marketing/dneskai-closing';

describe('the DNESKAi closing card drawn from its words (9 November 2026)', () => {
  it('reads the words back from the slide it writes, and the default slide carries the defaults', () => {
    const words = { headline: 'Sleduj', body: 'pro denní přehled AI.', handle: '@dneskai.cz' };
    expect(dneskaiClosingWords(dneskaiClosingText(words))).toEqual(words);
    expect(dneskaiClosingWords(dneskaiClosingSlide())).toEqual(DNESKAI_CLOSING_DEFAULTS);
    expect(dneskaiClosingSlide(words)).toMatchObject({ headline: 'Sleduj [[DNESKAi]]', body: 'pro denní přehled AI. @dneskai.cz' });
  });
  it('draws a 1080 × 1350 PNG, the same pixels for the same words', async () => {
    const sharp = (await import('sharp')).default;
    const png = await renderDneskaiClosingCard(DNESKAI_CLOSING_DEFAULTS);
    expect(await sharp(png).metadata()).toMatchObject({ width: 1080, height: 1350, format: 'png' });
    expect((await renderDneskaiClosingCard(DNESKAI_CLOSING_DEFAULTS)).equals(png)).toBe(true);
  }, 60000);

  it('fits a wide custom headline inside the card margin', async () => {
    const sharp = (await import('sharp')).default;
    const blank = await renderDneskaiClosingCard({ ...DNESKAI_CLOSING_DEFAULTS, headline: '' });
    const wide = await renderDneskaiClosingCard({ ...DNESKAI_CLOSING_DEFAULTS, headline: 'W'.repeat(24) });
    const pixels = (image: Buffer, left: number, width: number) =>
      sharp(image).extract({ left, width, top: 590, height: 290 }).raw().toBuffer();
    expect((await pixels(wide, 66, 936)).equals(await pixels(blank, 66, 936))).toBe(false);
    expect((await pixels(wide, 1008, 72)).equals(await pixels(blank, 1008, 72))).toBe(true);
  }, 60000);
});
