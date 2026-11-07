'use client';

import { useId, useState } from 'react';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { dneskaiToday } from '@/lib/i18n/sections/dneskai-today';
import { dneskaiPlanDayCounts, dneskaiPlanDays, type DneskaiPlanChannel, type DneskaiPlanRead, type DneskaiPlanSlot } from '@/lib/marketing/dneskai-plan-view';
import { DNESKAI_PLAN_STATUS_TONES, dneskaiPlanRelativeDay, dneskaiPlanTextIsLong } from '@/lib/marketing/dneskai-plan-client';
import { cn } from '@/lib/utils';
import { DneskaiCodeText } from './code-text';
import { TabHeader } from './tab-header';

type Lang = 'en' | 'cs';
type Network = 'instagram' | 'threads';
/** What a 30-day plan read is while it loads beside the two-day read. */
export type DneskaiPlanMonth = DneskaiPlanRead | 'loading' | 'unavailable';

/** Switches the workspace to the Design Lab with this post open (the Lab reads `labPost` when it mounts). */
function openInLab(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('projectTab', 'dneskai-review'); url.searchParams.set('labPost', id); url.searchParams.set('labSlide', '0');
  window.history.replaceState(window.history.state, '', url); window.dispatchEvent(new Event('project-tab'));
}

/** „Dnes · sobota 7. 11.“ / „Today · Saturday 7 Nov“: the date is already a Prague day, so it is formatted in UTC. */
function dayName(date: string, lang: Lang): string {
  const at = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { weekday: 'long', timeZone: 'UTC' }).format(at);
  return lang === 'cs' ? `${weekday} ${at.getUTCDate()}. ${at.getUTCMonth() + 1}.` : `${weekday} ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(at)}`;
}

function PlanStatus({ slot, lang }: { slot: Pick<DneskaiPlanSlot, 'status'>; lang: Lang }) {
  return <StatusBadge value={`dneskai-plan-${slot.status}`} label={dneskaiToday[lang].statuses[slot.status]} tone={DNESKAI_PLAN_STATUS_TONES[slot.status]} className="shrink-0" />;
}

/** The networks a slot posts to, as short marks with their full names for assistive technology. */
function NetworkMarks({ slot, lang, short = false }: { slot: Pick<DneskaiPlanSlot, 'instagram' | 'threads' | 'story'>; lang: Lang; short?: boolean }) {
  const t = dneskaiToday[lang];
  const networks = (['instagram', 'story', 'threads'] as const).filter((network) => slot[network]);
  return <ul className="flex flex-wrap gap-1" aria-label={networks.map((network) => t[network]).join(', ')}>
    {networks.map((network) => <li key={network} className="inline-flex min-h-6 items-center rounded-sm border border-border bg-surface-inset px-1.5 text-[11px] font-medium text-foreground-muted">
      {short ? <><span aria-hidden>{network === 'instagram' ? t.instagramShort : network === 'story' ? t.storyShort : t.threadsShort}</span><span className="sr-only">{t[network]}</span></> : t[network]}
    </li>)}
  </ul>;
}

/** The rendered slides as a feed preview: a strip that scrolls inside its own frame, never the page. */
function SlideStrip({ slot, lang }: { slot: DneskaiPlanSlot; lang: Lang }) {
  const t = dneskaiToday[lang];
  if (slot.slides.length === 0) {
    const note = !slot.instagram ? t.noSlides.textOnly : slot.status === 'planned' ? t.noSlides.planned : slot.status === 'generating' ? t.noSlides.generating : t.noSlides.missing;
    return <p className="rounded-md border border-dashed border-border-strong px-3 py-4 text-xs text-foreground-muted">{note}</p>;
  }
  return <ul role="list" tabIndex={0} aria-label={t.slides(slot.title)} data-testid="dneskai-today-slides"
    className="relative flex w-0 min-w-full snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain rounded-md pb-2 focus-ring">
    {slot.slides.map((slide, index) => <li key={`${slide.url}-${index}`} className="w-36 shrink-0 snap-start sm:w-44">
      <Image unoptimized src={slide.url} alt={slide.alt || t.slide(index + 1, slot.slides.length)} width={slide.width} height={slide.height} loading="lazy" sizes="11rem"
        className="h-auto w-full rounded border border-border bg-surface-inset" />
      <span className="sr-only">{t.slide(index + 1, slot.slides.length)}</span>
    </li>)}
  </ul>;
}

