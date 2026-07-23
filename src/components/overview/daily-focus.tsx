"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, subDays } from "date-fns";
import { Check, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { useDateLocale, useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import type { DailyFocus, Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

const dailyFocusKey = ["daily-focus"] as const;

async function loadDailyFocus(): Promise<DailyFocus> {
  const response = await fetch("/api/daily-focus", { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as DailyFocus & {
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Could not load daily focus.");
  return body;
}

export function DailyFocusPanel({
  todos,
  isPreview = false,
}: {
  todos: Todo[];
  isPreview?: boolean;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const qc = useQueryClient();
  const supabase = createClient();
  const focus = useQuery({
    queryKey: dailyFocusKey,
    queryFn: loadDailyFocus,
    staleTime: 60_000,
    enabled: !isPreview,
  });
  const regenerate = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/daily-focus", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as DailyFocus & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not regenerate daily focus.");
      }
      return body;
    },
    onSuccess: (data) => qc.setQueryData(dailyFocusKey, data),
  });
  const toggle = useMutation({
    mutationFn: async ({
      todoId,
      done,
    }: {
      todoId: string;
      done: boolean;
    }) => {
      const { error } = await supabase
        .from("todos")
        .update({ done: !done })
        .eq("id", todoId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: dailyFocusKey }),
        qc.invalidateQueries({ queryKey: qk.todos }),
      ]);
    },
  });

  const doneByTodo = useMemo(
    () => new Map(todos.map((todo) => [todo.id, todo.done])),
    [todos],
  );
  const previewData = useMemo<DailyFocus>(
    () => ({
      setId: "preview-daily-focus",
      date: format(new Date(), "yyyy-MM-dd"),
      generation: 1,
      items: todos
        .filter((todo) => !todo.done)
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
        .slice(0, 7)
        .map((todo, index) => ({
          id: `preview-focus-${todo.id}`,
          set_id: "preview-daily-focus",
          todo_id: todo.id,
          position: index + 1,
          title_snapshot: todo.title,
          project_name_snapshot: todo.repo_name ?? todo.category,
          importance_snapshot: todo.importance,
          waiting_since: todo.generated_at ?? todo.created_at,
          completed_at: null,
        })),
      garden: [],
    }),
    [todos],
  );
  const data = isPreview ? previewData : focus.data;
  const completed = data?.items.filter((item) => item.completed_at).length ?? 0;
  const total = data?.items.length ?? 0;
  const gardenByDate = useMemo(
    () => new Map((data?.garden ?? []).map((day) => [day.date, day])),
    [data?.garden],
  );
  const garden = useMemo(
    () =>
      Array.from({ length: 49 }, (_, index) => {
        const date = subDays(new Date(), 48 - index);
        const key = format(date, "yyyy-MM-dd");
        return { key, date, day: gardenByDate.get(key) };
      }),
    [gardenByDate],
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">
              {t.todos.dailyFocusTitle}
            </h2>
            {total > 0 && (
              <span className="text-xs tabular text-foreground-muted">
                {t.todos.dailyFocusProgress(completed, total)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-foreground-subtle">
            {t.todos.dailyFocusDescription}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => regenerate.mutate()}
          disabled={isPreview || regenerate.isPending || focus.isLoading}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", regenerate.isPending && "animate-spin")}
          />
          {regenerate.isPending
            ? t.todos.regeneratingDailyFocus
            : t.todos.regenerateDailyFocus}
        </Button>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 border-b border-border xl:border-b-0 xl:border-r">
          {!isPreview && focus.isLoading ? (
            <div className="space-y-2 p-5" aria-live="polite">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className="h-11 animate-pulse rounded-md bg-skeleton"
                />
              ))}
            </div>
          ) : total === 0 ? (
            <EmptyState
              icon={Sparkles}
              title={t.todos.dailyFocusEmpty}
              description={t.todos.dailyFocusEmptyDescription}
              className="py-12"
            />
          ) : (
            <>
              <Progress
                value={(completed / total) * 100}
                aria-label={t.todos.dailyFocusProgress(completed, total)}
                className="rounded-none"
              />
              <ol className="divide-y divide-border">
                {data?.items.map((item) => {
                  const isDone =
                    item.completed_at !== null ||
                    (item.todo_id
                      ? doneByTodo.get(item.todo_id) === true
                      : false);
                  const waiting = formatDistanceToNow(
                    new Date(item.waiting_since),
                    { locale },
                  );
                  return (
                    <li
                      key={item.id}
                      className="flex min-h-12 items-center gap-3 px-4 py-2.5"
                    >
                      <span className="w-5 shrink-0 text-center text-[11px] tabular text-foreground-subtle">
                        {item.position}
                      </span>
                      <Checkbox
                        checked={isDone}
                        disabled={isPreview || !item.todo_id || toggle.isPending}
                        onCheckedChange={() =>
                          item.todo_id &&
                          toggle.mutate({ todoId: item.todo_id, done: isDone })
                        }
                        aria-label={item.title_snapshot}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-sm",
                            isDone && "text-foreground-subtle line-through",
                          )}
                        >
                          {item.title_snapshot}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-foreground-subtle">
                          {item.project_name_snapshot && (
                            <span>{item.project_name_snapshot}</span>
                          )}
                          <span>{t.todos.waitingFor(waiting)}</span>
                        </p>
                      </div>
                      {item.importance_snapshot === 6 && (
                        <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
                          {t.todos.globalGroup}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>

        <section className="p-4" aria-labelledby="completion-garden-title">
          <div className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-success" />
            <h3 id="completion-garden-title" className="text-sm font-semibold">
              {t.todos.completionGarden}
            </h3>
          </div>
          <p className="mt-1 text-[11px] text-foreground-subtle">
            {t.todos.completionGardenDescription}
          </p>
          <div className="mt-4 grid grid-flow-col grid-rows-7 gap-1" role="list">
            {garden.map(({ key, date, day }) => {
              const label = day?.completed
                ? t.todos.completedDay
                : t.todos.incompleteDay;
              return (
                <Tooltip
                  key={key}
                  content={`${format(date, "PPP", { locale })} · ${label}`}
                >
                  <span
                    role="listitem"
                    aria-label={`${format(date, "PPP", { locale })}: ${label}`}
                    className={cn(
                      "h-3.5 w-3.5 rounded-[3px] border",
                      day?.completed
                        ? "border-success/40 bg-success"
                        : day
                          ? "border-border-strong bg-surface-muted"
                          : "border-border bg-surface-inset",
                    )}
                  />
                </Tooltip>
              );
            })}
          </div>
        </section>
      </div>
    </Card>
  );
}
