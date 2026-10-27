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
  it.each(["*/15 * * * 1", "0 */4 * JAN *", "0 * 1 * *", "90 6 * * *", "0 25 * * *", "0 7 0 * *", "0 7 * * 8", "0 7 * * 0-8"])("uses the owner's coarse interval for restricted or invalid %s", schedule => {
    expect(expectedIntervalMs(cron({ schedule, runs_per_month: 15 }))).toBe(2 * DAY);
  });
  it("counts each selected weekday once, with both Sunday aliases", () => {
    expect(expectedIntervalMs(cron({ schedule: "0 7 * * 0,7" }))).toBe(7 * DAY);
    expect(expectedIntervalMs(cron({ schedule: "0 7 * * 1-5,5" }))).toBe(7 * DAY / 5);
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
  const now=Date.parse('2026-10-27T12:00:00Z');
  const payload=()=>({monitor:{id:3,name:'Synthetic monitor'},heartbeat:{monitorID:3,status:0,time:'2026-10-27 11:59:00.123',msg:'Discarded diagnostic'},msg:'Discarded vendor options'});
  it('captures stable identity and raw UTC time without vendor diagnostics',()=>{
    expect(parseUptimeKumaEvent(payload(),now)).toEqual({monitorId:3,monitor:'Synthetic monitor',observedAt:'2026-10-27T11:59:00.123Z',down:true});
  });
  it('reads explicit recovery and falls back to an id label',()=>{
    const body=payload();body.monitor.name=' ';body.heartbeat.status=1;
    expect(parseUptimeKumaEvent(body,now)).toEqual({monitorId:3,monitor:'Monitor 3',observedAt:'2026-10-27T11:59:00.123Z',down:false});
  });
  it.each([null,[],{},'text',{monitor:{id:3},heartbeat:null},{monitor:{name:'Synthetic'},heartbeat:{status:0,time:'2026-10-27 11:59:00'}}])('ignores test/incomplete payloads %j',body=>{expect(parseUptimeKumaEvent(body,now)).toBeNull();});
  it.each([2,3,4,-1,null,true,'0','1',{}])('does not invent a transition from status %j',status=>{const body=payload();expect(parseUptimeKumaEvent({...body,heartbeat:{...body.heartbeat,status}},now)).toBeNull();});
  it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'3',null])('refuses unverifiable identity %j',id=>{const body=payload();expect(parseUptimeKumaEvent({...body,monitor:{...body.monitor,id}},now)).toBeNull();});
  it('refuses mismatched monitor identities',()=>{const body=payload();body.heartbeat.monitorID=4;expect(parseUptimeKumaEvent(body,now)).toBeNull();});
  it.each(['0000-01-01 11:00:00','2026-10-27 11:59:00\n','2026-02-30 11:00:00','2026-10-27 24:00:00','2026-10-27 12:05:00.001','2026-10-27T11:00:00','2026-10-27 11:00:00+02:00','infinity','2026-10-27 11:59:00.123456',''])('refuses ambiguous/invalid/future time %j',time=>{const body=payload();body.heartbeat.time=time;expect(parseUptimeKumaEvent(body,now)).toBeNull();});
  it.each(['2026-10-27 11:59:00','2026-10-27 11:59:00.1','2026-10-27T11:59:00.123Z'])('accepts bounded explicit UTC forms %s',time=>{const body=payload();body.heartbeat.time=time;expect(parseUptimeKumaEvent(body,now)?.observedAt).toMatch(/^2026-10-27T11:59:00\.\d{3}Z$/);});
  it('does not split a Unicode scalar or accept an unpaired surrogate in a name',()=>{const body=payload();body.monitor.name='x'.repeat(199)+'😀';expect(parseUptimeKumaEvent(body,now)?.monitor).toBe('x'.repeat(199));body.monitor.name='Synthetic\uDC00monitor';expect(parseUptimeKumaEvent(body,now)).toBeNull();});
  it('bounds display names and refuses control characters/invalid clocks',()=>{const body=payload();body.monitor.name='x'.repeat(201);expect(parseUptimeKumaEvent(body,now)?.monitor).toHaveLength(200);body.monitor.name='Synthetic\nmonitor';expect(parseUptimeKumaEvent(body,now)).toBeNull();expect(parseUptimeKumaEvent(payload(),NaN)).toBeNull();});
});