/** One platform's exact text, collapsed to a few lines when it is long. */
function ChannelText({ network, channel, title, lang, waiting }: { network: Network; channel: DneskaiPlanChannel; title: string; lang: Lang; waiting: boolean }) {
  const t = dneskaiToday[lang];
  const [open, setOpen] = useState(false);
  const textId = useId();
  const text = channel.caption?.trim() ? channel.caption : null;
  const long = text ? dneskaiPlanTextIsLong(text) : false;
  return <div className="min-w-0 space-y-1">
    <h5 className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground-muted">
      {network === 'instagram' ? t.instagramText : t.threadsText}
      {waiting && <span className="text-warning">{t.threadsWaiting}</span>}
    </h5>
    {text ? <p id={textId} className={cn('whitespace-pre-wrap break-words text-sm', long && !open && 'line-clamp-5')}>{text}</p>
      : <p className="text-sm text-foreground-muted">{t.noText}</p>}
    {long && <button type="button" aria-expanded={open} aria-controls={textId} onClick={() => setOpen((value) => !value)}
      className="inline-flex min-h-11 items-center rounded text-xs text-information underline focus-ring md:min-h-6">{open ? t.showLess : t.showAll}</button>}
    {channel.errorCode && <DneskaiCodeText code={channel.errorCode} lang={lang} />}
    {channel.remoteUrl && <a href={channel.remoteUrl} target="_blank" rel="noopener noreferrer" aria-label={`${t.view[network]}: ${title}`}
      className="inline-flex min-h-11 items-center gap-1 rounded text-xs text-information underline focus-ring md:min-h-6">{t.view[network]}<ExternalLink className="size-3.5" aria-hidden /></a>}
  </div>;
}

function SlotCard({ slot, read, lang }: { slot: DneskaiPlanSlot; read: DneskaiPlanRead; lang: Lang }) {
  const t = dneskaiToday[lang];
  const titleId = useId();
  return <article aria-labelledby={titleId} data-testid="dneskai-today-slot" data-status={slot.status}
    className={cn('min-w-0 space-y-3 rounded-lg border border-border bg-surface p-3', slot.status === 'skipped' && 'opacity-70')}>
    <div className="flex flex-wrap items-center gap-2">
      <time dateTime={slot.scheduledAt} className="tabular text-base font-semibold">{slot.time}</time>
      <NetworkMarks slot={slot} lang={lang} />
      <span className="text-xs text-foreground-muted">{t.kinds[slot.kind]}</span>
      <span className="ml-auto"><PlanStatus slot={slot} lang={lang} /></span>
    </div>
    <h4 id={titleId} className="break-words text-sm font-semibold">{slot.title}</h4>
    {slot.status === 'failed' && <DneskaiCodeText code={slot.code} lang={lang} />}
    <SlideStrip slot={slot} lang={lang} />
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      {slot.instagram && <ChannelText network="instagram" channel={slot.instagram} title={slot.title} lang={lang} waiting={false} />}
      {slot.threads && <ChannelText network="threads" channel={slot.threads} title={slot.title} lang={lang} waiting={read.accounts.threads === null} />}
    </div>
    {slot.labPostId ? <Button variant="outline" size="sm" className="min-h-11 md:min-h-8" aria-label={t.openLabName(slot.title)} onClick={() => openInLab(slot.labPostId!)}>{t.openLab}</Button>
      : <p className="text-xs text-foreground-muted">{t.noLab}</p>}
  </article>;
}

