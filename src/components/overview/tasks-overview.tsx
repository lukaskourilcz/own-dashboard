"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { GithubIcon } from "@/components/icons/github";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { useDict, type Dict } from "@/lib/i18n";
import { daysUntilDate } from "@/lib/date-keys";
import { qk } from "@/lib/queries/keys";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A category bucket: a GitHub repo, a named category, or the Personal group. */
type Group = {
  key: string;
  name: string;
  kind: "github" | "personal";
  url: string | null;
  open: Todo[];
  total: number;
};

/**
 * Overview centrepiece — every open task bucketed into its category so you can
 * see, at a glance, how much is left on each front. GitHub-sourced tasks group
 * by their repo; hand-added tasks fall into their category (or "Personal").
 */
export function TasksOverview({
  todos,
  onOpenAll,
}: {
  todos: Todo[];
  onOpenAll?: () => void;
}) {
  const t = useDict();
  const supabase = createClient();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("todos")
        .insert({ title: title.trim(), user_id: userId })
        .select()
        .single();
      if (error) throw error;
      return data as Todo;
    },
    onSuccess: (todo) => {
      qc.setQueryData<Todo[]>(qk.todos, (prev = []) => [todo, ...prev]);
      setTitle("");
      void qc.invalidateQueries({ queryKey: qk.todos });
    },
  });

  // Optimistic toggle — mirror the full Tasks panel so checking off here feels
  // instant and reconciles with the DB on settle.
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

  const openCount = useMemo(() => todos.filter((td) => !td.done).length, [todos]);

  // Bucket by category, tracking open items + total (open+done) for progress.
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const td of todos) {
      let key: string;
      let name: string;
      let kind: Group["kind"];
      let url: string | null = null;
      if (td.source === "github" && td.repo_id) {
        key = `repo:${td.repo_id}`;
        name = td.repo_name ?? td.category ?? td.repo_id;
        kind = "github";
        url = td.repo_url;
      } else if (td.category) {
        key = `cat:${td.category}`;
        name = td.category;
        kind = "personal";
      } else {
        key = "personal";
        name = t.todos.personalGroup;
        kind = "personal";
      }
      const g =
        map.get(key) ??
        (map.set(key, { key, name, kind, url, open: [], total: 0 }),
        map.get(key)!);
      g.total += 1;
      if (!td.done) g.open.push(td);
    }
    // Only surface buckets that still have something open; busiest first.
    return [...map.values()]
      .filter((g) => g.open.length > 0)
      .sort((a, b) => b.open.length - a.open.length || a.name.localeCompare(b.name));
  }, [todos, t.todos.personalGroup]);

  return (
    <Card className="overflow-hidden">
      {/* Header — title, live open count, and a jump to the full Tasks view. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground">
          <ListTodo className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {t.todos.title}
          </h2>
          <p className="text-xs text-foreground-subtle tabular">
            {t.todos.totalOpen(openCount)}
          </p>
        </div>
        {onOpenAll && (
          <button
            type="button"
            onClick={onOpenAll}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
          >
            {t.todos.openAll}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <CardContent className="space-y-4 pt-4">
        {/* One-line add — parity with the old compact tasks widget. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) addMutation.mutate();
          }}
          className="flex gap-2"
        >
          <Input
            placeholder={t.todos.quickAddPlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            disabled={addMutation.isPending}
            aria-label={t.todos.addTask}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </form>

        {groups.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={t.todos.allClear}
            description={t.todos.allClearDescription}
            className="py-8"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <CategoryCard
                key={g.key}
                t={t}
                group={g}
                onToggle={(td) => toggleMutation.mutate(td)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** One category: name, how many remain, a progress bar, and its top tasks. */
function CategoryCard({
  t,
  group,
  onToggle,
}: {
  t: Dict;
  group: Group;
  onToggle: (td: Todo) => void;
}) {
  // Collapsed by default so the overview stays compact — expand to see tasks.
  const [open, setOpen] = useState(false);
  const remaining = group.open.length;
  const doneRatio = group.total > 0 ? (group.total - remaining) / group.total : 0;
  const preview = group.open.slice(0, 3);
  const more = remaining - preview.length;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface-muted/30 p-3.5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? t.todos.collapseGroup : t.todos.expandGroup}
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        {group.kind === "github" ? (
          <GithubIcon className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
        ) : (
          <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
        )}
        <div className="min-w-0 flex-1">
          {group.url ? (
            <a
              href={group.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-semibold text-foreground hover:underline"
              title={group.name}
            >
              {group.name}
            </a>
          ) : (
            <span className="block truncate text-sm font-semibold text-foreground">
              {group.name}
            </span>
          )}
        </div>
        <div className="shrink-0 text-right leading-none">
          <span className="text-lg font-semibold tabular text-foreground">
            {remaining}
          </span>
          <span className="ml-1 text-[10px] uppercase tracking-wide text-foreground-subtle">
            {t.todos.remainingLabel}
          </span>
        </div>
      </div>

      {/* Progress: how much of this category is already done. */}
      <Progress value={Math.round(doneRatio * 100)} className="mt-2.5" />

      {open && (
        <>
          <ul className="mt-3 space-y-1">
            <AnimatePresence initial={false}>
              {preview.map((td) => (
                <motion.li
                  key={td.id}
                  layout
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    checked={td.done}
                    onCheckedChange={() => onToggle(td)}
                    aria-label={td.title}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {td.title}
                  </span>
                  {td.due_date && <DueChip t={t} due={td.due_date} />}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          {more > 0 && (
            <p className="mt-2 text-[11px] text-foreground-subtle">
              {t.todos.moreTasks(more)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Compact due-date chip that reddens as the deadline passes. */
function DueChip({ t, due }: { t: Dict; due: string }) {
  const left = daysUntilDate(due);
  return (
    <Tooltip content={t.todos.timeLeft(left)}>
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular",
          left < 0
            ? "bg-destructive/10 text-destructive"
            : left <= 2
              ? "bg-warning/10 text-warning"
              : "bg-surface text-foreground-subtle",
        )}
      >
        {left < 0
          ? t.todos.timeLeft(left)
          : left === 0
            ? t.todos.dueTodayTag
            : `${left}d`}
      </span>
    </Tooltip>
  );
}

