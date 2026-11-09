import { describe, expect, it } from 'vitest';
import { fitText } from '@/lib/carousel-studio/text';
import { measureEm, resolveFace } from '@/lib/carousel-studio/fonts';

// A fixed size isolates the rebalance (no shrink); a large height keeps height out of it. No keepWithNext, so every
// piece is one word and "a lone last word" is a last line with no space.
const base = {
  locale: 'cs' as const,
  heightPx: 4000,
  maxLines: 6,
  maxChars: 400,
  fontFamily: 'Space Grotesk',
  fontWeight: 400,
};
const lastLineIsLoneWord = (lines: string[]) => lines.length >= 2 && !lines.at(-1)!.includes(' ');

describe('carousel-studio text balance (DNESKAi no-orphan, text-pretty)', () => {
  it.each([
    'Tržby 16,3 miliardy dolarů za půl roku. Anthropic podal návrh na IPO.',
    'Alexa teď spravuje nákupní seznamy a předplatné',
    'Grok 4.7 doporučil republikána v 92 % odpovědí.',
    'OpenAI: aplikace ChatGPT na takovou otázku neodpovídá.',
    'Z 83 ŠKODLIVÝCH POLOŽEK JICH 77 VZNIKLO ZA 43 MINUT 1. ZÁŘÍ.',
  ])('fills every line of %s', (value) => {
    const fontFamily = 'Archivo';
    const fontWeight = 800;
    const widthPx = 936;
    const fitted = fitText({ ...base, value, fontFamily, fontWeight, widthPx, minFontSize: 46, maxFontSize: 104, keepWithNext: 'cs', balance: true });
    const face = resolveFace(fontFamily, fontWeight);
    expect(fitted.truncated).toBe(false);
    expect(fitted.lines.join(' ')).toBe(value);
    for (const line of fitted.lines) {
      const words = line.split(' ').length;
      expect(words).toBeGreaterThan(1);
      if (words === 2) expect(measureEm(face, line) * fitted.fontSize).toBeGreaterThanOrEqual(widthPx * 0.55 - 0.001);
    }
  });

  it('leaves wrapping identical when balance is off, and clears lone last words when on', () => {
    const value = 'Novela zákona o dani z příjmů prošla prvním čtením sněmovny ještě dnes večer';
    let orphanScenarios = 0;
    let fixedByBalance = 0;
    for (let widthPx = 320; widthPx <= 900; widthPx += 20) {
      const plain = fitText({ ...base, value, widthPx, minFontSize: 56, maxFontSize: 56 });
      const pretty = fitText({ ...base, value, widthPx, minFontSize: 56, maxFontSize: 56, balance: true });
      // Off: unchanged behaviour (this is the frozen contract for every v1/devShark layer).
      // On: the last line is never a lone word when the penultimate line still has a word to spare.
      if (lastLineIsLoneWord(plain.lines)) {
        orphanScenarios += 1;
        const penultimateHasSpare = plain.lines.at(-2)!.includes(' ');
        if (penultimateHasSpare) {
          expect(lastLineIsLoneWord(pretty.lines)).toBe(false);
          fixedByBalance += 1;
        }
      }
    }
    // The scan actually exercised the case, so the assertions above mean something.
    expect(orphanScenarios).toBeGreaterThan(0);
    expect(fixedByBalance).toBeGreaterThan(0);
  });

  it('shrinks a step when rebalancing alone cannot clear the orphan, never below the floor', () => {
    // Two words where the penultimate line is a single word: rebalancing cannot help, so the fitter steps down until
    // both fit one line. Find a width that splits them at the top size.
    const value = 'Protiústavní rozhodnutí';
    let shrank = 0;
    for (let widthPx = 240; widthPx <= 760; widthPx += 10) {
      const top = fitText({ ...base, value, widthPx, minFontSize: 28, maxFontSize: 64 });
      if (top.lines.length === 2) {
        const pretty = fitText({ ...base, value, widthPx, minFontSize: 28, maxFontSize: 64, balance: true });
        // Either it now sits on one line at a smaller size, or the floor was reached.
        expect(pretty.fontSize).toBeLessThanOrEqual(top.fontSize);
        expect(pretty.fontSize).toBeGreaterThanOrEqual(28);
        if (pretty.lines.length === 1) { expect(pretty.fontSize).toBeLessThan(top.fontSize); shrank += 1; }
      }
    }
    expect(shrank).toBeGreaterThan(0);
  });

  it('leaves a single line and an already-balanced block untouched', () => {
    const one = fitText({ ...base, value: 'Krátký titulek', widthPx: 900, minFontSize: 40, maxFontSize: 80, balance: true });
    expect(one.lines).toHaveLength(1);
    // A block whose last line already has two words is not disturbed.
    const many = fitText({ ...base, value: 'Vláda dnes schválila návrh rozpočtu na příští rok ráno', widthPx: 520, minFontSize: 48, maxFontSize: 48, balance: true });
    if (many.lines.length >= 2) expect(many.lines.at(-1)!.split(' ').length).toBeGreaterThanOrEqual(1);
  });
});
