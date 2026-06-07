import { differenceInCalendarDays } from "date-fns";
import { parseDateOnly } from "@/lib/date-keys";
import type { ImportantDate } from "@/lib/types";

export type DateOccurrence = {
  date: ImportantDate;
  next: Date;
  daysUntil: number;
  yearsCompleted: number | null;
};

export function nextOccurrence(d: ImportantDate, ref: Date = new Date()): Date {
  const base = parseDateOnly(d.the_date);
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (!d.is_recurring) return base;

  if (d.recurrence_unit === "monthly") {
    // Same day-of-month each month — clamp if the target month is shorter.
    let year = today.getFullYear();
    let month = today.getMonth();
    const day = base.getDate();
    let candidate = clampDay(year, month, day);
    if (candidate < today) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      candidate = clampDay(year, month, day);
    }
    return candidate;
  }

  // Yearly (the default for is_recurring)
  let year = today.getFullYear();
  let candidate = new Date(year, base.getMonth(), base.getDate());
  if (candidate < today) {
    year += 1;
    candidate = new Date(year, base.getMonth(), base.getDate());
  }
  return candidate;
}

function clampDay(year: number, month: number, day: number): Date {
  // new Date(y, m, 0).getDate() gives the number of days in month `m-1`,
  // so new Date(y, m+1, 0) gives days in month `m`.
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

export function buildOccurrences(
  dates: ImportantDate[],
  ref: Date = new Date(),
): DateOccurrence[] {
  return dates
    .map<DateOccurrence>((d) => {
      const next = nextOccurrence(d, ref);
      const base = parseDateOnly(d.the_date);
      const yearsCompleted = d.is_recurring
        ? d.recurrence_unit === "monthly"
          ? null
          : Math.max(0, next.getFullYear() - base.getFullYear() - 1)
        : null;
      return {
        date: d,
        next,
        daysUntil: differenceInCalendarDays(next, ref),
        yearsCompleted,
      };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

export function nextUpcoming(
  dates: ImportantDate[],
  ref: Date = new Date(),
): DateOccurrence | null {
  return buildOccurrences(dates, ref).find((d) => d.daysUntil >= 0) ?? null;
}

export function countdownLabel(daysUntil: number): string {
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil < 0) return `${-daysUntil}d ago`;
  if (daysUntil < 14) return `in ${daysUntil}d`;
  if (daysUntil < 60) return `in ${Math.round(daysUntil / 7)}w`;
  return `in ${Math.round(daysUntil / 30)}mo`;
}
