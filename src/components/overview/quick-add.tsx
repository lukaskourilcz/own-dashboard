"use client";

import { useRef, useState } from "react";
import { Sparkles, CornerDownLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { todayKey } from "@/lib/date-keys";
import { useDict } from "@/lib/i18n";
import type { Streak, StreakLog, Todo, Updater } from "@/lib/types";

type Props = {
  setTodos: Updater<Todo[]>;
  streaks: Streak[];
  streakLogs: StreakLog[];
  setStreakLogs: Updater<StreakLog[]>;
  onCalendarTitle: (title: string) => void;
};

type NlAction =
  | { kind: "todo"; title: string; due_date?: string }
  | { kind: "streak"; streak_name: string }
  | {
      kind: "calendar_event";
      title: string;
      date: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      description?: string;
    };

export function QuickAdd({
  setTodos,
  streaks,
  streakLogs,
  setStreakLogs,
  onCalendarTitle,
}: Props) {
  const supabase = createClient();
  const toast = useToast();
  const t = useDict();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function getUserId(): Promise<string | null> {
    const { data: userData } = await supabase.auth.getUser();
    return userData.user?.id ?? null;
  }

  async function addTodoLocal(userId: string, title: string, dueDate?: string) {
    const { data, error } = await supabase
      .from("todos")
      .insert({ title, user_id: userId, due_date: dueDate ?? null })
      .select()
      .single();
    if (error || !data) {
      toast.err(error?.message ?? t.quickAdd.couldNotAddTodo);
      return false;
    }
    setTodos((prev) => [data, ...prev]);
    toast.ok(t.quickAdd.addedTodo(title));
    return true;
  }

  async function markStreakLocal(userId: string, name: string) {
    const streak = streaks.find(
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    if (!streak) {
      toast.err(t.quickAdd.noHabitNamed(name));
      return false;
    }
    const today = todayKey();
    if (
      streakLogs.some(
        (l) => l.streak_id === streak.id && l.log_date === today,
      )
    ) {
      toast.info(t.quickAdd.alreadyDoneToday(streak.name));
      return true;
    }
    const { data, error } = await supabase
      .from("streak_logs")
      .insert({ streak_id: streak.id, user_id: userId, log_date: today })
      .select()
      .single();
    if (error || !data) {
      toast.err(error?.message ?? t.quickAdd.couldNotMarkHabit);
      return false;
    }
    setStreakLogs((prev) => [...prev, data]);
    toast.ok(t.quickAdd.markedForToday(streak.name));
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;

    setBusy(true);
    try {
      const userId = await getUserId();
      if (!userId) {
        toast.err(t.quickAdd.signInFirst);
        return;
      }

      // Explicit prefixes always win — fast path, predictable, works offline.
      if (v.startsWith("!todo ")) {
        const title = v.slice("!todo ".length).trim();
        if (!title) {
          toast.err(t.quickAdd.titleRequired);
          return;
        }
        if (await addTodoLocal(userId, title)) setValue("");
        return;
      }
      if (v.startsWith("!streak ")) {
        const name = v.slice("!streak ".length).trim();
        if (!name) {
          toast.err(t.quickAdd.habitNameRequired);
          return;
        }
        if (await markStreakLocal(userId, name)) setValue("");
        return;
      }
      if (v.startsWith("!cal ")) {
        const title = v.slice("!cal ".length).trim();
        if (!title) {
          toast.err(t.quickAdd.eventTitleRequired);
          return;
        }
        onCalendarTitle(title);
        setValue("");
        toast.info(t.quickAdd.openedCalendarForm);
        return;
      }

      // Otherwise: natural language via /api/quick-add → Claude Haiku tool-use.
      const tz =
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;
      let parsed: { action: NlAction | null; disabled?: boolean } | null = null;
      try {
        const res = await fetch("/api/quick-add", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: v, timezone: tz }),
        });
        if (res.ok) parsed = await res.json();
      } catch {
        // Treat network errors as "no parse".
      }

      if (parsed?.disabled) {
        toast.err(t.quickAdd.nlOff);
        return;
      }
      if (!parsed?.action) {
        toast.err(t.quickAdd.couldntParse);
        return;
      }

      const a = parsed.action;
      if (a.kind === "todo") {
        if (await addTodoLocal(userId, a.title, a.due_date)) setValue("");
      } else if (a.kind === "streak") {
        if (await markStreakLocal(userId, a.streak_name)) setValue("");
      } else if (a.kind === "calendar_event") {
        // Hand off to the existing calendar route; surface the prefilled form
        // so the user can confirm before creating the GCal event.
        onCalendarTitle(a.title);
        setValue("");
        toast.info(
          t.quickAdd.openingCalendarForm(a.title, a.date, a.startTime),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="relative">
      <Sparkles className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
      <Input
        ref={inputRef}
        id="quick-add-input"
        placeholder={t.quickAdd.placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
        className="pl-9 pr-20 h-10 text-sm"
      />
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-foreground-subtle">
        <kbd className="inline-flex h-5 items-center rounded border border-border bg-surface-muted px-1.5 text-[10px] font-medium">
          n
        </kbd>
        <CornerDownLeft className="h-3 w-3" />
      </div>
    </form>
  );
}
