import { describe, expect, it } from "vitest";
import {
  amountConfirmationAfterEdit,
  isAmountConfirmed,
  isDevelopmentSubscription,
  isDevelopmentTransaction,
  monthKeys,
  staleAllocationIds,
  subscriptionActiveInMonth,
  subscriptionShares,
  summarizeDevFinance,
} from "@/lib/dev-finance";
import type { Project, Subscription, SubscriptionAllocation, Transaction } from "@/lib/types";

const NOW = new Date(2026, 8, 16);

function sub(overrides: Partial<Subscription>): Subscription {
  return {
    id: overrides.id ?? "s",
    user_id: "u",
    name: overrides.name ?? "Vendor",
    amount: 10,
    currency: "USD",
    billing_cycle: "monthly",
    category: null,
    category_group: "development",
    next_billing_date: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function project(overrides: Partial<Project>): Project {
  return {
    id: overrides.id ?? "p",
    user_id: "u",
    name: overrides.name ?? "Project",
    slug: overrides.slug ?? overrides.id ?? "p",
    repo_full_name: null,
    url: null,
    notes: "",
    color: null,
    sort_order: 0,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function allocation(subscription_id: string, project_id: string, share: number): SubscriptionAllocation {
  return { id: `${subscription_id}-${project_id}`, user_id: "u", subscription_id, project_id, share, note: "", created_at: "", updated_at: "" };
}

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? "t",
    user_id: "u",
    account_id: null,
    kind: "expense",
    amount: 10,
    currency: "USD",
    category: null,
    note: null,
    occurred_on: "2026-09-01",
    external_id: null,
    created_at: "",
    ...overrides,
  };
}

describe("development scope", () => {
  it("treats development-group and allocated subscriptions as development", () => {
    const personal = sub({ id: "n", category_group: "entertainment" });
    const dev = sub({ id: "d" });
    const allocated = sub({ id: "a", category_group: "other" });
    const allocations = [allocation("a", "p", 1)];
    expect(isDevelopmentSubscription(personal, allocations)).toBe(false);
    expect(isDevelopmentSubscription(dev, allocations)).toBe(true);
    expect(isDevelopmentSubscription(allocated, allocations)).toBe(true);
  });

  it("recognizes development transactions by link or category, never income", () => {
    expect(isDevelopmentTransaction(tx({ subscription_id: "s" }))).toBe(true);
    expect(isDevelopmentTransaction(tx({ project_id: "p" }))).toBe(true);
    expect(isDevelopmentTransaction(tx({ category: "Development" }))).toBe(true);
    expect(isDevelopmentTransaction(tx({ category: "Groceries" }))).toBe(false);
    expect(isDevelopmentTransaction(tx({ kind: "income", project_id: "p" }))).toBe(false);
  });
});

describe("subscription shares", () => {
  it("leaves the remainder unallocated and normalizes over-allocation", () => {
    const s = sub({ id: "s" });
    expect(subscriptionShares(s, [allocation("s", "a", 0.25), allocation("s", "b", 0.25)])).toEqual([
      { projectId: "a", share: 0.25 },
      { projectId: "b", share: 0.25 },
      { projectId: null, share: 0.5 },
    ]);
    const over = subscriptionShares(s, [allocation("s", "a", 1), allocation("s", "b", 1)]);
    expect(over.map((slice) => slice.share)).toEqual([0.5, 0.5]);
  });

  it("falls back to the legacy single project link", () => {
    expect(subscriptionShares(sub({ id: "s", project_id: "p" }), [])).toEqual([{ projectId: "p", share: 1 }]);
  });
});

describe("amount confirmation", () => {
  it("reads a confirmation only from a well-formed date", () => {
    expect(isAmountConfirmed(sub({}))).toBe(false);
    expect(isAmountConfirmed(sub({ amount_confirmed_on: null }))).toBe(false);
    expect(isAmountConfirmed(sub({ amount_confirmed_on: "" }))).toBe(false);
    expect(isAmountConfirmed(sub({ amount_confirmed_on: "yesterday" }))).toBe(false);
    expect(isAmountConfirmed(sub({ amount_confirmed_on: "2026-09-16" }))).toBe(true);
  });

  it("keeps a confirmation across edits that leave the figure alone", () => {
    const previous = sub({ amount: 20, currency: "USD", billing_cycle: "monthly", amount_confirmed_on: "2026-09-16" });
    expect(amountConfirmationAfterEdit(previous, { amount: 20, currency: "USD", billing_cycle: "monthly" })).toBe("2026-09-16");
  });

  it("drops it when the amount, the currency or the cycle moves", () => {
    const previous = sub({ amount: 20, currency: "USD", billing_cycle: "monthly", amount_confirmed_on: "2026-09-16" });
    expect(amountConfirmationAfterEdit(previous, { amount: 22.99, currency: "USD", billing_cycle: "monthly" })).toBeNull();
    expect(amountConfirmationAfterEdit(previous, { amount: 20, currency: "EUR", billing_cycle: "monthly" })).toBeNull();
    expect(amountConfirmationAfterEdit(previous, { amount: 20, currency: "USD", billing_cycle: "yearly" })).toBeNull();
  });

  it("never invents a confirmation for a new or unconfirmed subscription", () => {
    expect(amountConfirmationAfterEdit(null, { amount: 20, currency: "USD", billing_cycle: "monthly" })).toBeNull();
    const unconfirmed = sub({ amount: 20, currency: "USD", billing_cycle: "monthly" });
    expect(amountConfirmationAfterEdit(unconfirmed, { amount: 20, currency: "USD", billing_cycle: "monthly" })).toBeNull();
  });
});

describe("months", () => {
  it("builds a trailing window of month keys", () => {
    expect(monthKeys(3, NOW)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("counts a subscription only between its start and end months", () => {
    const s = sub({ started_on: "2026-07-18", ended_on: "2026-08-28" });
    expect(subscriptionActiveInMonth(s, "2026-06")).toBe(false);
    expect(subscriptionActiveInMonth(s, "2026-07")).toBe(true);
    expect(subscriptionActiveInMonth(s, "2026-08")).toBe(true);
    expect(subscriptionActiveInMonth(s, "2026-09")).toBe(false);
    const running = sub({ started_on: "2026-08-01" });
    expect(subscriptionActiveInMonth(running, "2026-09")).toBe(true);
    const stopped = sub({ created_at: "2026-05-01T00:00:00Z", updated_at: "2026-07-10T00:00:00Z", is_active: false });
    expect(subscriptionActiveInMonth(stopped, "2026-07")).toBe(true);
    expect(subscriptionActiveInMonth(stopped, "2026-08")).toBe(false);
  });
});

describe("summarizeDevFinance", () => {
  const projects = [
    project({ id: "dash", name: "OwnDashboard", engagement: "own", portfolio_key: "own-dashboard" }),
    project({ id: "gym", name: "gym-plzen", engagement: "client" }),
    project({ id: "old", name: "old", engagement: "own" }),
  ];
  const subscriptions = [
    sub({ id: "vercel", name: "Vercel", amount: 20, started_on: "2026-07-18" }),
    sub({ id: "netflix", name: "Netflix", amount: 15, category_group: "entertainment" }),
    sub({ id: "mobbin", name: "Mobbin", amount: 45, billing_cycle: "quarterly", started_on: "2026-08-29" }),
  ];
  const allocations = [allocation("vercel", "dash", 0.5), allocation("vercel", "gym", 0.25)];
  const transactions = [
    tx({ id: "1", amount: 24.2, occurred_on: "2026-07-18", subscription_id: "vercel" }),
    tx({ id: "2", amount: 65.48, occurred_on: "2026-08-20", subscription_id: "vercel" }),
    tx({ id: "3", amount: 10, occurred_on: "2026-08-08", project_id: "dash" }),
    tx({ id: "4", amount: 14500, currency: "CZK", occurred_on: "2026-08-01", category: "Rent" }),
    tx({ id: "5", amount: 999, occurred_on: "2024-01-01", project_id: "dash" }),
  ];

  const summary = summarizeDevFinance({ subscriptions, allocations, transactions, projects, projectCosts: [], crons: [], currency: "USD", now: NOW, months: 12 });

  it("excludes personal subscriptions and splits shared ones by share", () => {
    expect(summary.recurringMonthly).toBeCloseTo(35, 5);
    expect(summary.ownMonthly).toBeCloseTo(10, 5);
    expect(summary.clientMonthly).toBeCloseTo(5, 5);
    // Own and client spend partition the allocated total; a project with no
    // spend is listed only when it is a portfolio or client project.
    expect(summary.byProject.map((row) => row.project.id)).not.toContain("old");
    expect(summary.unallocatedMonthly).toBeCloseTo(5 + 15, 5);
    expect(summary.byVendor.map((row) => row.name)).toEqual(["Vercel", "Mobbin"]);
  });

  it("attributes paid invoices through the subscription allocation and one-offs directly", () => {
    const dash = summary.byProject.find((row) => row.project.id === "dash")!;
    expect(dash.paidTotal).toBeCloseTo((24.2 + 65.48) * 0.5 + 10, 5);
    expect(dash.oneOffTotal).toBeCloseTo(10, 5);
    expect(summary.paidLastMonths).toBeCloseTo(24.2 + 65.48 + 10, 5);
    expect(summary.developmentTransactions.map((item) => item.id)).toEqual(["2", "3", "1", "5"]);
  });

  it("reports the running spend whose figure nobody has checked", () => {
    // Vercel $20 is confirmed, Mobbin $45 quarterly ($15/mo) is not, and the
    // personal Netflix row is outside development entirely.
    const withConfirmation = summarizeDevFinance({
      subscriptions: subscriptions.map((item) => (item.id === "vercel" ? { ...item, amount_confirmed_on: "2026-09-10" } : item)),
      allocations,
      transactions,
      projects,
      projectCosts: [],
      crons: [],
      currency: "USD",
      now: NOW,
      months: 12,
    });
    expect(withConfirmation.unconfirmedCount).toBe(1);
    expect(withConfirmation.unconfirmedMonthly).toBeCloseTo(15, 5);
  });

  it("counts every running development subscription while none is confirmed", () => {
    expect(summary.unconfirmedCount).toBe(2);
    expect(summary.unconfirmedMonthly).toBeCloseTo(35, 5);
  });

  it("leaves an ended subscription out of the unconfirmed figure", () => {
    const ended = summarizeDevFinance({
      subscriptions: [...subscriptions, sub({ id: "canva", name: "Canva", amount: 100, is_active: false })],
      allocations,
      transactions,
      projects,
      projectCosts: [],
      crons: [],
      currency: "USD",
      now: NOW,
      months: 12,
    });
    expect(ended.unconfirmedCount).toBe(2);
    expect(ended.unconfirmedMonthly).toBeCloseTo(35, 5);
  });

  it("builds a committed vs paid timeline", () => {
    const july = summary.timeline.find((point) => point.month === "2026-07")!;
    const september = summary.timeline.find((point) => point.month === "2026-09")!;
    expect(july.committed).toBeCloseTo(20, 5);
    expect(july.paid).toBeCloseTo(24.2, 5);
    expect(september.committed).toBeCloseTo(35, 5);
    expect(summary.timeline).toHaveLength(12);
  });
});

describe("staleAllocationIds", () => {
  it("deletes only rows the form opened with and no longer lists", () => {
    const opened = [
      { id: "a1", project_id: "dneskai" },
      { id: "a2", project_id: "devshark" },
    ];
    expect(staleAllocationIds(opened, [{ project_id: "dneskai" }])).toEqual(["a2"]);
    expect(staleAllocationIds(opened, [{ project_id: "dneskai" }, { project_id: "devshark" }])).toEqual([]);
  });

  it("deletes nothing when the form opened before the allocations loaded", () => {
    // The editor showed no rows because none had arrived; saving it must not
    // read as "remove every allocation".
    expect(staleAllocationIds([], [])).toEqual([]);
    expect(staleAllocationIds([], [{ project_id: "dneskai" }])).toEqual([]);
  });
});
