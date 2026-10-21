'use client';

import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiCalendarDays, pragueDstDay, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { cn } from '@/lib/utils';
import { DneskaiStateChip } from './state-chip';
import { DneskaiCodeText } from './code-text';
import { TabHeader } from './review-tab';

type Lang = 'en' | 'cs';

/** The next seven Prague days, each slot with what is planned in it and its state (#119). */
export function DneskaiCalendarTab({ read, lang, preview, refreshing, onRefresh }: { read: DneskaiWorkspaceRead; lang: Lang; preview: boolean; refreshing: boolean; onRefresh: () => void }) {
  const t = dneskaiWorkspace[lang];
  const days = dneskaiCalendarDays(read);
  const dayName = (date: string) => new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  return <section aria-labelledby="dneskai-calendar-title" className="min-w-0 space-y-5" data-testid="dneskai-calendar">
    <TabHeader id="dneskai-calendar-title" title={t.calendar.title} intro={t.calendar.intro} lang={lang} refreshing={refreshing} onRefresh={onRefresh} preview={preview} />
    <ol className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">{days.map((day) => <li key={day.date} className="min-w-0 rounded-lg border border-border bg-surface" data-testid="dneskai-calendar-day" data-date={day.date}>
      <h3 className="flex flex-wrap items-baseline gap-2 border-b border-border px-3 py-2 text-sm font-semibold">
        <span className="first-letter:uppercase">{dayName(day.date)}</span>{day.date === read.today && <span className="text-xs font-normal text-information">{t.calendar.today}</span>}
      </h3>
      {pragueDstDay(day.date) && <p className="border-b border-border px-3 py-1.5 text-xs text-warning">{t.calendar.dst}</p>}
      <ul className="divide-y divide-border">{day.entries.map((entry) => <li key={`${entry.kind}-${entry.at}-${entry.kind === 'post' ? entry.post.id : entry.kind === 'job' ? entry.job.id : ''}`}
        className={cn('grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1 px-3 py-2 text-sm', entry.kind === 'free' && 'text-foreground-muted')}>
        <time dateTime={entry.at} className="tabular text-xs leading-5">{entry.time}</time>
        {entry.kind === 'free' ? <span className="text-xs leading-5">{t.calendar.free}</span> : <div className="min-w-0 space-y-1">
          <p className="break-words text-sm leading-5">{entry.kind === 'post' ? entry.post.title : entry.job.title || t.calendar.job}</p>
          <DneskaiStateChip detail={entry.state} lang={lang} />
          {entry.state.state === 'problem' && <DneskaiCodeText code={entry.state.code} lang={lang} />}
        </div>}
      </li>)}</ul>
    </li>)}</ol>
  </section>;
}
