"use client";

import { useMemo } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
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
import {
  commitFile,
  loadRepoFile,
  type GithubRepo,
  type RepoFileResult,
} from "@/lib/github";
import {
  NEEDED_FILE,
  parseNeeded,
  removeNeededLine,
  type NeededItem,
} from "@/lib/needed";
import { buildNeededRows, neededKey } from "@/lib/needed-sync";
import type { Todo } from "@/lib/types";

function fileQueryKey(repoId: string) {
  return ["github", "file", repoId, NEEDED_FILE] as const;
}

export function NeededChecklist({ repos }: { repos: GithubRepo[] }) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();

  // Sync every repo's NEEDED.md. Same cache key as elsewhere, 5-min freshness.
  const results = useQueries({
    queries: repos.map((repo) => ({
      queryKey: fileQueryKey(String(repo.id)),
      queryFn: () => loadRepoFile(repo.owner, repo.name, NEEDED_FILE),
      staleTime: 5 * 60_000,
    })),
  });

  const loading = results.some((r) => r.isPending);
  const disconnected = results.some(
    (r) => r.data?.kind === "disconnected",
  );

  const groups = useMemo(() => {
    return repos
      .map((repo, i) => {
        const res = results[i]?.data;
        if (!res || res.kind !== "ok") return null;
        const items = parseNeeded(res.content, repo, res.htmlUrl);
        if (items.length === 0) return null;
        return { repo, items, htmlUrl: res.htmlUrl };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [repos, results]);

  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);

  // Items to import as todos — prefers each file's task checkboxes, markdown
  // stripped. Kept separate from the on-screen `groups` (which shows everything).
  const importCount = useMemo(() => {
    return repos.reduce((n, repo, i) => {
      const res = results[i]?.data;
      if (!res || res.kind !== "ok") return n;
      return n + parseNeeded(res.content, repo, res.htmlUrl).length;
    }, 0);
  }, [repos, results]);

  // Create categorized todos from every repo's NEEDED.md. Each task's category
  // is the repo name; existing tasks (same category + title) are skipped so
  // re-clicking never duplicates.
  const importTodos = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");

      const nowIso = new Date().toISOString();
      const candidates = repos.flatMap((repo, i) => {
        const res = results[i]?.data;
        if (!res || res.kind !== "ok") return [];
        return buildNeededRows(userId, repo, res.content, res.htmlUrl, nowIso);
      });
      if (candidates.length === 0) return { inserted: 0, repos: 0 };

      const { data: existing } = await supabase
        .from("todos")
        .select("title, category, repo_id, needed_raw")
        .eq("user_id", userId);
      const seen = new Set(
        (existing ?? []).map((e) =>
          neededKey(
            (e as Partial<Todo>).repo_id ?? null,
            (e as Partial<Todo>).needed_raw ?? null,
            e.title ?? "",
          ),
        ),
      );

      const rows = candidates.filter((c) => {
        const k = neededKey(c.repo_id, c.needed_raw, c.title);
        if (seen.has(k)) return false; // already imported
        seen.add(k);
        return true;
      });
      if (rows.length === 0) return { inserted: 0, repos: 0 };

      const { error } = await supabase.from("todos").insert(rows);
      if (error) throw error;
      return { inserted: rows.length, repos: new Set(rows.map((r) => r.category)).size };
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
      toast.err(
        (e as Error).message === "no-user"
          ? t.github.needed.reconnect
          : t.github.needed.todosErr,
      );
    },
  });

  const checkOff = useMutation({
    mutationFn: async (item: NeededItem) => {
      const cached = qc.getQueryData<RepoFileResult>(
        fileQueryKey(item.repoId),
      );
      if (!cached || cached.kind !== "ok") throw new Error("stale");
      const { next, removed } = removeNeededLine(cached.content, item.raw);
      if (!removed) throw new Error("gone"); // already removed elsewhere
      const outcome = await commitFile({
        owner: item.owner,
        repo: item.repo,
        path: NEEDED_FILE,
        content: next,
        message: t.github.needed.commitMessage(item.text.slice(0, 64)),
      });
      if (!outcome.ok) throw outcome;
      return item;
    },
    onSuccess: (item) => {
      toast.ok(t.github.needed.removedFrom(item.repo));
      void qc.invalidateQueries({ queryKey: fileQueryKey(item.repoId) });
    },
    onError: (e) => {
      const status = (e as { status?: number }).status;
      toast.err(
        status === 401 ? t.github.needed.reconnect : t.github.needed.updateErr,
      );
    },
  });

  const pendingKey =
    checkOff.isPending && checkOff.variables ? checkOff.variables.key : null;

  return (
    <Card className="mb-4 overflow-hidden p-0">
      <div className="flex items-start gap-2.5 border-b border-border bg-surface-muted/40 px-4 py-3">
        <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
        <div className="min-w-0 flex-1">
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
              className="shrink-0"
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
      ) : totalItems === 0 ? (
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
                  className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted hover:text-foreground"
                  title={g.repo.full_name}
                >
                  {g.repo.name}
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
                          className="group flex w-full items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover focus-ring disabled:opacity-60"
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
