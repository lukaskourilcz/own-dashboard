'use client';

import { useId, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { qk } from '@/lib/queries/keys';
import { dneskaiSources } from '@/lib/i18n/sections/dneskai-sources';
import { DneskaiRecoveryRequestError, loadDneskaiSources, nextDneskaiSourceCheck, postDneskaiRecovery, sourceExternalUrl, type DneskaiRecoveryRequest } from '@/lib/marketing/dneskai-client';
import { DNESKAI_HELD_GROUPS, DNESKAI_OWNER_CODES, DNESKAI_RECOVERY_OFF, dneskaiBriefActions, dneskaiHeldGroup, dneskaiHeldReleaseBlock } from '@/lib/marketing/dneskai-recovery-rules';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';
import type { DneskaiCollectionState, DneskaiEventSelection, DneskaiEventView } from '@/lib/marketing/dneskai-contracts';

/** Provider codes can be any string; inherited object members are never localized text. */
const ownText = (dictionary: Record<string, string>, code: string): string | undefined => Object.hasOwn(dictionary, code) ? dictionary[code] : undefined;

/** `onOpenReview` switches the project workspace to „Dnes ke schválení“, where the final review happens. */
type Props = { projectId: string; lang: 'en' | 'cs'; onOpenReview: () => void; disabled?: boolean; now?: Date };
export function DneskaiSources({ projectId, lang, onOpenReview, disabled = false, now = new Date() }: Props) {
  const t = dneskaiSources[lang];
  const query = useQuery({ queryKey: [...qk.dneskaiSources, projectId], enabled: !disabled, retry: false, staleTime: 30000,
    queryFn: ({ signal }) => loadDneskaiSources(projectId, signal) });
  return <section aria-labelledby="dneskai-sources-title" className="min-w-0 space-y-5" data-testid="dneskai-sources">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 id="dneskai-sources-title" className="text-sm font-semibold">{t.title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{t.intro}</p></div>
      <Button variant="outline" className="min-h-11" disabled={disabled || query.isFetching} onClick={() => void query.refetch()}>{t.refresh}</Button></div>
    <div className="space-y-2 border-l-2 border-information pl-3"><p className="text-sm">{t.approval}</p><button type="button" className="focus-ring inline-flex min-h-11 items-center rounded text-sm text-information underline" onClick={onOpenReview}>{t.openReview}</button></div>
    {disabled ? <p role="status" className="text-sm text-foreground-muted">{t.preview}</p> : query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p> : query.isError ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p> : query.data ? <DneskaiSourceRecords state={query.data} lang={lang} now={now} recovery={{ projectId }} /> : null}
  </section>;
}

/** A capped read is normal: the cursor moves on (docs/dneskai-native-feeds.md). It informs, it does not warn. */
const INFORMATIONAL_SOURCE_CODES = new Set(['collection-source-item-cap']);

/** `recovery` enables the owner recovery actions (C3, briefs-07); without it the records stay read-only. */
export function DneskaiSourceRecords({ state, lang, now, recovery }: { state: DneskaiCollectionState; lang: 'en' | 'cs'; now: Date; recovery?: { projectId: string } }) {
  const t = dneskaiSources[lang]; const today = pragueMarketingDate(now); const r = t.recovery;
  const capabilities = state.recovery ?? DNESKAI_RECOVERY_OFF;
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const dateFormat = new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { timeZone: 'Europe/Prague', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dateOnly = (date: string) => new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { timeZone: 'Europe/Prague', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
  const at = (date: string | null) => date ? <time dateTime={date}>{dateFormat.format(new Date(date))}</time> : t.noDate;
  // An estimated publication date is an upper bound (see docs/dneskai-native-feeds.md) and says so in words.
  const published = (date: string | null, estimated?: boolean) => date ? <>{at(date)}{estimated && <> ({t.estimated})</>}</> : t.unknownPublished;
  const latest = <K extends 'publishedAt' | 'fetchedAt'>(sourceId: string, key: K) => state.candidates.filter(candidate => candidate.sourceId === sourceId && candidate[key])
    .reduce<DneskaiCollectionState['candidates'][number] | null>((best, candidate) => !best || Date.parse(String(candidate[key])) > Date.parse(String(best[key])) ? candidate : best, null);
  const cost = (amount: number | null) => amount === null ? t.unknownCost : new Intl.NumberFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(amount);
  const status = (value: 'never' | 'ok' | 'partial' | 'error' | 'held' | 'running' | 'complete' | 'failed') => <StatusBadge value={value} label={t[value]} tone={value === 'ok' || value === 'complete' ? 'success' : value === 'error' || value === 'failed' ? 'risk' : value === 'partial' || value === 'held' ? 'warning' : 'neutral'} />;
  const todayChecks = state.sourceStates.filter(value => value.lastAttemptAt && pragueMarketingDate(new Date(value.lastAttemptAt)) === today);
  const topicDays = [{ id: 'today', date: today, title: t.todayTopics, empty: t.noTodayTopics }, { id: 'tomorrow', date: tomorrow, title: t.nextTopics, empty: t.noTopics }];
  const unassociated = state.candidates.some(candidate => candidate.status === 'selected' && candidate.targetDate === null);
  const sourceName = (id: string) => state.sources.find(source => source.id === id)?.name ?? t.sourceUnknown;
  // Events (#115) replace the flat topic list when the server sends them; older responses keep the candidate list.
  const events = state.events;
  const link = (member: { url: string; title: string }) => { const url = sourceExternalUrl(member.url); return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded underline">{member.title || t.unnamed}</a> : member.title || t.unnamed; };
  const reasonText = (code: string | null) => code ? ownText(t.eventReasons, code) ?? ownText(t.blockers, code) ?? t.reasonUnknown : null;
  const briefLabel = (brief: NonNullable<DneskaiEventView['brief']>) => brief.status === 'queued' ? t.briefQueued : brief.status === 'ready' ? (brief.code ? [t.briefRetry, ownText(t.eventReasons, brief.code)].filter(Boolean).join(' · ') : t.briefReady)
    : brief.status === 'pending' ? (brief.code === 'account-unavailable' ? t.briefAccount : brief.code && DNESKAI_OWNER_CODES.has(brief.code) ? r.briefOwner : t.briefMedia) : reasonText(brief.code) ?? t.reasonUnknown;
  // Owner actions on a dead-end brief: retry, reslot, release. „Generate now“ for a waiting brief lives in the Lab day column.
  const briefControls = (event: DneskaiEventView) => {
    if (!recovery || !event.brief) return null;
    const title = event.members[0].title || t.unnamed;
    const actions = dneskaiBriefActions(event.brief, capabilities, now).map(item => ({ key: item.action, label: r[item.action], name: `${r[item.action]}: ${title}`, available: item.available, reason: item.reason,
      request: { action: item.action, briefId: event.brief!.id } as DneskaiRecoveryRequest, done: r.done[item.action] }));
    return <RecoveryControls actions={actions} lang={lang} />;
  };
  const held = state.candidates.filter(candidate => candidate.status === 'held');
  const eventItem = (event: DneskaiEventView) => {
    const [primary, ...supporting] = event.members;
    return <li key={event.eventId} className="min-w-0 space-y-1 py-3">
      <p className="break-words text-sm font-medium">{link(primary)}</p>
      <p className="text-xs text-foreground-muted">{sourceName(primary.sourceId)} · {t.primarySource} · {t.unpublished}</p>
      {event.brief && <p className="text-xs text-foreground-muted">{briefLabel(event.brief)}{event.brief.scheduledAt && <> · {t.slot}: {at(event.brief.scheduledAt)}</>}</p>}
      {briefControls(event)}
      {supporting.length > 0 && <ul aria-label={t.supportingReports} className="mt-1 space-y-1 border-l border-border pl-3">{supporting.map(member => <li key={member.candidateId} className="break-words text-xs text-foreground-muted">{sourceName(member.sourceId)}: {link(member)}</li>)}</ul>}
    </li>;
  };
  const otherEvents = (events ?? []).filter(event => event.status !== 'selected');
  const eventTone = (status: DneskaiEventView['status']) => status === 'held' ? 'warning' as const : status === 'selected' ? 'information' as const : 'neutral' as const;
  return <>
    <div className="space-y-2 border-t border-border pt-4"><StatusBadge value={state.enabled ? 'active' : 'held'} label={state.enabled ? t.enabled : t.disabled} tone={state.enabled ? 'information' : 'warning'} />
      {state.blockers.length > 0 && <div role="status"><h3 className="text-sm font-medium">{t.configuration}</h3><ul className="list-inside list-disc text-sm text-foreground-muted">{state.blockers.map((code, index) => <li key={`${code}-${index}`}>{ownText(t.blockers, code) ?? t.configuration}</li>)}</ul></div>}</div>
    {unassociated && <p className="text-xs text-foreground-muted">{t.pendingTopics}</p>}
    <div className="grid min-w-0 gap-5 md:grid-cols-2">{topicDays.map(day => {
      const selected = state.candidates.filter(candidate => candidate.status === 'selected' && candidate.targetDate === day.date).slice(0, 4);
      const dayEvents = events?.filter(event => event.status === 'selected' && event.brief && event.targetDate === day.date).sort((a, b) => a.brief!.rank - b.brief!.rank).slice(0, 4);
      const run = state.runs.find(run => run.targetDate === day.date);
      const count = dayEvents ? dayEvents.length : selected.length;
      return <section key={day.id} aria-labelledby={`dneskai-${day.id}-title`} className="min-w-0 space-y-2 border-t border-border pt-3"><h3 id={`dneskai-${day.id}-title`} className="text-sm font-semibold">{day.title} · {dateOnly(day.date)}</h3>
      <p className="text-sm text-foreground-muted">{run && <>{status(run.status)} · </>}{t.selectedCount}: {count} / 4</p>
      {count === 0 ? <p className="text-sm text-foreground-muted">{day.empty}</p> : dayEvents ? <ol className="divide-y divide-border">{dayEvents.map(eventItem)}</ol> : <ol className="divide-y divide-border">{selected.map(candidate => {
        const url = sourceExternalUrl(candidate.url);
        return <li key={candidate.id} className="min-w-0 space-y-1 py-3"><p className="break-words text-sm font-medium">{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded underline">{candidate.title || t.unnamed}</a> : candidate.title || t.unnamed}</p><p className="text-xs text-foreground-muted">{sourceName(candidate.sourceId)} · {t.unpublished}</p><p className="flex flex-wrap gap-x-3 text-xs text-foreground-muted"><span>{candidate.publishedAt ? <>{t.publishedAt}: {published(candidate.publishedAt, candidate.dateEstimated)}</> : t.unknownPublished}</span><span>{t.importedAt}: {at(candidate.fetchedAt)}</span></p></li>;
      })}</ol>}</section>;
    })}</div>
    {events && <section aria-labelledby="dneskai-events-title" className="space-y-2"><h3 id="dneskai-events-title" className="text-sm font-semibold">{t.otherEvents}</h3>
      {otherEvents.length === 0 ? <p className="text-sm text-foreground-muted">{t.noOtherEvents}</p> : <ul className="divide-y divide-border">{otherEvents.map(event => <li key={event.eventId} className="min-w-0 space-y-1 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words text-sm">{link(event.members[0])}</p><StatusBadge value={event.status} label={t.eventStatus[event.status]} tone={eventTone(event.status)} /></div>
        <p className="text-xs text-foreground-muted">{sourceName(event.members[0].sourceId)} · {t.reports}: {event.members.length}{reasonText(event.reason) && <> · {reasonText(event.reason)}</>}</p>
        {event.selection && <SelectionFacts selection={event.selection} lang={lang} now={now} published={published} />}
        {briefControls(event)}
      </li>)}</ul>}</section>}
    <section aria-labelledby="dneskai-held-title" className="space-y-2"><h3 id="dneskai-held-title" className="text-sm font-semibold">{r.heldTitle} · <span className="tabular">{held.length}</span></h3>
      <p className="max-w-3xl text-xs text-foreground-muted">{r.heldIntro}{state.candidates.length >= 200 && <> {r.heldShown}</>}</p>
      {held.length === 0 ? <p className="text-sm text-foreground-muted">{r.noHeld}</p> : <div className="border-b border-border">{DNESKAI_HELD_GROUPS.map(group => {
        const items = held.filter(candidate => dneskaiHeldGroup(candidate.reason) === group);
        return items.length === 0 ? null : <details key={group} className="border-t border-border" data-held-group={group}>
          <summary className="focus-ring flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded text-sm font-medium"><span>{r.heldGroups[group]}</span><span className="tabular text-foreground-muted">{items.length}</span></summary>
          <ul className="divide-y divide-border pb-2">{items.map(candidate => {
            const block = capabilities.heldRelease ? dneskaiHeldReleaseBlock(candidate, now) : 'recovery-held-release-unavailable';
            return <li key={candidate.id} className="min-w-0 space-y-1 py-3">
              <p className="break-words text-sm">{link(candidate)}</p>
              <p className="text-xs text-foreground-muted">{sourceName(candidate.sourceId)} · {reasonText(candidate.reason) ?? t.reasonUnknown} · {t.published}: {published(candidate.publishedAt, candidate.dateEstimated)}</p>
              {recovery && <RecoveryControls lang={lang} actions={[{ key: 'held', label: r.reReview, name: `${r.reReview}: ${candidate.title || t.unnamed}`, available: block === null, reason: block,
                request: { action: 'release', projectId: recovery.projectId, candidateId: candidate.id }, done: r.done.held }]} />}
            </li>;
          })}</ul>
        </details>;
      })}</div>}
    </section>
    <section aria-labelledby="dneskai-checks-title" className="space-y-2"><h3 id="dneskai-checks-title" className="text-sm font-semibold">{t.today} · {dateOnly(today)}</h3>
      {todayChecks.length === 0 ? <p className="text-sm text-foreground-muted">{t.noChecks}</p> : <ul className="divide-y divide-border">{todayChecks.map(value => <li key={value.sourceId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span className="min-w-0 break-words">{sourceName(value.sourceId)}</span><span>{status(value.status)} · {at(value.lastAttemptAt)}</span></li>)}</ul>}</section>
    <section aria-labelledby="dneskai-registry-title"><h3 id="dneskai-registry-title" className="mb-2 text-sm font-semibold">{t.registry}</h3>
      {state.sources.length === 0 ? <EmptyState align="start" title={t.empty} /> : <ul className="divide-y divide-border border-y border-border">{state.sources.map(source => {
        const value = state.sourceStates.find(item => item.sourceId === source.id); const url = sourceExternalUrl(source.url);
        const newest = latest(source.id, 'publishedAt'), imported = latest(source.id, 'fetchedAt');
        return <li key={source.id} className="min-w-0 space-y-2 py-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-semibold">{url ? <a className="focus-ring rounded underline" href={url} target="_blank" rel="noopener noreferrer">{source.name}</a> : source.name}</p><p className="text-xs text-foreground-muted">{t.kinds[source.kind]} · {t.days}: {[...source.weekdays].sort((a, b) => a - b).map(day => t.weekdays[day]).join(', ')}</p></div>{status(value?.status ?? 'never')}</div>
          <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
            <div><dt className="text-foreground-muted">{t.planned}</dt><dd className="tabular">{state.enabled ? at(nextDneskaiSourceCheck(source, now)) : t.notScheduled}</dd></div>
            <div><dt className="text-foreground-muted">{t.attempt}</dt><dd className="tabular">{at(value?.lastAttemptAt ?? null)}</dd></div>
            <div><dt className="text-foreground-muted">{t.success}</dt><dd className="tabular">{at(value?.lastSuccessAt ?? null)}</dd></div>
            <div><dt className="text-foreground-muted">{t.newestPublished}</dt><dd className="tabular">{newest ? published(newest.publishedAt, newest.dateEstimated) : t.noDate}</dd></div>
            <div><dt className="text-foreground-muted">{t.lastImport}</dt><dd className="tabular">{at(imported?.fetchedAt ?? null)}</dd></div>
            <div><dt className="text-foreground-muted">{t.count}</dt><dd className="tabular">{value ? value.itemCount : t.noDate}</dd></div>
            <div><dt className="text-foreground-muted">{t.cost}</dt><dd className="tabular">{cost(value?.costUsd ?? null)}</dd></div>
          </dl>{value?.errorCode && <p className={`text-xs ${INFORMATIONAL_SOURCE_CODES.has(value.errorCode) ? 'text-foreground-muted' : 'text-risk'}`}>{ownText(t.blockers, value.errorCode) ?? t.errorDetail}</p>}
        </li>;
      })}</ul>}</section>
    <section aria-labelledby="dneskai-runs-title" className="space-y-2"><h3 id="dneskai-runs-title" className="text-sm font-semibold">{t.runs}</h3>
      {state.runs.length === 0 ? <p className="text-sm text-foreground-muted">{t.noRuns}</p> : <ul className="divide-y divide-border">{state.runs.map(run => <li key={run.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"><div><p>{t.runDate}: {dateOnly(run.date)} · {t.targetDate}: {dateOnly(run.targetDate)}</p><p className="text-xs text-foreground-muted">{t.selectedCount}: {run.selectedCount} / 4 · {t.cost}: {cost(run.costUsd)}</p>{run.errorCode && <p className="text-xs text-risk">{ownText(t.blockers, run.errorCode) ?? t.errorDetail}</p>}</div>{status(run.status)}</li>)}</ul>}</section>
  </>;
}

/**
 * SEL-05: the stored facts behind an unselected event (topic, relevance, publication age) and, for an open event,
 * the first selection rule it fails. A missing value says so; it is never shown as zero.
 */
function SelectionFacts({ selection, lang, now, published }: { selection: DneskaiEventSelection; lang: 'en' | 'cs'; now: Date; published: (date: string | null, estimated?: boolean) => ReactNode }) {
  const t = dneskaiSources[lang];
  const locale = lang === 'cs' ? 'cs-CZ' : 'en-GB';
  const relevance = selection.relevance === null ? t.noDate : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(selection.relevance);
  const hours = selection.publishedAt ? (now.getTime() - Date.parse(selection.publishedAt)) / 3600000 : null;
  const age = hours === null || hours < 0 ? null : new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-(hours < 48 ? Math.round(hours) : Math.round(hours / 24)), hours < 48 ? 'hour' : 'day');
  return <div className="space-y-1">
    <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground-muted">
      <div className="flex gap-1"><dt>{t.category}:</dt><dd>{selection.category ? t.categories[selection.category] : t.unclassified}</dd></div>
      <div className="flex gap-1"><dt>{t.relevance}:</dt><dd className="tabular">{relevance}</dd></div>
      <div className="flex gap-1"><dt>{t.published}:</dt><dd className="tabular">{selection.publishedAt ? <>{published(selection.publishedAt, selection.dateEstimated)}{age && <> · {age}</>}</> : t.unknownPublished}</dd></div>
    </dl>
    {selection.code && <p className="text-xs"><span className="font-medium">{t.whyNot}:</span> {t.selectionReasons[selection.code]}</p>}
  </div>;
}

type RecoveryAction = { key: string; label: string; name: string; available: boolean; reason: string | null; request: DneskaiRecoveryRequest; done: string };
/**
 * One row of owner recovery buttons. A disabled action names its reason in text, linked to the button; the outcome
 * is announced in a polite status region. A refusal shows only its localized code.
 */
function RecoveryControls({ actions, lang }: { actions: RecoveryAction[]; lang: 'en' | 'cs' }) {
  const t = dneskaiSources[lang]; const r = t.recovery; const client = useQueryClient(); const id = useId();
  const mutation = useMutation({ mutationFn: (action: RecoveryAction) => postDneskaiRecovery(action.request), onSuccess: () => client.invalidateQueries({ queryKey: qk.dneskaiSources }) });
  if (!actions.length) return null;
  const code = mutation.error instanceof DneskaiRecoveryRequestError ? mutation.error.code : 'recovery-unavailable';
  const message = mutation.isSuccess ? mutation.variables.done : mutation.isError ? ownText(r.reasons, code) ?? ownText(t.eventReasons, code) ?? r.reasons['recovery-unavailable'] : '';
  return <div className="space-y-1 pt-1">
    <div className="flex flex-wrap gap-2">{actions.map(action => <Button key={action.key} type="button" variant="outline" size="sm" className="min-h-11" aria-label={action.name}
      aria-describedby={action.reason ? `${id}-${action.key}` : undefined} disabled={!action.available || mutation.isPending || mutation.isSuccess} onClick={() => mutation.mutate(action)}>
      {mutation.isPending && mutation.variables?.key === action.key ? r.working : action.label}</Button>)}</div>
    {actions.filter(action => action.reason).map(action => <p key={action.key} id={`${id}-${action.key}`} className="text-xs text-foreground-muted">{ownText(r.reasons, action.reason!) ?? r.reasons['recovery-unavailable']}</p>)}
    <p role="status" className={`text-xs ${mutation.isError ? 'text-risk' : 'text-foreground-muted'}`}>{message}</p>
  </div>;
}
