import { describe, expect, it } from 'vitest';
import { applyDneskaiDeckEdit } from '@/lib/marketing/dneskai-deck-edit';
import { dneskaiRenderKey, dneskaiStudioInput } from '@/lib/marketing/dneskai-render';
import { DneskaiDeckSchema } from '@/lib/marketing/dneskai-slides';
import { dneskaiSlidePixelsKey } from '@/lib/marketing/dneskai-deck-editor';
import { deck } from './marketing-dneskai-revision-fixture';

const box = { x: 72, y: 200, w: 700, size: 64, align: 'left' as const };
const encoder = { sharp: '0.35.5', vips: '8.18.7' };

describe('DNESKAi hand placement in the deck (Design Studio)', () => {
  it('parses a slide layout and refuses boxes off the canvas grid', () => {
    const value = deck();
    value.slides[2] = { ...value.slides[2]!, layout: { headline: box } };
    expect(DneskaiDeckSchema.safeParse(value).success).toBe(true);
    value.slides[2] = { ...value.slides[2]!, layout: { headline: { ...box, w: 20 } } };
    expect(DneskaiDeckSchema.safeParse(value).success).toBe(false);
  });

  it('keys a slide without layout exactly as before and a placed slide apart', () => {
    const plain = deck().slides[2]!;
    const placed = { ...plain, layout: { headline: box } };
    const position = { index: 2, count: 3 };
    expect(dneskaiRenderKey({ ...plain, layout: {} }, position, encoder, 'spotlight')).toBe(dneskaiRenderKey(plain, position, encoder, 'spotlight'));
    expect(dneskaiRenderKey(placed, position, encoder, 'spotlight')).not.toBe(dneskaiRenderKey(plain, position, encoder, 'spotlight'));
    expect(dneskaiSlidePixelsKey(placed)).not.toBe(dneskaiSlidePixelsKey(plain));
    expect(dneskaiStudioInput(placed, position, [], 'spotlight').layout).toEqual({ headline: box });
    expect('layout' in dneskaiStudioInput(plain, position, [], 'spotlight')).toBe(false);
  });

  it('saves, clears and drops boxes through a deck edit', () => {
    const base = { ...deck(), kit: 'spotlight' as const };
    const keep = base.slides.map((_, from) => ({ from }));
    const placed = applyDneskaiDeckEdit(base, { slides: [keep[0]!, keep[1]!, { from: 2, layout: { headline: box } }] });
    expect(placed.slides[2]!.layout).toEqual({ headline: box });
    const kept = applyDneskaiDeckEdit(placed, { slides: keep });
    expect(kept.slides[2]!.layout).toEqual({ headline: box });
    const cleared = applyDneskaiDeckEdit(placed, { slides: [keep[0]!, keep[1]!, { from: 2, layout: null }] });
    expect(cleared.slides[2]!.layout).toBeUndefined();
  });
});
