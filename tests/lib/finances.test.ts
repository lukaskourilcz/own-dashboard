import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentMonthKey,
  expenseByCategory,
  monthlyTotals,
  netWorth,
} from "@/lib/finances";
import type { Account, Transaction } from "@/lib/types";

const FROZEN = new Date(2026, 4, 12);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN);
});
afterEach(() => {
  vi.useRealTimers();
});

function acct(overrides: Partial<Account> = {}): Account {
  return {
    id: "a",
    user_id: "u",
    name: "Checking",
    balance: 0,
    currency: "USD",
    external_ref: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t",
    user_id: "u",
    account_id: null,
    kind: "expense",
    amount: 0,
    currency: "USD",
    category: null,
    note: null,
    occurred_on: "2026-05-12",
    external_id: null,
    created_at: "",
    ...overrides,
  };
}

describe("netWorth", () => {
  it("sums balances into the chosen display currency", () => {
    const accts = [
      acct({ balance: 1000, currency: "USD" }),
      acct({ balance: 1000, currency: "EUR" }), // -> ~1080 USD
    ];
    expect(netWorth(accts, "USD")).toBeCloseTo(2080, 0);
  });
  it("returns 0 for an empty list", () => {
    expect(netWorth([], "USD")).toBe(0);
  });
});

describe("monthlyTotals", () => {
  it("buckets transactions into income/expense per month", () => {
    const txs = [
      tx({ kind: "income", amount: 1000, occurred_on: "2026-05-01" }),
      tx({ kind: "expense", amount: 100, occurred_on: "2026-05-15" }),
      tx({ kind: "income", amount: 500, occurred_on: "2026-04-20" }),
    ];
    const buckets = monthlyTotals(txs, "USD", 6);
    const may = buckets.find((b) => b.month === "2026-05");
    const apr = buckets.find((b) => b.month === "2026-04");
    expect(may?.income).toBe(1000);
    expect(may?.expense).toBe(100);
    expect(apr?.income).toBe(500);
  });

  it("returns the requested number of months, even when empty", () => {
    expect(monthlyTotals([], "USD", 6).length).toBe(6);
  });

  it("ignores transactions outside the window", () => {
    const txs = [
      // 2 years ago — should not affect a 6-month window.
      tx({ kind: "expense", amount: 999, occurred_on: "2024-05-01" }),
    ];
    const buckets = monthlyTotals(txs, "USD", 6);
    expect(buckets.every((b) => b.expense === 0)).toBe(true);
  });
});

describe("expenseByCategory", () => {
  it("groups expenses by category in the given month", () => {
    const txs = [
      tx({ amount: 10, category: "Food", occurred_on: "2026-05-01" }),
      tx({ amount: 20, category: "Food", occurred_on: "2026-05-08" }),
      tx({ amount: 30, category: "Transport", occurred_on: "2026-05-10" }),
      // wrong month — should be excluded.
      tx({ amount: 99, category: "Food", occurred_on: "2026-04-10" }),
    ];
    const slices = expenseByCategory(txs, "USD", "2026-05");
    expect(slices.find((s) => s.name === "Food")?.value).toBe(30);
    expect(slices.find((s) => s.name === "Transport")?.value).toBe(30);
  });

  it("buckets uncategorized expenses under 'Uncategorized'", () => {
    const txs = [tx({ amount: 5, category: null, occurred_on: "2026-05-01" })];
    expect(expenseByCategory(txs, "USD", "2026-05")[0].name).toBe(
      "Uncategorized",
    );
  });

  it("matches recorded expense totals without adding a second planned subscription charge", () => {
    const rows = [tx({ amount: 120, category: "Subscriptions", subscription_id: "annual-plan" }), tx({ amount: 5, category: "Development" })];
    const slices = expenseByCategory(rows, "USD", "2026-05");
    expect(slices.find(slice => slice.name === "Subscriptions")?.value).toBe(120);
    expect(slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(monthlyTotals(rows, "USD").at(-1)?.expense);
    expect(expenseByCategory([], "USD", "2026-05")).toEqual([]);
  });

  it("ignores income rows", () => {
    const txs = [
      tx({ kind: "income", amount: 1000, occurred_on: "2026-05-01" }),
    ];
    expect(expenseByCategory(txs, "USD", "2026-05").length).toBe(0);
  });

  it("sorts slices by value descending", () => {
    const txs = [
      tx({ amount: 5, category: "A", occurred_on: "2026-05-01" }),
      tx({ amount: 50, category: "B", occurred_on: "2026-05-02" }),
      tx({ amount: 20, category: "C", occurred_on: "2026-05-03" }),
    ];
    expect(expenseByCategory(txs, "USD", "2026-05").map((s) => s.name)).toEqual(
      ["B", "C", "A"],
    );
  });
});

describe("currentMonthKey", () => {
  it("returns yyyy-MM for the frozen day", () => {
    expect(currentMonthKey()).toBe("2026-05");
  });
});


it("uses an injected month rather than the module-load date", () => {
  expect(monthlyTotals([], "USD", 2, new Date(2026, 9, 1)).map(month => month.month)).toEqual(["2026-09", "2026-10"]);
  expect(currentMonthKey(new Date(2026, 10, 2))).toBe("2026-11");
});
