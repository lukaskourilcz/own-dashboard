// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DneskaiStudioView } from '@/components/marketing/dneskai/lab/studio-view';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { designStudio } from '@/lib/i18n/sections/design-studio';
import type { DneskaiSlide, DneskaiSlideLayout } from '@/lib/marketing/dneskai-slides';
import type { DneskaiStagePreview } from '@/components/marketing/dneskai/lab/stage';

const t = dneskaiLab.cs.stage.studio;
const tools = designStudio.cs;
const slide: DneskaiSlide = { type: 'statement', headline: 'Výrok k ověření', body: 'Text pod ním.', images: [], alt: 'Výrok' };
const blocks: DneskaiStagePreview['blocks'] = [
  { field: 'headline', box: { x: 72, y: 600, w: 936, size: 88, align: 'center' }, height: 200 },
  { field: 'body', box: { x: 72, y: 840, w: 936, size: 40, align: 'center' }, height: 120 },
];
const rendered: DneskaiStagePreview = { slide: 0, status: 'rendered', image: 'data:image/webp;base64,AAAA', code: null, blocks };
let host: HTMLDivElement, root: Root, layouts: Array<DneskaiSlideLayout | undefined>;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); layouts = []; });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async (props: Partial<Parameters<typeof DneskaiStudioView>[0]> = {}) => act(async () => {
  root.render(<DneskaiStudioView slide={slide} index={0} preview={rendered} last={null} editable onLayout={(layout) => layouts.push(layout)} lang="cs" {...props} />);
});
const block = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label^="${label}: "]`)!;

describe('DNESKAi Lab Studio view', () => {
  it('lays the engine\'s text frames over the rendered slide', async () => {
    await render();
    expect(host.querySelector('[data-testid="dneskai-studio-canvas"] img')).not.toBeNull();
    expect(block(t.blocks.headline)).toBeTruthy();
    expect(block(t.blocks.body)).toBeTruthy();
  });

  it('moves a block with the arrows and fixes the other words where the engine drew them', async () => {
    await render();
    await act(async () => { block(t.blocks.headline).focus(); });
    await act(async () => { block(t.blocks.headline).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })); });
    expect(layouts.at(-1)).toEqual({ headline: { x: 72, y: 590, w: 936, size: 88, align: 'center' }, body: blocks[1]!.box });
  });

  it('returns a placed block to the automatic layout', async () => {
    await render({ slide: { ...slide, layout: { headline: { x: 72, y: 200, w: 600, size: 64, align: 'left' } } } });
    await act(async () => { block(t.blocks.headline).focus(); });
    const auto = [...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find((item) => item.textContent === tools.auto)!;
    await act(async () => { auto.click(); });
    expect(layouts.at(-1)).toBeUndefined();
  });

  it('keeps the last picture while the next change draws, and is read-only outside review', async () => {
    await render({ preview: { slide: 0, status: 'loading', image: null, code: null, blocks: [] }, last: { image: rendered.image!, blocks }, editable: false });
    expect(host.querySelector('[data-testid="dneskai-studio-canvas"] img')).not.toBeNull();
    expect(host.textContent).toContain(t.drawing);
    expect(host.textContent).toContain(t.readOnly);
    expect(block(t.blocks.headline).disabled).toBe(true);
  });
});
