"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  Gauge,
  ListFilter,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { Markdown } from "@/components/ui/markdown";
import { GithubIcon } from "@/components/icons/github";
import { useDict } from "@/lib/i18n";
import { useFeatureFlag, FLAGS } from "@/lib/feature-flags";
import { connectGitHub } from "@/lib/github-auth";
import { loadRepoFile, type GithubRepo } from "@/lib/github";
import { useReposQuery } from "@/lib/github-queries";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCurrency } from "@/lib/utils";
import { projectMonthlyIn } from "@/lib/projects";
import { isActive as subIsActive, toMonthlyIn } from "@/lib/subscriptions";
import type {
  Cron,
  Project,
  ProjectCost,
  Subscription,
} from "@/lib/types";
import {
  readCostsHiddenRepos,
  readCostsOnlyWithFile,
  readRepoFilter,
  writeCostsHiddenRepos,
  writeCostsOnlyWithFile,
} from "@/lib/use-prefs";
import { cn } from "@/lib/utils";
import {
  STACK_AND_SCALING_FILE,
  STACK_AND_SCALING_PROMPT,
} from "@/lib/stack-prompt";

const CategoryDonut = dynamic(
  () =>
    import("@/components/charts/category-donut").then((m) => m.CategoryDonut),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

type Status = "loading" | "connected" | "disconnected" | "error";
/** Whether a repo has the stack-and-scaling.md file, or we're still checking. */
type FileState = "ok" | "missing" | "pending";

const EMPTY_REPOS: GithubRepo[] = [];

export function CostsPanel({
  initialVisibleIds,
  onOpenRepos,
  projects,
  projectCosts,
  crons,
  subscriptions,
  displayCurrency,
}: {
  /** Saved repo allow-list (GitHub repo ids). Empty = every repo is active. */
  initialVisibleIds: string[];
  onOpenRepos: () => void;
  projects: Project[];
  projectCosts: ProjectCost[];
  crons: Cron[];
  subscriptions: Subscription[];
  displayCurrency: string;
}) {
  const t = useDict();
  const { data, isPending, isFetching, refetch } = useReposQuery();
  const [connecting, setConnecting] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // Feature-flagged so the filter can be rolled out / killed remotely.
  const filterEnabled = useFeatureFlag(FLAGS.costsFilter);

  const repos = data?.kind === "ok" ? data.repos : EMPTY_REPOS;
  const status: Status = isPending
    ? "loading"
    : data
      ? data.kind === "ok"
        ? "connected"
        : data.kind
      : "error";

  // Active repos = the shared Repositories allow-list applied (empty = all),
  // mirroring the Repositories section. Read once per mount.
  const [visibleIds] = useState<string[]>(
    () => readRepoFilter() ?? initialVisibleIds,
  );
  const active = useMemo(() => {
    if (visibleIds.length === 0) return repos;
    const set = new Set(visibleIds);
    return repos.filter((r) => set.has(String(r.id)));
  }, [repos, visibleIds]);

  // Costs-panel-specific filters, persisted device-locally so they survive
  // reloads. `onlyWithFile` hides repos lacking the file; `hiddenIds` is an
  // explicit per-repo hide-list the user manages in the filter dialog.
  const [onlyWithFile, setOnlyWithFileState] = useState<boolean>(() =>
    readCostsOnlyWithFile(),
  );
  const [hiddenIds, setHiddenIds] = useState<string[]>(() =>
    readCostsHiddenRepos(),
  );
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const filterActive = onlyWithFile || hiddenIds.length > 0;

  const setOnlyWithFile = (v: boolean) => {
    setOnlyWithFileState(v);
    writeCostsOnlyWithFile(v);
  };
  const toggleHidden = (id: string) => {
    setHiddenIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      writeCostsHiddenRepos(next);
      return next;
    });
  };
  const clearFilters = () => {
    setOnlyWithFile(false);
    setHiddenIds([]);
    writeCostsHiddenRepos([]);
  };

  // Read each active repo's file status once, at the parent, so we can filter
  // by "has file". These share React Query's cache (same key) with each card's
  // own query, so there's no duplicate network request.
  const fileQueries = useQueries({
    queries: active.map((repo) => ({
      queryKey: ["github", "file", String(repo.id), STACK_AND_SCALING_FILE],
      queryFn: () =>
        loadRepoFile(repo.owner, repo.name, STACK_AND_SCALING_FILE),
      staleTime: 5 * 60_000,
    })),
  });
  const fileStatus = useMemo(() => {
    const m = new Map<string, FileState>();
    active.forEach((repo, i) => {
      const q = fileQueries[i];
      m.set(
        String(repo.id),
        q?.isPending ? "pending" : q?.data?.kind === "ok" ? "ok" : "missing",
      );
    });
    return m;
  }, [active, fileQueries]);

  // When "only with file" is on we can't decide visibility until every check
  // resolves — show skeletons rather than flashing repos in and out.
  const resolvingFiles =
    filterEnabled &&
    onlyWithFile &&
    active.some((r) => fileStatus.get(String(r.id)) === "pending");

  const visibleRepos = filterEnabled
    ? active.filter((repo) => {
        const id = String(repo.id);
        if (hiddenSet.has(id)) return false;
        if (onlyWithFile && fileStatus.get(id) !== "ok") return false;
        return true;
      })
    : active;

  async function onConnect() {
    setConnecting(true);
    const { error } = await connectGitHub();
    if (error) setConnecting(false);
  }

  return (
    <div>
      <PageHeader
        title={t.costs.title}
        description={t.costs.description}
        action={
          status === "connected" ? (
            <div className="flex items-center gap-1">
              {active.length > 0 && filterEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFilterOpen(true)}
                >
                  <span className="relative">
                    <ListFilter className="h-3.5 w-3.5" />
                    {filterActive && (
                      <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </span>
                  {t.costs.filter}
                </Button>
              )}
              <Tooltip content={t.costs.refresh}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  aria-label={t.costs.refresh}
                >
                  <RefreshCw
                    className={"h-3.5 w-3.5" + (isFetching ? " animate-spin" : "")}
                  />
                </Button>
              </Tooltip>
            </div>
          ) : null
        }
      />

      <CostOverview
        projects={projects}
        projectCosts={projectCosts}
        crons={crons}
        subscriptions={subscriptions}
        displayCurrency={displayCurrency}
      />

      {(status === "loading" || resolvingFiles) && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[220px] w-full" />
          ))}
        </div>
      )}

      {status === "error" && (
        <EmptyState
          icon={GithubIcon}
          title={t.github.loadErr}
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t.github.refresh}
            </Button>
          }
        />
      )}

      {status === "disconnected" && (
        <EmptyState
          icon={GithubIcon}
          title={t.github.connectTitle}
          description={t.github.connectBody}
          action={
            <Button onClick={onConnect} disabled={connecting}>
              <GithubIcon className="h-4 w-4" />
              {connecting ? t.common.redirecting : t.github.connect}
            </Button>
          }
        />
      )}

      {status === "connected" &&
        !resolvingFiles &&
        (active.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title={t.costs.noActiveRepos}
            description={t.costs.noActiveReposDesc}
            action={
              <Button variant="outline" size="sm" onClick={onOpenRepos}>
                {t.costs.openRepositories}
              </Button>
            }
          />
        ) : visibleRepos.length === 0 ? (
          <EmptyState
            icon={ListFilter}
            title={t.costs.noMatch}
            description={t.costs.noMatchDesc}
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t.costs.clearFilters}
              </Button>
            }
          />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {visibleRepos.map((repo) => (
              <CostCard key={repo.id} repo={repo} />
            ))}
          </div>
        ))}

      {filterEnabled && (
        <FilterDialog
          open={filterOpen}
          onOpenChange={setFilterOpen}
          repos={active}
          fileStatus={fileStatus}
          onlyWithFile={onlyWithFile}
          setOnlyWithFile={setOnlyWithFile}
          hiddenSet={hiddenSet}
          toggleHidden={toggleHidden}
          filterActive={filterActive}
          clearFilters={clearFilters}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

type Slice = { name: string; value: number };

/**
 * Aggregate spend broken down as pies: everything together, projects only, and
 * subscriptions by category. Project cost = manual cost lines + AI cron
 * estimates (same figure the Projects section shows); subscription cost is
 * normalized to a monthly amount. A monthly ↔ yearly toggle just scales every
 * value by 12 (yearly = monthly × 12), matching the rest of the app.
 */
function CostOverview({
  projects,
  projectCosts,
  crons,
  subscriptions,
  displayCurrency,
}: {
  projects: Project[];
  projectCosts: ProjectCost[];
  crons: Cron[];
  subscriptions: Subscription[];
  displayCurrency: string;
}) {
  const t = useDict();
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const factor = period === "yearly" ? 12 : 1;

  const costsByProject = useMemo(() => {
    const map = new Map<string, ProjectCost[]>();
    for (const c of projectCosts) {
      const arr = map.get(c.project_id);
      if (arr) arr.push(c);
      else map.set(c.project_id, [c]);
    }
    return map;
  }, [projectCosts]);

  const cronsByProject = useMemo(() => {
    const map = new Map<string, Cron[]>();
    for (const c of crons) {
      const arr = map.get(c.project_id);
      if (arr) arr.push(c);
      else map.set(c.project_id, [c]);
    }
    return map;
  }, [crons]);

  // Active projects → one slice each (monthly running cost), biggest first.
  const projectSlices = useMemo<Slice[]>(
    () =>
      projects
        .filter((p) => p.is_active)
        .map((p) => ({
          name: p.name,
          value: projectMonthlyIn(
            costsByProject.get(p.id) ?? [],
            cronsByProject.get(p.id) ?? [],
            displayCurrency,
          ),
        }))
        .filter((s) => s.value > 0)
        .sort((a, b) => b.value - a.value),
    [projects, costsByProject, cronsByProject, displayCurrency],
  );

  // Active subscriptions → one slice per category (e.g. Entertainment).
  const subscriptionSlices = useMemo<Slice[]>(() => {
    const byCategory = new Map<string, number>();
    for (const s of subscriptions) {
      if (!subIsActive(s)) continue;
      const key = s.category?.trim() || t.costs.overviewUncategorized;
      byCategory.set(key, (byCategory.get(key) ?? 0) + toMonthlyIn(s, displayCurrency));
    }
    return [...byCategory.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [subscriptions, displayCurrency, t.costs.overviewUncategorized]);

  const projectsTotal = projectSlices.reduce((a, s) => a + s.value, 0);
  const subsTotal = subscriptionSlices.reduce((a, s) => a + s.value, 0);

  // The "all costs" pie keeps projects as one slice and subscriptions split by
  // category, so the whole picture reads at a glance.
  const totalSlices = useMemo<Slice[]>(() => {
    const slices: Slice[] = [];
    if (projectsTotal > 0)
      slices.push({ name: t.costs.overviewProjects, value: projectsTotal });
    slices.push(...subscriptionSlices);
    return slices.sort((a, b) => b.value - a.value);
  }, [projectsTotal, subscriptionSlices, t.costs.overviewProjects]);

  const hasAnything = projectsTotal > 0 || subsTotal > 0;
  const perLabel =
    period === "yearly" ? t.costs.overviewPerYr : t.costs.overviewPerMo;

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between gap-2 p-4 pb-0">
        <h2 className="text-sm font-semibold text-foreground">
          {t.costs.overviewTitle}
        </h2>
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(["monthly", "yearly"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors focus-ring",
                period === p
                  ? "bg-surface-muted text-foreground"
                  : "text-foreground-subtle hover:text-foreground",
              )}
            >
              {p === "monthly" ? t.costs.overviewMonthly : t.costs.overviewYearly}
            </button>
          ))}
        </div>
      </div>

      {!hasAnything ? (
        <p className="px-4 py-8 text-center text-sm text-foreground-subtle">
          {t.costs.overviewEmpty}
        </p>
      ) : (
        <div className="grid gap-6 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <PieBlock
            title={t.costs.overviewTotal}
            slices={totalSlices.map((s) => ({ ...s, value: s.value * factor }))}
            currency={displayCurrency}
            perLabel={perLabel}
          />
          <PieBlock
            title={t.costs.overviewProjects}
            slices={projectSlices.map((s) => ({ ...s, value: s.value * factor }))}
            currency={displayCurrency}
            perLabel={perLabel}
          />
          <PieBlock
            title={t.costs.overviewSubscriptions}
            slices={subscriptionSlices.map((s) => ({
              ...s,
              value: s.value * factor,
            }))}
            currency={displayCurrency}
            perLabel={perLabel}
          />
        </div>
      )}
    </Card>
  );
}

