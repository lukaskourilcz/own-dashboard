'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { EntityBadge } from '@/components/ui/status-badge';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { mediaFits, mediaResolution, orderedMediaPool } from '@/lib/marketing/dneskai-deck-editor';
import type { DneskaiBriefMedia } from '@/lib/marketing/dneskai-brief';
import type { DneskaiSlide } from '@/lib/marketing/dneskai-slides';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';

/**
 * The topic's source pictures in their original order (primary source first, then position in each post or
 * article), with credit, resolution and whether a picture can fill the place it would go into.
 */
export function DneskaiMediaTray({ lang, brief, slide, current, previews, state, onChoose, headingId }: {
  lang: 'en' | 'cs'; brief: NonNullable<DneskaiWorkspacePost['brief']>; slide: Pick<DneskaiSlide, 'type' | 'variant'>; current: string;
  previews: ReadonlyMap<string, string>; state: 'loading' | 'ready' | 'unavailable'; onChoose: (media: DneskaiBriefMedia) => void; headingId: string;
}) {
  const t = dneskaiWorkspace[lang].editor;
  const pool = orderedMediaPool(brief);
  const sources = brief.evidence.map((item) => item.candidateId);
  return <section aria-labelledby={headingId} className="min-w-0 space-y-2 rounded-md border border-border bg-surface-secondary p-3" data-testid="dneskai-media-tray">
    <h5 id={headingId} className="text-xs font-semibold">{t.pool}</h5>
    {state === 'loading' && <p role="status" className="text-xs text-foreground-muted">{t.poolLoading}</p>}
    {state === 'unavailable' && <p role="status" className="text-xs text-warning">{t.poolUnavailable}</p>}
    {pool.length === 0 ? <p className="text-xs text-foreground-muted">{t.poolEmpty}</p> : <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{pool.map((media) => {
      const preview = previews.get(media.assetSha256);
      const resolution = mediaResolution(media);
      const fits = mediaFits(media, slide);
      const inUse = media.assetSha256 === current;
      const origin = t.origin(sources.indexOf(media.candidateId) + 1, media.position + 1);
      return <li key={media.assetSha256} className="min-w-0 space-y-1.5 rounded-md border border-border bg-surface p-2">
        <span className="block overflow-hidden rounded border border-border bg-surface-inset">
          {preview ? <Image unoptimized src={preview} alt={`${origin}, ${media.credit}`} width={media.width} height={media.height} loading="lazy" sizes="12rem" className="block aspect-[4/3] h-auto w-full object-cover" />
            : <span className="flex aspect-[4/3] items-center justify-center p-2 text-center text-[11px] text-foreground-muted">{t.sourceMissing}</span>}
        </span>
        <p className="text-xs font-medium">{origin}</p>
        <p className="break-words text-xs text-foreground-muted">{media.credit}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-[11px]"><EntityBadge>{t.resolution[resolution]}</EntityBadge><span className="tabular text-foreground-muted">{media.width} × {media.height}</span></p>
        {!fits && <p className="text-[11px] text-warning">{t.notFitting}</p>}
        {inUse ? <p className="text-xs font-medium text-success">{t.current}</p>
          : <Button type="button" size="sm" variant="outline" className="w-full" aria-label={`${t.choose}: ${origin}`} onClick={() => onChoose(media)}>{t.choose}</Button>}
      </li>;
    })}</ul>}
  </section>;
}
