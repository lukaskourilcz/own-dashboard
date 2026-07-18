"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Flag,
  Heart,
  ListTodo,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { GithubIcon } from "@/components/icons/github";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { useTasksPerCategory } from "@/lib/use-prefs";
import { useDict, useDateLocale, type Dict } from "@/lib/i18n";
import { daysUntilDate, parseDateOnly } from "@/lib/date-keys";
import { qk } from "@/lib/queries/keys";
import { useReposQuery } from "@/lib/github-queries";
import { commitFile, loadRepoFile } from "@/lib/github";
import { NEEDED_FILE, removeNeededLine } from "@/lib/needed";
import {
  buildNeededRows,
  diffNeededTodos,
  type NeededTodoRow,
} from "@/lib/needed-sync";
import type { Locale } from "date-fns";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TodosPanel({
  todos,
  compact = false,
  partnerTodos,
  partnerName,
}: {
  todos: Todo[];
  compact?: boolean;
  partnerTodos?: Todo[];
  partnerName?: string;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const locale = useDateLocale();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [newImportance, setNewImportance] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  // Tasks filter: 0 = show all (scored + unscored); 1–5 = only tasks whose
  // importance is at least this. Applies to the full view's open-task groups.
  const [minImportance, setMinImportance] = useState(0);
  // How many tasks each category shows before "show all" (Settings; 0 = all).
  const { count: tasksPerCategory } = useTasksPerCategory();
  // Repos are only needed for the full view's Refresh / NEEDED sync — keep the
  // query off in the compact dashboard widget.
  const reposQuery = useReposQuery(!compact);

  const addMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("todos")
        .insert({
          title: title.trim(),
          due_date: dueDate || null,
          importance: newImportance ? Number(newImportance) : null,
          user_id: userId,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Todo;
    },
    onSuccess: (todo) => {
      qc.setQueryData<Todo[]>(qk.todos, (prev = []) => [todo, ...prev]);
      setTitle("");
      setDueDate("");
      setNewImportance("");
      setAddOpen(false);
      void qc.invalidateQueries({ queryKey: qk.todos });
    },
  });

  // Optimistic toggle: flip in the cache immediately, roll back on error,
  // reconcile with the DB via invalidate once settled.
  const toggleMutation = useMutation({
    mutationFn: async (td: Todo) => {
      const { error } = await supabase
        .from("todos")
        .update({ done: !td.done })
        .eq("id", td.id);
      if (error) throw error;
    },
    onMutate: async (td) => {
      await qc.cancelQueries({ queryKey: qk.todos });
      const prev = qc.getQueryData<Todo[]>(qk.todos);
      qc.setQueryData<Todo[]>(qk.todos, (old = []) =>
        old.map((x) => (x.id === td.id ? { ...x, done: !td.done } : x)),
      );
      return { prev };
    },
    onError: (_e, _td, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.todos, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.todos }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("todos").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.todos });
      const prev = qc.getQueryData<Todo[]>(qk.todos);
      qc.setQueryData<Todo[]>(qk.todos, (old = []) =>
        old.filter((td) => td.id !== id),
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.todos, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.todos }),
  });

  // Refresh: re-scan every repo's NEEDED.md, add newly-listed tasks and drop
  // open GitHub tasks whose source line is gone. A repo whose file failed to
  // load (transient error) is left untouched so nothing is lost on a blip.
  const refresh = useMutation({
    mutationFn: async () => {
      const reposData = reposQuery.data;
      if (!reposData || reposData.kind !== "ok") {
        throw new Error(
          reposData?.kind === "disconnected" ? "disconnected" : "no-repos",
        );
      }
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("disconnected");

      const nowIso = new Date().toISOString();
      const scanned = new Set<string>();
      const freshRows: NeededTodoRow[] = [];
      for (const repo of reposData.repos) {
        const res = await loadRepoFile(repo.owner, repo.name, NEEDED_FILE);
        if (res.kind === "disconnected") throw new Error("disconnected");
        if (res.kind === "ok") {
          scanned.add(String(repo.id));
          freshRows.push(
            ...buildNeededRows(userId, repo, res.content, res.htmlUrl, nowIso),
          );
        } else if (res.kind === "not-found") {
          // No NEEDED.md anymore → its open tasks are stale, allow cleanup.
          scanned.add(String(repo.id));
        }
        // "error" → skip: don't touch this repo's tasks on a transient failure.
      }

      const { data: existing } = await supabase
        .from("todos")
        .select("*")
        .eq("user_id", userId);
      const { toInsert, toDeleteIds } = diffNeededTodos(
        scanned,
        freshRows,
        (existing ?? []) as Todo[],
      );

      if (toDeleteIds.length) {
        const { error } = await supabase
          .from("todos")
          .delete()
          .in("id", toDeleteIds);
        if (error) throw error;
      }
      if (toInsert.length) {
        const { error } = await supabase.from("todos").insert(toInsert);
        if (error) throw error;
      }
      return { added: toInsert.length, removed: toDeleteIds.length };
    },
    onSuccess: ({ added, removed }) => {
      toast.ok(
        added === 0 && removed === 0
          ? t.todos.refreshNothing
          : t.todos.refreshDone(added, removed),
      );
      void qc.invalidateQueries({ queryKey: qk.todos });
    },
    onError: (e) => {
      const m = (e as Error).message;
      toast.err(
        m === "disconnected"
          ? t.todos.refreshDisconnected
          : m === "no-repos"
            ? t.todos.refreshNoRepos
            : t.todos.refreshErr,
      );
    },
  });

  // Delete finished NEEDED tasks from their repos' NEEDED.md (one commit per
  // repo), then clear the finished rows. Repos whose commit fails keep their
  // rows so the action can be retried.
  const clearFinished = useMutation({
    mutationFn: async () => {
      const finished = todos.filter(
        (td) =>
          td.done &&
          td.source === "github" &&
          td.needed_raw &&
          td.repo_owner &&
          td.repo_name,
      );
      if (finished.length === 0) return { removed: 0 };

      const byRepo = new Map<string, Todo[]>();
      for (const td of finished) {
        const key = td.repo_id ?? `${td.repo_owner}/${td.repo_name}`;
        const arr = byRepo.get(key);
        if (arr) arr.push(td);
        else byRepo.set(key, [td]);
      }

      const idsToDelete: string[] = [];
      for (const tasks of byRepo.values()) {
        const first = tasks[0];
        const owner = first.repo_owner!;
        const name = first.repo_name!;
        const res = await loadRepoFile(owner, name, NEEDED_FILE);
        if (res.kind === "disconnected") throw new Error("disconnected");
        if (res.kind === "not-found") {
          // File already gone — the lines are gone with it; just clear rows.
          idsToDelete.push(...tasks.map((x) => x.id));
          continue;
        }
        if (res.kind !== "ok") continue; // transient — keep rows, retry later

        let content = res.content;
        for (const td of tasks) {
          const { next, removed } = removeNeededLine(content, td.needed_raw!);
          if (removed) content = next;
        }
        if (content !== res.content) {
          const outcome = await commitFile({
            owner,
            repo: name,
            path: NEEDED_FILE,
            content,
            message: t.todos.finishedCommitMessage(tasks.length),
          });
          if (!outcome.ok) {
            if (outcome.status === 401) throw new Error("disconnected");
            continue; // commit failed — keep rows
          }
        }
        idsToDelete.push(...tasks.map((x) => x.id));
      }

      if (idsToDelete.length) {
        const { error } = await supabase
          .from("todos")
          .delete()
          .in("id", idsToDelete);
        if (error) throw error;
      }
      return { removed: idsToDelete.length };
    },
    onSuccess: ({ removed }) => {
      toast.ok(
        removed === 0
          ? t.todos.clearFromNeededNone
          : t.todos.clearFromNeededDone(removed),
      );
      void qc.invalidateQueries({ queryKey: qk.todos });
      // Drop cached NEEDED file contents so the Repos checklist reflects it.
      void qc.invalidateQueries({ queryKey: ["github", "file"] });
    },
    onError: (e) => {
      toast.err(
        (e as Error).message === "disconnected"
          ? t.todos.refreshDisconnected
          : t.todos.clearFromNeededErr,
      );
    },
  });

  const saving = addMutation.isPending;

  function addTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    addMutation.mutate();
  }

  const toggle = (td: Todo) => toggleMutation.mutate(td);
  const remove = (id: string) => removeMutation.mutate(id);

  const open = todos.filter((td) => !td.done);
  const done = todos.filter((td) => td.done);
  const visible = compact ? open.slice(0, 5) : todos;

  if (compact) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>{t.todos.compactTitle}</CardTitle>
          <span className="text-xs text-foreground-subtle tabular">
            {t.todos.openDoneCount(open.length, done.length)}
          </span>
        </CardHeader>
        <CardContent>
          <QuickAddForm
            t={t}
            title={title}
            setTitle={setTitle}
            saving={saving}
            onSubmit={addTodo}
          />
          {visible.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={t.todos.allClear}
              description={t.todos.allClearDescription}
              className="py-6"
            />
          ) : (
            <TodoList
              t={t}
              locale={locale}
              items={visible}
              onToggle={toggle}
              compact
            />
          )}
          {partnerTodos && partnerTodos.length > 0 && (
            <PartnerBlock
              t={t}
              locale={locale}
              items={partnerTodos.filter((td) => !td.done).slice(0, 3)}
              partnerName={partnerName}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  // Full view: open GitHub tasks become per-repo cards with a subcard each;
  // hand-added tasks collect in a "Personal" card. The importance filter (0 =
  // all) narrows to tasks scoring at least `minImportance`; unscored tasks
  // (null) count as 0, so any active filter hides them.
  const passesImportance = (td: Todo) =>
    minImportance === 0 || (td.importance ?? 0) >= minImportance;
  const openVisible = open.filter(passesImportance);
  const hiddenByFilter = open.length - openVisible.length;
  const openGithub = openVisible
    .filter((td) => td.source === "github" && td.repo_id)
    .sort(byImportanceThenDue);
  const openPersonal = openVisible
    .filter((td) => !(td.source === "github" && td.repo_id))
    .sort(byImportanceThenDue);

  const repoMap = new Map<
    string,
    { name: string; fullName: string | null; url: string | null; items: Todo[] }
  >();
  for (const td of openGithub) {
    const key = td.repo_id!;
    const g = repoMap.get(key);
    if (g) g.items.push(td);
    else
      repoMap.set(key, {
        name: td.repo_name ?? td.category ?? key,
        fullName: td.repo_full_name,
        url: td.repo_url,
        items: [td],
      });
  }
  const repoGroups = [...repoMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const finishedNeeded = done.filter(
    (td) => td.source === "github" && td.needed_raw,
  ).length;

  return (
    <div>
      <PageHeader
        title={t.todos.title}
        description={t.todos.description}
        action={
          <div className="flex items-center gap-2">
            <Tooltip content={t.todos.refreshHint}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending || reposQuery.isPending}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    refresh.isPending && "animate-spin",
                  )}
                />
                {refresh.isPending ? t.todos.refreshing : t.todos.refresh}
              </Button>
            </Tooltip>
            <Tooltip content={t.todos.addTask}>
              <Button
                size="icon"
                onClick={() => setAddOpen(true)}
                aria-label={t.todos.addTask}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        }
      />
      <div className="space-y-4">
          {open.length > 0 && (
            <ImportanceFilter
              t={t}
              value={minImportance}
              onChange={setMinImportance}
              hidden={hiddenByFilter}
            />
          )}
          {open.length === 0 ? (
            <Card>
              <CardContent className="pt-5">
                <EmptyState
                  icon={ListTodo}
                  title={t.todos.nothingOnPlate}
                  description={t.todos.nothingOnPlateDescription}
                />
              </CardContent>
            </Card>
          ) : openVisible.length === 0 ? (
            <Card>
              <CardContent className="pt-5">
                <EmptyState
                  icon={Flag}
                  title={t.todos.filterEmptyTitle}
                  description={t.todos.filterEmptyDescription(minImportance)}
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {repoGroups.map((g) => (
                <TaskGroupCard
                  key={g.fullName ?? g.name}
                  t={t}
                  locale={locale}
                  items={g.items}
                  limit={tasksPerCategory}
                  onToggle={toggle}
                  onRemove={remove}
                  header={
                    g.url ? (
                      <a
                        href={g.url}
                        target="_blank"
                        rel="noreferrer"
                        title={g.fullName ?? g.name}
                        className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-foreground hover:underline"
                      >
                        <GithubIcon className="h-4 w-4 shrink-0 text-foreground-muted" />
                        <span className="truncate">{g.name}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-foreground-subtle" />
                      </a>
                    ) : (
                      <span className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-foreground">
                        <GithubIcon className="h-4 w-4 shrink-0 text-foreground-muted" />
                        <span className="truncate">{g.name}</span>
                      </span>
                    )
                  }
                />
              ))}
              {openPersonal.length > 0 && (
                <TaskGroupCard
                  t={t}
                  locale={locale}
                  items={openPersonal}
                  limit={tasksPerCategory}
                  onToggle={toggle}
                  onRemove={remove}
                  header={
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ListTodo className="h-4 w-4 shrink-0 text-foreground-muted" />
                      {t.todos.personalGroup}
                    </span>
                  }
                />
              )}
            </>
          )}

          {done.length > 0 && (
            <FinishedSection
              t={t}
              locale={locale}
              items={done}
              open={showFinished}
              onToggleOpen={() => setShowFinished((v) => !v)}
              onReopen={toggle}
              onRemove={remove}
              canClearNeeded={finishedNeeded > 0}
              clearing={clearFinished.isPending}
              onClearNeeded={() => {
                if (window.confirm(t.todos.clearFromNeededConfirm))
                  clearFinished.mutate();
              }}
            />
          )}

          {partnerTodos && partnerTodos.length > 0 && (
            <Card>
              <CardContent className="pt-5">
                <PartnerBlock
                  t={t}
                  locale={locale}
                  items={partnerTodos}
                  partnerName={partnerName}
                />
              </CardContent>
            </Card>
          )}
      </div>

      <AddTaskDialog
        t={t}
        open={addOpen}
        onOpenChange={setAddOpen}
        title={title}
        setTitle={setTitle}
        dueDate={dueDate}
        setDueDate={setDueDate}
        newImportance={newImportance}
        setNewImportance={setNewImportance}
        saving={saving}
        onSubmit={addTodo}
      />
    </div>
  );
}

