'use client';

import { ExternalLink } from 'lucide-react';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiCalendarDays, formatDneskaiDay, pragueDstDay, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { cn } from '@/lib/utils';
import { DneskaiStateChip } from './state-chip';
import { DneskaiCodeText } from './code-text';
import { TabHeader } from './tab-header';

type Lang = 'en' | 'cs';

/** The next seven Prague days, each slot with what is planned in it and its state (#119). */
export function DneskaiCalendarTab({ read, lang, preview, refreshing, onRefresh, renderFailed }: { read: DneskaiWorkspaceRead; lang: Lang; preview: boolean; refreshing: boolean; onRefresh: () => void; renderFailed?: ReadonlySet<string> }) {
  const t = dneskaiWorkspace[lang];
  const days = dneskaiCalendarDays(read, renderFailed);
  const dayName = (date: string) => `${new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))} ${formatDneskaiDay(date)}`;
  return <section aria-labelledby="dneskai-calendar-title" className="min-w-0 space-y-5" data-testid="dneskai-calendar">
    <TabHeader focusable id="dneskai-calendar-title" title={t.calendar.title} intro={t.calendar.intro} lang={lang} refreshing={refreshing} onRefresh={onRefresh} preview={preview} unreadable={read.unreadable} />
    <ol className="grid min-w-0 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{days.map((day) => <li key={day.date} className="min-w-0 rounded-lg border border-border bg-surface" data-testid="dneskai-calendar-day" data-date={day.date}>
      <h3 className="flex flex-wrap items-baseline gap-2 border-b border-border px-3 py-2 text-sm font-semibold">
        <span className="first-letter:uppercase">{dayName(day.date)}</span>{day.date === read.today && <span className="text-xs font-normal text-information">{t.calendar.today}</span>}
      </h3>
      {pragueDstDay(day.date) && <p className="border-b border-border px-3 py-1.5 text-xs text-warning">{t.calendar.dst}</p>}
      <ul className="divide-y divide-border">{day.entries.map((entry) => <li key={`${entry.kind}-${entry.at}-${entry.kind === 'post' ? entry.post.id : entry.kind === 'job' ? entry.job.id : entry.kind === 'waiting' ? entry.brief.briefId : ''}`}
        className={cn('grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1 px-3 py-2 text-sm', entry.kind === 'free' && 'text-foreground-muted')}>
        <time dateTime={entry.at} className="tabular text-xs leading-5">{entry.time}</time>
        {entry.kind === 'free' ? <span className="text-xs leading-5">{read.calendarComplete === true && read.unreadable === 0 ? t.calendar.free : t.calendar.unknown}</span> : <div className="min-w-0 space-y-1">
          <p className="break-words text-sm leading-5">{entry.kind === 'post' ? entry.post.title : entry.kind === 'waiting' ? entry.brief.title : entry.job.title || t.calendar.job}</p>
          <DneskaiStateChip detail={entry.state} lang={lang} />
          {entry.kind === 'post' && entry.state.state === 'published' && entry.post.publication?.remoteUrl && <a href={entry.post.publication.remoteUrl} target="_blank" rel="noopener noreferrer"
            aria-label={`${t.published.open}: ${entry.post.title}`} className="inline-flex min-h-11 items-center gap-1 rounded text-xs text-information underline focus-ring md:min-h-6">{t.published.open}<ExternalLink className="size-3.5" aria-hidden /></a>}
          {entry.state.state === 'problem' && <DneskaiCodeText compact code={entry.state.code} lang={lang} />}
          {entry.kind === 'waiting' && entry.brief.code && <DneskaiCodeText compact code={entry.brief.code} lang={lang} />}
        </div>}
      </li>)}</ul>
    </li>)}</ol>
  </section>;
}
