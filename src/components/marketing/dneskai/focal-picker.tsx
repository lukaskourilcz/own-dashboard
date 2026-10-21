'use client';

import { useId, useRef } from 'react';
import Image from 'next/image';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { DNESKAI_ZOOM, focalFromPoint, moveFocal } from '@/lib/marketing/dneskai-deck-editor';

type Focal = { x: number; y: number };

/**
 * The focal point of one picture: click or tap the picture to set it, or use the arrow keys (2 % per press, Home
 * centres it). The point stays in view when the template crops the picture; the readout states it in numbers.
 */
export function DneskaiFocalPicker({ lang, label, src, width, height, focal, zoom, onFocal, onZoom }: {
  lang: 'en' | 'cs'; label: string; src: string | null; width: number; height: number; focal: Focal; zoom: number;
  onFocal: (focal: Focal) => void; onZoom: (zoom: number) => void;
}) {
  const t = dneskaiWorkspace[lang].editor;
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const percent = (value: number) => Math.round(value * 100);
  return <div className="min-w-0 space-y-2">
    {src ? <div ref={box} role="group" tabIndex={0} aria-label={`${label}: ${t.focal}`} aria-describedby={`${id}-help ${id}-value`}
      data-testid="dneskai-focal-picker"
      className="relative w-full max-w-sm cursor-crosshair touch-manipulation overflow-hidden rounded-md border border-border bg-surface-inset focus-ring"
      onClick={(event) => { const rect = box.current?.getBoundingClientRect(); if (rect) onFocal(focalFromPoint(rect, event.clientX, event.clientY)); }}
      onKeyDown={(event) => { const next = moveFocal(focal, event.key); if (next) { event.preventDefault(); onFocal(next); } }}>
      <Image unoptimized src={src} alt="" width={width} height={height} loading="lazy" sizes="24rem" className="pointer-events-none block h-auto w-full select-none" draggable={false} />
      <span aria-hidden className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-primary/80 shadow-elevated"
        style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }} />
    </div> : <p className="rounded-md border border-dashed border-border-strong p-3 text-xs text-foreground-muted">{t.sourceMissing}</p>}
    <p id={`${id}-help`} className="text-xs text-foreground-muted">{t.focalHelp}</p>
    <output id={`${id}-value`} aria-live="polite" className="block text-xs tabular">{t.focalValue(percent(focal.x), percent(focal.y))}</output>
    <div className="flex max-w-sm items-center gap-3">
      <label htmlFor={`${id}-zoom`} className="shrink-0 text-xs font-medium text-foreground-muted">{t.zoom}</label>
      <input id={`${id}-zoom`} type="range" min={DNESKAI_ZOOM.min} max={DNESKAI_ZOOM.max} step={DNESKAI_ZOOM.step} value={zoom}
        aria-valuetext={t.zoomValue(zoom.toFixed(2))} onChange={(event) => onZoom(Number(event.target.value))}
        className="h-11 min-w-0 flex-1 accent-primary md:h-6" />
      <output htmlFor={`${id}-zoom`} className="w-12 shrink-0 text-right text-xs tabular">{t.zoomValue(zoom.toFixed(2))}</output>
    </div>
  </div>;
}
