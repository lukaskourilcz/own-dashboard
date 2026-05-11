"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TodosPanel({
  initial,
  compact = false,
}: {
  initial: Todo[];
  compact?: boolean;
}) {
  const supabase = createClient();
  const [todos, setTodos] = useState<Todo[]>(initial);
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

  return (
    <Card className={compact ? "" : "max-w-2xl"}>
      <CardHeader>
        <CardTitle>
          Todos
          {compact && (
            <span className="text-sm font-normal text-zinc-500 ml-2">
              {open.length} open · {done.length} done
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={addTodo} className="flex gap-2 mb-4">
          <Input
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {!compact && (
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-44"
            />
          )}
          <Button type="submit" disabled={saving}>
            Add
          </Button>
        </form>
        {visible.length === 0 ? (
          <p className="text-sm text-zinc-500">All clear.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {visible.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => toggle(t)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm truncate",
                      t.done && "line-through text-zinc-400",
                    )}
                  >
                    {t.title}
                  </p>
                  {t.due_date && (
                    <p className="text-xs text-zinc-500">due {t.due_date}</p>
                  )}
                </div>
                {!compact && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(t.id)}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