/** One titled donut with its total in the middle and a compact legend. */
function PieBlock({
  title,
  slices,
  currency,
  perLabel,
}: {
  title: string;
  slices: Slice[];
  currency: string;
  perLabel: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          {title}
        </h3>
        <span className="text-xs tabular text-foreground-subtle">
          {formatCurrency(total, currency)}
          {perLabel}
        </span>
      </div>
      {slices.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-md border border-dashed border-border text-xs text-foreground-subtle">
          —
        </div>
      ) : (
        <>
          <div className="relative h-40">
            <CategoryDonut
              data={slices}
              currency={currency}
              innerRadius={44}
              outerRadius={68}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-semibold tabular text-foreground">
                {formatCurrency(total, currency)}
              </span>
            </div>
          </div>
          <ul className="mt-3 space-y-1">
            {slices.map((s, i) => (
              <li key={s.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="flex-1 truncate text-foreground">{s.name}</span>
                <span className="tabular text-foreground-muted">
                  {formatCurrency(s.value, currency)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border",
      )}
    >
      {checked && <Check className="h-3 w-3" />}
    </span>
  );
}

function FilterDialog({
  open,
  onOpenChange,
  repos,
  fileStatus,
  onlyWithFile,
  setOnlyWithFile,
  hiddenSet,
  toggleHidden,
  filterActive,
  clearFilters,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  repos: GithubRepo[];
  fileStatus: Map<string, FileState>;
  onlyWithFile: boolean;
  setOnlyWithFile: (v: boolean) => void;
  hiddenSet: Set<string>;
  toggleHidden: (id: string) => void;
  filterActive: boolean;
  clearFilters: () => void;
}) {
  const t = useDict();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-md flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>{t.costs.filterTitle}</DialogTitle>
            {filterActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] text-foreground-subtle transition-colors hover:text-foreground focus-ring rounded px-1"
              >
                {t.costs.clearFilters}
              </button>
            )}
          </div>
        </DialogHeader>

          {/* Only-with-file toggle */}
          <button
            type="button"
            role="checkbox"
            aria-checked={onlyWithFile}
            onClick={() => setOnlyWithFile(!onlyWithFile)}
            className="mt-3 flex w-full items-start gap-2.5 rounded-md border border-border p-2.5 text-left transition-colors hover:bg-surface-hover focus-ring"
          >
            <span className="mt-0.5">
              <CheckBox checked={onlyWithFile} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-foreground">
                {t.costs.onlyWithFile}
              </span>
              <span className="mt-0.5 block text-xs text-foreground-muted">
                {t.costs.onlyWithFileHint}
              </span>
            </span>
          </button>

          {/* Per-repo show/hide list */}
          <p className="mt-4 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
            {t.costs.reposLabel}
          </p>
          <div className="-mx-1 flex-1 overflow-y-auto">
            {repos.map((repo) => {
              const id = String(repo.id);
              const visible = !hiddenSet.has(id);
              const fs = fileStatus.get(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="checkbox"
                  aria-checked={visible}
                  aria-label={
                    (visible ? t.costs.hideRepo : t.costs.showRepo) +
                    ": " +
                    repo.name
                  }
                  onClick={() => toggleHidden(id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover focus-ring"
                >
                  <CheckBox checked={visible} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {repo.name}
                  </span>
                  {fs === "ok" ? (
                    <span className="inline-flex items-center gap-1 shrink-0 text-[10px] font-medium text-foreground-muted">
                      <FileText className="h-3 w-3" />
                      {t.costs.hasFile}
                    </span>
                  ) : fs === "missing" ? (
                    <span className="shrink-0 text-[10px] text-foreground-subtle">
                      {t.costs.noFile}
                    </span>
                  ) : (
                    <span className="h-3 w-10 shrink-0">
                      <Skeleton className="h-3 w-full" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex justify-end">
            <DialogClose asChild>
              <Button size="sm">{t.costs.done}</Button>
            </DialogClose>
          </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------- */

function CostCard({ repo }: { repo: GithubRepo }) {
  const t = useDict();
  const toast = useToast();
  const fileQuery = useQuery({
    queryKey: ["github", "file", String(repo.id), STACK_AND_SCALING_FILE],
    queryFn: () => loadRepoFile(repo.owner, repo.name, STACK_AND_SCALING_FILE),
    staleTime: 5 * 60_000,
  });
  const result = fileQuery.data;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(STACK_AND_SCALING_PROMPT);
      toast.ok(t.costs.promptCopied);
    } catch {
      toast.err(t.costs.couldNotCopy);
    }
  }

  return (
    <Card className="flex flex-col p-0">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <a
          href={repo.html_url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-sm font-semibold text-foreground hover:underline"
          title={repo.full_name}
        >
          {repo.name}
        </a>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip content={t.costs.refresh}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => fileQuery.refetch()}
              disabled={fileQuery.isFetching}
              aria-label={t.costs.refresh}
            >
              <RefreshCw
                className={
                  "h-3.5 w-3.5" + (fileQuery.isFetching ? " animate-spin" : "")
                }
              />
            </Button>
          </Tooltip>
          {result?.kind === "ok" && result.htmlUrl && (
            <Tooltip content={t.costs.viewFile}>
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                aria-label={t.costs.viewFile}
              >
                <a href={result.htmlUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex-1 p-3">
        {fileQuery.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : result?.kind === "ok" ? (
          <Markdown source={result.content} />
        ) : result?.kind === "not-found" ? (
          <div className="flex flex-col items-center px-2 py-4 text-center">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-foreground-subtle">
              <FileText className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {t.costs.fileMissingTitle}
            </p>
            <p className="mt-1 max-w-xs text-xs text-foreground-muted">
              {t.costs.fileMissingDesc}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" onClick={copyPrompt}>
                <Copy className="h-3.5 w-3.5" />
                {t.costs.copyPrompt}
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={repo.html_url} target="_blank" rel="noreferrer">
                  <GithubIcon className="h-3.5 w-3.5" />
                  {t.costs.openRepo}
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center px-2 py-4 text-center">
            <p className="text-xs text-destructive">{t.costs.loadErr}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => fileQuery.refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t.costs.retry}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
