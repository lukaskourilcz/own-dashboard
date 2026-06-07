import { format, subDays } from "date-fns";

export function todayKey(ref: Date = new Date()): string {
  return format(ref, "yyyy-MM-dd");
}

export function parseDateOnly(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T00:00:00`);
}

export function consecutiveDaysEndingOn(
  dates: Iterable<string>,
  end: Date = new Date(),
): number {
  const set = dates instanceof Set ? dates : new Set(dates);
  let count = 0;
  let cursor = end;
  while (set.has(format(cursor, "yyyy-MM-dd"))) {
    count++;
    cursor = subDays(cursor, 1);
  }
  return count;
}
