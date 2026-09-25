import { describe, expect, it } from "vitest";
import {
  cronHeartbeatState,
  expectedIntervalMs,
  parseUptimeKumaEvent,
  staleCronCount,
} from "@/lib/cron-heartbeat";
import type { Cron } from "@/lib/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function cron(overrides: Partial<Cron> = {}): Cron {
  return {
    id: "cron-1",
    user_id: "u1",
    project_id: "p1",
    name: "Daily article",
    schedule: "0 6 * * *",
    description: "",
    endpoint: "/api/cron/generate-daily",
    is_ai_call: false,
    cost_per_run: 0,
    currency: "USD",
    runs_per_month: 30,
    enabled: true,
    last_run_at: null,
    heartbeat_url: "https://uptime.example.com/api/push/abc",
    last_success_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("expectedIntervalMs", () => {
  it("reads the shapes the cron form produces", () => {
    expect(expectedIntervalMs(cron({ schedule: "0 6 * * *" }))).toBe(DAY);
    expect(expectedIntervalMs(cron({ schedule: "*/15 * * * *" }))).toBe(15 * MINUTE);
    expect(expectedIntervalMs(cron({ schedule: "* * * * *" }))).toBe(MINUTE);
    expect(expectedIntervalMs(cron({ schedule: "30 * * * *" }))).toBe(HOUR);
    expect(expectedIntervalMs(cron({ schedule: "0 */4 * * *" }))).toBe(4 * HOUR);
    expect(expectedIntervalMs(cron({ schedule: "0 7 * * 0" }))).toBe(7 * DAY);
    expect(expectedIntervalMs(cron({ schedule: "0 7 * * 1-5" }))).toBe((7 * DAY) / 5);
    expect(expectedIntervalMs(cron({ schedule: "0 7 1 * *" }))).toBe(30 * DAY);
  });

  it("falls back to runs_per_month for an expression it cannot read", () => {
    expect(
      expectedIntervalMs(cron({ schedule: "nonsense", runs_per_month: 15 })),
    ).toBe((30 * DAY) / 15);
    expect(
      expectedIntervalMs(cron({ schedule: "0 6 * JAN *", runs_per_month: 1 })),
    ).toBe(30 * DAY);
  });

  it("never divides by zero when runs_per_month is unset", () => {
    expect(expectedIntervalMs(cron({ schedule: "?", runs_per_month: 0 }))).toBe(
      30 * DAY,
    );
  });
});

describe("cronHeartbeatState", () => {
  const now = new Date("2026-07-21T12:00:00Z");

  it("calls a daily cron that reported this morning on time", () => {
    const result = cronHeartbeatState(
      cron({ last_success_at: "2026-07-21T06:00:00Z" }),
      now,
    );
    expect(result.state).toBe("ok");
    expect(result.overdueByMs).toBe(0);
    expect(result.lastSuccessAt?.toISOString()).toBe("2026-07-21T06:00:00.000Z");
  });

  it("calls two missed days late and four days stale", () => {
    expect(
      cronHeartbeatState(cron({ last_success_at: "2026-07-19T06:00:00Z" }), now)
        .state,
    ).toBe("late");
    expect(
      cronHeartbeatState(cron({ last_success_at: "2026-07-17T06:00:00Z" }), now)
        .state,
    ).toBe("stale");
  });

  it("reports the overdue gap past one expected interval", () => {
    const result = cronHeartbeatState(
      cron({ last_success_at: "2026-07-19T12:00:00Z" }),
      now,
    );
    expect(result.overdueByMs).toBe(DAY);
  });

  it("separates a monitored cron that never ran from an unmonitored one", () => {
    expect(cronHeartbeatState(cron({ last_success_at: null }), now).state).toBe(
      "never",
    );
    expect(
      cronHeartbeatState(
        cron({ last_success_at: null, heartbeat_url: "" }),
        now,
      ).state,
    ).toBe("unmonitored");
    expect(
      cronHeartbeatState(
        cron({ last_success_at: "2026-01-01T06:00:00Z", heartbeat_url: "  " }),
        now,
      ).state,
    ).toBe("stale");
  });

  it("never calls a disabled cron late", () => {
    const result = cronHeartbeatState(
      cron({ enabled: false, last_success_at: "2026-01-01T06:00:00Z" }),
      now,
    );
    expect(result.state).toBe("unmonitored");
    expect(result.overdueByMs).toBe(0);
  });

  it("treats an unparseable timestamp as no success at all", () => {
    expect(
      cronHeartbeatState(cron({ last_success_at: "not a date" }), now),
    ).toMatchObject({ state: "never", lastSuccessAt: null });
  });

  it("counts only the stale ones for project health", () => {
    expect(
      staleCronCount(
        [
          cron({ last_success_at: "2026-07-21T06:00:00Z" }),
          cron({ last_success_at: "2026-07-17T06:00:00Z" }),
          cron({ enabled: false, last_success_at: "2026-01-01T06:00:00Z" }),
        ],
        now,
      ),
    ).toBe(1);
  });
});

describe("parseUptimeKumaEvent", () => {
  it("reads a down notification", () => {
    expect(
      parseUptimeKumaEvent({
        heartbeat: { status: 0, time: "2026-07-21 12:00:00", msg: "timeout" },
        monitor: { id: 3, name: "Bank sync" },
        msg: "[Bank sync] [🔴 Down] timeout",
      }),
    ).toEqual({ monitor: "Bank sync", down: true, message: "timeout" });
  });

  it("reads a recovery and falls back to the top-level message", () => {
    expect(
      parseUptimeKumaEvent({
        heartbeat: { status: 1 },
        monitor: { name: "Bank sync" },
        msg: "[Bank sync] [✅ Up] OK",
      }),
    ).toEqual({
      monitor: "Bank sync",
      down: false,
      message: "[Bank sync] [✅ Up] OK",
    });
  });

  it("names a monitor by id when it sent no name", () => {
    expect(parseUptimeKumaEvent({ monitor: { id: 7 }, heartbeat: { status: 1 } }))
      .toMatchObject({ monitor: "Monitor 7", down: false });
  });

  it("ignores a body with no identifiable monitor", () => {
    expect(parseUptimeKumaEvent({})).toBeNull();
    expect(parseUptimeKumaEvent(null)).toBeNull();
    expect(parseUptimeKumaEvent({ monitor: { name: "   " } })).toBeNull();
  });

  it("treats an unreadable status as down, so an alert is never lost", () => {
    expect(
      parseUptimeKumaEvent({ monitor: { name: "Jobs" }, heartbeat: {} }),
    ).toMatchObject({ down: true });
    expect(
      parseUptimeKumaEvent({ monitor: { name: "Jobs" } }),
    ).toMatchObject({ down: true });
  });
});
