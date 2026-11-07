'use client';

import { useState } from 'react';
import { BoxOverlay, StudioToolbar, type StudioBlock, type StudioBox } from '@/components/design-studio/box-overlay';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import type { DneskaiPreviewResult } from '@/lib/marketing/dneskai-lab';
import type { DneskaiEditableField, DneskaiSlide, DneskaiSlideLayout } from '@/lib/marketing/dneskai-slides';
import { DneskaiCodeText } from '../code-text';
import type { DneskaiStagePreview } from './stage';

type Lang = 'en' | 'cs';
const WIDTH = 1080;
const HEIGHT = 1350;
type Laid = DneskaiPreviewResult['blocks'][number];

/** Every box as drawn, with the owner's on top: the first hand change fixes the slide's other words where they are. */
function materialised(laid: readonly Laid[], layout: DneskaiSlideLayout | undefined): DneskaiSlideLayout {
  return Object.fromEntries(laid.map((block) => [block.field, layout?.[block.field] ?? block.box])) as DneskaiSlideLayout;
}
const int = (box: StudioBox) => ({ x: Math.max(0, Math.round(box.x)), y: Math.max(0, Math.round(box.y)), w: Math.min(WIDTH, Math.max(80, Math.round(box.w))), size: Math.min(200, Math.max(16, Math.round(box.size))), align: box.align });

/**
 * The DNESKAi Lab's Studio view (Design Studio, 7 November 2026): the slide exactly as the engine renders it, from the
 * render-only preview, with its headline, text and label as blocks on the shared editing surface. A change is stored
 * in the draft slide's `layout` at once, so the boxes follow the pointer; the preview then draws it again. Until the
 * new picture arrives the last one stays, so the slide never blanks while the owner works.
 */
export function DneskaiStudioView({ slide, index, preview, last, editable, onLayout, lang }: {
  slide: DneskaiSlide; index: number; preview: DneskaiStagePreview | null;
  /** The newest picture drawn for this slide, kept by the Lab while the next one renders. */
  last: { image: string; blocks: Laid[] } | null;
  editable: boolean; onLayout: (layout: DneskaiSlideLayout | undefined) => void; lang: Lang;
}) {
  const t = dneskaiLab[lang].stage.studio;
  const [selected, setSelected] = useState<string | null>(null);
  const current = preview?.slide === index ? preview : null;
  const shown = current?.status === 'rendered' && current.image ? { image: current.image, blocks: current.blocks } : last;
  const laid = shown?.blocks ?? [];
  const blocks: StudioBlock[] = laid.map((block) => ({
    key: block.field, label: t.blocks[block.field], text: slide[block.field] ?? '', box: slide.layout?.[block.field] ?? block.box,
    height: slide.layout?.[block.field] ? Math.max(block.height, 24) : block.height, placed: !!slide.layout?.[block.field],
    warned: current?.status === 'refused',
  }));
  const selectedBlock = blocks.find((block) => block.key === selected) ?? null;
  const setBox = (key: string, patch: Partial<StudioBox>) => {
    const boxes = materialised(laid, slide.layout);
    const field = key as DneskaiEditableField;
    onLayout({ ...boxes, [field]: int({ ...(boxes[field] ?? laid.find((block) => block.field === field)!.box), ...patch }) });
  };
  const auto = (key: string) => {
    const boxes = { ...(slide.layout ?? {}) };
    delete boxes[key as DneskaiEditableField];
    onLayout(Object.keys(boxes).length ? boxes : undefined);
  };
  return <div className="space-y-2" data-testid="dneskai-studio">
    <StudioToolbar block={selectedBlock} lang={lang} disabled={!editable} onBox={setBox} onAuto={auto} hint={t.selectHint} />
    {shown ? <BoxOverlay width={WIDTH} height={HEIGHT} blocks={blocks} selected={selected} onSelect={setSelected} onBox={setBox} disabled={!editable} lang={lang} testId="dneskai-studio-canvas">
      {/* eslint-disable-next-line @next/next/no-img-element -- an in-memory data URL of the render-only preview */}
      <img src={shown.image} alt="" aria-hidden width={864} height={1080} className="absolute inset-0 block size-full" />
    </BoxOverlay> : <div className="flex aspect-[4/5] items-center justify-center rounded-md border border-border bg-surface-inset p-5 text-center" role="status" aria-live="polite">
      <p className="text-sm font-medium">{current?.status === 'refused' || current?.status === 'unavailable' ? t.unavailable : t.drawing}</p>
    </div>}
    <div aria-live="polite" className="min-h-5 text-xs">
      {current?.status === 'loading' && shown && <span className="text-foreground-muted">{t.drawing}</span>}
      {(current?.status === 'refused' || current?.status === 'unavailable') && <span className="flex flex-wrap items-center gap-1 text-warning">{shown && t.unavailable}{current.code && <DneskaiCodeText code={current.code} lang={lang} />}</span>}
    </div>
    <p className="text-xs text-foreground-muted">{!editable ? t.readOnly : shown && !laid.length ? t.noBlocks : t.help}</p>
  </div>;
}
