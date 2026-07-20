import { describe, it, expect } from "vitest";
import {
  isActive,
  toMonthly,
  toMonthlyIn,
  toYearlyIn,
  totalMonthly,
  totalMonthlyIn,
  upcomingRenewals,
} from "@/lib/subscriptions";
import type { Subscription } from "@/lib/types";

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "x",
    user_id: "u",
    name: "Netflix",
    amount: 10,
    currency: "USD",
    billing_cycle: "monthly",
    category: null,
    next_billing_date: null,
    is_active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("toMonthly", () => {
  it("returns the amount untouched for monthly billing", () => {
    expect(toMonthly(sub({ amount: 12, billing_cycle: "monthly" }))).toBe(12);
  });
  it("divides yearly billing by 12", () => {
    expect(toMonthly(sub({ amount: 120, billing_cycle: "yearly" }))).toBe(10);
  });
  it("scales weekly billing by 52/12", () => {
    expect(toMonthly(sub({ amount: 12, billing_cycle: "weekly" }))).toBeCloseTo(
      52,
      0,
    );
  });
});

describe("totalMonthly", () => {
  it("sums only active subscriptions in their own currency", () => {
    const subs = [
      sub({ amount: 10 }),
      sub({ amount: 20, is_active: false }),
      sub({ amount: 5 }),
    ];
    expect(totalMonthly(subs)).toBe(15);
  });
});

describe("toMonthlyIn", () => {
  it("converts the monthly equivalent into the display currency", () => {
    // 12 EUR/yr -> 1 EUR/mo -> ~1.08 USD/mo.
    expect(
      toMonthlyIn(
        sub({ amount: 12, currency: "EUR", billing_cycle: "yearly" }),
        "USD",
      ),
    ).toBeCloseTo(1.08, 2);
  });
});

describe("toYearlyIn", () => {
  it("is twelve times the monthly cost in the display currency", () => {
    const s = sub({ amount: 9.99, currency: "USD", billing_cycle: "monthly" });
    expect(toYearlyIn(s, "USD")).toBeCloseTo(9.99 * 12, 2);
  });
  it("normalises a yearly-billed sub back to its yearly amount", () => {
    // 120 USD/yr -> 10/mo -> 120/yr again.
    expect(
      toYearlyIn(sub({ amount: 120, billing_cycle: "yearly" }), "USD"),
    ).toBeCloseTo(120, 2);
  });
});

describe("totalMonthlyIn", () => {
  it("converts each sub before summing", () => {
    const subs = [
      sub({ amount: 10, currency: "USD" }),
      sub({ amount: 10, currency: "EUR" }),
    ];
    // 10 USD + 10.80 USD (from EUR).
    expect(totalMonthlyIn(subs, "USD")).toBeCloseTo(20.8, 1);
  });
  it("excludes cancelled subs from totals", () => {
    const subs = [sub({ amount: 10, is_active: false }), sub({ amount: 5 })];
    expect(totalMonthlyIn(subs, "USD")).toBe(5);
  });
});

describe("isActive", () => {
  it("returns true for is_active=true", () => {
    expect(isActive(sub({ is_active: true }))).toBe(true);
  });
  it("returns false for is_active=false", () => {
    expect(isActive(sub({ is_active: false }))).toBe(false);
  });
  it("treats missing is_active as active (pre-migration rows)", () => {
    const row = sub();
    delete (row as Partial<Subscription>).is_active;
    expect(isActive(row)).toBe(true);
  });
});

describe("upcomingRenewals", () => {
  it("includes only subs renewing in the window, active only, with a date", () => {
    const today = new Date();
    const plus = (days: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return d;
    };
    const subs = [
      sub({ name: "Soon", next_billing_date: ymd(plus(1)) }),
      sub({ name: "Past", next_billing_date: ymd(plus(-1)) }),
      sub({ name: "Far", next_billing_date: ymd(plus(60)) }),
      sub({
        name: "Cancelled",
        next_billing_date: ymd(plus(1)),
        is_active: false,
      }),
      sub({ name: "NoDate", next_billing_date: null }),
    ];
    expect(upcomingRenewals(subs, 30).map((s) => s.name)).toEqual(["Soon"]);
  });

  it("sorts results by date ascending", () => {
    const today = new Date();
    const plus = (days: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return d;
    };
    const subs = [
      sub({ name: "C", next_billing_date: ymd(plus(7)) }),
      sub({ name: "A", next_billing_date: ymd(plus(1)) }),
      sub({ name: "B", next_billing_date: ymd(plus(3)) }),
    ];
    expect(upcomingRenewals(subs, 30).map((s) => s.name)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});
