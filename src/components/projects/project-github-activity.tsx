"use client";

import { GitCommitHorizontal, Minus, Plus } from "lucide-react";
import { GithubIcon } from "@/components/icons/github";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProjectCommitsQuery } from "@/lib/github-queries";
import { useDict } from "@/lib/i18n";

/**
 * Read-only change history for a project's linked repository: recent commits
 * and how much code changed over the last four weeks, pulled live from the
 * GitHub API. Renders inside the project workspace so each project shows what
 * was implemented and roughly how much code it moved.
 */
export function ProjectGithubActivity({
  repoFullName,
  enabled,
}: {
  repoFullName: string;
  enabled: boolean;
}) {
  const p = useDict().professional;
  const query = useProjectCommitsQuery(repoFullName, enabled);
  const data = query.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GithubIcon className="h-4 w-4" />
          {p.githubActivity}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!enabled || data?.kind === "disconnected" ? (
          <p className="text-sm text-foreground-muted">{p.githubDisconnected}</p>
        ) : query.isPending ? (
          <p className="text-sm text-foreground-muted">{p.githubLoading}</p>
        ) : data?.kind !== "ok" ? (
          <p className="text-sm text-foreground-muted">{p.githubError}</p>
        ) : data.commits.length === 0 ? (
          <p className="text-sm text-foreground-muted">{p.githubEmpty}</p>
        ) : (
          <div className="space-y-3">
            {data.codeVolume && (data.codeVolume.additions > 0 || data.codeVolume.deletions > 0) && (
              <div className="flex items-center gap-3 rounded-md border border-border bg-surface-secondary px-3 py-2 text-sm">
                <span className="text-foreground-muted">{p.codeVolumeLabel}</span>
                <span className="ml-auto inline-flex items-center gap-3 tabular">
                  <span className="inline-flex items-center gap-0.5 text-success">
                    <Plus className="h-3 w-3" aria-hidden />
                    {data.codeVolume.additions.toLocaleString()}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-destructive">
                    <Minus className="h-3 w-3" aria-hidden />
                    {data.codeVolume.deletions.toLocaleString()}
                  </span>
                </span>
              </div>
            )}
            <ul className="divide-y divide-border">
              {data.commits.map((c) => (
                <li key={c.sha} className="flex items-start gap-3 py-2">
                  <GitCommitHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-foreground-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm text-foreground hover:underline focus-ring"
                      title={c.message}
                    >
                      {c.message}
                    </a>
                    <p className="mt-0.5 font-mono text-[11px] text-foreground-muted">
                      {c.shortSha}
                      {c.author ? ` · ${c.author}` : ""}
                      {c.date ? ` · ${c.date.slice(0, 10)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
