"use client";

import { useRef, useState } from "react";
import { Sparkles, CornerDownLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { todayKey } from "@/lib/date-keys";
import type { Streak, StreakLog, Todo, Updater } from "@/lib/types";

type Props = {
  setTodos: Updater<Todo[]>;
  streaks: Streak[];
  streakLogs: StreakLog[];
  setStreakLogs: Updater<StreakLog[]>;
  onCalendarTitle: (title: string) => void;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;

    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        toast.err("Sign in first.");
        return;
      }

      if (v.startsWith("!todo ")) {
        const title = v.slice("!todo ".length).trim();
        if (!title) {
          toast.err("Title is required.");
          return;
        }
        const { data, error } = await supabase
          .from("todos")
          .insert({ title, user_id: userId })
          .select()
          .single();
        if (error || !data) {
          toast.err(error?.message ?? "Could not add todo.");
          return;
        }
        setTodos((prev) => [data, ...prev]);
        setValue("");
        toast.ok(`Added todo: ${title}`);
      } else if (v.startsWith("!streak ")) {
        const name = v.slice("!streak ".length).trim();
        if (!name) {
          toast.err("Streak name is required.");
          return;
        }
        const streak = streaks.find(
          (s) => s.name.toLowerCase() === name.toLowerCase(),
        );
        if (!streak) {
          toast.err(`No streak named "${name}".`);
          return;
        }
        const today = todayKey();
        if (
          streakLogs.some(
            (l) => l.streak_id === streak.id && l.log_date === today,
          )
        ) {
          toast.info(`${streak.name} already done today.`);
          setValue("");
          return;
        }
        const { data, error } = await supabase
          .from("streak_logs")
          .insert({ streak_id: streak.id, user_id: userId, log_date: today })
          .select()
          .single();
        if (error || !data) {
          toast.err(error?.message ?? "Could not mark streak.");
          return;
        }
        setStreakLogs((prev) => [...prev, data]);
        setValue("");
        toast.ok(`Marked ${streak.name} for today.`);
      } else if (v.startsWith("!cal ")) {
        const title = v.slice("!cal ".length).trim();
        if (!title) {
          toast.err("Event title is required.");
          return;
        }
        onCalendarTitle(title);
        setValue("");
        toast.info("Opened the calendar form.");
      } else {
        toast.err("Use !todo, !streak, or !cal …");
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
        placeholder="Quick add — !todo, !streak, or !cal …"
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
