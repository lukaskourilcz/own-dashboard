import type { Subscription } from "@/lib/types";
import { convert } from "@/lib/fx";

export function isActive(sub: Subscription): boolean {
  // Treat undefined (pre-migration rows) as active.
  return sub.is_active !== false;
}

export function toMonthly(sub: Subscription): number {
  if (sub.billing_cycle === "yearly") return sub.amount / 12;
  if (sub.billing_cycle === "weekly") return (sub.amount * 52) / 12;
  return sub.amount;
}

export function toMonthlyIn(sub: Subscription, displayCurrency: string): number {
  return convert(toMonthly(sub), sub.currency, displayCurrency);
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

export function upcomingRenewals(
  subs: Subscription[],
  withinDays = 30,
): Subscription[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + withinDays);

  return subs
    .filter((s) => isActive(s) && s.next_billing_date)
    .filter((s) => {
      const d = new Date(`${s.next_billing_date}T00:00:00`);
      return d >= today && d <= horizon;
    })
    .sort((a, b) =>
      (a.next_billing_date ?? "").localeCompare(b.next_billing_date ?? ""),
    );
}
