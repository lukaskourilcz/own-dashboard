'use client';

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { layoutDevsharkSlide, SLIDE_HEIGHT, SLIDE_WIDTH, type StudioBlockKey, type StudioSlide } from '@/lib/design-studio/devshark-layout';
import type { DevsharkBox, DevsharkDeck, DevsharkSlide } from '@/lib/marketing/devshark-deck';
import { designStudio } from '@/lib/i18n/sections/design-studio';

/** The brand pictures and fonts the editor draws with: the same files the renderer verifies (public/design-studio). */
export const STUDIO_BROWSER_ASSETS = { finGreen: '/design-studio/devshark/devshark-fin-clean-green.svg', finInk: '/design-studio/devshark/devshark-fin-clean-ink.svg', logoWhite: '/design-studio/devshark/devshark-logo-horizontal-white.svg' };
const FONT_FACES = `@font-face{font-family:"Manrope";font-weight:700;src:url(/design-studio/fonts/manrope-700.ttf) format("truetype")}
@font-face{font-family:"Manrope";font-weight:800;src:url(/design-studio/fonts/manrope-800.ttf) format("truetype")}
@font-face{font-family:"JetBrains Mono";font-weight:400;src:url(/design-studio/fonts/jetbrains-mono-400.ttf) format("truetype")}`;
const GRID = 8;
const snap = (value: number) => Math.round(value / GRID) * GRID;
type Lang = 'en' | 'cs';
type Drag = { key: StudioBlockKey; mode: 'move' | 'width'; startX: number; startY: number; box: Required<DevsharkBox>; scale: number };

/** Every block's current box, so a slide's first manual change fixes all of them where they are. */
function materialised(slide: DevsharkSlide, layout: StudioSlide): NonNullable<DevsharkSlide['layout']> {
  return Object.fromEntries(layout.blocks.map((block) => [block.key, slide.layout?.[block.key] ?? block.box])) as NonNullable<DevsharkSlide['layout']>;
}

/**
 * One slide of the Design Studio (7 November 2026): the exact SVG the renderer publishes, with its text blocks laid
 * over it. Drag a block to move it, drag its right edge to change its width, double-click to write in it, and use the
 * toolbar for size, alignment and green words. Arrow keys move the selected block by 1 px (10 with Shift).
 */
