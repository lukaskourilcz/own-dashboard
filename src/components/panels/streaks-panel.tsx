"use client";

import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Flame, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { Streak, StreakLog } from "@/lib/types";
import { cn } from "@/lib/utils";
import { computeStreak, logsByStreak as groupLogs, todayStr } from "@/lib/streaks";

type Updater<T> = (next: T | ((prev: T) => T)) => void;

const DEFAULT_COLORS = [
  "#10b981",
  "#6366f1",
  "#f59e0b",
  "#ec4899",
  "#3b82f6",
  "#ef4444",
];

export function StreaksPanel({
  streaks,
  setStreaks,
  logs,
  setLogs,
  compact = false,
}: {
  streaks: Streak[];
  setStreaks: Updater<Streak[]>;
  logs: StreakLog[];
  setLogs: Updater<StreakLog[]>;
  compact?: boolean;
}) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const logsByStreak = useMemo(() => groupLogs(logs), [logs]);

  async function addStreak(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setSaving(false);
      return;
    }
    const { data, error } = await supabase
      .from("streaks")
      .insert({ name: name.trim(), color, user_id: userId })
      .select()
      .single();
    if (!error && data) {
      setStreaks((prev) => [...prev, data]);
      setName("");
    }
    setSaving(false);
  }

  async function removeStreak(id: string) {
    const { error } = await supabase.from("streaks").delete().eq("id", id);
    if (!error) {
      setStreaks((prev) => prev.filter((s) => s.id !== id));
      setLogs((prev) => prev.filter((l) => l.streak_id !== id));
    }
  }

  async function toggleToday(streak: Streak) {
    const date = todayStr();
    const existing = (logsByStreak.get(streak.id) ?? []).find(
      (l) => l.log_date === date,
    );
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    if (existing) {
      const { error } = await supabase
        .from("streak_logs")
        .delete()
        .eq("id", existing.id);
      if (!error) setLogs((prev) => prev.filter((l) => l.id !== existing.id));
    } else {
      const { data, error } = await supabase
        .from("streak_logs")
        .insert({ streak_id: streak.id, user_id: userId, log_date: date })
        .select()
        .single();
      if (!error && data) setLogs((prev) => [...prev, data]);
    }
  }

  const days = Array.from({ length: compact ? 7 : 14 }, (_, i) =>
    format(subDays(new Date(), (compact ? 6 : 13) - i), "yyyy-MM-dd"),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            <Flame className="h-4 w-4" /> Streaks
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!compact && (
          <form onSubmit={addStreak} className="flex flex-wrap gap-2 mb-4 items-end">
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label htmlFor="streak-name">Skill</Label>
              <Input
                id="streak-name"
                placeholder="Read 30 min"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Color</Label>
              <div className="flex gap-1">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setColor(c)}
                    className={cn(
                      "h-7 w-7 rounded-md border-2",
                      color === c ? "border-zinc-900 dark:border-zinc-100" : "border-transparent",
                    )}
                    style={{ background: c }}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>
            <Button type="submit" disabled={saving}>
              Add streak
            </Button>
          </form>
        )}

        {streaks.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No streaks yet. Add one to start tracking daily.
          </p>
        ) : (
          <ul className="space-y-3">
            {streaks.map((s) => {
              const sLogs = logsByStreak.get(s.id) ?? [];
              const dates = new Set(sLogs.map((l) => l.log_date));
              const streakCount = computeStreak(sLogs);
              const checkedToday = dates.has(todayStr());
              return (
                <li
                  key={s.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ background: s.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{s.name}</p>
                      <p className="text-xs text-zinc-500">
                        {streakCount} day{streakCount === 1 ? "" : "s"} in a row
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={checkedToday ? "secondary" : "default"}
                      onClick={() => toggleToday(s)}
                    >
                      {checkedToday ? "Done today" : "Mark today"}
                    </Button>
                    {!compact && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeStreak(s.id)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 flex gap-1">
                    {days.map((d) => {
                      const hit = dates.has(d);
                      return (
                        <div
                          key={d}
                          title={d}
                          className={cn(
                            "h-5 flex-1 rounded-sm",
                            hit ? "opacity-100" : "opacity-20",
                          )}
                          style={{ background: hit ? s.color : "#a1a1aa" }}
                        />
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
