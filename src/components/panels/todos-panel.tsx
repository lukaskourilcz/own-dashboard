"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, ListTodo, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import type { Todo, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TodosPanel({
  todos,
  setTodos,
  compact = false,
  partnerTodos,
  partnerName,
}: {
  todos: Todo[];
  setTodos: Updater<Todo[]>;
  compact?: boolean;
  partnerTodos?: Todo[];
  partnerName?: string;
}) {
  const supabase = createClient();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setSaving(false);
      return;
    }
    const { data, error } = await supabase
      .from("todos")
      .insert({
        title: title.trim(),
        due_date: dueDate || null,
        user_id: userId,
      })
      .select()
      .single();
    if (!error && data) {
      setTodos((prev) => [data, ...prev]);
      setTitle("");
      setDueDate("");
    }
    setSaving(false);
  }

  async function toggle(t: Todo) {
    const next = !t.done;
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: next } : x)));
    const { error } = await supabase
      .from("todos")
      .update({ done: next })
      .eq("id", t.id);
    if (error) {
      setTodos((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, done: !next } : x)),
      );
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("todos").delete().eq("id", id);
    if (!error) setTodos((prev) => prev.filter((t) => t.id !== id));
  }

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const visible = compact ? open.slice(0, 5) : todos;

  if (compact) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Tasks</CardTitle>
          <span className="text-xs text-foreground-subtle tabular">
            {open.length} open · {done.length} done
          </span>
        </CardHeader>
        <CardContent>
          <QuickAddForm
            title={title}
            setTitle={setTitle}
            saving={saving}
            onSubmit={addTodo}
          />
          {visible.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title="All clear"
              description="No open tasks. Add one above."
              className="py-6"
            />
          ) : (
            <TodoList items={visible} onToggle={toggle} compact />
          )}
          {partnerTodos && partnerTodos.length > 0 && (
            <PartnerBlock
              items={partnerTodos.filter((t) => !t.done).slice(0, 3)}
              partnerName={partnerName}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="What you're working on and what's coming up."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Add task</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addTodo} className="space-y-3">
              <Input
                placeholder="What needs doing?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <Button type="submit" disabled={saving} className="w-full">
                <Plus className="h-3.5 w-3.5" />
                Add task
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>All tasks</CardTitle>
            <span className="text-xs text-foreground-subtle tabular">
              {open.length} open · {done.length} done
            </span>
          </CardHeader>
          <CardContent>
            {todos.length === 0 ? (
              <EmptyState
                icon={ListTodo}
                title="Nothing on your plate"
                description="Add a task on the left to get started."
              />
            ) : (
              <TodoList items={visible} onToggle={toggle} onRemove={remove} />
            )}
            {partnerTodos && partnerTodos.length > 0 && (
              <PartnerBlock items={partnerTodos} partnerName={partnerName} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuickAddForm({
  title,
  setTitle,
  saving,
  onSubmit,
}: {
  title: string;
  setTitle: (v: string) => void;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="flex gap-2 mb-3">
      <Input
        placeholder="Add a task…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Button type="submit" disabled={saving} size="sm">
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}

function TodoList({
  items,
  onToggle,
  onRemove,
  compact,
}: {
  items: Todo[];
  onToggle: (t: Todo) => void;
  onRemove?: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <ul className="-mx-2">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.li
            key={t.id}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
            transition={{ duration: 0.15 }}
            className="group flex items-center gap-3 rounded-md px-2 py-1.5 row-hover"
          >
            <Checkbox checked={t.done} onChange={() => onToggle(t)} />
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm truncate transition-colors",
                  t.done && "line-through text-foreground-subtle",
                )}
              >
                {t.title}
              </p>
              {t.due_date && (
                <p className="text-[11px] text-foreground-subtle tabular">
                  due {t.due_date}
                </p>
              )}
            </div>
            {!compact && onRemove && (
              <Tooltip content="Delete">
                <button
                  type="button"
                  onClick={() => onRemove(t.id)}
                  aria-label="Delete"
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
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
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
  items,
  partnerName,
}: {
  items: Todo[];
  partnerName?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-5 pt-4 border-t border-border">
      <SectionLabel className="mb-2 inline-flex items-center gap-1.5">
        <Heart className="h-3 w-3" />
        From {partnerName ?? "partner"}
      </SectionLabel>
      <ul className="-mx-2">
        {items.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-3 rounded-md px-2 py-1.5 text-foreground-muted"
          >
            <span
              className={cn(
                "h-4 w-4 shrink-0 rounded border border-border-strong flex items-center justify-center text-[10px]",
                t.done && "bg-surface-muted",
              )}
            >
              {t.done ? "✓" : ""}
            </span>
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm truncate",
                  t.done && "line-through text-foreground-subtle",
                )}
              >
                {t.title}
              </p>
              {t.due_date && (
                <p className="text-[11px] text-foreground-subtle tabular">
                  due {t.due_date}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