/** The compact 30-day grid: each day with its slots, each slot with a draft linking to the Lab. */
function MonthPlan({ month, lang }: { month: DneskaiPlanMonth; lang: Lang }) {
  const t = dneskaiToday[lang];
  return <section aria-labelledby="dneskai-plan-title" className="min-w-0 space-y-3" data-testid="dneskai-plan">
    <div><h3 id="dneskai-plan-title" className="text-sm font-semibold">{t.plan.title}</h3><p className="mt-1 text-sm text-foreground-muted">{t.plan.intro}</p></div>
    {month === 'loading' ? <p role="status" className="text-sm text-foreground-muted">{t.plan.loading}</p>
      : month === 'unavailable' ? <p role="alert" className="text-sm text-risk">{t.plan.unavailable}</p>
      : <ol className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">{dneskaiPlanDays(month).map((day) => {
        const counts = dneskaiPlanDayCounts(day.slots);
        const relative = dneskaiPlanRelativeDay(day.date, month.today);
        return <li key={day.date} className="min-w-0 rounded-lg border border-border bg-surface" data-testid="dneskai-plan-day" data-date={day.date}>
          <h4 className="flex flex-wrap items-baseline gap-x-2 border-b border-border px-3 py-2 text-sm font-semibold">
            <span className="first-letter:uppercase">{dayName(day.date, lang)}</span>
            {relative !== 'other' && <span className="text-xs font-normal text-information">{relative === 'today' ? t.today : t.tomorrow}</span>}
            <span className="ml-auto text-xs font-normal tabular text-foreground-muted">{t.counts(counts.instagram, counts.threads)}</span>
          </h4>
          {day.slots.length === 0 ? <p className="px-3 py-2 text-xs text-foreground-muted">{t.plan.free}</p>
            : <ul className="divide-y divide-border">{day.slots.map((slot) => <li key={slot.id} className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1 px-3 py-2">
              <time dateTime={slot.scheduledAt} className="tabular text-xs leading-6">{slot.time}</time>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5"><NetworkMarks slot={slot} lang={lang} short /><PlanStatus slot={slot} lang={lang} /></div>
                <p className={cn('break-words text-sm leading-5', slot.status === 'skipped' && 'text-foreground-muted line-through')}>{slot.title}</p>
                {slot.labPostId && <button type="button" aria-label={t.openLabName(slot.title)} onClick={() => openInLab(slot.labPostId!)}
                  className="inline-flex min-h-11 items-center rounded text-xs text-information underline focus-ring md:min-h-6">{t.openLab}</button>}
              </div>
            </li>)}</ul>}
        </li>;
      })}</ol>}
  </section>;
}

/**
 * „Dnes a zítra“ (owner decision, 7 November 2026): every post that goes out today and tomorrow, at its time and on
 * its networks, with its exact Instagram caption and Threads text and the rendered slides. Each post with a draft
 * opens in the Design Lab, whose queue holds the same two days. The 30-day plan follows below.
 */
export function DneskaiTodayTab({ read, month, lang, preview, refreshing, onRefresh }: {
  read: DneskaiPlanRead; month: DneskaiPlanMonth; lang: Lang; preview: boolean; refreshing: boolean; onRefresh: () => void;
}) {
  const t = dneskaiToday[lang];
  const days = dneskaiPlanDays(read);
  return <section aria-labelledby="dneskai-today-title" className="min-w-0 space-y-6" data-testid="dneskai-today">
    <TabHeader id="dneskai-today-title" title={t.title} intro={t.intro} lang={lang} refreshing={refreshing} onRefresh={onRefresh} preview={preview} />
    {(!read.enabled || read.accounts.threads === null) && <div className="space-y-1">
      {!read.enabled && <p className="border-l-2 border-warning pl-3 text-xs text-foreground" data-testid="dneskai-plan-off">{t.planOff}</p>}
      {read.accounts.threads === null && <p className="border-l-2 border-information pl-3 text-xs text-foreground-muted" data-testid="dneskai-threads-missing">{t.threadsMissing}</p>}
    </div>}
    {days.map((day) => {
      const counts = dneskaiPlanDayCounts(day.slots);
      const relative = dneskaiPlanRelativeDay(day.date, read.today);
      const headingId = `dneskai-today-${day.date}`;
      return <section key={day.date} aria-labelledby={headingId} className="min-w-0 space-y-3" data-testid="dneskai-today-day" data-date={day.date}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2">
          <h3 id={headingId} className="text-sm font-semibold">
            {relative === 'today' ? `${t.today} · ` : relative === 'tomorrow' ? `${t.tomorrow} · ` : ''}{dayName(day.date, lang)}
          </h3>
          <p className="tabular text-xs text-foreground-muted">{t.counts(counts.instagram, counts.threads)}</p>
        </div>
        {day.slots.length === 0 ? <p className="text-sm text-foreground-muted">{t.emptyDay}</p>
          : <ul className="min-w-0 space-y-3">{day.slots.map((slot) => <li key={slot.id} className="min-w-0"><SlotCard slot={slot} read={read} lang={lang} /></li>)}</ul>}
      </section>;
    })}
    <MonthPlan month={month} lang={lang} />
  </section>;
}
