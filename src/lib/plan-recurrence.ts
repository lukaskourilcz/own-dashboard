import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  startOfMonth,
} from "date-fns";
import type { Plan, PlanRecurrence } from "@/lib/types";

/**
 * Recurring-plan logic — framework-free pure helpers so they can be unit-tested
 * and shared across the server/client boundary.
 *
 * A recurring plan repeats every period (week / two weeks / month). Within the
 * current period it is either still "to do" or already "done" — that resets
 * automatically when the next period starts. "Done for this period" is derived
 * from `last_completed_at` falling inside the current period window, so no
 * per-period rows are needed.
 *
 * Week and biweek windows are Monday-aligned. Biweekly fortnights are anchored
 * to a fixed Monday epoch, so every biweekly plan shares the same boundaries
 * (predictable, the same way weekly aligns to the calendar week).
 */

export type PlanPeriod = { start: Date; end: Date };

// A Monday (2024-01-01 was a Monday) used as the fortnight anchor for biweekly.
const BIWEEKLY_EPOCH = new Date(2024, 0, 1);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight (local) of the given date. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-aligned start of the week containing `d` (local midnight). */
function startOfWeekMonday(d: Date): Date {
  const day = startOfDay(d);
  // getDay(): 0 = Sunday … 6 = Saturday. Shift so Monday = 0.
  const offset = (day.getDay() + 6) % 7;
  return addDays(day, -offset);
}

/**
 * The current period window [start, end) for a recurrence at time `now`.
 * Returns null for non-recurring ("none") plans.
 */
export function currentPeriod(
  recurrence: PlanRecurrence,
  now: Date = new Date(),
): PlanPeriod | null {
  switch (recurrence) {
    case "weekly": {
      const start = startOfWeekMonday(now);
      return { start, end: addDays(start, 7) };
    }
    case "biweekly": {
      const weekStart = startOfWeekMonday(now);
      const weeksSinceEpoch = Math.floor(
        (startOfDay(weekStart).getTime() - BIWEEKLY_EPOCH.getTime()) /
          (7 * MS_PER_DAY),
      );
      // Snap back to the start of the even-indexed week so fortnights tile cleanly.
      const blocksBack = ((weeksSinceEpoch % 2) + 2) % 2;
      const start = addDays(weekStart, -7 * blocksBack);
      return { start, end: addDays(start, 14) };
    }
    case "monthly": {
      const start = startOfMonth(now);
      // end is midnight on the 1st of next month (exclusive upper bound).
      return { start, end: addDays(startOfDay(endOfMonth(now)), 1) };
    }
    default:
      return null;
  }
}

/** Whether a recurring plan has already been completed in its current period. */
export function isDoneThisPeriod(plan: Plan, now: Date = new Date()): boolean {
  if (plan.recurrence === "none" || !plan.last_completed_at) return false;
  const period = currentPeriod(plan.recurrence, now);
  if (!period) return false;
  const done = new Date(plan.last_completed_at).getTime();
  return done >= period.start.getTime() && done < period.end.getTime();
}

/**
 * Whole days left until the period ends (the period's last day is inclusive).
 * e.g. if the period ends tomorrow midnight, today still counts → 1 day left.
 */
export function daysLeftInPeriod(
  period: PlanPeriod,
  now: Date = new Date(),
): number {
  // `end` is the exclusive next-period start, so the last usable day is end-1.
  return Math.max(0, differenceInCalendarDays(period.end, startOfDay(now)) - 1);
}

export type RecurringPlanStatus = {
  plan: Plan;
  period: PlanPeriod;
  done: boolean;
  daysLeft: number;
};

/**
 * The dashboard tracker set: every active recurring plan with its current-period
 * state. Excludes one-off plans and any that are dropped/done (retired goals).
 * Sorted so the still-pending ones come first, soonest deadline first.
 */
export function recurringPlanStatuses(
  plans: Plan[],
  now: Date = new Date(),
): RecurringPlanStatus[] {
  const out: RecurringPlanStatus[] = [];
  for (const plan of plans) {
    if (plan.recurrence === "none") continue;
    if (plan.status === "dropped" || plan.status === "done") continue;
    const period = currentPeriod(plan.recurrence, now);
    if (!period) continue;
    out.push({
      plan,
      period,
      done: isDoneThisPeriod(plan, now),
      daysLeft: daysLeftInPeriod(period, now),
    });
  }
  return out.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return a.plan.title.localeCompare(b.plan.title);
  });
}
