"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, BriefcaseBusiness, CircleDollarSign, FolderKanban, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HistoryReadNotice } from "@/components/github/history-read-notice";
import { GithubIcon } from "@/components/icons/github";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Metric } from "@/components/ui/metric";
import { StatusBadge } from "@/components/ui/status-badge";
import { MarketingWeekCard } from "@/components/work/marketing-week";
import { WeeklyPlanningFlow } from "@/components/work/weekly-planning";
import { useDict } from "@/lib/i18n";
import { CHANGELOG, entriesSince, previousCompletedReviewDate } from "@/lib/changelog";
import { mondayKey, todayKey } from "@/lib/date-keys";
import { buildOccurrences } from "@/lib/important-dates";
import { useNow } from "@/lib/use-now";
import { assessProjectHealth } from "@/lib/project-health";
import { useCrossProjectActivityQuery } from "@/lib/github-queries";
import { dueFollowUps } from "@/lib/jobs/board";
import type { EventsResult } from "@/lib/calendar";
import type { MarketingCalendarsResponse } from "@/lib/marketing-calendars";
import type { EntityStatus } from "@/lib/queries/entities";
import type { ClientOpportunity, Cron, ImportantDate, Invoice, JobApplication, Organization, Project, ProjectCost, Todo, Updater, WeeklyReview } from "@/lib/types";

const CLOSED = new Set(["won", "lost", "expired", "archived"]);

