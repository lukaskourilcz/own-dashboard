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
