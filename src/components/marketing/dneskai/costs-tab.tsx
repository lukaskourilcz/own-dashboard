'use client';

import { useQuery } from '@tanstack/react-query';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/ui/status-badge';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiAccount } from '@/lib/i18n/sections/dneskai-account';
import { marketingTokenState } from '@/lib/marketing/accounts-client';
import { dneskaiWorkspaceApi } from '@/lib/marketing/dneskai-workspace-client';
import { qk } from '@/lib/queries/keys';
import { dneskaiNeedsReview, dneskaiPostState, dneskaiStateContext, type DneskaiCostsRead, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { DneskaiCodeText } from './code-text';
import { DneskaiStateChip } from './state-chip';
import { TabHeader, pragueDateTime } from './review-tab';

type Lang = 'en' | 'cs';

/**
 * „Chyby a náklady“ (#119): the 24-hour generation spend against the daily limit, the Instagram token, cost per day,
 * collection runs, posts waiting for review that cannot be approved, failed or uncertain jobs and publications, and
 * the scheduler's last 24 hours. Read-only.
 */
export function DneskaiCostsTab({ read, review = 'loading', renderFailed, lang, preview, refreshing, onRefresh, now = new Date() }: {
  read: DneskaiCostsRead; review?: DneskaiWorkspaceRead | 'loading' | 'unavailable'; renderFailed?: ReadonlySet<string>; lang: Lang; preview: boolean; refreshing: boolean; onRefresh: () => void; now?: Date;
}) {
  const t = dneskaiWorkspace[lang];
  const usd = (value: number) => new Intl.NumberFormat(lang === 'cs' ? 'cs-CZ' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const day = (date: string) => new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const { spentUsd, ceilingUsd, code } = read.generation;
  const share = spentUsd !== null && ceilingUsd ? Math.min(100, Math.round((spentUsd / ceilingUsd) * 100)) : 0;
  const tone = (status: string) => status === 'complete' ? 'success' as const : status === 'failed' ? 'risk' as const : status === 'running' ? 'information' as const : 'warning' as const;
  return <section aria-labelledby="dneskai-costs-title" className="min-w-0 space-y-6" data-testid="dneskai-costs">
    <TabHeader id="dneskai-costs-title" title={t.costs.title} intro={t.costs.intro} lang={lang} refreshing={refreshing} onRefresh={onRefresh} preview={preview} unreadable={read.unreadable} />
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <section aria-labelledby="dneskai-budget-title" className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-4">
        <h3 id="dneskai-budget-title" className="text-sm font-semibold">{t.costs.budget}</h3>
        {spentUsd !== null && ceilingUsd !== null ? <>
          <p className="text-xl font-semibold tabular">{t.costs.budgetValue(usd(spentUsd), usd(ceilingUsd))}</p>
          <Progress value={share} aria-label={t.costs.budget} aria-valuetext={t.costs.budgetValue(usd(spentUsd), usd(ceilingUsd))} indicatorClassName={share >= 75 ? 'bg-warning' : 'bg-information'} />
          <p className="text-xs text-foreground-muted">{t.costs.budgetLeft(usd(Math.max(0, ceilingUsd - spentUsd)))}</p>
        </> : <p className="text-sm text-warning">{spentUsd === null ? t.costs.budgetUnknown : t.costs.ceilingUnknown}</p>}
        <p className="text-xs text-foreground-muted">{t.costs.budgetBasis}</p>
        {code && <DneskaiCodeText code={code} lang={lang} />}
      </section>
      <TokenSection lang={lang} preview={preview} now={now} />
    </div>

    {/* cost-16: balances are never read, so they show as unknown instead of a number. */}
    <section aria-labelledby="dneskai-balances-title" className="min-w-0 space-y-1" data-testid="dneskai-balances">
      <h3 id="dneskai-balances-title" className="text-sm font-semibold">{t.costs.balances}</h3>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {[t.costs.balanceApify, t.costs.balanceAnthropic].map((label) => <div key={label} className="flex gap-1"><dt className="text-foreground-muted">{label}:</dt><dd className="text-warning">{t.costs.balanceUnknown}</dd></div>)}
      </dl>
      <p className="text-xs text-foreground-muted">{t.costs.balancesHelp}</p>
    </section>

    <section aria-labelledby="dneskai-days-title" className="min-w-0 space-y-2">
      <h3 id="dneskai-days-title" className="text-sm font-semibold">{t.costs.days}</h3>
      <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-surface" role="region" aria-labelledby="dneskai-days-title" tabIndex={0}>
        <table className="w-full min-w-[36rem] text-left text-xs" aria-describedby="dneskai-days-help">
          <thead className="border-b border-border text-foreground-muted"><tr><th scope="col" className="px-3 py-2 font-medium">{t.costs.date}</th><th scope="col" className="px-3 py-2 text-right font-medium">{t.costs.collection}</th><th scope="col" className="px-3 py-2 text-right font-medium">{t.costs.generation}</th><th scope="col" className="px-3 py-2 text-right font-medium">{t.costs.total}</th><th scope="col" className="px-3 py-2 text-right font-medium">{t.costs.booked}</th></tr></thead>
          <tbody className="divide-y divide-border">{read.days.map((row) => <tr key={row.date}>
            <th scope="row" className="px-3 py-2 font-normal">{day(row.date)}{row.unknown > 0 && <span className="block text-warning">{t.costs.unknown(row.unknown)}</span>}</th>
            <td className="px-3 py-2 text-right tabular">{usd(row.collectionUsd)}</td><td className="px-3 py-2 text-right tabular">{usd(row.generationUsd)}</td><td className="px-3 py-2 text-right font-medium tabular">{usd(row.collectionUsd + row.generationUsd)}</td>
            <td className={`px-3 py-2 text-right tabular ${row.generationBookedUsd > 0 ? 'text-warning' : 'text-foreground-muted'}`}>{usd(row.generationBookedUsd)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p id="dneskai-days-help" className="max-w-3xl text-xs text-foreground-muted">{t.costs.daysHelp}</p>
    </section>

    <section aria-labelledby="dneskai-runs-cost-title" className="min-w-0 space-y-2">
      <h3 id="dneskai-runs-cost-title" className="text-sm font-semibold">{t.costs.runs}</h3>
      {read.runs.length === 0 ? <p className="text-sm text-foreground-muted">{t.costs.noRuns}</p> : <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{read.runs.map((run) => <li key={run.id} className="min-w-0 space-y-1 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{day(run.date)} · <span className="text-foreground-muted">{t.costs.runFor(day(run.targetDate))}</span></span>
          <span className="flex items-center gap-2 text-xs"><span className="tabular text-foreground-muted">{t.costs.cost}: {run.costUsd === null ? t.costs.unknownCost : usd(run.costUsd)}</span><StatusBadge value={`run-${run.status}`} label={t.costs.runStatus[run.status] ?? run.status} tone={tone(run.status)} /></span></div>
        {run.errorCode && <DneskaiCodeText code={run.errorCode} lang={lang} tone={run.status === 'failed' ? 'risk' : 'muted'} details={[[t.detailRun, run.id]]} />}
      </li>)}</ul>}
    </section>

    <BlockedPosts review={review} renderFailed={renderFailed} lang={lang} />

    <section aria-labelledby="dneskai-jobs-title" className="min-w-0 space-y-2">
      <h3 id="dneskai-jobs-title" className="text-sm font-semibold">{t.costs.jobs}</h3>
      {read.jobs.length === 0 ? <p className="text-sm text-foreground-muted">{t.costs.noJobs}</p> : <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{read.jobs.map((job) => <li key={job.id} className="min-w-0 space-y-1 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="min-w-0 break-words">{job.title || t.calendar.job}</span>
          <span className="flex items-center gap-2 text-xs text-foreground-muted">{job.scheduledAt && <time dateTime={job.scheduledAt} className="tabular">{pragueDateTime(job.scheduledAt, lang)}</time>}<StatusBadge value={`job-${job.status}`} label={t.costs.jobStatus[job.status] ?? job.status} tone={job.status === 'failed' ? 'risk' : 'warning'} /></span></div>
        <DneskaiCodeText code={job.errorCode} lang={lang} details={[[t.detailJob, job.id], [t.costs.bookedShort, job.costUsd === null ? null : usd(job.costUsd)]]} />
      </li>)}</ul>}
    </section>

    <section aria-labelledby="dneskai-publications-title" className="min-w-0 space-y-2">
      <h3 id="dneskai-publications-title" className="text-sm font-semibold">{t.costs.publications}</h3>
      {read.publications.length === 0 ? <p className="text-sm text-foreground-muted">{t.costs.noPublications}</p> : <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{read.publications.map((publication) => <li key={publication.id} className="min-w-0 space-y-1 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="min-w-0 break-words">{publication.title}</span>
          <span className="flex items-center gap-2 text-xs text-foreground-muted"><time dateTime={publication.scheduledAt} className="tabular">{pragueDateTime(publication.scheduledAt, lang)}</time><StatusBadge value="dneskai-problem" label={t.states.problem} tone="risk" /></span></div>
        <DneskaiCodeText code={publication.errorCode ?? (publication.status === 'reconciliation' ? 'read-only-reconciliation' : 'publishing-failed')} lang={lang} details={[[t.detailPublication, publication.id], [t.detailRevision, publication.revisionId]]} />
      </li>)}</ul>}
    </section>

    <section aria-labelledby="dneskai-ticks-title" className="min-w-0 space-y-2">
      <h3 id="dneskai-ticks-title" className="text-sm font-semibold">{t.costs.ticks}</h3>
      {read.ticks.total === 0 ? <p className="text-sm text-warning">{t.costs.noTicks}</p> : <p className="text-sm">{t.costs.tickSummary(read.ticks.total, read.ticks.withErrors, read.ticks.generationDeferred)}{read.ticks.lastStartedAt && <span className="text-foreground-muted"> · {t.costs.lastTick}: <time dateTime={read.ticks.lastStartedAt} className="tabular">{pragueDateTime(read.ticks.lastStartedAt, lang)}</time></span>}</p>}
      {read.ticks.recent.length > 0 && <>
        <h4 className="text-xs font-semibold text-foreground-muted">{t.costs.recentTicks}</h4>
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{read.ticks.recent.map((tick) => <li key={tick.id} className="min-w-0 space-y-1 px-3 py-2.5 text-xs">
          <p><time dateTime={tick.startedAt} className="tabular">{pragueDateTime(tick.startedAt, lang)}</time> · {t.costs.tickKind[tick.kind]}{!tick.finishedAt && <span className="text-warning"> · {t.costs.unfinished}</span>}</p>
          <p className="text-foreground-muted">{tick.did.map((step) => `${t.costs.steps[step.category] ?? t.costs.otherStep}: ${t.costs.stepStatus[step.status] ?? step.status}`).join(' · ')}</p>
          {tick.errors.map((error, index) => <DneskaiCodeText key={`${error.category}-${index}`} code={error.code} lang={lang} />)}
        </li>)}</ul>
      </>}
    </section>
  </section>;
}

/** Undecided posts in a problem state: a refused render, a render that never attached, a version that cannot be approved. */
function BlockedPosts({ review, renderFailed, lang }: { review: DneskaiWorkspaceRead | 'loading' | 'unavailable'; renderFailed?: ReadonlySet<string>; lang: Lang }) {
  const t = dneskaiWorkspace[lang];
  const blocked = typeof review === 'string' ? [] : review.posts.filter(dneskaiNeedsReview)
    .map((post) => ({ post, detail: dneskaiPostState(post, dneskaiStateContext(review, renderFailed)) })).filter(({ detail }) => detail.state === 'problem')
    .sort((a, b) => Date.parse(a.post.scheduledAt) - Date.parse(b.post.scheduledAt));
  return <section aria-labelledby="dneskai-blocked-title" className="min-w-0 space-y-2">
    <h3 id="dneskai-blocked-title" className="text-sm font-semibold">{t.costs.posts}</h3>
    {review === 'loading' ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : review === 'unavailable' ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
        : blocked.length === 0 ? <p className="text-sm text-foreground-muted">{t.costs.noPosts}</p>
          : <ul className="divide-y divide-border rounded-lg border border-border bg-surface" data-testid="dneskai-blocked-posts">{blocked.map(({ post, detail }) => <li key={post.id} className="min-w-0 space-y-1 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="min-w-0 break-words">{post.title}</span>
              <span className="flex items-center gap-2 text-xs text-foreground-muted"><time dateTime={post.scheduledAt} className="tabular">{pragueDateTime(post.scheduledAt, lang)}</time><DneskaiStateChip detail={detail} lang={lang} /></span></div>
            <DneskaiCodeText code={detail.code} lang={lang} details={[[t.detailRevision, post.id], [t.detailHash, post.contentHash]]} />
          </li>)}</ul>}
  </section>;
}

function TokenSection({ lang, preview, now }: { lang: Lang; preview: boolean; now: Date }) {
  const t = dneskaiWorkspace[lang];
  const account = dneskaiAccount[lang];
  // The preview's demo account stays under its own key, so the Sources tab's account panel never shows it.
  const query = useQuery({ queryKey: preview ? [...qk.marketingAccounts, 'preview'] : qk.marketingAccounts, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => (await dneskaiWorkspaceApi(preview)).loadAccounts(signal) });
  const record = query.data?.find((item) => item.brand === 'dneskai' && item.platform === 'instagram') ?? null;
  const state = record ? marketingTokenState(record.token, now) : null;
  return <section aria-labelledby="dneskai-token-title" className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-4">
    <h3 id="dneskai-token-title" className="text-sm font-semibold">{t.costs.token}</h3>
    {query.isPending ? <p role="status" className="text-xs text-foreground-muted">{t.costs.tokenLoading}</p>
      : query.isError ? <p role="alert" className="text-xs text-risk">{t.costs.tokenUnavailable}</p>
        : !record || !state ? <p className="text-xs text-foreground-muted">{t.costs.noAccount}</p>
          : <>
            <StatusBadge value={`token-${state}`} label={account.token[state]} tone={state === 'valid' ? 'success' : state === 'expiring' ? 'warning' : state === 'expired' ? 'risk' : 'neutral'} />
            <p className="text-xs"><span className="text-foreground-muted">@{record.handle} · {t.costs.tokenExpires}: </span>{record.token ? <time dateTime={record.token.expiresAt} className="tabular">{pragueDateTime(record.token.expiresAt, lang)}</time> : account.notRecorded}</p>
            {account.tokenHelp[state] && <p className="text-xs text-foreground-muted">{account.tokenHelp[state]}</p>}
          </>}
  </section>;
}
