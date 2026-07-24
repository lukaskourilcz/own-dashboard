"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Markdown } from "@/components/ui/markdown";
import { ABOUT_PROJECT_FILE } from "@/lib/about-project";
import { loadRepoFile } from "@/lib/github";
import { useDict } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ProjectKnowledgePanel({
  repoFullName,
  enabled = true,
}: {
  repoFullName: string | null;
  enabled?: boolean;
}) {
  const t = useDict();
  const p = t.professional;
  const [owner, repo] = repoFullName?.split("/") ?? [];
  const query = useQuery({
    queryKey: ["github", "about-project", owner, repo],
    queryFn: () => loadRepoFile(owner, repo, ABOUT_PROJECT_FILE),
    enabled: enabled && Boolean(owner && repo),
    staleTime: 5 * 60_000,
  });

  const result = query.data;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {ABOUT_PROJECT_FILE}
          </CardTitle>
          <p className="mt-1 text-xs text-foreground-subtle">
            {p.aboutProjectDescription}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void query.refetch()}
          disabled={!repoFullName || query.isFetching}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")}
          />
          {query.isFetching ? p.checkingKnowledge : p.checkKnowledge}
        </Button>
      </CardHeader>
      <CardContent>
        {!repoFullName || !enabled ? (
          <EmptyState
            icon={BookOpen}
            title={p.repositoryUnavailable}
            description={p.aboutProjectRepositoryRequired}
          />
        ) : result?.kind === "not-found" ? (
          <EmptyState
            icon={BookOpen}
            title={p.aboutProjectMissing}
            description={p.aboutProjectMissingDescription}
          />
        ) : result?.kind === "disconnected" ? (
          <EmptyState
            icon={BookOpen}
            title={p.githubDisconnected}
            description={p.aboutProjectRepositoryRequired}
          />
        ) : result?.kind === "error" || query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {p.aboutProjectError}
          </p>
        ) : query.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2" aria-live="polite">
            <div className="h-28 animate-pulse rounded-md bg-skeleton" />
            <div className="h-28 animate-pulse rounded-md bg-skeleton" />
          </div>
        ) : result?.kind === "ok" ? (
          result.content.trim() ? (
            <div className="rounded-md border border-border bg-surface-inset p-4">
              <Markdown source={result.content} className="max-w-3xl" />
            </div>
          ) : (
            <EmptyState
              icon={BookOpen}
              title={p.aboutProjectMissing}
              description={p.aboutProjectMissingDescription}
            />
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
