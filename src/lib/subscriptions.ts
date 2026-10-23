import type { Subscription } from "@/lib/types";
import { convert } from "@/lib/fx";
import { parseDateOnly } from "@/lib/date-keys";
import { differenceInCalendarDays, startOfDay } from "date-fns";

export function isActive(sub: Subscription): boolean {
  // Treat undefined (pre-migration rows) as active.
  return sub.is_active !== false;
}

export function toMonthly(sub: Subscription): number {
  if (sub.billing_cycle === "yearly") return sub.amount / 12;
  if (sub.billing_cycle === "quarterly") return sub.amount / 3;
  if (sub.billing_cycle === "weekly") return (sub.amount * 52) / 12;
  return sub.amount;
}

export function toMonthlyIn(sub: Subscription, displayCurrency: string): number {
  return convert(toMonthly(sub), sub.currency, displayCurrency);
}

/** A single subscription's yearly cost (monthly × 12) in the display currency. */
export function toYearlyIn(sub: Subscription, displayCurrency: string): number {
  return toMonthlyIn(sub, displayCurrency) * 12;
}

export function totalMonthly(subs: Subscription[]): number {
  return subs.filter(isActive).reduce((acc, s) => acc + toMonthly(s), 0);
}

export function totalMonthlyIn(
  subs: Subscription[],
  displayCurrency: string,
): number {
  return subs.filter(isActive).reduce(
    (acc, s) => acc + toMonthlyIn(s, displayCurrency),
    0,
  );
}

/**
 * Days until the next billing date, or null if the subscription has none.
 * Negative for overdue, 0 for "today", positive for future. Floor()-ed at
 * the day boundary so "tomorrow at 23:00" still reads as 1 day, not 0.
 */
export function daysUntilRenewal(sub: Subscription, now: Date = new Date()): number | null {
  if (!sub.next_billing_date) return null;
  const d = parseDateOnly(sub.next_billing_date);
  return differenceInCalendarDays(d, now);
}

export function upcomingRenewals(
  subs: Subscription[],
  withinDays = 30,
  now: Date = new Date(),
): Subscription[] {
  const today = startOfDay(now);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + withinDays);

  return subs
    .filter((s) => isActive(s) && s.next_billing_date)
    .filter((s) => {
      const d = parseDateOnly(s.next_billing_date!);
      return d >= today && d <= horizon;
    })
    .sort((a, b) =>
      (a.next_billing_date ?? "").localeCompare(b.next_billing_date ?? ""),
    );
}
