import { format, subDays } from "date-fns";
import type { Streak, StreakLog } from "@/lib/types";

export function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function computeStreak(logs: StreakLog[]): number {
  const set = new Set(logs.map((l) => l.log_date));
  let count = 0;
  let cursor = new Date();
  while (set.has(format(cursor, "yyyy-MM-dd"))) {
    count++;
    cursor = subDays(cursor, 1);
  }
  return count;
}

const DAY_MS = 1000 * 60 * 60 * 24;

export function bestStreak(logs: StreakLog[]): number {
  if (logs.length === 0) return 0;
  const sorted = [...new Set(logs.map((l) => l.log_date))].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const cur = new Date(sorted[i]);
    if (Math.round((cur.getTime() - prev.getTime()) / DAY_MS) === 1) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

export function logsByStreak(logs: StreakLog[]): Map<string, StreakLog[]> {
  const map = new Map<string, StreakLog[]>();
  for (const log of logs) {
    const arr = map.get(log.streak_id);
    if (arr) arr.push(log);
    else map.set(log.streak_id, [log]);
  }
  return map;
}

export function longestActiveStreak(
  streaks: Streak[],
  logs: StreakLog[],
): { streak: Streak; count: number } | null {
  const grouped = logsByStreak(logs);
  let best: { streak: Streak; count: number } | null = null;
  for (const s of streaks) {
    const c = computeStreak(grouped.get(s.id) ?? []);
    if (!best || c > best.count) best = { streak: s, count: c };
  }
  return best && best.count > 0 ? best : null;
}

export function streaksUncheckedToday(
  streaks: Streak[],
  logs: StreakLog[],
): Streak[] {
  const today = todayStr();
  const checkedIds = new Set(
    logs.filter((l) => l.log_date === today).map((l) => l.streak_id),
  );
  return streaks.filter((s) => !checkedIds.has(s.id));
}

export type StreakWithCount = { streak: Streak; count: number };

export function uncheckedTodayWithCounts(
  streaks: Streak[],
  logs: StreakLog[],
): StreakWithCount[] {
  const today = todayStr();
  const grouped = logsByStreak(logs);
  return streaks
    .filter((s) => !logs.some((l) => l.streak_id === s.id && l.log_date === today))
    .map((s) => {
      // Walk back from yesterday — that's the run today's check-in would extend.
      const dates = new Set((grouped.get(s.id) ?? []).map((l) => l.log_date));
      let count = 0;
      let cursor = subDays(new Date(), 1);
      while (dates.has(format(cursor, "yyyy-MM-dd"))) {
        count++;
        cursor = subDays(cursor, 1);
      }
      return { streak: s, count };
    })
    .sort((a, b) => b.count - a.count);
}
