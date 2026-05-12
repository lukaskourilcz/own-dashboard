"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Heart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  MOOD_META,
  averageMood,
  buildTrend,
  findToday,
  pulseStreak,
  todayKey,
} from "@/lib/pulse";
import type { DailyPulse, PulseMood } from "@/lib/types";
import type { Profile } from "@/lib/types";

type Updater<T> = (next: T | ((prev: T) => T)) => void;

const MOOD_LEVELS: PulseMood[] = [1, 2, 3, 4, 5];

let tentativePulseCounter = 0;

export function PulsePanel({
  pulses,
  setPulses,
  userId,
  userName,
  partnerProfile,
  compact = false,
}: {
  pulses: DailyPulse[];
  setPulses: Updater<DailyPulse[]>;
  userId: string;
  userName: string;
  partnerProfile: Profile | null;
  compact?: boolean;
}) {
  const supabase = createClient();
  const toast = useToast();
  const today = todayKey();
  const myToday = useMemo(() => findToday(pulses, userId), [pulses, userId]);
  const partnerId = partnerProfile?.id ?? null;
  const partnerName =
    partnerProfile?.display_name ?? partnerProfile?.email ?? "Partner";
  const partnerToday = useMemo(
    () => (partnerId ? findToday(pulses, partnerId) : null),
    [pulses, partnerId],
  );

  const [note, setNote] = useState<string>(myToday?.note ?? "");
  const [editing, setEditing] = useState(false);

  async function setMood(mood: PulseMood) {
    if (myToday) {
      // Update existing.
      const before = myToday;
      setPulses((prev) =>
        prev.map((p) => (p.id === before.id ? { ...p, mood } : p)),
      );
      const { error } = await supabase
        .from("daily_pulse")
        .update({ mood })
        .eq("id", before.id);
      if (error) {
        setPulses((prev) =>
          prev.map((p) => (p.id === before.id ? before : p)),
        );
        toast.err(error.message);
      }
      return;
    }
    // Insert new.
    const tentativeId = `tmp-${++tentativePulseCounter}`;
    const tentative: DailyPulse = {
      id: tentativeId,
      user_id: userId,
      log_date: today,
      mood,
      note: note.trim() || null,
      created_at: "",
    };
    setPulses((prev) => [tentative, ...prev]);
    const { data, error } = await supabase
      .from("daily_pulse")
      .insert({
        user_id: userId,
        log_date: today,
        mood,
        note: note.trim() || null,
      })
      .select()
      .single();
    if (error || !data) {
      setPulses((prev) => prev.filter((p) => p.id !== tentativeId));
      toast.err(error?.message ?? "Could not save mood.");
      return;
    }
    setPulses((prev) => prev.map((p) => (p.id === tentativeId ? data : p)));
    toast.ok(`Logged ${MOOD_META[mood].label.toLowerCase()} for today.`);
  }

  async function saveNote() {
    if (!myToday) {
      toast.info("Pick a mood first.");
      return;
    }
    const next = note.trim() || null;
    const before = myToday;
    setPulses((prev) =>
      prev.map((p) => (p.id === before.id ? { ...p, note: next } : p)),
    );
    setEditing(false);
    const { error } = await supabase
      .from("daily_pulse")
      .update({ note: next })
      .eq("id", before.id);
    if (error) {
      setPulses((prev) =>
        prev.map((p) => (p.id === before.id ? before : p)),
      );
      toast.err(error.message);
    }
  }

  async function clearToday() {
    if (!myToday) return;
    const before = myToday;
    setPulses((prev) => prev.filter((p) => p.id !== before.id));
    setNote("");
    setEditing(false);
    const { error } = await supabase
      .from("daily_pulse")
      .delete()
      .eq("id", before.id);
    if (error) {
      setPulses((prev) => [before, ...prev]);
      toast.err(error.message);
    }
  }

  const streak = pulseStreak(pulses, userId);
  const myAvg = averageMood(pulses, userId, 14);
  const partnerAvg = partnerId ? averageMood(pulses, partnerId, 14) : null;
  const trend = useMemo(
    () => buildTrend(pulses, userId, partnerId, compact ? 14 : 30),
    [pulses, userId, partnerId, compact],
  );

  if (compact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-4 w-4" />
              Pulse
              <span className="text-sm font-normal text-zinc-500 ml-2">
                {streak > 0 ? `${streak}-day check-in streak` : "today"}
              </span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {myToday ? (
            <div className="flex items-center gap-3">
              <span className="text-3xl">{MOOD_META[myToday.mood].emoji}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {MOOD_META[myToday.mood].label}
                </p>
                {myToday.note && (
                  <p className="text-xs text-zinc-500 truncate">
                    {myToday.note}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {MOOD_LEVELS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMood(m)}
                  className="h-9 w-9 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xl"
                  aria-label={MOOD_META[m].label}
                  title={MOOD_META[m].label}
                >
                  {MOOD_META[m].emoji}
                </button>
              ))}
            </div>
          )}
          {partnerProfile && (
            <p className="text-xs text-zinc-500 mt-3 inline-flex items-center gap-1.5">
              <Heart className="h-3 w-3" />
              {partnerToday ? (
                <>
                  {partnerName}: {MOOD_META[partnerToday.mood].emoji}{" "}
                  {MOOD_META[partnerToday.mood].label}
                </>
              ) : (
                <>{partnerName} hasn&apos;t checked in today.</>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-4 w-4" />
              How are you today?
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {MOOD_LEVELS.map((m) => {
              const active = myToday?.mood === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMood(m)}
                  className={cn(
                    "h-14 w-14 rounded-lg text-3xl border-2 transition-all",
                    active
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900 scale-105"
                      : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-700",
                  )}
                  aria-label={MOOD_META[m].label}
                  title={MOOD_META[m].label}
                >
                  {MOOD_META[m].emoji}
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-2">
            {myToday && !editing && (
              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/40 dark:bg-zinc-900/40">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-medium">
                      {MOOD_META[myToday.mood].label}
                    </span>
                    {myToday.note ? ` — ${myToday.note}` : ""}
                  </p>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNote(myToday.note ?? "");
                        setEditing(true);
                      }}
                    >
                      {myToday.note ? "Edit note" : "Add note"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={clearToday}
                      aria-label="Clear today"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {(!myToday || editing) && (
              <div className="space-y-2">
                <Textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    myToday
                      ? "One line about today (optional)…"
                      : "Pick a mood above. You can add a note now or later."
                  }
                />
                {editing && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveNote}>
                      Save note
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(false);
                        setNote(myToday?.note ?? "");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="Check-in streak" value={streak > 0 ? `${streak}d` : "—"} />
            <Stat
              label="My 14-day avg"
              value={myAvg !== null ? myAvg.toFixed(1) : "—"}
            />
            <Stat
              label={partnerProfile ? `${partnerName} 14d avg` : "Logs"}
              value={
                partnerProfile
                  ? partnerAvg !== null
                    ? partnerAvg.toFixed(1)
                    : "—"
                  : String(pulses.filter((p) => p.user_id === userId).length)
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              {partnerProfile ? (
                <Heart className="h-4 w-4" />
              ) : (
                <Activity className="h-4 w-4" />
              )}
              {partnerProfile
                ? `${userName} & ${partnerName}`
                : "Your 30 days"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {partnerProfile && (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
                <p className="text-xs text-zinc-500">{userName} (you)</p>
                {myToday ? (
                  <p className="text-lg">
                    {MOOD_META[myToday.mood].emoji}{" "}
                    <span className="text-sm font-medium">
                      {MOOD_META[myToday.mood].label}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-zinc-400">Not yet today.</p>
                )}
                {myToday?.note && (
                  <p className="text-xs text-zinc-500 mt-1">{myToday.note}</p>
                )}
              </div>
              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
                <p className="text-xs text-zinc-500">{partnerName}</p>
                {partnerToday ? (
                  <p className="text-lg">
                    {MOOD_META[partnerToday.mood].emoji}{" "}
                    <span className="text-sm font-medium">
                      {MOOD_META[partnerToday.mood].label}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-zinc-400">Not yet today.</p>
                )}
                {partnerToday?.note && (
                  <p className="text-xs text-zinc-500 mt-1">
                    {partnerToday.note}
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis
                  dataKey="label"
                  fontSize={10}
                  interval={Math.max(0, Math.floor(trend.length / 6) - 1)}
                />
                <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} fontSize={10} width={20} />
                <Tooltip
                  formatter={(value, name) => {
                    if (value === null || value === undefined)
                      return ["—", name === "me" ? userName : partnerName];
                    const n = Number(value) as PulseMood;
                    return [
                      `${MOOD_META[n].emoji} ${MOOD_META[n].label}`,
                      name === "me" ? userName : partnerName,
                    ];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="me"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name="me"
                />
                {partnerProfile && (
                  <Line
                    type="monotone"
                    dataKey="partner"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name="partner"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
