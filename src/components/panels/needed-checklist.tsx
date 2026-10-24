"use client";

import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ExternalLink,
  ListChecks,
  ListPlus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { qk } from "@/lib/queries/keys";
import { commitFile, type GithubRepo } from "@/lib/github";
import {
  loadNeededFile,
  neededTodoItems,
  removeNeededLine,
  type NeededFileResult,
  type NeededItem,
} from "@/lib/needed";
import { buildNeededRows } from "@/lib/needed-sync";
import { setReposDisconnected } from "@/lib/github-queries";
import { syncNeededTasks } from "@/lib/needed-task-store";
import { loadNeededBatch, neededBatchQueryKey, type NeededBatchResult } from "@/lib/needed-batch-client";

export function NeededChecklist({ repos }: { repos: GithubRepo[] }) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();

  const queryKey = neededBatchQueryKey(repos);
  const batch = useQuery({ queryKey, queryFn: ({ signal }) => loadNeededBatch(repos, signal), staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  const files = useMemo(() => new Map(batch.data?.kind === "ok" ? batch.data.files.map(file => [file.repoId, file.result]) : []), [batch.data]);
  const loading = batch.isPending, disconnected = batch.data?.kind === "disconnected";
  useEffect(() => { if (disconnected) void setReposDisconnected(qc); }, [disconnected, qc]);
  const unavailable = repos.filter(repo => files.get(String(repo.id))?.kind !== "ok");
  function mergeSources(expected: Map<string, NeededFileResult>, update: NeededBatchResult) {
    qc.setQueryData<NeededBatchResult>(queryKey, current => {
      if (current?.kind !== "ok") return current;
      if (update.kind === "disconnected") return update;
      const changes = new Map(update.files.map(file => [file.repoId, file.result]));
      return { kind: "ok", files: current.files.map(file => changes.has(file.repoId) && file.result === expected.get(file.repoId) ? { ...file, result: changes.get(file.repoId)! } : file) };
    });
  }
  const retrySources = useMutation({ gcTime: 0, mutationFn: async () => {
    const expected = new Map(files);
    mergeSources(expected, await loadNeededBatch(unavailable));
  } });
  const groups = useMemo(() => repos.flatMap(repo => {
    const res = files.get(String(repo.id));
    if (res?.kind !== "ok") return [];
    const items = neededTodoItems(res.content, repo, res.htmlUrl);
    return items.length ? [{ repo, items, htmlUrl: res.htmlUrl }] : [];
  }), [repos, files]);

  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);

  const importCount = totalItems;

  // Create categorized todos from every repo's NEEDED.md. Each task's category
  // is the repo name; existing tasks (same category + title) are skipped so
  // re-clicking never duplicates.
  const importTodos = useMutation({
    gcTime: 0,
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");

      const nowIso = new Date().toISOString();
      const candidates = repos.flatMap(repo => {
        const res = files.get(String(repo.id));
        if (!res || res.kind !== "ok") return [];
        return buildNeededRows(userId, repo, res.content, res.htmlUrl, nowIso);
      });
      if (candidates.length === 0) return { inserted: 0, repos: 0 };

      const result = await syncNeededTasks(supabase, candidates);
      return { inserted: result.added, repos: result.repos };
    },
    onSuccess: (res) => {
      toast.ok(
        res.inserted === 0
          ? t.github.needed.todosNoneNew
          : t.github.needed.todosCreated(res.inserted, res.repos),
      );
      void qc.invalidateQueries({ queryKey: qk.todos });
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: qk.todos });
      toast.err(
        (e as Error).message === "no-user"
          ? t.github.needed.reconnect
          : t.github.needed.todosErr,
      );
    },
  });

  const checkOff = useMutation({
    gcTime: 0,
    mutationFn: async (item: NeededItem) => {
      await qc.cancelQueries({ queryKey });
      const current = qc.getQueryData<NeededBatchResult>(queryKey);
      const cached = current?.kind === "ok" ? current.files.find(file => file.repoId === item.repoId)?.result : undefined;
      if (!cached || cached.kind !== "ok") throw new Error("stale");
      const { next, removed } = removeNeededLine(cached.content, item.raw);
      if (!removed) throw new Error("gone"); // already removed elsewhere
      const outcome = await commitFile({
        intent: "edit", expectedSha: cached.sha,
        owner: item.owner,
        repo: item.repo,
        path: cached.path,
        content: next,
        message: t.github.needed.commitMessage(item.text.slice(0, 64)),
      });
      if (!outcome.ok) throw outcome;
      mergeSources(new Map([[item.repoId, cached]]), { kind: "ok", files: [{ repoId: item.repoId, result: { kind: "ok", path: cached.path, content: next, sha: outcome.result.content.sha, htmlUrl: outcome.result.content.html_url } }] });
      return { item, path: cached.path };
    },
    onSuccess: ({ item, path }) => { toast.ok(t.github.needed.removedFrom(item.repo, path)); },
    onError: async (e, item) => {
      const status = (e as { status?: number }).status;
      toast.err(status === 401 ? t.github.needed.reconnect : status === 409 ? t.github.fileChanged : t.github.needed.updateErr);
      if (status === 401) { await setReposDisconnected(qc); return; }
      const current = qc.getQueryData<NeededBatchResult>(queryKey);
      if (current?.kind !== "ok") return;
      const expected = new Map(current.files.map(file => [file.repoId, file.result]));
      const result = await loadNeededFile(item.owner, item.repo);
      mergeSources(expected, result.kind === "disconnected" ? { kind: "disconnected" } : { kind: "ok", files: [{ repoId: item.repoId, result }] });
    },
  });

  const pendingKey =
    checkOff.isPending && checkOff.variables ? checkOff.variables.key : null;

  return (
    <Card className="mb-4 overflow-hidden p-0">
      <div className="flex flex-wrap items-start gap-2.5 border-b border-border bg-surface-muted/40 px-4 py-3">
        <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {t.github.needed.title}
            </span>
            {!loading && totalItems > 0 && (
              <span className="rounded-full bg-primary px-[7px] py-[3px] text-[10px] font-semibold tabular text-primary-foreground">
                {totalItems}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-foreground-muted">
            {t.github.needed.subtitle}
          </p>
        </div>
        {!loading && !disconnected && importCount > 0 && (
          <Tooltip content={t.github.needed.createTodosHint}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => importTodos.mutate()}
              disabled={importTodos.isPending}
              className="ml-auto shrink-0"
            >
              {importTodos.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ListPlus className="h-3.5 w-3.5" />
              )}
              {t.github.needed.createTodos}
            </Button>
          </Tooltip>
        )}
      </div>

      {!loading && !disconnected && unavailable.length > 0 && <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="min-w-0 flex-1 break-words text-xs text-foreground-muted">{t.github.needed.unavailable(unavailable.map(repo => repo.full_name).join(", "))}</p>
        <Button size="sm" variant="outline" onClick={() => retrySources.mutate()} disabled={retrySources.isPending || batch.isFetching || checkOff.isPending}>{t.common.retry}</Button>
      </div>}
      {loading ? (
        <div className="space-y-2 p-4">
          <p className="text-xs text-foreground-subtle">
            {t.github.needed.scanning}
          </p>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : disconnected ? (
        <p className="px-4 py-6 text-center text-sm text-foreground-muted">
          {t.github.needed.reconnect}
        </p>
      ) : totalItems === 0 && unavailable.length > 0 ? null : totalItems === 0 ? (
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-foreground-subtle">
            <Check className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {t.github.needed.allClear}
          </p>
          <p className="mt-1 max-w-xs text-xs text-foreground-muted">
            {t.github.needed.allClearDesc}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {groups.map((g) => (
            <div key={g.repo.id} className="px-4 py-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <a
                  href={g.htmlUrl ?? g.repo.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted hover:text-foreground"
                  title={g.repo.full_name}
                >
                  <span className="min-w-0 truncate">{g.repo.name}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
                <span className="text-[10px] tabular text-foreground-subtle">
                  {t.github.needed.itemsCount(g.items.length)}
                </span>
              </div>
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const busy = pendingKey === item.key;
                  return (
                    <li key={item.key}>
                      <Tooltip content={t.github.needed.checkOff}>
                        <button
                          type="button"
                          onClick={() => checkOff.mutate(item)}
                          disabled={checkOff.isPending}
                          aria-label={t.github.needed.checkOff + ": " + item.text}
                          className="group flex min-h-11 w-full items-start md:min-h-0 gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover focus-ring disabled:opacity-60"
                        >
                          <span
                            aria-hidden
                            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border transition-colors group-hover:border-primary"
                          >
                            {busy ? (
                              <Loader2 className="h-3 w-3 animate-spin text-foreground-muted" />
                            ) : (
                              <Check className="h-3 w-3 text-transparent group-hover:text-primary" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1 break-words text-sm text-foreground">
                            {item.text}
                          </span>
                        </button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
