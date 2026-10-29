"use client";

import { useMemo } from "react";
import { GitCommitHorizontal, Minus, Plus, RefreshCw } from "lucide-react";
import { GithubIcon } from "@/components/icons/github";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HistoryReadNotice } from "@/components/github/history-read-notice";
import { useProjectCommitsQuery } from "@/lib/github-queries";
import { useDict, useLang } from "@/lib/i18n";

/** One read-only recent page, with optional validated code-volume statistics. */
export function ProjectGithubActivity({ repoFullName, enabled, preview = false }: { repoFullName: string; enabled: boolean; preview?: boolean }) {
  const p = useDict().professional;
  const { lang } = useLang();
  const count = useMemo(() => new Intl.NumberFormat(lang === "cs" ? "cs-CZ" : "en-GB"), [lang]);
  const query = useProjectCommitsQuery(repoFullName, enabled);
  const data = query.data;
  return <Card>
    <CardHeader className="flex-row items-center justify-between">
      <CardTitle role="heading" aria-level={2}><GithubIcon className="h-4 w-4" />{p.githubActivity}</CardTitle>
      {enabled && data?.kind === "ok" && !query.isError && <Button variant="ghost" size="icon-sm" aria-label={p.githubRefresh} disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw aria-hidden className="h-3.5 w-3.5" /></Button>}
    </CardHeader>
    <CardContent className="space-y-3">
      {!enabled || data?.kind === "disconnected" ? <p className="text-sm text-foreground-muted">{preview ? p.githubPreview : p.githubDisconnected}</p>
        : query.isPending ? <p role="status" className="text-sm text-foreground-muted">{p.githubLoading}</p>
        : data?.kind !== "ok" ? <HistoryReadNotice missing={data?.kind === "not-found"} busy={query.isFetching} onRetry={() => void query.refetch()} />
        : <>
          {query.isError && <HistoryReadNotice cached busy={query.isFetching} onRetry={() => void query.refetch()} />}
          {data.codeVolume && <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border pb-3 text-sm">
            <span className="text-foreground-muted">{p.codeVolumeLabel(data.codeVolume.weeks)}</span>
            <span className="inline-flex flex-wrap items-center gap-3 tabular">
              <span className="inline-flex items-center gap-0.5 text-success"><Plus className="h-3 w-3" aria-hidden /><span className="sr-only">{p.githubAdditions}: </span>{count.format(data.codeVolume.additions)}</span>
              <span className="inline-flex items-center gap-0.5 text-destructive"><Minus className="h-3 w-3" aria-hidden /><span className="sr-only">{p.githubDeletions}: </span>{count.format(data.codeVolume.deletions)}</span>
            </span>
          </div>}
          {data.commits.length === 0 ? <p className="text-sm text-foreground-muted">{p.githubEmpty}</p> : <ul className="divide-y divide-border">
            {data.commits.map(commit => <li key={commit.sha} className="flex items-start gap-3 py-2">
              <GitCommitHorizontal className="mt-3 h-4 w-4 shrink-0 text-foreground-subtle md:mt-0.5" aria-hidden />
              <div className="min-w-0 flex-1">
                <a href={commit.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center text-sm text-foreground hover:underline focus-ring md:min-h-0" title={commit.message}><span className="line-clamp-2 break-words">{commit.message || commit.shortSha}</span></a>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-foreground-muted">
                  <code>{commit.shortSha}</code>
                  {commit.author && <span className="min-w-0 max-w-full truncate sm:max-w-xs" title={commit.author}>{commit.author}</span>}
                  {commit.date && <time dateTime={commit.date}>{commit.date.slice(0, 10)}</time>}
                </div>
              </div>
            </li>)}
          </ul>}
        </>}
    </CardContent>
  </Card>;
}
