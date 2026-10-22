'use client';

import { useId } from 'react';
import Image from 'next/image';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import type { DneskaiKit, DneskaiLabKit } from '@/lib/marketing/dneskai-lab';
import { cn } from '@/lib/utils';

/**
 * The five kits as one radio group of bordered cover thumbnails (design-lab-spec.md §2, inspector 1). The digit is the
 * shortcut. A kit with no rendered cover says so in words; a kit OwnDashboard cannot render is disabled and explained.
 */
export function DneskaiKitTiles({ kits, chosen, onChoose, lang }: { kits: readonly DneskaiLabKit[]; chosen: DneskaiKit; onChoose: (kit: DneskaiKit) => void; lang: 'en' | 'cs' }) {
  const t = dneskaiLab[lang].kits;
  const id = useId();
  const anyUnavailable = kits.some((kit) => !kit.renderable);
  return <fieldset className="min-w-0 space-y-2" aria-describedby={anyUnavailable ? `${id}-help` : undefined} data-testid="dneskai-kit-tiles">
    <legend className="text-xs font-semibold">{t.label}</legend>
    <div className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible">
      {kits.map((kit) => {
        const selected = kit.id === chosen;
        return <label key={kit.id} data-testid={`dneskai-kit-${kit.id}`}
          className={cn('relative block w-24 shrink-0 space-y-1 rounded-md border p-1 text-[11px] focus-within:ring-2 focus-within:ring-ring lg:w-auto',
            selected ? 'border-primary bg-surface-selected' : 'border-border bg-surface',
            kit.renderable ? 'cursor-pointer hover:border-border-strong' : 'cursor-not-allowed text-foreground-muted')}>
          <input type="radio" name={`${id}-kit`} value={kit.id} checked={selected} disabled={!kit.renderable} onChange={() => onChoose(kit.id)} className="sr-only"
            aria-label={`${kit.key} ${t.names[kit.id]}${kit.current ? `, ${t.current}` : ''}${kit.renderable ? '' : `, ${t.unavailable}`}${kit.fits === false ? `, ${t.shorten}` : ''}`} />
          <span className="relative block aspect-[4/5] overflow-hidden rounded-sm border border-border bg-surface-inset">
            {kit.cover ? <Image unoptimized src={kit.cover.url} alt="" width={kit.cover.width} height={kit.cover.height} sizes="96px" className="absolute inset-0 size-full" />
              : <span className="absolute inset-0 flex items-center justify-center p-1 text-center text-[10px] leading-tight">{!kit.renderable ? t.unavailable : selected ? t.onStage : t.pick}</span>}
          </span>
          <span aria-hidden className="flex items-baseline justify-between gap-1"><span className="font-medium"><span className="tabular text-foreground-muted">{kit.key}</span> {t.names[kit.id]}</span></span>
          {kit.fits !== null && <span aria-hidden className={cn('block', kit.fits ? 'text-success' : 'text-warning')}>{kit.fits ? t.fits : t.shorten}</span>}
        </label>;
      })}
    </div>
    {anyUnavailable && <p id={`${id}-help`} className="text-xs text-foreground-muted">{t.unavailableHelp}</p>}
    <p className="text-xs text-foreground-muted">{t.switchNeedsApproval}</p>
  </fieldset>;
}