/* ---------------------------- Task group card ---------------------------- */

/** Order tasks within a category: highest importance first (unscored last),
 * then soonest due date first. */
function byImportanceThenDue(a: Todo, b: Todo): number {
  const ia = a.importance ?? 0;
  const ib = b.importance ?? 0;
  if (ia !== ib) return ib - ia;
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return 0;
}

/**
 * A collapsible category card (one repo, or "Personal"). Shows the first
 * `limit` tasks (0 = all) with a "show all / show less" control, and the whole
 * body can be collapsed from the header. Tasks arrive pre-sorted by importance.
 */
function TaskGroupCard({
  t,
  locale,
  header,
  items,
  limit,
  onToggle,
  onRemove,
}: {
  t: Dict;
  locale: Locale;
  header: React.ReactNode;
  items: Todo[];
  limit: number;
  onToggle: (td: Todo) => void;
  onRemove: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const total = items.length;
  const capped = limit > 0 && !showAll;
  const shown = capped ? items.slice(0, limit) : items;
  const canExpand = limit > 0 && total > limit;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-border bg-surface-muted/40 px-2 py-2.5 pr-4">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.todos.expandGroup : t.todos.collapseGroup}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">{header}</div>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold tabular text-foreground-muted">
          {t.todos.repoTaskCount(total)}
        </span>
      </div>
      {!collapsed && (
        <>
          <ul className="space-y-2 p-3">
            <AnimatePresence initial={false}>
              {shown.map((td) => (
                <TaskSubcard
                  key={td.id}
                  t={t}
                  locale={locale}
                  td={td}
                  onToggle={onToggle}
                  onRemove={onRemove}
                />
              ))}
            </AnimatePresence>
          </ul>
          {canExpand && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="w-full border-t border-border/60 px-4 py-2 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
            >
              {showAll ? t.todos.showLess : t.todos.showAllCount(total)}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

/** One task, rendered as a bordered subcard with its generated date + timer. */
function TaskSubcard({
  t,
  locale,
  td,
  onToggle,
  onRemove,
}: {
  t: Dict;
  locale: Locale;
  td: Todo;
  onToggle: (td: Todo) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ duration: 0.15 }}
      className="group flex items-start gap-2.5 rounded-md border border-border bg-surface-muted/30 px-3 py-2"
    >
      <Checkbox
        checked={td.done}
        onChange={() => onToggle(td)}
        label={td.title}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 break-words text-sm text-foreground">
            {td.title}
          </p>
          {td.importance != null && (
            <ImportanceBadge t={t} value={td.importance} />
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-subtle">
          {td.generated_at && (
            <span className="tabular">
              {t.todos.generatedOn(
                format(new Date(td.generated_at), t.todos.dueDateFormat, {
                  locale,
                }),
              )}
            </span>
          )}
          {td.due_date && <TimeChip t={t} due={td.due_date} />}
        </div>
      </div>
      <Tooltip content={t.common.delete}>
        <button
          type="button"
          onClick={() => onRemove(td.id)}
          aria-label={t.common.delete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-foreground-subtle hover:text-destructive focus-ring"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </motion.li>
  );
}

/** The "time to finish" chip — colour shifts as the 7-day timer runs down. */
function TimeChip({ t, due }: { t: Dict; due: string }) {
  const left = daysUntilDate(due);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 font-medium tabular",
        left < 0
          ? "bg-destructive/10 text-destructive"
          : left <= 2
            ? "bg-warning/10 text-warning"
            : "bg-surface text-foreground-muted",
      )}
    >
      {t.todos.timeLeft(left)}
    </span>
  );
}

/* ------------------------------- Finished -------------------------------- */

function FinishedSection({
  t,
  locale,
  items,
  open,
  onToggleOpen,
  onReopen,
  onRemove,
  canClearNeeded,
  clearing,
  onClearNeeded,
}: {
  t: Dict;
  locale: Locale;
  items: Todo[];
  open: boolean;
  onToggleOpen: () => void;
  onReopen: (td: Todo) => void;
  onRemove: (id: string) => void;
  canClearNeeded: boolean;
  clearing: boolean;
  onClearNeeded: () => void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-muted/40 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggleOpen}
          className="inline-flex items-center gap-2 text-sm font-semibold text-foreground focus-ring rounded"
        >
          {t.todos.finishedTitle}
          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold tabular text-foreground-muted">
            {t.todos.finishedCount(items.length)}
          </span>
          <span className="text-[11px] font-normal text-foreground-subtle">
            {open ? t.todos.finishedHide : t.todos.finishedShow}
          </span>
        </button>
        {canClearNeeded && (
          <Tooltip content={t.todos.clearFromNeededHint}>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={onClearNeeded}
              disabled={clearing}
            >
              {clearing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GithubIcon className="h-3.5 w-3.5" />
              )}
              {clearing ? t.todos.clearingFromNeeded : t.todos.clearFromNeeded}
            </Button>
          </Tooltip>
        )}
      </div>
      {open && (
        <ul className="divide-y divide-border/60">
          {items.map((td) => (
            <li
              key={td.id}
              className="group flex items-center gap-3 px-4 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground-subtle line-through">
                  {td.title}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-foreground-subtle">
                  {td.repo_name && <span className="truncate">{td.repo_name}</span>}
                  {td.due_date && (
                    <span className="tabular">
                      {t.todos.due(
                        format(parseDateOnly(td.due_date), t.todos.dueDateFormat, {
                          locale,
                        }),
                      )}
                    </span>
                  )}
                </div>
              </div>
              <Tooltip content={t.todos.reopen}>
                <button
                  type="button"
                  onClick={() => onReopen(td)}
                  aria-label={t.todos.reopen}
                  className="p-1 rounded text-foreground-subtle hover:text-foreground focus-ring"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip content={t.common.delete}>
                <button
                  type="button"
                  onClick={() => onRemove(td.id)}
                  aria-label={t.common.delete}
                  className="p-1 rounded text-foreground-subtle hover:text-destructive focus-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------ Importance ------------------------------- */

// Tailwind classes per score, warmer/stronger as importance climbs.
const IMPORTANCE_STYLES: Record<number, string> = {
  1: "bg-surface text-foreground-subtle border-border",
  2: "bg-surface text-foreground-muted border-border",
  3: "bg-primary/10 text-primary border-primary/20",
  4: "bg-warning/10 text-warning border-warning/20",
  5: "bg-destructive/10 text-destructive border-destructive/20",
};

/** Small pill showing a task's 1–5 importance score. */
function ImportanceBadge({ t, value }: { t: Dict; value: number }) {
  return (
    <Tooltip content={t.todos.importanceOf(value)}>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular",
          IMPORTANCE_STYLES[value] ?? IMPORTANCE_STYLES[1],
        )}
        aria-label={t.todos.importanceOf(value)}
      >
        <Flag className="h-2.5 w-2.5" />
        {value}
      </span>
    </Tooltip>
  );
}

/** Segmented "minimum importance" filter. 0 = all; 1–5 = at-least-N. */
function ImportanceFilter({
  t,
  value,
  onChange,
  hidden,
}: {
  t: Dict;
  value: number;
  onChange: (v: number) => void;
  hidden: number;
}) {
  const levels = [0, 1, 2, 3, 4, 5];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
        <Flag className="h-3.5 w-3.5" />
        {t.todos.importanceFilterLabel}
      </span>
      <div className="inline-flex overflow-hidden rounded-md border border-border">
        {levels.map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => onChange(lvl)}
            aria-pressed={value === lvl}
            className={cn(
              "px-2.5 py-1 text-xs font-medium tabular transition-colors border-l border-border first:border-l-0 focus-ring",
              value === lvl
                ? "bg-primary text-primary-foreground"
                : "bg-surface text-foreground-muted hover:bg-surface-hover",
            )}
          >
            {lvl === 0 ? t.todos.filterAll : t.todos.filterMin(lvl)}
          </button>
        ))}
      </div>
      {value !== 0 && hidden > 0 && (
        <span className="text-[11px] text-foreground-subtle tabular">
          {t.todos.filterHidden(hidden)}
        </span>
      )}
    </div>
  );
}

/* ------------------------------ Add dialog ------------------------------- */

/** Add-task form in a popup, opened by the header "+". Kept out of the page
 * body so the full width can show current tasks — this form is rarely used
 * (most tasks are generated from repos' NEEDED.md). */
function AddTaskDialog({
  t,
  open,
  onOpenChange,
  title,
  setTitle,
  dueDate,
  setDueDate,
  newImportance,
  setNewImportance,
  saving,
  onSubmit,
}: {
  t: Dict;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  setTitle: (v: string) => void;
  dueDate: string;
  setDueDate: (v: string) => void;
  newImportance: string;
  setNewImportance: (v: string) => void;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.todos.addTaskTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-add-title">{t.todos.taskLabel}</Label>
              <Input
                id="todo-add-title"
                placeholder={t.todos.whatNeedsDoing}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="todo-add-due">{t.todos.dueDate}</Label>
                <Input
                  id="todo-add-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="todo-add-importance">
                  {t.todos.importanceLabel}
                </Label>
                <SimpleSelect
                  id="todo-add-importance"
                  value={newImportance}
                  onValueChange={setNewImportance}
                  options={[
                    { value: "", label: t.todos.importanceNone },
                    ...[5, 4, 3, 2, 1].map((n) => ({
                      value: String(n),
                      label: t.todos.importanceOption(n),
                    })),
                  ]}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t.common.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={saving || !title.trim()}>
                <Plus className="h-3.5 w-3.5" />
                {t.todos.addTask}
              </Button>
            </div>
          </form>
        </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Shared UI ------------------------------- */

function QuickAddForm({
  t,
  title,
  setTitle,
  saving,
  onSubmit,
}: {
  t: Dict;
  title: string;
  setTitle: (v: string) => void;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="flex gap-2 mb-3">
      <Input
        placeholder={t.todos.quickAddPlaceholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Button
        type="submit"
        disabled={saving}
        size="sm"
        aria-label={t.todos.addTask}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}

function TodoList({
  t,
  locale,
  items,
  onToggle,
  onRemove,
  compact,
}: {
  t: Dict;
  locale: Locale;
  items: Todo[];
  onToggle: (todo: Todo) => void;
  onRemove?: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <ul className="-mx-2">
      <AnimatePresence initial={false}>
        {items.map((td) => (
          <motion.li
            key={td.id}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
            transition={{ duration: 0.15 }}
            className="group flex items-center gap-3 rounded-md px-2 py-1.5 row-hover"
          >
            <Checkbox
              checked={td.done}
              onChange={() => onToggle(td)}
              label={td.title}
            />
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm truncate transition-colors",
                  td.done && "line-through text-foreground-subtle",
                )}
              >
                {td.title}
              </p>
              {td.due_date && (
                <p className="text-[11px] text-foreground-subtle tabular">
                  {t.todos.due(
                    format(parseDateOnly(td.due_date), t.todos.dueDateFormat, {
                      locale,
                    }),
                  )}
                </p>
              )}
            </div>
            {!compact && onRemove && (
              <Tooltip content={t.common.delete}>
                <button
                  type="button"
                  onClick={() => onRemove(td.id)}
                  aria-label={t.common.delete}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-foreground-subtle hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "h-4 w-4 shrink-0 rounded border transition-all duration-150 ease-out flex items-center justify-center focus-ring",
        checked
          ? "bg-primary border-primary text-primary-foreground"
          : "border-border-strong hover:border-foreground/40",
        className,
      )}
    >
      {checked && (
        <svg
          viewBox="0 0 12 12"
          className="h-2.5 w-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="2.5 6.5 5 9 9.5 3.5" />
        </svg>
      )}
    </button>
  );
}

function PartnerBlock({
  t,
  locale,
  items,
  partnerName,
}: {
  t: Dict;
  locale: Locale;
  items: Todo[];
  partnerName?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1">
      <SectionLabel className="mb-2 inline-flex items-center gap-1.5">
        <Heart className="h-3 w-3" />
        {t.todos.fromPartner(partnerName ?? t.todos.partnerFallback)}
      </SectionLabel>
      <ul className="-mx-2">
        {items.map((td) => (
          <li
            key={td.id}
            className="flex items-center gap-3 rounded-md px-2 py-1.5 text-foreground-muted"
          >
            <span
              className={cn(
                "h-4 w-4 shrink-0 rounded border border-border-strong flex items-center justify-center text-[10px]",
                td.done && "bg-surface-muted",
              )}
            >
              {td.done ? "✓" : ""}
            </span>
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm truncate",
                  td.done && "line-through text-foreground-subtle",
                )}
              >
                {td.title}
              </p>
              {td.due_date && (
                <p className="text-[11px] text-foreground-subtle tabular">
                  {t.todos.due(
                    format(parseDateOnly(td.due_date), t.todos.dueDateFormat, {
                      locale,
                    }),
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
