"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { motion } from "motion/react";
import { Bell, Flame, Heart, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { useDict, useDateLocale, type Dict } from "@/lib/i18n";
import type { Locale } from "date-fns";
import type { Streak, StreakLog, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  bestStreak,
  computeStreak,
  logsByStreak as groupLogs,
} from "@/lib/streaks";
import { todayKey, parseDateOnly } from "@/lib/date-keys";
import { qk } from "@/lib/queries/keys";
import { StreakHeatmap } from "@/components/panels/streak-heatmap";

let tentativeLogCounter = 0;

const DEFAULT_COLORS = [
  "#0a0a0a",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
];

export function StreaksPanel({
  streaks,
  setStreaks,
  logs,
  setLogs,
  compact = false,
  partnerStreaks,
  partnerLogs,
  partnerName,
}: {
  streaks: Streak[];
  setStreaks: Updater<Streak[]>;
  logs: StreakLog[];
  setLogs: Updater<StreakLog[]>;
  compact?: boolean;
  partnerStreaks?: Streak[];
  partnerLogs?: StreakLog[];
  partnerName?: string;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const locale = useDateLocale();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const [reminder, setReminder] = useState("");

  const logsByStreak = useMemo(() => groupLogs(logs), [logs]);

  // Create needs the server-generated id, so it stays non-optimistic:
  // apply the new row in onSuccess, reset inputs, then reconcile via invalidate.
  const addMutation = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("streaks")
        .insert({
          name: name.trim(),
          color,
          reminder_time: reminder || null,
          user_id: userId,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Streak;
    },
    onSuccess: (streak) => {
      setStreaks((prev) => [...prev, streak]);
      setName("");
      setReminder("");
      void qc.invalidateQueries({ queryKey: qk.streaks });
    },
  });

  // Optimistic delete: drop the streak (and its logs) from the cache
  // immediately, roll back on error, reconcile both keys once settled.
  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("streaks").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.streaks });
      await qc.cancelQueries({ queryKey: qk.streakLogs });
      const prevStreaks = qc.getQueryData<Streak[]>(qk.streaks);
      const prevLogs = qc.getQueryData<StreakLog[]>(qk.streakLogs);
      setStreaks((prev) => prev.filter((s) => s.id !== id));
      setLogs((prev) => prev.filter((l) => l.streak_id !== id));
      return { prevStreaks, prevLogs };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prevStreaks) setStreaks(ctx.prevStreaks);
      if (ctx?.prevLogs) setLogs(ctx.prevLogs);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.streaks });
      void qc.invalidateQueries({ queryKey: qk.streakLogs });
    },
  });

  // Marking/unmarking a day is an insert/delete in streak_logs. The cache is
  // updated optimistically before the await, so this mirrors the todos toggle:
  // snapshot in onMutate, roll back on error, reconcile via invalidate.
  const toggleMutation = useMutation({
    mutationFn: async ({
      streak,
      existing,
      userId,
      date,
    }: {
      streak: Streak;
      existing: StreakLog | undefined;
      userId: string;
      date: string;
    }) => {
      if (existing) {
        const { error } = await supabase
          .from("streak_logs")
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
        return undefined;
      }
      const { data, error } = await supabase
        .from("streak_logs")
        .insert({ streak_id: streak.id, user_id: userId, log_date: date })
        .select()
        .single();
      if (error) throw error;
      return data as StreakLog;
    },
    onMutate: async ({ existing, streak, userId, date }) => {
      await qc.cancelQueries({ queryKey: qk.streakLogs });
      const prev = qc.getQueryData<StreakLog[]>(qk.streakLogs);
      if (existing) {
        setLogs((old) => old.filter((l) => l.id !== existing.id));
        return { prev, tentativeId: undefined };
      }
      const tentativeId = `tmp-${++tentativeLogCounter}`;
      const tentative: StreakLog = {
        id: tentativeId,
        streak_id: streak.id,
        user_id: userId,
        log_date: date,
        created_at: "",
      };
      setLogs((old) => [...old, tentative]);
      return { prev, tentativeId };
    },
    onSuccess: (data, _vars, ctx) => {
      // Insert resolved: swap the tentative row for the server one.
      if (data && ctx?.tentativeId) {
        setLogs((old) =>
          old.map((l) => (l.id === ctx.tentativeId ? data : l)),
        );
      }
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) setLogs(ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.streakLogs }),
  });

  const saving = addMutation.isPending;

  function addStreak(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addMutation.mutate();
  }

  function removeStreak(id: string) {
    removeMutation.mutate(id);
  }

  async function toggleToday(streak: Streak) {
    const date = todayKey();
    const existing = (logsByStreak.get(streak.id) ?? []).find(
      (l) => l.log_date === date,
    );
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    toggleMutation.mutate({ streak, existing, userId, date });
  }

  const stripDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        format(subDays(new Date(), 6 - i), "yyyy-MM-dd"),
      ),
    [],
  );

  if (compact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-1.5">
            <Flame className="h-3 w-3" /> {t.streaks.compactTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {streaks.length === 0 ? (
            <EmptyState
              icon={Flame}
              title={t.streaks.noHabitsYet}
              description={t.streaks.trackDailyHabit}
              className="py-6"
            />
          ) : (
            <ul className="space-y-3">
              {streaks.map((s) => (
                <StreakRow
                  key={s.id}
                  t={t}
                  locale={locale}
                  streak={s}
                  logs={logsByStreak.get(s.id) ?? []}
                  stripDays={stripDays}
                  onToggle={() => toggleToday(s)}
                  compact
                />
              ))}
            </ul>
          )}

          {partnerStreaks && partnerStreaks.length > 0 && (
            <PartnerBlock
              t={t}
              locale={locale}
              streaks={partnerStreaks}
              logs={partnerLogs ?? []}
              stripDays={stripDays}
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
        title={t.streaks.title}
        description={t.streaks.description}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t.streaks.newHabit}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addStreak} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="streak-name">{t.streaks.name}</Label>
                <Input
                  id="streak-name"
                  placeholder={t.streaks.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t.streaks.color}</Label>
                <div className="flex gap-1.5">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setColor(c)}
                      className={cn(
                        "h-7 w-7 rounded-md transition-all duration-150",
                        color === c
                          ? "ring-2 ring-foreground/40 ring-offset-2 ring-offset-surface scale-105"
                          : "hover:scale-105",
                      )}
                      style={{ background: c }}
                      aria-label={t.streaks.colorAria(c)}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="streak-reminder" className="inline-flex items-center gap-1">
                  <Bell className="h-3 w-3" />
                  {t.streaks.reminder}
                </Label>
                <Input
                  id="streak-reminder"
                  type="time"
                  value={reminder}
                  onChange={(e) => setReminder(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={saving} className="w-full">
                <Plus className="h-3.5 w-3.5" />
                {t.streaks.addHabit}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.streaks.yourHabits}</CardTitle>
          </CardHeader>
          <CardContent>
            {streaks.length === 0 ? (
              <EmptyState
                icon={Flame}
                title={t.streaks.noHabitsYet}
                description={t.streaks.addHabitDescription}
              />
            ) : (
              <ul className="space-y-4">
                {streaks.map((s) => (
                  <StreakRow
                    key={s.id}
                    t={t}
                    locale={locale}
                    streak={s}
                    logs={logsByStreak.get(s.id) ?? []}
                    stripDays={stripDays}
                    onToggle={() => toggleToday(s)}
                    onRemove={() => removeStreak(s.id)}
                  />
                ))}
              </ul>
            )}

            {partnerStreaks && partnerStreaks.length > 0 && (
              <PartnerBlock
                t={t}
                locale={locale}
                streaks={partnerStreaks}
                logs={partnerLogs ?? []}
                stripDays={stripDays}
                partnerName={partnerName}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StreakRow({
  t,
  locale,
  streak,
  logs,
  stripDays,
  onToggle,
  onRemove,
  compact,
}: {
  t: Dict;
  locale: Locale;
  streak: Streak;
  logs: StreakLog[];
  stripDays: string[];
  onToggle: () => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const dates = useMemo(() => new Set(logs.map((l) => l.log_date)), [logs]);
  const streakCount = computeStreak(logs);
  const best = bestStreak(logs);
  const checkedToday = dates.has(todayKey());

  return (
    <li className="group rounded-lg border border-border bg-surface px-3.5 py-3 transition-all duration-150 hover:border-border-strong">
      <div className="flex items-center gap-3">
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ background: streak.color }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate text-foreground">
            {streak.name}
          </p>
          <p className="text-[11px] text-foreground-subtle inline-flex items-center gap-1.5 tabular">
            <span>
              <span className="text-foreground-muted font-medium">{streakCount}</span>{" "}
              {t.streaks.current}
            </span>
            <span className="text-foreground-subtle/40">·</span>
            <span>
              <span className="text-foreground-muted font-medium">{best}</span>{" "}
              {t.streaks.best}
            </span>
            {streak.reminder_time && (
              <>
                <span className="text-foreground-subtle/40">·</span>
                <span className="inline-flex items-center gap-1">
                  <Bell className="h-2.5 w-2.5" />
                  {streak.reminder_time.slice(0, 5)}
                </span>
              </>
            )}
          </p>
        </div>
        <motion.button
          type="button"
          onClick={onToggle}
          whileTap={{ scale: 0.96 }}
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium transition-all duration-150 focus-ring",
            checkedToday
              ? "bg-success/10 text-success border border-success/20"
              : "bg-primary text-primary-foreground hover:bg-primary-hover",
          )}
        >
          {checkedToday ? t.streaks.doneToday : t.streaks.markToday}
        </motion.button>
        {!compact && onRemove && (
          <Tooltip content={t.common.delete}>
            <button
              type="button"
              onClick={onRemove}
              aria-label={t.common.delete}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-foreground-subtle hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
      {compact ? (
        <div className="mt-3 flex gap-1">
          {stripDays.map((d) => {
            const hit = dates.has(d);
            return (
              <div
                key={d}
                title={format(parseDateOnly(d), t.streaks.dateFormat, { locale })}
                className={cn(
                  "h-4 flex-1 rounded-sm transition-opacity",
                  hit ? "opacity-100" : "opacity-15",
                )}
                style={{
                  background: hit ? streak.color : "var(--border-strong)",
                }}
              />
            );
          })}
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <StreakHeatmap
            t={t}
            locale={locale}
            color={streak.color}
            dates={dates}
          />
        </div>
      )}
    </li>
  );
}

function PartnerBlock({
  t,
  locale,
  streaks,
  logs,
  stripDays,
  partnerName,
}: {
  t: Dict;
  locale: Locale;
  streaks: Streak[];
  logs: StreakLog[];
  stripDays: string[];
  partnerName?: string;
}) {
  return (
    <div className="mt-5 pt-4 border-t border-border">
      <SectionLabel className="mb-3 inline-flex items-center gap-1.5">
        <Heart className="h-3 w-3" />
        {t.streaks.partnerHabits(partnerName ?? t.streaks.partnerFallback)}
      </SectionLabel>
      <ul className="space-y-3">
        {streaks.map((s) => {
          const sLogs = logs.filter((l) => l.streak_id === s.id);
          const dates = new Set(sLogs.map((l) => l.log_date));
          const current = computeStreak(sLogs);
          const best = bestStreak(sLogs);
          const checkedToday = dates.has(todayKey());
          return (
            <li
              key={s.id}
              className="rounded-md border border-border px-3 py-2.5 opacity-80"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: s.color }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate text-foreground">{s.name}</p>
                  <p className="text-[11px] text-foreground-subtle tabular">
                    {t.streaks.currentVsBest(current, best)}
                  </p>
                </div>
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded",
                    checkedToday
                      ? "bg-success/10 text-success"
                      : "bg-surface-muted text-foreground-subtle",
                  )}
                >
                  {checkedToday ? t.streaks.doneTag : t.streaks.notDoneTag}
                </span>
              </div>
              <div className="mt-2.5 flex gap-1">
                {stripDays.map((d) => {
                  const hit = dates.has(d);
                  return (
                    <div
                      key={d}
                      title={format(parseDateOnly(d), t.streaks.dateFormat, {
                        locale,
                      })}
                      className={cn(
                        "h-3 flex-1 rounded-sm",
                        hit ? "opacity-100" : "opacity-15",
                      )}
                      style={{
                        background: hit ? s.color : "var(--border-strong)",
                      }}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
