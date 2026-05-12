import type { Subscription } from "@/lib/types";

export function toMonthly(sub: Subscription): number {
  if (sub.billing_cycle === "yearly") return sub.amount / 12;
  if (sub.billing_cycle === "weekly") return (sub.amount * 52) / 12;
  return sub.amount;
}

export function totalMonthly(subs: Subscription[]): number {
  return subs.reduce((acc, s) => acc + toMonthly(s), 0);
}
