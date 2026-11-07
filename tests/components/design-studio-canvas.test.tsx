// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SlideCanvas } from '@/components/design-studio/slide-canvas';
import type { DevsharkDeck, DevsharkSlide } from '@/lib/marketing/devshark-deck';
import { designStudio } from '@/lib/i18n/sections/design-studio';

const deck: DevsharkDeck = { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [
  { kind: 'cover', kicker: 'React', headline: 'Keys in lists.', body: 'React uses the key to tell items apart.' },
  { kind: 'closing', headline: 'Quizzes and coding tasks.' },
] };
let root: Root; let host: HTMLDivElement; let changes: DevsharkSlide[];
const render = (value: DevsharkDeck) => act(() => { root.render(<SlideCanvas deck={value} index={0} lang="cs" onChange={(slide) => changes.push(slide)} />); });
const block = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="design-studio-canvas"] button')].find((button) => button.getAttribute('aria-label')!.startsWith(`${name}: `))!;
const t = designStudio.cs;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); changes = []; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Design Studio slide canvas', () => {
  it('draws the slide SVG with one control per text block', async () => {
    await render(deck);
    expect(host.querySelector('[data-testid="design-studio-canvas"] svg')).not.toBeNull();
    expect(block(t.blocks.headline)).toBeTruthy();
    expect(block(t.blocks.body)).toBeTruthy();
  });

  it('moves a block by dragging, snapped to 8 px, and fixes every block of the slide in place', async () => {
    await render(deck);
    const headline = block(t.blocks.headline);
    const frame = host.querySelector('[data-testid="design-studio-canvas"]')!;
    await act(async () => { headline.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 })); });
    await act(async () => { frame.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 83, clientY: 41, pointerId: 1 })); });
    const last = changes.at(-1)!;
    expect(last.layout?.headline).toMatchObject({ x: 160, y: 240 });
    expect(Object.keys(last.layout ?? {}).sort()).toEqual(['body', 'headline', 'kicker']);
  });

  it('changes size and alignment from the toolbar and writes text with green words', async () => {
    await render(deck);
    await act(async () => { block(t.blocks.body).focus(); });
    const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label)!;
    await act(async () => { button(t.larger).click(); });
    expect(changes.at(-1)!.layout?.body?.size).toBe(72);
    await act(async () => { button(t.align.center).click(); });
    expect(changes.at(-1)!.layout?.body?.align).toBe('center');
    await act(async () => { block(t.blocks.body).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    const area = host.querySelector<HTMLTextAreaElement>('textarea')!;
    area.setSelectionRange(0, 5);
    await act(async () => { button(t.green).click(); });
    expect(changes.at(-1)!.body).toBe('[[React]] uses the key to tell items apart.');
  });
});
