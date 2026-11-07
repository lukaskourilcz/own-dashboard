'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { designStudio } from '@/lib/i18n/sections/design-studio';

/**
 * The Design Studio's shared editing surface (7 November 2026), used by devShark and DNESKAi alike: a slide picture
 * of the exact pixels the renderer publishes, with its text blocks laid over it. Drag a block to move it, drag its
 * right edge to change its width, use the arrow keys for 1 px (10 with Shift), and the toolbar for size, alignment
 * and the brand's automatic layout. What the picture is (client-side SVG or a server render) is the caller's.
 */
export type StudioBox = { x: number; y: number; w: number; size: number; align: 'left' | 'center' | 'right' };
export type StudioBlock = { key: string; label: string; text: string; box: StudioBox; height: number; warned?: boolean; placed: boolean };
type Lang = 'en' | 'cs';
type Drag = { key: string; mode: 'move' | 'width'; startX: number; startY: number; box: StudioBox; scale: number };

const GRID = 8;
const snap = (value: number) => Math.round(value / GRID) * GRID;

export function StudioToolbar({ block, lang, disabled, onBox, onAuto, hint, children }: {
  block: StudioBlock | null; lang: Lang; disabled?: boolean; hint?: string; onBox: (key: string, patch: Partial<StudioBox>) => void; onAuto: (key: string) => void; children?: ReactNode;
}) {
  const t = designStudio[lang];
  return <div role="toolbar" aria-label={t.toolbar} className="flex min-h-11 flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1">
    <span className="px-2 text-xs text-foreground-muted">{block ? block.label : hint ?? t.selectHint}</span>
    {block && <>
      <button type="button" disabled={disabled} onClick={() => onBox(block.key, { size: Math.max(16, block.box.size - 4) })} className="min-h-9 rounded px-2 text-sm hover:bg-surface-hover focus-ring" aria-label={t.smaller}>A−</button>
      <span className="tabular w-10 text-center text-xs text-foreground-muted" aria-live="polite">{Math.round(block.box.size)}</span>
      <button type="button" disabled={disabled} onClick={() => onBox(block.key, { size: Math.min(200, block.box.size + 4) })} className="min-h-9 rounded px-2 text-sm hover:bg-surface-hover focus-ring" aria-label={t.larger}>A+</button>
      {(['left', 'center', 'right'] as const).map((align) => <button key={align} type="button" disabled={disabled} aria-pressed={block.box.align === align}
        onClick={() => onBox(block.key, { align })} className={cn('min-h-9 rounded px-2 text-xs focus-ring', block.box.align === align ? 'bg-accent' : 'hover:bg-surface-hover')}>{t.align[align]}</button>)}
      {children}
      <button type="button" disabled={disabled || !block.placed} onClick={() => onAuto(block.key)}
        className="min-h-9 rounded px-2 text-xs hover:bg-surface-hover focus-ring disabled:opacity-40">{t.auto}</button>
    </>}
  </div>;
}

export function BoxOverlay({ width, height, blocks, selected, onSelect, onBox, onEdit, editing, renderEditor, disabled, lang, children, testId }: {
  /** The slide's master size in px; boxes are in the same units. */
  width: number; height: number; blocks: readonly StudioBlock[]; selected: string | null; onSelect: (key: string | null) => void;
  onBox: (key: string, patch: Partial<StudioBox>) => void;
  /** Double-click or Enter on a block: write in it (on the slide or in a form field, as the caller decides). */
  onEdit?: (key: string) => void; editing?: string | null; renderEditor?: (block: StudioBlock) => ReactNode;
  disabled?: boolean; lang: Lang; children: ReactNode; testId?: string;
}) {
  const t = designStudio[lang];
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // A frame not laid out yet (or in a test DOM) measures 0; treat it as full size rather than divide by zero.
  const scale = () => (frame.current?.getBoundingClientRect().width || width) / width;
  const start = (event: PointerEvent, block: StudioBlock, mode: Drag['mode']) => {
    if (disabled || editing === block.key) return;
    event.stopPropagation();
    // Capture keeps the drag when the pointer leaves the block; a pointer the browser no longer tracks cannot be captured.
    try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* the frame still receives the moves */ }
    onSelect(block.key);
    setDrag({ key: block.key, mode, startX: event.clientX, startY: event.clientY, box: block.box, scale: scale() });
  };
  const move = (event: PointerEvent) => {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.scale, dy = (event.clientY - drag.startY) / drag.scale;
    if (drag.mode === 'move') onBox(drag.key, { x: snap(drag.box.x + dx), y: snap(drag.box.y + dy) });
    else onBox(drag.key, { w: Math.max(80, Math.min(width, snap(drag.box.w + dx))) });
  };
  const keys = (event: KeyboardEvent, block: StudioBlock) => {
    if (disabled || editing) return;
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (delta[event.key]) { event.preventDefault(); onBox(block.key, { x: block.box.x + delta[event.key]![0], y: block.box.y + delta[event.key]![1] }); }
    if (event.key === 'Enter' && onEdit) { event.preventDefault(); onEdit(block.key); }
  };
  return <div ref={frame} className="relative w-full select-none overflow-hidden rounded-md border border-border" style={{ aspectRatio: `${width} / ${height}` }}
    onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerDown={() => { if (!editing) onSelect(null); }} data-testid={testId}>
    {children}
    {blocks.map((block) => {
      const style = { left: `${(block.box.x / width) * 100}%`, top: `${(block.box.y / height) * 100}%`, width: `${(block.box.w / width) * 100}%`, height: `${(Math.max(block.height, 24) / height) * 100}%` };
      return <div key={block.key} style={style} className={cn('absolute rounded-sm outline-2 outline-offset-2', selected === block.key ? 'outline outline-information' : 'hover:outline hover:outline-information/50', block.warned && 'outline-dashed outline-warning')}>
        {editing === block.key && renderEditor
          ? renderEditor(block)
          : <button type="button" disabled={disabled} aria-label={`${block.label}: ${block.text.replace(/\[\[|\]\]/g, '')}`} aria-pressed={selected === block.key}
              onPointerDown={(event) => start(event, block, 'move')} onDoubleClick={() => !disabled && onEdit?.(block.key)} onKeyDown={(event) => keys(event, block)} onFocus={() => onSelect(block.key)}
              className={cn('absolute inset-0 cursor-move focus-ring', disabled && 'cursor-default')} />}
        {selected === block.key && editing !== block.key && !disabled && <span role="presentation" onPointerDown={(event) => start(event, block, 'width')}
          className="absolute -right-2 top-1/2 h-8 w-3 -translate-y-1/2 cursor-ew-resize rounded-sm border border-information bg-surface" title={t.width} />}
      </div>;
    })}
  </div>;
}
