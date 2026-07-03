"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
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
import { connectGitHub } from "@/lib/github-auth";
import { loadRepoFile, type GithubRepo } from "@/lib/github";
import { useReposQuery } from "@/lib/github-queries";
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

type Status = "loading" | "connected" | "disconnected" | "error";
/** Whether a repo has the stack-and-scaling.md file, or we're still checking. */
type FileState = "ok" | "missing" | "pending";

const EMPTY_REPOS: GithubRepo[] = [];

export function CostsPanel({
  initialVisibleIds,
  onOpenRepos,
}: {
  /** Saved repo allow-list (GitHub repo ids). Empty = every repo is active. */
  initialVisibleIds: string[];
  onOpenRepos: () => void;
}) {
  const t = useDict();
  const { data, isPending, isFetching, refetch } = useReposQuery();
  const [connecting, setConnecting] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

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
    onlyWithFile &&
    active.some((r) => fileStatus.get(String(r.id)) === "pending");

  const visibleRepos = active.filter((repo) => {
    const id = String(repo.id);
    if (hiddenSet.has(id)) return false;
    if (onlyWithFile && fileStatus.get(id) !== "ok") return false;
    return true;
  });

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
              {active.length > 0 && (
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="anim-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface p-5 shadow-elevated">
          <div className="flex items-center justify-between gap-2">
            <Dialog.Title className="text-sm font-semibold">
              {t.costs.filterTitle}
            </Dialog.Title>
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
            <Dialog.Close asChild>
              <Button size="sm">{t.costs.done}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