export function SlideCanvas({ deck, index, lang, disabled, onChange }: { deck: DevsharkDeck; index: number; lang: Lang; disabled?: boolean; onChange: (slide: DevsharkSlide) => void }) {
  const t = designStudio[lang];
  const slide = deck.slides[index]!;
  const layout = useMemo(() => layoutDevsharkSlide(deck, index, STUDIO_BROWSER_ASSETS), [deck, index]);
  const frame = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState<StudioBlockKey | null>(null);
  const [editing, setEditing] = useState<StudioBlockKey | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const selectedBlock = layout.blocks.find((block) => block.key === selected) ?? null;

  const setBox = (key: StudioBlockKey, patch: Partial<Required<DevsharkBox>>) => {
    const boxes = materialised(slide, layout);
    const current = { ...layout.blocks.find((block) => block.key === key)!.box, ...(boxes[key] ?? {}) };
    onChange({ ...slide, layout: { ...boxes, [key]: { ...current, ...patch } } });
  };
  const setText = (key: StudioBlockKey, value: string) => {
    const next = { ...slide };
    if (key === 'kicker') next.kicker = value.trim() ? value : undefined;
    else if (key === 'headline') next.headline = value.trim() ? value : slide.headline;
    else if (key === 'body') next.body = value.trim() ? value : undefined;
    else next.code = value.trim() ? value : undefined;
    onChange(next);
  };
  // A frame not laid out yet (or in a test DOM) measures 0; treat it as full size rather than divide by zero.
  const scale = () => (frame.current?.getBoundingClientRect().width || SLIDE_WIDTH) / SLIDE_WIDTH;
  const start = (event: PointerEvent, key: StudioBlockKey, mode: Drag['mode']) => {
    if (disabled || editing === key) return;
    event.stopPropagation();
    // Capture keeps the drag when the pointer leaves the block; a pointer the browser no longer tracks cannot be captured.
    try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* the frame still receives the moves */ }
    setSelected(key);
    setDrag({ key, mode, startX: event.clientX, startY: event.clientY, box: layout.blocks.find((block) => block.key === key)!.box, scale: scale() });
  };
  const move = (event: PointerEvent) => {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.scale, dy = (event.clientY - drag.startY) / drag.scale;
    if (drag.mode === 'move') setBox(drag.key, { x: snap(drag.box.x + dx), y: snap(drag.box.y + dy) });
    else setBox(drag.key, { w: Math.max(80, Math.min(SLIDE_WIDTH, snap(drag.box.w + dx))) });
  };
  const keys = (event: KeyboardEvent, key: StudioBlockKey) => {
    if (disabled || editing) return;
    const step = event.shiftKey ? 10 : 1;
    const box = layout.blocks.find((block) => block.key === key)!.box;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (delta[event.key]) { event.preventDefault(); setBox(key, { x: box.x + delta[event.key]![0], y: box.y + delta[event.key]![1] }); }
    if (event.key === 'Enter') { event.preventDefault(); setEditing(key); }
  };
  const green = () => {
    const area = editor.current;
    if (!area || !editing || editing === 'code' || editing === 'kicker') return;
    const { selectionStart: from, selectionEnd: to, value } = area;
    if (from === to) return;
    setText(editing, `${value.slice(0, from)}[[${value.slice(from, to)}]]${value.slice(to)}`);
  };

  return <div className="min-w-0 space-y-2">
    <style>{FONT_FACES}</style>
    <div role="toolbar" aria-label={t.toolbar} className="flex min-h-11 flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1">
      <span className="px-2 text-xs text-foreground-muted">{selectedBlock ? t.blocks[selectedBlock.key] : t.selectHint}</span>
      {selectedBlock && <>
        <button type="button" disabled={disabled} onClick={() => setBox(selectedBlock.key, { size: Math.max(12, selectedBlock.box.size - 4) })} className="min-h-9 rounded px-2 text-sm hover:bg-surface-hover focus-ring" aria-label={t.smaller}>A−</button>
        <span className="tabular w-10 text-center text-xs text-foreground-muted" aria-live="polite">{Math.round(selectedBlock.box.size)}</span>
        <button type="button" disabled={disabled} onClick={() => setBox(selectedBlock.key, { size: Math.min(240, selectedBlock.box.size + 4) })} className="min-h-9 rounded px-2 text-sm hover:bg-surface-hover focus-ring" aria-label={t.larger}>A+</button>
        {(['left', 'center', 'right'] as const).map((align) => <button key={align} type="button" disabled={disabled} aria-pressed={selectedBlock.box.align === align}
          onClick={() => setBox(selectedBlock.key, { align })} className={cn('min-h-9 rounded px-2 text-xs focus-ring', selectedBlock.box.align === align ? 'bg-accent' : 'hover:bg-surface-hover')}>{t.align[align]}</button>)}
        <button type="button" disabled={disabled || editing === null || editing === 'code' || editing === 'kicker'} onMouseDown={(event) => event.preventDefault()} onClick={green}
          className="min-h-9 rounded px-2 text-xs font-semibold text-success hover:bg-surface-hover focus-ring disabled:opacity-40">{t.green}</button>
        <button type="button" disabled={disabled || !slide.layout?.[selectedBlock.key]} onClick={() => { const boxes = { ...(slide.layout ?? {}) }; delete boxes[selectedBlock.key]; onChange({ ...slide, layout: Object.keys(boxes).length ? boxes : undefined }); }}
          className="min-h-9 rounded px-2 text-xs hover:bg-surface-hover focus-ring disabled:opacity-40">{t.auto}</button>
      </>}
    </div>
    <div ref={frame} className="relative w-full select-none overflow-hidden rounded-md border border-border" style={{ aspectRatio: `${SLIDE_WIDTH} / ${SLIDE_HEIGHT}` }}
      onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerDown={() => { if (!editing) setSelected(null); }} data-testid="design-studio-canvas">
      <div aria-hidden className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: layout.svg }} />
      {layout.blocks.map((block) => {
        const style = { left: `${(block.box.x / SLIDE_WIDTH) * 100}%`, top: `${(block.box.y / SLIDE_HEIGHT) * 100}%`, width: `${(block.box.w / SLIDE_WIDTH) * 100}%`, height: `${(Math.max(block.height, 24) / SLIDE_HEIGHT) * 100}%` };
        const warned = layout.warnings.some((warning) => warning.block === block.key && warning.code === 'outside-slide');
        return <div key={block.key} style={style} className={cn('absolute rounded-sm outline-2 outline-offset-2', selected === block.key ? 'outline outline-information' : 'hover:outline hover:outline-information/50', warned && 'outline-dashed outline-warning')}>
          {editing === block.key
            ? <textarea ref={editor} autoFocus aria-label={t.blocks[block.key]} defaultValue={block.text} spellCheck={block.key !== 'code'}
                onChange={(event) => setText(block.key, event.target.value)} onBlur={() => setEditing(null)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setEditing(null); } }}
                className={cn('h-full min-h-16 w-full resize-none rounded-sm bg-surface/90 p-1 text-sm text-foreground shadow-lg focus-ring', block.key === 'code' && 'font-mono')} />
            : <button type="button" disabled={disabled} aria-label={`${t.blocks[block.key]}: ${block.text.replace(/\[\[|\]\]/g, '')}`} aria-pressed={selected === block.key}
                onPointerDown={(event) => start(event, block.key, 'move')} onDoubleClick={() => !disabled && setEditing(block.key)} onKeyDown={(event) => keys(event, block.key)} onFocus={() => setSelected(block.key)}
                className={cn('absolute inset-0 cursor-move focus-ring', disabled && 'cursor-default')} />}
          {selected === block.key && editing !== block.key && !disabled && <span role="presentation" onPointerDown={(event) => start(event, block.key, 'width')}
            className="absolute -right-2 top-1/2 h-8 w-3 -translate-y-1/2 cursor-ew-resize rounded-sm border border-information bg-surface" title={t.width} />}
        </div>;
      })}
    </div>
    <p className="text-xs text-foreground-muted">{t.howTo}</p>
    {layout.warnings.length > 0 && <ul className="space-y-0.5 text-xs text-warning" aria-live="polite">{layout.warnings.map((warning, at) => <li key={at}>{t.blocks[warning.block]}: {t.warnings[warning.code]}</li>)}</ul>}
  </div>;
}
