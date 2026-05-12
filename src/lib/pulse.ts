import { format, subDays } from "date-fns";
import type { DailyPulse, PulseMood } from "@/lib/types";

export const MOOD_META: Record<
  PulseMood,
  { emoji: string; label: string; color: string }
> = {
  1: { emoji: "😞", label: "Rough", color: "#ef4444" },
  2: { emoji: "😕", label: "Meh", color: "#f59e0b" },
  3: { emoji: "😐", label: "Okay", color: "#eab308" },
  4: { emoji: "🙂", label: "Good", color: "#84cc16" },
  5: { emoji: "😄", label: "Great", color: "#10b981" },
};

export function todayKey(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function findToday(
  pulses: DailyPulse[],
  userId: string,
): DailyPulse | null {
  const k = todayKey();
  return (
    pulses.find((p) => p.user_id === userId && p.log_date === k) ?? null
  );
}

export function pulseStreak(pulses: DailyPulse[], userId: string): number {
  const dates = new Set(
    pulses.filter((p) => p.user_id === userId).map((p) => p.log_date),
  );
  let count = 0;
  let cursor = new Date();
  while (dates.has(format(cursor, "yyyy-MM-dd"))) {
    count++;
    cursor = subDays(cursor, 1);
  }
  return count;
}

export type TrendPoint = {
  date: string;
  label: string;
  me: number | null;
  partner: number | null;
};

export function buildTrend(
  pulses: DailyPulse[],
  userId: string,
  partnerId: string | null,
  days = 30,
): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(new Date(), i);
    const key = format(d, "yyyy-MM-dd");
    const mine = pulses.find(
      (p) => p.user_id === userId && p.log_date === key,
    );
    const theirs = partnerId
      ? pulses.find((p) => p.user_id === partnerId && p.log_date === key)
      : null;
    out.push({
      date: key,
      label: format(d, "MMM d"),
      me: mine ? mine.mood : null,
      partner: theirs ? theirs.mood : null,
    });
  }
  return out;
}

export function averageMood(
  pulses: DailyPulse[],
  userId: string,
  days = 14,
): number | null {
  const cutoff = format(subDays(new Date(), days - 1), "yyyy-MM-dd");
  const window = pulses.filter(
    (p) => p.user_id === userId && p.log_date >= cutoff,
  );
  if (window.length === 0) return null;
  const sum = window.reduce((s, p) => s + p.mood, 0);
  return sum / window.length;
}
