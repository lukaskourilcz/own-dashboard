"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, FileText, Gauge, RefreshCw } from "lucide-react";
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
import { readRepoFilter } from "@/lib/use-prefs";
import {
  STACK_AND_SCALING_FILE,
  STACK_AND_SCALING_PROMPT,
} from "@/lib/stack-prompt";

type Status = "loading" | "connected" | "disconnected" | "error";

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

  const repos = data?.kind === "ok" ? data.repos : EMPTY_REPOS;
  const status: Status = isPending
    ? "loading"
    : data
      ? data.kind === "ok"
        ? "connected"
        : data.kind
      : "error";

  // Active repos = the saved repo filter applied (empty filter = all repos),
  // mirroring the Repositories section. Read once per mount.
  const [visibleIds] = useState<string[]>(
    () => readRepoFilter() ?? initialVisibleIds,
  );
  const active = useMemo(() => {
    if (visibleIds.length === 0) return repos;
    const set = new Set(visibleIds);
    return repos.filter((r) => set.has(String(r.id)));
  }, [repos, visibleIds]);

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
          ) : null
        }
      />

      {status === "loading" && (
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
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {active.map((repo) => (
              <CostCard key={repo.id} repo={repo} />
            ))}
          </div>
        ))}
    </div>
  );
}

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
