"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { todayStr } from "@/lib/streaks";
import { MOOD_META } from "@/lib/pulse";
import type { DailyPulse, PulseMood, Streak, StreakLog, Todo } from "@/lib/types";

type Updater<T> = (next: T | ((prev: T) => T)) => void;

let tentativeQuickPulseCounter = 0;

const MOOD_WORDS: Record<string, PulseMood> = {
  rough: 1,
  bad: 1,
  awful: 1,
  meh: 2,
  off: 2,
  okay: 3,
  ok: 3,
  fine: 3,
  good: 4,
  nice: 4,
  great: 5,
  amazing: 5,
};

function parseMood(rest: string): { mood: PulseMood; note: string } | null {
  const trimmed = rest.trim();
  if (!trimmed) return null;
  const [first, ...restWords] = trimmed.split(/\s+/);
  const note = restWords.join(" ").trim();
  const asNumber = Number(first);
  if (asNumber >= 1 && asNumber <= 5 && Number.isInteger(asNumber)) {
    return { mood: asNumber as PulseMood, note };
  }
  const word = MOOD_WORDS[first.toLowerCase()];
  if (word) return { mood: word, note };
  return null;
}

type Props = {
  setTodos: Updater<Todo[]>;
  streaks: Streak[];
  streakLogs: StreakLog[];
  setStreakLogs: Updater<StreakLog[]>;
  setPulses: Updater<DailyPulse[]>;
  pulses: DailyPulse[];
  onCalendarTitle: (title: string) => void;
};

export function QuickAdd({
  setTodos,
  streaks,
  streakLogs,
  setStreakLogs,
  setPulses,
  pulses,
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
      } else if (v.startsWith("!mood ")) {
        const parsed = parseMood(v.slice("!mood ".length));
        if (!parsed) {
          toast.err("Try !mood 1-5 or !mood great/good/okay/meh/rough");
          return;
        }
        const today = todayStr();
        const existing = pulses.find(
          (p) => p.user_id === userId && p.log_date === today,
        );
        if (existing) {
          const before = existing;
          setPulses((prev) =>
            prev.map((p) =>
              p.id === before.id
                ? {
                    ...p,
                    mood: parsed.mood,
                    note: parsed.note || p.note,
                  }
                : p,
            ),
          );
          const { error } = await supabase
            .from("daily_pulse")
            .update({
              mood: parsed.mood,
              note: parsed.note || existing.note,
            })
            .eq("id", existing.id);
          if (error) {
            setPulses((prev) =>
              prev.map((p) => (p.id === before.id ? before : p)),
            );
            toast.err(error.message);
            return;
          }
        } else {
          const tentativeId = `tmp-${++tentativeQuickPulseCounter}`;
          const tentative: DailyPulse = {
            id: tentativeId,
            user_id: userId,
            log_date: today,
            mood: parsed.mood,
            note: parsed.note || null,
            created_at: "",
          };
          setPulses((prev) => [tentative, ...prev]);
          const { data, error } = await supabase
            .from("daily_pulse")
            .insert({
              user_id: userId,
              log_date: today,
              mood: parsed.mood,
              note: parsed.note || null,
            })
            .select()
            .single();
          if (error || !data) {
            setPulses((prev) => prev.filter((p) => p.id !== tentativeId));
            toast.err(error?.message ?? "Could not save mood.");
            return;
          }
          setPulses((prev) =>
            prev.map((p) => (p.id === tentativeId ? data : p)),
          );
        }
        setValue("");
        toast.ok(
          `${MOOD_META[parsed.mood].emoji} ${MOOD_META[parsed.mood].label} logged.`,
        );
      } else {
        toast.err("Use !todo, !streak, !cal, or !mood …");
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
