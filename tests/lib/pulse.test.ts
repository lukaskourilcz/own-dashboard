import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { format, subDays } from "date-fns";
import {
  MOOD_META,
  averageMood,
  buildTrend,
  findToday,
  pulseStreak,
  todayKey,
} from "@/lib/pulse";
import type { DailyPulse, PulseMood } from "@/lib/types";

const FROZEN = new Date(2026, 4, 12);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN);
});
afterEach(() => {
  vi.useRealTimers();
});

function pulse(d: Date, user_id = "me", mood: PulseMood = 4): DailyPulse {
  return {
    id: `${user_id}-${format(d, "yyyy-MM-dd")}`,
    user_id,
    log_date: format(d, "yyyy-MM-dd"),
    mood,
    note: null,
    created_at: "",
  };
}

describe("todayKey", () => {
  it("returns the frozen day", () => {
    expect(todayKey()).toBe("2026-05-12");
  });
});

describe("findToday", () => {
  it("locates the user's today entry", () => {
    const p = pulse(FROZEN, "me");
    expect(findToday([p], "me")).toBe(p);
  });
  it("returns null when only the partner logged today", () => {
    expect(findToday([pulse(FROZEN, "partner")], "me")).toBeNull();
  });
  it("returns null when nothing was logged today", () => {
    expect(findToday([pulse(subDays(FROZEN, 1), "me")], "me")).toBeNull();
  });
});

describe("pulseStreak", () => {
  it("counts consecutive days from today backwards", () => {
    const logs = [
      pulse(FROZEN),
      pulse(subDays(FROZEN, 1)),
      pulse(subDays(FROZEN, 2)),
    ];
    expect(pulseStreak(logs, "me")).toBe(3);
  });
  it("breaks at the first gap", () => {
    const logs = [pulse(FROZEN), pulse(subDays(FROZEN, 2))];
    expect(pulseStreak(logs, "me")).toBe(1);
  });
  it("returns 0 when today is missing", () => {
    expect(pulseStreak([pulse(subDays(FROZEN, 1))], "me")).toBe(0);
  });
});

describe("buildTrend", () => {
  it("returns N days of points with null for missing days", () => {
    const logs = [
      pulse(FROZEN, "me", 5),
      pulse(subDays(FROZEN, 2), "me", 3),
    ];
    const trend = buildTrend(logs, "me", null, 5);
    expect(trend.length).toBe(5);
    expect(trend[trend.length - 1].me).toBe(5);
    expect(trend[trend.length - 3].me).toBe(3);
    expect(trend[trend.length - 2].me).toBeNull();
    expect(trend[0].partner).toBeNull();
  });

  it("populates the partner column when a partner id is given", () => {
    const logs = [pulse(FROZEN, "me", 4), pulse(FROZEN, "you", 2)];
    const trend = buildTrend(logs, "me", "you", 3);
    const today = trend[trend.length - 1];
    expect(today.me).toBe(4);
    expect(today.partner).toBe(2);
  });
});

describe("averageMood", () => {
  it("returns null when there is no data in the window", () => {
    expect(averageMood([], "me", 7)).toBeNull();
  });

  it("averages all logs inside the window", () => {
    const logs = [
      pulse(FROZEN, "me", 5),
      pulse(subDays(FROZEN, 1), "me", 3),
      pulse(subDays(FROZEN, 30), "me", 1), // outside 14-day window
    ];
    expect(averageMood(logs, "me", 14)).toBe(4);
  });
});

describe("MOOD_META", () => {
  it("exposes emoji + label + color for every level", () => {
    for (const m of [1, 2, 3, 4, 5] as const) {
      expect(MOOD_META[m].emoji.length).toBeGreaterThan(0);
      expect(MOOD_META[m].label.length).toBeGreaterThan(0);
      expect(MOOD_META[m].color).toMatch(/^#/);
    }
  });
});
