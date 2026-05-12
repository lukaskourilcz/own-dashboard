import { format } from "date-fns";
import { convert } from "@/lib/fx";
import { totalMonthlyIn } from "@/lib/subscriptions";
import type { Account, Subscription, Transaction } from "@/lib/types";

export function netWorth(accounts: Account[], displayCurrency: string): number {
  return accounts.reduce(
    (acc, a) => acc + convert(a.balance, a.currency, displayCurrency),
    0,
  );
}

export type MonthBucket = {
  month: string; // "yyyy-MM"
  label: string; // "Jan", "Feb"...
  income: number;
  expense: number;
};

export function monthlyTotals(
  transactions: Transaction[],
  displayCurrency: string,
  monthsBack = 6,
): MonthBucket[] {
  const now = new Date();
  const buckets = new Map<string, MonthBucket>();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = format(d, "yyyy-MM");
    buckets.set(key, { month: key, label: format(d, "MMM"), income: 0, expense: 0 });
  }
  for (const t of transactions) {
    const key = t.occurred_on.slice(0, 7);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const amount = convert(t.amount, t.currency, displayCurrency);
    if (t.kind === "income") bucket.income += amount;
    else bucket.expense += amount;
  }
  return [...buckets.values()];
}

export type CategorySlice = { name: string; value: number };

export function expenseByCategory(
  transactions: Transaction[],
  displayCurrency: string,
  // Pass active subscriptions to fold their monthly equivalent into the chart
  // as a synthetic "Subscriptions" slice the rest of the dashboard already
  // tracks separately.
  subscriptions: Subscription[],
  monthKey: string,
): CategorySlice[] {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.kind !== "expense") continue;
    if (!t.occurred_on.startsWith(monthKey)) continue;
    const key = t.category?.trim() || "Uncategorized";
    totals.set(
      key,
      (totals.get(key) ?? 0) + convert(t.amount, t.currency, displayCurrency),
    );
  }
  const subsTotal = totalMonthlyIn(subscriptions, displayCurrency);
  if (subsTotal > 0) {
    totals.set("Subscriptions", (totals.get("Subscriptions") ?? 0) + subsTotal);
  }
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value);
}

export function currentMonthKey(): string {
  return format(new Date(), "yyyy-MM");
}
