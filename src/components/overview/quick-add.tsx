"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { todayStr } from "@/lib/streaks";
import type { Streak, StreakLog, Todo } from "@/lib/types";

type Updater<T> = (next: T | ((prev: T) => T)) => void;

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
        const today = todayStr();
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
        toast.err("Use !todo <title>, !streak <name>, or !cal <title>.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <div className="relative flex-1">
        <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
        <Input
          ref={inputRef}
          id="quick-add-input"
          placeholder="Quick add — !todo, !streak, or !cal … (press n)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-9"
        />
      </div>
      <Button type="submit" disabled={busy}>
        Add
      </Button>
    </form>
  );
}
