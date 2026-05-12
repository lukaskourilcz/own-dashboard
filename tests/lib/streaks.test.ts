import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { format, subDays } from "date-fns";
import {
  bestStreak,
  computeStreak,
  logsByStreak,
  longestActiveStreak,
  streaksUncheckedToday,
  todayStr,
  uncheckedTodayWithCounts,
} from "@/lib/streaks";
import type { Streak, StreakLog } from "@/lib/types";

// Freeze time so test results don't drift with the system clock.
const FROZEN = new Date(2026, 4, 12); // 2026-05-12 (month is 0-indexed: May).

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN);
});
afterEach(() => {
  vi.useRealTimers();
});

function log(date: Date, streak_id = "s1", user_id = "u"): StreakLog {
  return {
    id: `${streak_id}-${format(date, "yyyy-MM-dd")}`,
    streak_id,
    user_id,
    log_date: format(date, "yyyy-MM-dd"),
    created_at: "",
  };
}

function streak(overrides: Partial<Streak> = {}): Streak {
  return {
    id: "s1",
    user_id: "u",
    name: "Read",
    color: "#000",
    reminder_time: null,
    created_at: "",
    ...overrides,
  };
}

describe("todayStr", () => {
  it("returns today's date in yyyy-MM-dd", () => {
    expect(todayStr()).toBe("2026-05-12");
  });
});

describe("computeStreak", () => {
  it("returns 0 when there are no logs", () => {
    expect(computeStreak([])).toBe(0);
  });
  it("returns 0 when today's log is missing", () => {
    expect(computeStreak([log(subDays(FROZEN, 1))])).toBe(0);
  });
  it("counts consecutive days walking back from today", () => {
    const logs = [
      log(FROZEN),
      log(subDays(FROZEN, 1)),
      log(subDays(FROZEN, 2)),
    ];
    expect(computeStreak(logs)).toBe(3);
  });
  it("stops at the first gap", () => {
    const logs = [
      log(FROZEN),
      log(subDays(FROZEN, 1)),
      // gap at day 2
      log(subDays(FROZEN, 3)),
    ];
    expect(computeStreak(logs)).toBe(2);
  });
});

describe("bestStreak", () => {
  it("returns 0 for an empty list", () => {
    expect(bestStreak([])).toBe(0);
  });
  it("returns 1 for a single log", () => {
    expect(bestStreak([log(FROZEN)])).toBe(1);
  });
  it("finds the longest run across gaps", () => {
    const logs = [
      log(subDays(FROZEN, 10)),
      log(subDays(FROZEN, 9)),
      log(subDays(FROZEN, 8)),
      log(subDays(FROZEN, 7)),
      log(subDays(FROZEN, 6)),
      // gap
      log(subDays(FROZEN, 3)),
      log(subDays(FROZEN, 2)),
    ];
    expect(bestStreak(logs)).toBe(5);
  });
  it("deduplicates same-day logs", () => {
    const today = log(FROZEN);
    const dup = { ...today, id: "dup" };
    const yesterday = log(subDays(FROZEN, 1));
    expect(bestStreak([today, dup, yesterday])).toBe(2);
  });
});

describe("logsByStreak", () => {
  it("groups logs by streak id", () => {
    const logs: StreakLog[] = [
      log(FROZEN, "a"),
      log(FROZEN, "b"),
      log(subDays(FROZEN, 1), "a"),
    ];
    const m = logsByStreak(logs);
    expect(m.get("a")?.length).toBe(2);
    expect(m.get("b")?.length).toBe(1);
  });
});

describe("longestActiveStreak", () => {
  it("returns null when no streak has a current run", () => {
    expect(longestActiveStreak([], [])).toBeNull();
  });
  it("picks the streak with the largest current count", () => {
    const a = streak({ id: "a", name: "A" });
    const b = streak({ id: "b", name: "B" });
    const logs = [
      log(FROZEN, "a"),
      log(subDays(FROZEN, 1), "a"),
      log(FROZEN, "b"),
    ];
    const best = longestActiveStreak([a, b], logs);
    expect(best?.streak.id).toBe("a");
    expect(best?.count).toBe(2);
  });
  it("ignores zero-count streaks", () => {
    const a = streak({ id: "a" });
    const b = streak({ id: "b" });
    const logs = [log(subDays(FROZEN, 2), "a"), log(subDays(FROZEN, 2), "b")];
    expect(longestActiveStreak([a, b], logs)).toBeNull();
  });
});

describe("streaksUncheckedToday", () => {
  it("returns streaks without today's log", () => {
    const a = streak({ id: "a" });
    const b = streak({ id: "b" });
    const logs = [log(FROZEN, "a")];
    expect(streaksUncheckedToday([a, b], logs).map((s) => s.id)).toEqual([
      "b",
    ]);
  });
});

describe("uncheckedTodayWithCounts", () => {
  it("computes the at-risk count walking back from yesterday", () => {
    const a = streak({ id: "a" });
    // 5-day run ending yesterday, no log today.
    const logs = Array.from({ length: 5 }, (_, i) =>
      log(subDays(FROZEN, i + 1), "a"),
    );
    expect(uncheckedTodayWithCounts([a], logs)[0].count).toBe(5);
  });
  it("returns 0 when no run leads up to today", () => {
    const a = streak({ id: "a" });
    const logs = [log(subDays(FROZEN, 5), "a")];
    expect(uncheckedTodayWithCounts([a], logs)[0].count).toBe(0);
  });
  it("excludes streaks already checked today", () => {
    const a = streak({ id: "a" });
    const logs = [log(FROZEN, "a"), log(subDays(FROZEN, 1), "a")];
    expect(uncheckedTodayWithCounts([a], logs).length).toBe(0);
  });
});
