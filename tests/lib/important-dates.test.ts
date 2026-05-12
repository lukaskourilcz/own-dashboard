import { describe, expect, it } from "vitest";
import {
  buildOccurrences,
  countdownLabel,
  nextOccurrence,
  nextUpcoming,
} from "@/lib/important-dates";
import type { ImportantDate } from "@/lib/types";

function date(overrides: Partial<ImportantDate> = {}): ImportantDate {
  return {
    id: "x",
    user_id: "u",
    couple_id: null,
    title: "Birthday",
    the_date: "2000-01-15",
    is_recurring: true,
    recurrence_unit: "yearly",
    emoji: null,
    notes: null,
    created_at: "",
    ...overrides,
  };
}

describe("countdownLabel", () => {
  it("handles today and tomorrow", () => {
    expect(countdownLabel(0)).toBe("today");
    expect(countdownLabel(1)).toBe("tomorrow");
  });
  it("describes past days", () => {
    expect(countdownLabel(-3)).toBe("3d ago");
  });
  it("uses days, weeks, and months at the right scales", () => {
    expect(countdownLabel(5)).toBe("in 5d");
    expect(countdownLabel(20)).toBe("in 3w");
    expect(countdownLabel(90)).toBe("in 3mo");
  });
});

describe("nextOccurrence", () => {
  it("yearly: returns this year's date when it's still ahead", () => {
    const d = date({ the_date: "2000-12-25" });
    const ref = new Date(2026, 5, 1);
    const next = nextOccurrence(d, ref);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(11);
    expect(next.getDate()).toBe(25);
  });

  it("yearly: rolls to next year once this year's has passed", () => {
    const d = date({ the_date: "2000-01-15" });
    const ref = new Date(2026, 5, 1);
    const next = nextOccurrence(d, ref);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(15);
  });

  it("yearly: returns today when today is the recurrence", () => {
    const d = date({ the_date: "2000-05-12" });
    const ref = new Date(2026, 4, 12);
    const next = nextOccurrence(d, ref);
    expect(next.getMonth()).toBe(4);
    expect(next.getDate()).toBe(12);
    expect(next.getFullYear()).toBe(2026);
  });

  it("monthly: clamps day-31 to month-end in February", () => {
    const d = date({
      the_date: "2025-01-31",
      recurrence_unit: "monthly",
    });
    // Feb 15, 2026 — February has 28 days. The 31st should clamp to 28.
    const ref = new Date(2026, 1, 15);
    const next = nextOccurrence(d, ref);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(28);
  });

  it("monthly: clamps to leap-February 29", () => {
    const d = date({
      the_date: "2024-01-31",
      recurrence_unit: "monthly",
    });
    // Feb 1, 2028 is a leap year. The 31st should clamp to 29.
    const ref = new Date(2028, 1, 1);
    const next = nextOccurrence(d, ref);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
  });

  it("monthly: rolls forward past the current month if already passed", () => {
    const d = date({
      the_date: "2025-01-05",
      recurrence_unit: "monthly",
    });
    // Already past May 5 — should land on June 5.
    const ref = new Date(2026, 4, 20);
    const next = nextOccurrence(d, ref);
    expect(next.getMonth()).toBe(5);
    expect(next.getDate()).toBe(5);
  });

  it("non-recurring: returns the original date even if it has passed", () => {
    const d = date({ the_date: "2020-06-01", is_recurring: false });
    const ref = new Date(2026, 5, 1);
    const next = nextOccurrence(d, ref);
    expect(next.getFullYear()).toBe(2020);
    expect(next.getMonth()).toBe(5);
    expect(next.getDate()).toBe(1);
  });
});

describe("buildOccurrences", () => {
  it("sorts by daysUntil ascending", () => {
    const ref = new Date(2026, 4, 12);
    const a = date({ id: "a", the_date: "2000-05-20" });
    const b = date({ id: "b", the_date: "2000-05-15" });
    const c = date({ id: "c", the_date: "2000-06-01" });
    expect(buildOccurrences([a, b, c], ref).map((o) => o.date.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("computes yearsCompleted for yearly anniversaries", () => {
    const ref = new Date(2026, 4, 12);
    const wedding = date({ the_date: "2020-08-01" });
    const [o] = buildOccurrences([wedding], ref);
    // Next occurrence is 2026-08-01. The couple turns (2026 - 2020) = 6 — and
    // buildOccurrences exposes yearsCompleted as one less than that (5),
    // because the upcoming date marks the start of year 6.
    expect(o.yearsCompleted).toBe(5);
  });

  it("does not compute yearsCompleted for monthly recurrence", () => {
    const ref = new Date(2026, 4, 12);
    const rent = date({
      the_date: "2020-01-01",
      recurrence_unit: "monthly",
    });
    const [o] = buildOccurrences([rent], ref);
    expect(o.yearsCompleted).toBeNull();
  });
});

describe("nextUpcoming", () => {
  it("returns null when no future occurrence exists", () => {
    const ref = new Date(2026, 4, 12);
    const past = date({ the_date: "2020-01-01", is_recurring: false });
    expect(nextUpcoming([past], ref)).toBeNull();
  });

  it("returns the soonest upcoming occurrence", () => {
    const ref = new Date(2026, 4, 12);
    const a = date({ id: "a", the_date: "2000-06-01" });
    const b = date({ id: "b", the_date: "2000-05-15" });
    expect(nextUpcoming([a, b], ref)?.date.id).toBe("b");
  });
});