export function WorkOverviewPanel({
  projects,
  opportunities,
  organizations,
  invoices,
  jobApplications,
  importantDates,
  todos,
  costs,
  crons,
  reviews,
  setReviews,
  reviewsStatus,
  lastWeekCalendar,
  lastWeekCalendarStatus,
  isPreview,
  repositoryIntegrationEnabled,
  previewMarketingCalendars,
}: {
  projects: Project[];
  opportunities: ClientOpportunity[];
  organizations: Organization[];
  invoices: Invoice[];
  jobApplications: JobApplication[];
  importantDates: ImportantDate[];
  todos: Todo[];
  costs: ProjectCost[];
  crons: Cron[];
  reviews: WeeklyReview[];
  setReviews: Updater<WeeklyReview[]>;
  reviewsStatus?: EntityStatus;
  lastWeekCalendar: EventsResult;
  lastWeekCalendarStatus?: EntityStatus;
  isPreview?: boolean;
  repositoryIntegrationEnabled?: boolean;
  /** Fixture calendars for the preview; the live overview reads GitHub. */
  previewMarketingCalendars?: MarketingCalendarsResponse;
}) {
  const t = useDict();
  const p = t.professional;
  const now = useNow();
  const weekStart = mondayKey(now ?? undefined);
  // The window the "shipped" block covers: everything published after the last
  // review that was actually completed. Null means there is none to measure
  // from — the first review, or one older than the twelve weeks the loader
  // fetches — and the newest entries are shown instead.
  const shippedSince = useMemo(() => previousCompletedReviewDate(reviews, weekStart), [reviews, weekStart]);
  const shipped = useMemo(() => entriesSince(CHANGELOG, shippedSince), [shippedSince]);
  const attention = useMemo(
    () => projects
      .filter((project) => project.is_active && project.status !== "archived")
      .map((project) => ({ project, result: assessProjectHealth(project, todos, costs, crons) }))
      .filter(({ result }) => result.health !== "healthy"),
    [projects, todos, costs, crons],
  );
  const dueOpportunityFollowUps = opportunities.filter((item) =>
    now && !CLOSED.has(item.status) && item.next_follow_up_at && new Date(item.next_follow_up_at) <= now,
  ).length;
  // Applications whose follow-up date has arrived, derived with the same rule
  // the Career board and its "Follow-ups due" metric use.
  const careerFollowUps = useMemo(() => now ? dueFollowUps(jobApplications, now) : [], [jobApplications, now]);

  const projectRepos = projects
    .filter((x) => x.is_active && x.status !== "archived" && x.repo_full_name)
    .slice(0, 12);

  const readHistory = repositoryIntegrationEnabled ?? !isPreview;
  const activityQuery = useCrossProjectActivityQuery(readHistory);
  const activity = activityQuery.data;

  const metrics = [
    { label: p.activeProjects, value: projects.filter((x) => x.is_active && x.status !== "archived").length, icon: FolderKanban },
    { label: p.openOpportunities, value: opportunities.filter((x) => !CLOSED.has(x.status)).length, icon: BriefcaseBusiness },
    { label: p.followUps, value: dueOpportunityFollowUps, icon: AlertTriangle },
    { label: p.unpaidInvoices, value: invoices.filter((x) => x.status === "issued").length, icon: CircleDollarSign },
    { label: p.clientsTitle, value: organizations.filter((x) => x.status === "active").length, icon: BriefcaseBusiness },
    { label: p.currentApplications, value: jobApplications.filter((x) => !["rejected", "withdrawn"].includes(x.status)).length, icon: BriefcaseBusiness },
  ];

  const upcomingDates = useMemo(() => now ? buildOccurrences(importantDates, now)
    .filter(item => item.daysUntil >= 0).slice(0, 6) : [], [importantDates, now]);
  const healthReason = (reason: string) => {
    if (reason === "Project is on hold") return p.projectOnHold;
    if (reason === "Running costs without recorded revenue") return p.costsWithoutRevenue;
    if (reason.includes("overdue task")) return `${p.overdueTasks}: ${reason.match(/^\d+/)?.[0] ?? ""}`;
    if (reason.includes("disabled automation")) return `${p.disabledAutomations}: ${reason.match(/^\d+/)?.[0] ?? ""}`;
    return reason;
  };

  return (
    <div>
      <PageHeader title={p.workTitle} description={p.workDescription} />
      <div className="surface-band -mx-4 grid grid-cols-2 gap-y-2 px-4 py-3 sm:grid-cols-3 md:-mx-6 md:px-6 xl:-mx-8 xl:grid-cols-6 xl:px-8">
        {metrics.map(({ label, value, icon }) => <Metric key={label} label={label} value={value} icon={icon} tone={label === p.followUps && value > 0 ? "attention" : "default"} />)}
      </div>
      <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,.8fr)]">
        <div className="space-y-4">
        <Card className="border-l-2 border-l-warning">
          <CardHeader><CardTitle>{p.attention}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {attention.length === 0 ? <p className="text-sm text-foreground-muted">{p.attentionEmpty}</p> : attention.map(({ project, result }) => (
              <Link key={project.id} href={`/projects/${encodeURIComponent(project.slug)}`} prefetch={false} className="block border-b border-border py-2.5 last:border-0">
                <div className="flex items-center justify-between gap-3"><p className="font-medium">{project.name}</p><StatusBadge value={result.health} /></div>
                <p className="mt-1 text-xs text-foreground-muted">{result.reasons.map(healthReason).join(" · ")}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle>{p.upcomingDates}</CardTitle></CardHeader><CardContent>{upcomingDates.length === 0 ? <p className="text-sm text-foreground-muted">{p.noUpcomingDates}</p> : <ul className="divide-y divide-border">{upcomingDates.map((item) => <li key={item.date.id}><Link href="/dates" prefetch={false} className="flex min-h-11 items-center justify-between gap-3 py-2"><span className="text-sm font-medium">{item.date.title}</span><span className="text-xs tabular text-foreground-muted">{todayKey(item.next)}</span></Link></li>)}</ul>}</CardContent></Card>
          <Card>
            <CardHeader><CardTitle>{p.shippedSinceReview}</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              <p className="text-xs text-foreground-muted">{shippedSince ? p.shippedSinceReviewDescription : p.shippedLatest}</p>
              {shipped.length === 0 ? (
                <p className="text-sm text-foreground-muted">{p.shippedEmpty}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {shipped.map((entry) => (
                    <li key={entry.date} className="py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 text-sm font-medium">{entry.title}</p>
                        <span className="shrink-0 text-xs tabular text-foreground-muted">{entry.date}</span>
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {entry.features.map((feature) => (
                          <li key={feature.title} className="text-xs text-foreground-muted">{feature.title}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <WeeklyPlanningFlow
            reviews={reviews}
            setReviews={setReviews}
            reviewsStatus={reviewsStatus}
            projects={projects}
            organizations={organizations}
            todos={todos}
            lastWeekCalendar={lastWeekCalendar}
            lastWeekCalendarStatus={lastWeekCalendarStatus}
            isPreview={isPreview}
          />
          <MarketingWeekCard preview={previewMarketingCalendars} />

        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className={careerFollowUps.length > 0 ? "border-l-2 border-l-warning" : undefined}>
          <CardHeader><CardTitle>{p.careerFollowUps}</CardTitle></CardHeader>
          <CardContent>
            {careerFollowUps.length === 0 ? <p className="text-sm text-foreground-muted">{p.careerFollowUpsEmpty}</p> : (
              <ul className="divide-y divide-border">
                {careerFollowUps.slice(0, 6).map((item) => (
                  <li key={item.id}>
                    <Link href="/career" prefetch={false} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.company ? `${item.title} · ${item.company}` : item.title}</span>
                      <span className="shrink-0 text-xs tabular text-foreground-muted">{p.careerFollowUpDue} {item.next_follow_up_at?.slice(0, 10)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle>{p.pipeline}</CardTitle></CardHeader><CardContent>{opportunities.filter((item) => !CLOSED.has(item.status)).length === 0 ? <p className="text-sm text-foreground-muted">{p.pipelineEmpty}</p> : <ul className="divide-y divide-border">{opportunities.filter((item) => !CLOSED.has(item.status)).slice(0, 6).map((item) => <li key={item.id}><Link href="/opportunities" prefetch={false} className="flex min-h-11 items-center justify-between gap-3 py-2"><span className="text-sm font-medium">{item.title}</span><StatusBadge value={item.status} /></Link></li>)}</ul>}</CardContent></Card>
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle className="flex items-center gap-2"><GithubIcon className="h-4 w-4" />{p.projectRepositories}</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-foreground-muted">{p.projectRepositoriesDescription}</p>
          {projectRepos.length === 0 ? <p className="text-sm text-foreground-muted">{p.noRelatedRecords}</p> : (
            <ul className="grid gap-1 sm:grid-cols-2">
              {projectRepos.map((project) => (
                <li key={project.id}>
                  <Link href={`/projects/${encodeURIComponent(project.slug)}`} prefetch={false} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:border-border-strong focus-ring">
                    <span className="truncate text-sm font-medium">{project.name}</span>
                    <span className="min-w-0 truncate font-mono text-[11px] text-foreground-muted" title={project.repo_full_name ?? undefined}>{project.repo_full_name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between"><CardTitle role="heading" aria-level={2}><GithubIcon className="h-4 w-4" />{p.crossProjectActivity}</CardTitle>{readHistory && activity?.kind === "ok" && !activityQuery.isError && <Button variant="ghost" size="icon-sm" aria-label={p.githubRefresh} disabled={activityQuery.isFetching} onClick={() => void activityQuery.refetch()}><RefreshCw className="h-3.5 w-3.5" aria-hidden /></Button>}</CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-foreground-muted">{p.crossProjectActivityDescription}</p>
          {!readHistory ? <p className="text-sm text-foreground-muted">{p.githubPreview}</p> : activity?.kind === "disconnected" ? (
            <p className="text-sm text-foreground-muted">{p.githubDisconnected}</p>
          ) : activityQuery.isPending ? (
            <p className="text-sm text-foreground-muted">{p.githubLoading}</p>
          ) : activity?.kind !== "ok" ? (
            <HistoryReadNotice busy={activityQuery.isFetching} onRetry={() => void activityQuery.refetch()} />
          ) : (<>
            {activityQuery.isError && <HistoryReadNotice cached busy={activityQuery.isFetching} onRetry={() => void activityQuery.refetch()} />}
            {activity.scope.projects < activity.scope.totalProjects && <p role="status" className="mt-3 text-xs text-foreground-muted">{p.githubScope(activity.scope.projects, activity.scope.totalProjects, activity.scope.repositories)}</p>}
            {activity.scope.unavailableRepositories > 0 && <p role="status" className="mt-3 text-xs text-foreground-muted">{p.githubPartial(activity.scope.unavailableRepositories)}</p>}
            {activity.items.length === 0 ? <p className="mt-3 text-sm text-foreground-muted">{activity.scope.repositories === 0 ? p.noRelatedRecords : p.githubEmpty}</p> : <ul className="divide-y divide-border">
              {activity.items.map((c) => (
                <li key={`${c.projectId}-${c.sha}`} className="grid gap-x-4 gap-y-1 py-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                  <a href={c.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center break-words text-sm text-foreground hover:underline focus-ring md:min-h-0" title={c.message}>{c.message || c.shortSha}</a>
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-foreground-muted">
                    <Link href={`/projects/${encodeURIComponent(c.projectSlug)}`} prefetch={false} title={c.projectName} className="inline-flex min-h-11 max-w-full items-center focus-ring hover:underline md:min-h-0"><span className="truncate">{c.projectName}</span></Link>
                    <code>{c.shortSha}</code>
                    {c.author && <span className="min-w-0 max-w-full truncate sm:max-w-xs" title={c.author}>{c.author}</span>}
                    {c.date && <time dateTime={c.date}>{c.date.slice(0, 10)}</time>}
                  </div>
                </li>
              ))}
            </ul>}</>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
