import { describe, expect, it } from "vitest";
import {
  currentPeriod,
  daysLeftInPeriod,
  isDoneThisPeriod,
  recurringPlanStatuses,
} from "@/lib/plan-recurrence";
import type { Plan } from "@/lib/types";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "x",
    user_id: "u",
    title: "Plan",
    target_date: null,
    status: "active",
    recurrence: "weekly",
    last_completed_at: null,
    notes: null,
    linked_calendar_event_id: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("currentPeriod", () => {
  it("returns null for non-recurring plans", () => {
    expect(currentPeriod("none", new Date(2026, 5, 24))).toBeNull();
  });

  it("weekly: Monday-aligned window", () => {
    // 2026-06-24 is a Wednesday.
    const p = currentPeriod("weekly", new Date(2026, 5, 24))!;
    expect(p.start).toEqual(new Date(2026, 5, 22)); // Monday
    expect(p.end).toEqual(new Date(2026, 5, 29)); // next Monday (exclusive)
  });

  it("monthly: calendar-month window", () => {
    const p = currentPeriod("monthly", new Date(2026, 5, 15))!;
    expect(p.start).toEqual(new Date(2026, 5, 1));
    expect(p.end).toEqual(new Date(2026, 6, 1));
  });

  it("biweekly: tiles into fixed 14-day fortnights", () => {
    const a = currentPeriod("biweekly", new Date(2024, 0, 3))!; // first fortnight
    expect(a.start).toEqual(new Date(2024, 0, 1));
    expect(a.end).toEqual(new Date(2024, 0, 15));

    const b = currentPeriod("biweekly", new Date(2024, 0, 16))!; // second fortnight
    expect(b.start).toEqual(new Date(2024, 0, 15));
    expect(b.end).toEqual(new Date(2024, 0, 29));
  });
});

describe("isDoneThisPeriod", () => {
  it("is false when never completed", () => {
    expect(isDoneThisPeriod(plan(), new Date(2026, 5, 24))).toBe(false);
  });

  it("is true when completed inside the current period", () => {
    const now = new Date(2026, 5, 24); // Wed
    const done = plan({ last_completed_at: new Date(2026, 5, 23).toISOString() });
    expect(isDoneThisPeriod(done, now)).toBe(true);
  });

  it("resets once the period rolls over", () => {
    const now = new Date(2026, 5, 24); // this week
    const lastWeek = plan({
      last_completed_at: new Date(2026, 5, 17).toISOString(),
    });
    expect(isDoneThisPeriod(lastWeek, now)).toBe(false);
  });
});

describe("daysLeftInPeriod", () => {
  it("counts whole days remaining, last day inclusive", () => {
    const period = currentPeriod("weekly", new Date(2026, 5, 22))!; // Monday
    // Period ends the following Monday; from Monday there are 6 more days (Sun = last).
    expect(daysLeftInPeriod(period, new Date(2026, 5, 22))).toBe(6);
    expect(daysLeftInPeriod(period, new Date(2026, 5, 28))).toBe(0); // Sunday
  });
});

describe("recurringPlanStatuses", () => {
  const now = new Date(2026, 5, 24);

  it("excludes one-off, dropped and done plans", () => {
    const plans = [
      plan({ id: "a", recurrence: "none" }),
      plan({ id: "b", status: "dropped" }),
      plan({ id: "c", status: "done" }),
      plan({ id: "d", recurrence: "weekly" }),
    ];
    expect(recurringPlanStatuses(plans, now).map((s) => s.plan.id)).toEqual([
      "d",
    ]);
  });

  it("orders pending before done", () => {
    const plans = [
      plan({
        id: "done",
        recurrence: "weekly",
        last_completed_at: new Date(2026, 5, 23).toISOString(),
      }),
      plan({ id: "todo", recurrence: "weekly" }),
    ];
    expect(recurringPlanStatuses(plans, now).map((s) => s.plan.id)).toEqual([
      "todo",
      "done",
    ]);
  });
});
