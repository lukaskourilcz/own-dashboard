"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { Heart, ListTodo, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { useDict, useDateLocale, type Dict } from "@/lib/i18n";
import { parseDateOnly } from "@/lib/date-keys";
import { qk } from "@/lib/queries/keys";
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
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("todos")
        .insert({ title: title.trim(), due_date: dueDate || null, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      return data as Todo;
    },
    onSuccess: (todo) => {
      qc.setQueryData<Todo[]>(qk.todos, (prev = []) => [todo, ...prev]);
      setTitle("");
      setDueDate("");
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

  // Full view: bucket tasks by category (repo), uncategorized last. When no
  // task has a category this collapses to a single ungrouped list (unchanged).
  // Plain computation — the React Compiler handles memoization (matching the
  // open/done/visible consts above).
  const categoryMap = new Map<string | null, Todo[]>();
  for (const td of visible) {
    const key = td.category ?? null;
    const arr = categoryMap.get(key);
    if (arr) arr.push(td);
    else categoryMap.set(key, [td]);
  }
  const grouped = [...categoryMap.entries()].sort((a, b) => {
    if (a[0] === b[0]) return 0;
    if (a[0] === null) return 1; // "Other" sinks to the bottom
    if (b[0] === null) return -1;
    return a[0].localeCompare(b[0]);
  });
  const hasCategories = grouped.some(([cat]) => cat !== null);

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

  return (
    <div>
      <PageHeader title={t.todos.title} description={t.todos.description} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t.todos.addTaskTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addTodo} className="space-y-3">
              <Input
                placeholder={t.todos.whatNeedsDoing}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Input
                type="date"
                aria-label={t.todos.dueDate}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <Button type="submit" disabled={saving} className="w-full">
                <Plus className="h-3.5 w-3.5" />
                {t.todos.addTask}
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>{t.todos.allTasks}</CardTitle>
            <span className="text-xs text-foreground-subtle tabular">
              {t.todos.openDoneCount(open.length, done.length)}
            </span>
          </CardHeader>
          <CardContent>
            {todos.length === 0 ? (
              <EmptyState
                icon={ListTodo}
                title={t.todos.nothingOnPlate}
                description={t.todos.nothingOnPlateDescription}
              />
            ) : hasCategories ? (
              <div className="space-y-4">
                {grouped.map(([cat, items]) => (
                  <div key={cat ?? "__other__"}>
                    <SectionLabel className="mb-1 flex items-center gap-1.5">
                      <span className="truncate">
                        {cat ?? t.todos.otherCategory}
                      </span>
                      <span className="tabular text-foreground-subtle">
                        {items.length}
                      </span>
                    </SectionLabel>
                    <TodoList
                      t={t}
                      locale={locale}
                      items={items}
                      onToggle={toggle}
                      onRemove={remove}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <TodoList
                t={t}
                locale={locale}
                items={visible}
                onToggle={toggle}
                onRemove={remove}
              />
            )}
            {partnerTodos && partnerTodos.length > 0 && (
              <PartnerBlock
                t={t}
                locale={locale}
                items={partnerTodos}
                partnerName={partnerName}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

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
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
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
    <div className="mt-5 pt-4 border-t border-border">
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
