'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';
import { cn } from '@/lib/utils';

/**
 * Every rendered slide of a post's current version, in order, as the real JPEGs behind their signed links. Lazy,
 * with intrinsic dimensions, and a visible state when a preview does not load. `onLoadedChange` reports whether
 * every slide has loaded, so approval can wait until the owner has seen them all.
 */
export function DneskaiSlideStrip({ post, lang, onOpenSlide, onLoadedChange, selected, className, label, compact = false, renderFailed = false }: {
  post: Pick<DneskaiWorkspacePost, 'id' | 'assets' | 'deck' | 'title'>; lang: 'en' | 'cs'; onOpenSlide?: (index: number) => void;
  onLoadedChange?: (loaded: boolean) => void; selected?: number; className?: string; label?: string;
  /** One scrolling row of small slides (the editor); they load at once, so approval never waits for a scroll. */
  compact?: boolean;
  /** The render was refused or failed, or never attached (`dneskaiRenderFailed`): no slides will appear for this version. */
  renderFailed?: boolean;
}) {
  const t = dneskaiWorkspace[lang];
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const keys = post.assets.map((asset, index) => `${index}:${asset.sha256}`);
  const allLoaded = keys.length > 0 && keys.every((key) => loaded.has(key));
  useEffect(() => { onLoadedChange?.(allLoaded); }, [allLoaded, onLoadedChange]);
  if (!post.assets.length) return <p className={cn('rounded-md border border-dashed border-border-strong p-3 text-xs text-foreground-muted', className)}>{renderFailed ? t.card.renderFailed : t.card.notRendered}</p>;
  const count = post.assets.length;
  return <ol aria-label={label ?? `${t.card.slides}: ${post.title}`} tabIndex={compact ? 0 : undefined}
    className={cn(compact ? 'flex gap-2 overflow-x-auto pb-1 focus-ring [&>li]:w-20 [&>li]:shrink-0 sm:[&>li]:w-24' : 'grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(5.5rem,8rem))]', className)}>
    {post.assets.map((asset, index) => {
      const key = keys[index]!;
      const type = post.deck?.slides[index]?.type;
      const caption = `${index + 1}/${count}${type ? ` · ${t.slideTypes[type]}` : ''}`;
      const picture = <span className="relative block overflow-hidden rounded-md border border-border bg-surface-inset">
        <Image unoptimized src={asset.url} alt={onOpenSlide ? '' : asset.alt} width={asset.width} height={asset.height} loading={compact ? 'eager' : 'lazy'} sizes="9rem"
          className={cn('block h-auto w-full', failed.has(key) && 'invisible')}
          onLoad={() => setLoaded((previous) => new Set(previous).add(key))}
          onError={() => { setFailed((previous) => new Set(previous).add(key)); setLoaded((previous) => { const next = new Set(previous); next.delete(key); return next; }); }} />
        {failed.has(key) && <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-risk">{t.card.imageFailed}</span>}
      </span>;
      return <li key={key} className="min-w-0">
        {onOpenSlide
          ? <button type="button" onClick={() => onOpenSlide(index)} aria-label={`${t.card.openSlide(index + 1)}. ${asset.alt}`} aria-current={selected === index ? 'true' : undefined}
            className={cn('block w-full rounded-md text-left focus-ring', selected === index && 'ring-2 ring-primary')}>{picture}<span className="mt-1 block text-[11px] text-foreground-muted tabular">{caption}</span></button>
          : <figure className="m-0">{picture}<figcaption className="mt-1 text-[11px] text-foreground-muted tabular">{caption}</figcaption></figure>}
      </li>;
    })}
  </ol>;
}
