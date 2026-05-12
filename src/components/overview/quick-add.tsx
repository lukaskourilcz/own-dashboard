"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type Hint = { tone: "ok" | "err"; text: string } | null;

export function QuickAdd({
  setTodos,
  streaks,
  streakLogs,
  setStreakLogs,
  onCalendarTitle,
}: Props) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<Hint>(null);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 4000);
    return () => clearTimeout(t);
  }, [hint]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setHint(null);
    const v = value.trim();
    if (!v) return;

    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        setHint({ tone: "err", text: "Sign in first." });
        return;
      }

      if (v.startsWith("!todo ")) {
        const title = v.slice("!todo ".length).trim();
        if (!title) {
          setHint({ tone: "err", text: "Title is required." });
          return;
        }
        const { data, error } = await supabase
          .from("todos")
          .insert({ title, user_id: userId })
          .select()
          .single();
        if (error || !data) {
          setHint({ tone: "err", text: error?.message ?? "Could not add todo." });
          return;
        }
        setTodos((prev) => [data, ...prev]);
        setValue("");
        setHint({ tone: "ok", text: `Added todo: ${title}` });
      } else if (v.startsWith("!streak ")) {
        const name = v.slice("!streak ".length).trim();
        if (!name) {
          setHint({ tone: "err", text: "Streak name is required." });
          return;
        }
        const streak = streaks.find(
          (s) => s.name.toLowerCase() === name.toLowerCase(),
        );
        if (!streak) {
          setHint({ tone: "err", text: `No streak named "${name}".` });
          return;
        }
        const today = todayStr();
        if (
          streakLogs.some(
            (l) => l.streak_id === streak.id && l.log_date === today,
          )
        ) {
          setHint({ tone: "ok", text: `${streak.name} already done today.` });
          setValue("");
          return;
        }
        const { data, error } = await supabase
          .from("streak_logs")
          .insert({ streak_id: streak.id, user_id: userId, log_date: today })
          .select()
          .single();
        if (error || !data) {
          setHint({ tone: "err", text: error?.message ?? "Could not mark streak." });
          return;
        }
        setStreakLogs((prev) => [...prev, data]);
        setValue("");
        setHint({ tone: "ok", text: `Marked ${streak.name} for today.` });
      } else if (v.startsWith("!cal ")) {
        const title = v.slice("!cal ".length).trim();
        if (!title) {
          setHint({ tone: "err", text: "Event title is required." });
          return;
        }
        onCalendarTitle(title);
        setValue("");
        setHint({ tone: "ok", text: "Opened the calendar form." });
      } else {
        setHint({
          tone: "err",
          text: "Use !todo <title>, !streak <name>, or !cal <title>.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
          <Input
            ref={inputRef}
            id="quick-add-input"
            placeholder="Quick add — !todo, !streak, or !cal …"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={busy}>
          Add
        </Button>
      </div>
      {hint && (
        <p
          className={
            "text-xs " +
            (hint.tone === "ok" ? "text-emerald-600" : "text-red-600")
          }
        >
          {hint.text}
        </p>
      )}
    </form>
  );
}
