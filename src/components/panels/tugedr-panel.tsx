"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Check, Lightbulb, ListTodo, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { useDict } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ---- local persistence --------------------------------------------------
 * Tugedr is a self-contained scratch space: its to-dos and ideas live only in
 * this browser (localStorage), independent of the Supabase-backed Tasks panel.
 * That keeps it a true "standalone" list with no server round-trip. */

type TodoItem = { id: string; text: string; done: boolean };
type IdeaItem = { id: string; text: string };

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/* localStorage-backed list via useSyncExternalStore — the same subscribe /
 * read / server-snapshot pattern the app uses for UI prefs (see
 * src/lib/use-prefs.ts), so there's no setState-in-effect and no hydration
 * mismatch. The server snapshot is a stable empty array. */

const EMPTY: readonly unknown[] = Object.freeze([]);

type ListStore = { cache: unknown[] | null; listeners: Set<() => void> };
const stores = new Map<string, ListStore>();

function storeFor(key: string): ListStore {
  let s = stores.get(key);
  if (!s) {
    s = { cache: null, listeners: new Set() };
    stores.set(key, s);
  }
  return s;
}

function readList<T>(key: string): T[] {
  const s = storeFor(key);
  if (s.cache != null) return s.cache as T[];
  if (typeof window === "undefined") return EMPTY as T[];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    s.cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    s.cache = [];
  }
  return s.cache as T[];
}

function writeList<T>(key: string, next: T[] | ((prev: T[]) => T[])): void {
  const s = storeFor(key);
  const prev = readList<T>(key);
  const value = typeof next === "function" ? (next as (p: T[]) => T[])(prev) : next;
  s.cache = value;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / unavailable storage
  }
  for (const cb of s.listeners) cb();
}

function useLocalList<T>(
  key: string,
): [T[], (next: T[] | ((prev: T[]) => T[])) => void] {
  const items = useSyncExternalStore(
    (cb) => {
      const s = storeFor(key);
      s.listeners.add(cb);
      return () => s.listeners.delete(cb);
    },
    () => readList<T>(key),
    () => EMPTY as T[],
  );
  const set = useCallback(
    (next: T[] | ((prev: T[]) => T[])) => writeList<T>(key, next),
    [key],
  );
  return [items, set];
}

/* ---- panel -------------------------------------------------------------- */

export function TugedrPanel() {
  const t = useDict();
  return (
    <div>
      <PageHeader title={t.tugedr.title} description={t.tugedr.description} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <TodoCard />
        <IdeasCard />
      </div>
    </div>
  );
}

/* ---- to-do card --------------------------------------------------------- */

function TodoCard() {
  const t = useDict();
  const [todos, setTodos] = useLocalList<TodoItem>("tugedr:todos");
  const [draft, setDraft] = useState("");

  const add = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text) return;
      setTodos((prev) => [{ id: newId(), text, done: false }, ...prev]);
      setDraft("");
    },
    [draft, setTodos],
  );

  const toggle = (id: string) =>
    setTodos((prev) =>
      prev.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
    );
  const remove = (id: string) =>
    setTodos((prev) => prev.filter((x) => x.id !== id));
  const clearDone = () => setTodos((prev) => prev.filter((x) => !x.done));

  const remaining = todos.filter((x) => !x.done).length;
  const hasDone = todos.some((x) => x.done);

  return (
    <Card className="flex flex-col p-0">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <ListTodo className="h-4 w-4 text-foreground-muted" />
        <span className="text-sm font-semibold text-foreground">
          {t.tugedr.todosTitle}
        </span>
        {todos.length > 0 && (
          <span className="text-[11px] text-foreground-subtle">
            {t.tugedr.remaining(remaining)}
          </span>
        )}
        {hasDone && (
          <button
            type="button"
            onClick={clearDone}
            className="ml-auto text-[11px] text-foreground-subtle transition-colors hover:text-foreground focus-ring rounded px-1"
          >
            {t.tugedr.clearDone}
          </button>
        )}
      </div>

      <form onSubmit={add} className="flex items-center gap-1.5 p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.tugedr.addTodoPlaceholder}
          className="h-9 text-sm"
          maxLength={200}
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          <Plus className="h-3.5 w-3.5" />
          {t.tugedr.addTodo}
        </Button>
      </form>

      {todos.length === 0 ? (
        <p className="px-3 pb-4 text-xs italic text-foreground-subtle">
          {t.tugedr.todosEmpty}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {todos.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-2.5 px-3 py-2.5"
            >
              <button
                type="button"
                onClick={() => toggle(item.id)}
                aria-pressed={item.done}
                aria-label={item.text}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors focus-ring",
                  item.done
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-foreground-muted",
                )}
              >
                {item.done && <Check className="h-3 w-3" />}
              </button>
              <span
                className={cn(
                  "min-w-0 flex-1 break-words text-sm",
                  item.done
                    ? "text-foreground-subtle line-through"
                    : "text-foreground",
                )}
              >
                {item.text}
              </span>
              <Tooltip content={t.tugedr.deleteTodo}>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  aria-label={t.tugedr.deleteTodo}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-muted opacity-100 transition-colors hover:bg-surface-hover hover:text-destructive focus-ring sm:opacity-0 sm:group-hover:opacity-100"
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

/* ---- ideas card --------------------------------------------------------- */

function IdeasCard() {
  const t = useDict();
  const [ideas, setIdeas] = useLocalList<IdeaItem>("tugedr:ideas");
  const [draft, setDraft] = useState("");

  const add = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text) return;
      setIdeas((prev) => [{ id: newId(), text }, ...prev]);
      setDraft("");
    },
    [draft, setIdeas],
  );

  const remove = (id: string) =>
    setIdeas((prev) => prev.filter((x) => x.id !== id));

  return (
    <Card className="flex flex-col p-0">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Lightbulb className="h-4 w-4 text-foreground-muted" />
        <span className="text-sm font-semibold text-foreground">
          {t.tugedr.ideasTitle}
        </span>
        {ideas.length > 0 && (
          <span className="text-[11px] text-foreground-subtle">
            {ideas.length}
          </span>
        )}
      </div>

      <form onSubmit={add} className="flex items-center gap-1.5 p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.tugedr.addIdeaPlaceholder}
          className="h-9 text-sm"
          maxLength={280}
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          <Plus className="h-3.5 w-3.5" />
          {t.tugedr.addIdea}
        </Button>
      </form>

      {ideas.length === 0 ? (
        <p className="px-3 pb-4 text-xs italic text-foreground-subtle">
          {t.tugedr.ideasEmpty}
        </p>
      ) : (
        <ul className="grid gap-2 p-3 pt-0">
          {ideas.map((item) => (
            <li
              key={item.id}
              className="group flex items-start gap-2 rounded-md border border-border bg-surface-muted/40 px-3 py-2"
            >
              <span className="min-w-0 flex-1 break-words text-sm text-foreground">
                {item.text}
              </span>
              <Tooltip content={t.tugedr.deleteIdea}>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  aria-label={t.tugedr.deleteIdea}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-muted opacity-100 transition-colors hover:bg-surface-hover hover:text-destructive focus-ring sm:opacity-0 sm:group-hover:opacity-100"
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
