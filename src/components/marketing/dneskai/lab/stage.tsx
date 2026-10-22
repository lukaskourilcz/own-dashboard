'use client';

import { useId, useRef } from 'react';
import Image from 'next/image';
import { Bookmark, ChevronLeft, ChevronRight, Heart, MessageCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import type { DneskaiLabAsset, DneskaiLabPost } from '@/lib/marketing/dneskai-lab';
import { cn } from '@/lib/utils';
import { DneskaiCodeText } from '../code-text';

type Lang = 'en' | 'cs';
export type DneskaiStageView = 'feed' | 'profile' | 'pixels';
/** The width a phone shows the feed at, in CSS px: the stage draws the slide at exactly this size (true scale). */
export const DNESKAI_PHONE_WIDTH = 390;

/**
 * The Lab's stage (design-lab-spec.md §2): the current slide in a phone frame at the width the feed shows it, the
 * profile grid with this post's cover among the latest real covers in the 3:4 crop, and the JPEG at its own pixel size.
 * The phone chrome is decorative and hidden from assistive technology; the slide image carries the alt text. A slide
 * without a render shows its state and problem in words, never a stand-in picture.
 */
export function DneskaiLabStage({ lab, slide, onSlide, view, onView, profileCovers, onLoaded, caption, lang }: {
  lab: DneskaiLabPost; slide: number; onSlide: (index: number) => void; view: DneskaiStageView; onView: (view: DneskaiStageView) => void;
  profileCovers: readonly DneskaiLabAsset[]; onLoaded: (url: string, ok: boolean) => void; caption: string; lang: Lang;
}) {
  const t = dneskaiLab[lang];
  const id = useId();
  const total = lab.slides.length;
  const current = lab.slides[slide] ?? null;
  const touch = useRef<number | null>(null);
  const views: DneskaiStageView[] = ['feed', 'profile', 'pixels'];
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3" data-testid="dneskai-lab-stage">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={`${id}-title`} className="min-w-0 break-words text-sm font-semibold">{lab.post.title}</h3>
      <fieldset className="flex shrink-0 rounded-md border border-border bg-surface-secondary p-0.5" data-testid="dneskai-stage-views">
        <legend className="sr-only">{t.stage.views.label}</legend>
        {views.map((item) => <label key={item} className={cn('inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded px-3 text-xs font-medium focus-within:ring-2 focus-within:ring-ring md:min-h-7',
          view === item ? 'bg-surface text-foreground shadow-soft' : 'text-foreground-muted hover:text-foreground')}>
          <input type="radio" name={`${id}-view`} value={item} checked={view === item} onChange={() => onView(item)} className="sr-only" />{t.stage.views[item]}
        </label>)}
      </fieldset>
    </div>

    {view === 'feed' && <figure className="mx-auto w-full" style={{ maxWidth: DNESKAI_PHONE_WIDTH }} data-testid="dneskai-phone"
      onTouchStart={(event) => { touch.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        const start = touch.current; touch.current = null;
        const end = event.changedTouches[0]?.clientX;
        if (start === null || end === undefined || Math.abs(end - start) < 40) return;
        onSlide(Math.min(total - 1, Math.max(0, slide + (end < start ? 1 : -1))));
      }}>
      <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-soft">
        <div aria-hidden className="flex h-11 items-center gap-2 px-3 text-[13px] font-semibold">
          <span className="size-7 rounded-full border border-border bg-surface-muted" />{lab.post.account.handle}
        </div>
        <div className="relative aspect-[4/5] bg-surface-inset">
          {current?.render ? <Image key={current.render.url} unoptimized priority src={current.render.url} alt={current.render.alt} width={current.render.width} height={current.render.height}
            sizes={`${DNESKAI_PHONE_WIDTH}px`} className="absolute inset-0 block size-full" data-testid="dneskai-stage-slide"
            onLoad={() => onLoaded(current.render!.url, true)} onError={() => onLoaded(current.render!.url, false)} />
            : <div className="absolute inset-0 flex flex-col justify-center gap-2 p-5" role="status">
              <p className="text-sm font-medium">{t.stage.noRender}</p>
              <DneskaiCodeText code={current?.problems.find((problem) => problem.blocking)?.code ?? lab.state.code ?? 'revision-not-ready'} lang={lang} />
            </div>}
        </div>
        <div aria-hidden className="flex h-11 items-center gap-4 px-3 text-foreground">
          <Heart className="size-5" /><MessageCircle className="size-5" /><Send className="size-5" />
          {total > 1 && <span className="mx-auto flex gap-1">{lab.slides.map((item) => <span key={item.index} className={cn('size-1.5 rounded-full', item.index === slide ? 'bg-primary' : 'bg-border-strong')} />)}</span>}
          <Bookmark className={cn('size-5', total <= 1 && 'ml-auto')} />
        </div>
        <p aria-hidden className="line-clamp-2 break-words px-3 pb-3 text-[13px] leading-[18px]"><span className="font-semibold">{lab.post.account.handle}</span> {caption}</p>
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-2 text-xs text-foreground-muted">
        <span className="tabular" aria-live="polite">{t.stage.slideOf(slide + 1, total)}</span>
        <span className="lg:hidden">{t.stage.swipeHelp}</span>
      </figcaption>
    </figure>}

    {view === 'profile' && <div className="mx-auto w-full space-y-2" style={{ maxWidth: DNESKAI_PHONE_WIDTH }} data-testid="dneskai-profile-grid">
      <p className="text-xs text-foreground-muted">{t.stage.profileHelp}</p>
      <ul className="grid grid-cols-3 gap-0.5 bg-surface">
        {[lab.slides[0]?.render ?? null, ...profileCovers].slice(0, 9).map((cover, index) => <li key={`${index}:${cover?.url ?? "none"}`} className={cn('relative aspect-[3/4] overflow-hidden bg-surface-inset', index === 0 && 'outline outline-2 -outline-offset-2 outline-primary')}>
          {cover ? <Image unoptimized src={cover.url} alt={index === 0 ? `${t.stage.profileThis}: ${cover.alt}` : cover.alt} width={cover.width} height={cover.height} sizes="130px" className="absolute inset-0 size-full object-cover" />
            : <span className="absolute inset-0 flex items-center p-2 text-[11px] text-foreground-muted">{t.stage.noRender}</span>}
        </li>)}
      </ul>
    </div>}

    {view === 'pixels' && (current?.render ? <div className="space-y-2">
      <p className="text-xs text-foreground-muted">{t.stage.pixelsHelp(current.render.width, current.render.height)}</p>
      <div role="region" aria-label={t.stage.pixelsRegion} tabIndex={0} className="max-h-[70dvh] overflow-auto rounded-md border border-border bg-surface-inset focus-ring" data-testid="dneskai-pixels">
        <Image unoptimized src={current.render.url} alt={current.render.alt} width={current.render.width} height={current.render.height} className="block max-w-none" style={{ width: current.render.width, height: current.render.height }} />
      </div>
    </div> : <p role="status" className="text-sm text-foreground-muted">{t.stage.noRender}</p>)}

    <DeckStrip lab={lab} slide={slide} onSlide={onSlide} lang={lang} onLoaded={onLoaded} />
  </section>;
}

/** Every slide as a thumbnail; the current one is ringed. The thumbnails also tell the Lab the deck has loaded. */
function DeckStrip({ lab, slide, onSlide, lang, onLoaded }: { lab: DneskaiLabPost; slide: number; onSlide: (index: number) => void; lang: Lang; onLoaded: (url: string, ok: boolean) => void }) {
  const t = dneskaiLab[lang];
  const types = dneskaiWorkspace[lang].slideTypes;
  const total = lab.slides.length;
  return <nav aria-label={t.stage.deck} className="flex min-w-0 items-center gap-2" data-testid="dneskai-deck-strip">
    <Button type="button" variant="outline" size="icon-sm" aria-label={t.stage.previous} disabled={slide <= 0} onClick={() => onSlide(slide - 1)}><ChevronLeft /></Button>
    <ol className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
      {lab.slides.map((item) => <li key={item.index} className="shrink-0">
        <button type="button" aria-current={item.index === slide ? 'true' : undefined} aria-label={`${t.stage.openSlide(item.index + 1)} · ${types[item.type]}`} onClick={() => onSlide(item.index)}
          className={cn('block w-16 overflow-hidden rounded-md border bg-surface-inset focus-ring md:w-24', item.index === slide ? 'border-primary ring-2 ring-primary' : 'border-border')}>
          {item.render ? <Image unoptimized src={item.render.url} alt="" width={item.render.width} height={item.render.height} sizes="96px" className="block aspect-[4/5] h-auto w-full"
            onLoad={() => onLoaded(item.render!.url, true)} onError={() => onLoaded(item.render!.url, false)} />
            : <span className="flex aspect-[4/5] items-center justify-center p-1 text-center text-[10px] text-foreground-muted">{item.index + 1}</span>}
        </button>
      </li>)}
    </ol>
    <Button type="button" variant="outline" size="icon-sm" aria-label={t.stage.next} disabled={slide >= total - 1} onClick={() => onSlide(slide + 1)}><ChevronRight /></Button>
  </nav>;
}
