import { addDays, differenceInCalendarDays, format, startOfWeek, subDays } from "date-fns";

export function todayKey(ref: Date = new Date()): string {
  return format(ref, "yyyy-MM-dd");
}

/**
 * Whole calendar days from today until a `yyyy-MM-dd` date. Negative = overdue,
 * 0 = due today, positive = days remaining. Powers task "time to finish".
 */
export function daysUntilDate(yyyyMmDd: string, ref: Date = new Date()): number {
  return differenceInCalendarDays(parseDateOnly(yyyyMmDd), ref);
}

export function parseDateOnly(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T00:00:00`);
}

/**
 * The Monday of the week a date falls in, as a `yyyy-MM-dd` key. This is the
 * `week_start` column of `weekly_reviews`, so it is formatted in local time —
 * a UTC conversion would move an early-morning Monday in a positive offset back
 * onto the previous Sunday and split one week across two review rows.
 */
export function mondayKey(ref: Date = new Date()): string {
  return format(startOfWeek(ref, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

/** The Monday of the week before the one `ref` falls in. */
export function previousMondayKey(ref: Date = new Date()): string {
  return mondayKey(subDays(startOfWeek(ref, { weekStartsOn: 1 }), 1));
}

/**
 * The half-open range of a `yyyy-MM-dd` week key: Monday 00:00 local up to, but
 * not including, the next Monday 00:00. Half-open so an event that starts
 * exactly at midnight on the following Monday belongs to the next week only.
 */
export function weekRange(weekStartKey: string): { start: Date; endExclusive: Date } {
  const start = parseDateOnly(weekStartKey);
  return { start, endExclusive: addDays(start, 7) };
}
