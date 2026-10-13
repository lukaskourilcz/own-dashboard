'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { qk } from '@/lib/queries/keys';
import { dneskaiSources } from '@/lib/i18n/sections/dneskai-sources';
import { loadDneskaiSources, nextDneskaiSourceCheck, sourceExternalUrl } from '@/lib/marketing/dneskai-client';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';
import type { DneskaiCollectionState } from '@/lib/marketing/dneskai-contracts';

type Props = { projectId: string; lang: 'en' | 'cs'; disabled?: boolean; now?: Date };
export function DneskaiSources({ projectId, lang, disabled = false, now = new Date() }: Props) {
  const t = dneskaiSources[lang];
  const query = useQuery({ queryKey: [...qk.dneskaiSources, projectId], enabled: !disabled, retry: false, staleTime: 30000,
    queryFn: ({ signal }) => loadDneskaiSources(projectId, signal) });
  return <section aria-labelledby="dneskai-sources-title" className="min-w-0 space-y-5" data-testid="dneskai-sources">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 id="dneskai-sources-title" className="text-sm font-semibold">{t.title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{t.intro}</p></div>
      <Button variant="outline" className="min-h-11" disabled={disabled || query.isFetching} onClick={() => void query.refetch()}>{t.refresh}</Button></div>
    <div className="space-y-2 border-l-2 border-information pl-3"><p className="text-sm">{t.approval}</p><Link prefetch={false} className="focus-ring inline-flex min-h-11 items-center rounded text-sm text-information underline" href="/marketing">{t.openMarketing}</Link></div>
    {disabled ? <p role="status" className="text-sm text-foreground-muted">{t.preview}</p> : query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p> : query.isError ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p> : query.data ? <DneskaiSourceRecords state={query.data} lang={lang} now={now} /> : null}
  </section>;
}

export function DneskaiSourceRecords({ state, lang, now }: { state: DneskaiCollectionState; lang: 'en' | 'cs'; now: Date }) {
  const t = dneskaiSources[lang]; const today = pragueMarketingDate(now);
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const dateFormat = new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { timeZone: 'Europe/Prague', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dateOnly = (date: string) => new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { timeZone: 'Europe/Prague', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
  const at = (date: string | null) => date ? <time dateTime={date}>{dateFormat.format(new Date(date))}</time> : t.noDate;
  const cost = (amount: number | null) => amount === null ? t.unknownCost : new Intl.NumberFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(amount);
  const status = (value: 'never' | 'ok' | 'partial' | 'error' | 'held' | 'running' | 'complete' | 'failed') => <StatusBadge value={value} label={t[value]} tone={value === 'ok' || value === 'complete' ? 'success' : value === 'error' || value === 'failed' ? 'risk' : value === 'partial' || value === 'held' ? 'warning' : 'neutral'} />;
  const todayChecks = state.sourceStates.filter(value => value.lastAttemptAt && pragueMarketingDate(new Date(value.lastAttemptAt)) === today);
  const tomorrowRun = state.runs.find(run => run.targetDate === tomorrow);
  const selected = state.candidates.filter(candidate => candidate.status === 'selected' && candidate.targetDate === tomorrow).slice(0, 4);
  const unassociated = state.candidates.some(candidate => candidate.status === 'selected' && candidate.targetDate === null);
  const sourceName = (id: string) => state.sources.find(source => source.id === id)?.name ?? t.sourceUnknown;
  return <>
    <div className="space-y-2 border-t border-border pt-4"><StatusBadge value={state.enabled ? 'active' : 'held'} label={state.enabled ? t.enabled : t.disabled} tone={state.enabled ? 'information' : 'warning'} />
      {state.blockers.length > 0 && <div role="status"><h3 className="text-sm font-medium">{t.configuration}</h3><ul className="list-inside list-disc text-sm text-foreground-muted">{state.blockers.map((code, index) => <li key={`${code}-${index}`}>{t.blockers[code] ?? t.configuration}</li>)}</ul></div>}</div>
    <section aria-labelledby="dneskai-tomorrow-title" className="space-y-2"><h3 id="dneskai-tomorrow-title" className="text-sm font-semibold">{t.nextTopics} · {dateOnly(tomorrow)}</h3>
      <p className="text-sm text-foreground-muted">{tomorrowRun && <>{status(tomorrowRun.status)} · </>}{t.selectedCount}: {selected.length} / 4</p>
      {unassociated && <p className="text-xs text-foreground-muted">{t.pendingTopics}</p>}
      {selected.length === 0 ? <p className="text-sm text-foreground-muted">{t.noTopics}</p> : <ol className="divide-y divide-border">{selected.map(candidate => {
        const url = sourceExternalUrl(candidate.url);
        return <li key={candidate.id} className="min-w-0 space-y-1 py-3"><p className="break-words text-sm font-medium">{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded underline">{candidate.title || t.unnamed}</a> : candidate.title || t.unnamed}</p><p className="text-xs text-foreground-muted">{sourceName(candidate.sourceId)} · {t.unpublished}</p><p className="text-xs text-foreground-muted">{candidate.publishedAt ? <>{t.publishedAt}: {at(candidate.publishedAt)}</> : t.unknownPublished}</p></li>;
      })}</ol>}</section>
    <section aria-labelledby="dneskai-checks-title" className="space-y-2"><h3 id="dneskai-checks-title" className="text-sm font-semibold">{t.today} · {dateOnly(today)}</h3>
      {todayChecks.length === 0 ? <p className="text-sm text-foreground-muted">{t.noChecks}</p> : <ul className="divide-y divide-border">{todayChecks.map(value => <li key={value.sourceId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span className="min-w-0 break-words">{sourceName(value.sourceId)}</span><span>{status(value.status)} · {at(value.lastAttemptAt)}</span></li>)}</ul>}</section>
    <section aria-labelledby="dneskai-registry-title"><h3 id="dneskai-registry-title" className="mb-2 text-sm font-semibold">{t.registry}</h3>
      {state.sources.length === 0 ? <EmptyState align="start" title={t.empty} /> : <ul className="divide-y divide-border border-y border-border">{state.sources.map(source => {
        const value = state.sourceStates.find(item => item.sourceId === source.id); const url = sourceExternalUrl(source.url);
        return <li key={source.id} className="min-w-0 space-y-2 py-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-semibold">{url ? <a className="focus-ring rounded underline" href={url} target="_blank" rel="noopener noreferrer">{source.name}</a> : source.name}</p><p className="text-xs text-foreground-muted">{t.kinds[source.kind]} · {t.days}: {[...source.weekdays].sort((a, b) => a - b).map(day => t.weekdays[day]).join(', ')}</p></div>{status(value?.status ?? 'never')}</div>
          <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
            <div><dt className="text-foreground-muted">{t.planned}</dt><dd className="tabular">{state.enabled ? at(nextDneskaiSourceCheck(source, now)) : t.notScheduled}</dd></div>
            <div><dt className="text-foreground-muted">{t.attempt}</dt><dd className="tabular">{at(value?.lastAttemptAt ?? null)}</dd></div>
            <div><dt className="text-foreground-muted">{t.success}</dt><dd className="tabular">{at(value?.lastSuccessAt ?? null)}</dd></div>
            <div><dt className="text-foreground-muted">{t.count}</dt><dd className="tabular">{value ? value.itemCount : t.noDate}</dd></div>
            <div><dt className="text-foreground-muted">{t.cost}</dt><dd className="tabular">{cost(value?.costUsd ?? null)}</dd></div>
          </dl>{value?.errorCode && <p className="text-xs text-risk">{t.blockers[value.errorCode] ?? t.errorDetail}</p>}
        </li>;
      })}</ul>}</section>
    <section aria-labelledby="dneskai-runs-title" className="space-y-2"><h3 id="dneskai-runs-title" className="text-sm font-semibold">{t.runs}</h3>
      {state.runs.length === 0 ? <p className="text-sm text-foreground-muted">{t.noRuns}</p> : <ul className="divide-y divide-border">{state.runs.map(run => <li key={run.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"><div><p>{t.runDate}: {dateOnly(run.date)} · {t.targetDate}: {dateOnly(run.targetDate)}</p><p className="text-xs text-foreground-muted">{t.selectedCount}: {run.selectedCount} / 4 · {t.cost}: {cost(run.costUsd)}</p>{run.errorCode && <p className="text-xs text-risk">{t.blockers[run.errorCode] ?? t.errorDetail}</p>}</div>{status(run.status)}</li>)}</ul>}</section>
  </>;
}
