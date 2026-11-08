import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MARKETING_CALENDAR_SOURCES,
  aggregateTipUsage,
  marketingWeek,
  parseMarketingCalendar,
  tipDeepLinkQuery,
  tipForDeepLink,
  tipTitleKey,
  unmatchedTipRefs,
  usageForTip,
  type MarketingCalendar,
  type MarketingSourceResult,
} from "@/lib/marketing-calendars";
import { readMarketingCalendars } from "@/lib/marketing-calendars-server";

/** A November-shaped devShark calendar: the first 12 October seed entries moved by 35 days. */
const DEVSHARK = readFileSync(path.join(__dirname, "../fixtures/marketing-calendar-devshark.json"), "utf8");
const PACE = "Pace decks at 6 to 10 slides and design slide 2 as a second cover";
const ASSUMPTIONS =
  "Rebuild platform assumptions for 2026: Instagram sends and originality, Threads replies and time viewed, LinkedIn dwell as a hypothesis";

function calendar(overrides: Partial<MarketingCalendar> = {}): MarketingCalendar {
  return { name: "x", launch: null, periodStart: null, periodEnd: null, entries: [], prelaunch: [], skipped: 0, ...overrides };
}

function source(id: string, label: string, value: MarketingCalendar | null, status: MarketingSourceResult["status"] = "ok"): MarketingSourceResult {
  return {
    id,
    label,
    file: `content/marketing-calendars/${id}.json`,
    calendarUrl: `https://example.com/admin/calendar?venture=${id}`,
    status,
    detail: null,
    calendar: value,
  };
}

const entry = (id: string, date: string, tipRefs: string[] = [], time: string | null = "09:00") => ({
  id,
  date,
  time,
  platform: "instagram",
  kind: "carousel",
  title: `Entry ${id}`,
  status: "planned",
  tipRefs,
});

describe("marketing calendar sources", () => {
  it("reads the devShark and DNESKAi calendars from committed files and nothing else", () => {
    expect(MARKETING_CALENDAR_SOURCES.map((item) => [item.label, item.file])).toEqual([
      ["devShark", "content/marketing-calendars/marketingshark.json"],
      ["DNESKAi", "content/marketing-calendars/caught-up.json"],
    ]);
    for (const item of MARKETING_CALENDAR_SOURCES) {
      expect(item.calendarUrl).toBe(`https://boardless-ai.vercel.app/admin/calendar?venture=${item.id}`);
    }
  });
});

describe("parseMarketingCalendar", () => {
  it("keeps what OwnDashboard shows from a real calendar document", () => {
    const parsed = parseMarketingCalendar(DEVSHARK, "devshark");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.calendar).toMatchObject({ name: "devShark", launch: "2026-11-05", periodStart: "2026-11-05", periodEnd: "2026-12-04", skipped: 0 });
    expect(parsed.calendar.entries).toHaveLength(12);
    expect(parsed.calendar.entries[0]).toEqual({
      id: "ds-001",
      date: "2026-11-05",
      time: "08:00",
      platform: "instagram",
      kind: "task",
      title: "Day 0: record baselines (IG + Threads + PostHog)",
      status: "planned",
      tipRefs: [
        "Make the professional profile answer offer, proof and next step",
        "Fold the weekly review into weekly planning: time by channel, carry-forward, then objectives",
      ],
    });
    // Nothing beyond the listed fields reaches the browser.
    expect(Object.keys(parsed.calendar.entries[0]!)).not.toContain("body");
    expect(parsed.calendar.prelaunch.map((item) => [item.id, item.issue, item.repo])).toEqual([
      ["ds-pre-03", null, null],
      ["ds-pre-01", null, null],
      ["ds-pre-02", "#239", "lukaskourilcz/react-express-app"],
    ]);
  });

  it("refuses a document that is not JSON, not marketing-calendar/1 or for another project", () => {
    expect(parseMarketingCalendar("{not json", "devshark")).toEqual({ ok: false, status: "invalid-json", detail: null });
    expect(parseMarketingCalendar(JSON.stringify({ project: "devshark", entries: [] }), "devshark")).toMatchObject({ status: "wrong-schema" });
    expect(parseMarketingCalendar(JSON.stringify({ schemaVersion: "marketing-calendar/1", project: "devshark" }), "devshark")).toMatchObject({ status: "wrong-schema" });
    expect(parseMarketingCalendar(DEVSHARK, "dneskai")).toEqual({ ok: false, status: "wrong-project", detail: "devshark" });
  });

  it("skips and counts entries without an id, a valid date or a title, and sorts the rest", () => {
    const parsed = parseMarketingCalendar(
      JSON.stringify({
        schemaVersion: "marketing-calendar/1",
        project: "dneskai",
        entries: [
          { id: "b", date: "2026-11-06", time: "7:00", title: "Late", tipRefs: ["  A tip  ", 4, ""] },
          { id: "a", date: "2026-11-06", time: "06:30", title: "Early", status: "Queued" },
          { id: "c", date: "2026-13-40", title: "Bad date" },
          { date: "2026-11-06", title: "No id" },
          "not an entry",
        ],
        prelaunch: [{ id: "p", due: "2026-10-01", title: "Bio", issue: 12 }, { id: "q", title: "No due" }],
      }),
      "dneskai",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.calendar.skipped).toBe(4);
    expect(parsed.calendar.entries.map((item) => [item.id, item.time, item.status])).toEqual([
      ["b", null, "planned"],
      ["a", "06:30", "queued"],
    ]);
    expect(parsed.calendar.entries[0]!.tipRefs).toEqual(["A tip"]);
    expect(parsed.calendar.prelaunch[0]).toMatchObject({ issue: "#12", repo: null, owner: null, status: "planned" });
  });
});

describe("aggregateTipUsage", () => {
  const parsed = parseMarketingCalendar(DEVSHARK, "devshark");
  const devshark = parsed.ok ? parsed.calendar : calendar();

  it("counts the entries that apply each tip, per calendar, with a link to the filtered calendar", () => {
    const dneskai = calendar({ entries: [entry("dn-1", "2026-11-05", [PACE]), entry("dn-2", "2026-11-06", [PACE.toUpperCase(), `  ${PACE}  `])] });
    const index = aggregateTipUsage([source("marketingshark", "devShark", devshark), source("caught-up", "DNESKAi", dneskai)]);
    expect(index.readSources).toEqual(["marketingshark", "caught-up"]);
    expect(usageForTip(index, ASSUMPTIONS)).toEqual([
      { sourceId: "marketingshark", label: "devShark", count: 9, url: expect.stringContaining("venture=marketingshark&q=Rebuild+platform") },
    ]);
    // One entry naming a tip twice counts once; case and spacing do not split a tip.
    expect(usageForTip(index, PACE).map((usage) => [usage.label, usage.count])).toEqual([
      ["devShark", 1],
      ["DNESKAi", 2],
    ]);
    expect(new URL(usageForTip(index, PACE)[1]!.url).searchParams.get("q")).toBe(PACE);
    expect(usageForTip(index, "A tip nobody applies")).toEqual([]);
  });

  it("leaves calendars that could not be read out of the counts", () => {
    const index = aggregateTipUsage([source("marketingshark", "devShark", devshark), source("caught-up", "DNESKAi", null, "error")]);
    expect(index.readSources).toEqual(["marketingshark"]);
    expect(usageForTip(index, PACE)).toHaveLength(1);
    expect(aggregateTipUsage([source("caught-up", "DNESKAi", null, "error")]).readSources).toEqual([]);
  });

  it("counts cited titles that match no saved tip", () => {
    const index = aggregateTipUsage([source("marketingshark", "devShark", devshark)]);
    const cited = [...index.byTitle.keys()];
    expect(unmatchedTipRefs(index, [PACE, ASSUMPTIONS])).toBe(cited.length - 2);
    expect(tipTitleKey("Don’t  do  this")).toBe(tipTitleKey("don't do this"));
  });
});

describe("marketingWeek", () => {
  const parsed = parseMarketingCalendar(DEVSHARK, "devshark");
  const devshark = parsed.ok ? parsed.calendar : calendar();

  it("before the launch counts down to it and lists pre-launch items due this week or overdue", () => {
    const week = marketingWeek([source("marketingshark", "devShark", devshark)], "2026-09-28");
    expect(week.from).toBe("2026-09-28");
    expect(week.to).toBe("2026-10-04");
    expect(week.entries).toEqual([]);
    expect(week.upcomingLaunch).toEqual({ date: "2026-11-05", labels: ["devShark"] });
    // ds-pre-03 was due yesterday but is done; ds-pre-02 is due after the window.
    expect(week.prelaunch.map((item) => [item.id, item.overdue])).toEqual([["ds-pre-01", false]]);
    expect(week.prelaunch[0]!.url).toBe("https://example.com/admin/calendar?venture=marketingshark");

    const later = marketingWeek([source("marketingshark", "devShark", devshark)], "2026-10-19");
    expect(later.prelaunch.map((item) => [item.id, item.overdue])).toEqual([
      ["ds-pre-01", true],
      ["ds-pre-02", false],
    ]);
    expect(later.prelaunch[1]!.url).toBe("https://github.com/lukaskourilcz/react-express-app/issues/239");
  });

  it("after the launch lists seven days of entries across calendars by date, time and calendar order", () => {
    const dneskai = calendar({
      launch: "2026-11-05",
      entries: [entry("dn-1", "2026-11-05", [], "08:00"), entry("dn-2", "2026-11-12"), entry("dn-0", "2026-11-04")],
    });
    const week = marketingWeek(
      [source("marketingshark", "devShark", devshark), source("caught-up", "DNESKAi", dneskai), source("broken", "Broken", null, "error")],
      "2026-11-05",
    );
    expect(week.upcomingLaunch).toBeNull();
    expect(week.to).toBe("2026-11-11");
    expect(week.entries.map((item) => `${item.date} ${item.time} ${item.label} ${item.id}`).slice(0, 3)).toEqual([
      "2026-11-05 08:00 devShark ds-001",
      "2026-11-05 08:00 DNESKAi dn-1",
      "2026-11-05 08:30 devShark ds-002",
    ]);
    expect(week.entries).toHaveLength(13);
    expect(week.entries.some((item) => item.id === "dn-2" || item.id === "dn-0")).toBe(false);
    const link = new URL(week.entries.find((item) => item.id === "ds-010")!.url);
    expect(link.searchParams.get("venture")).toBe("marketingshark");
    expect(link.searchParams.get("week")).toBe("2026-11-02");
    expect(link.searchParams.get("entry")).toBe("ds-010");
  });

  it("falls back to the plan's first day when a calendar names no launch", () => {
    const week = marketingWeek([source("caught-up", "DNESKAi", calendar({ periodStart: "2026-11-05" }))], "2026-11-01");
    expect(week.upcomingLaunch).toEqual({ date: "2026-11-05", labels: ["DNESKAi"] });
  });
});

describe("IG TIPS deep link", () => {
  const tips = [
    { id: "pace", title: PACE },
    { id: "other", title: "Pace yourself" },
  ];

  it("reads the q parameter as the search and finds the tip with that exact title", () => {
    const query = tipDeepLinkQuery(new URLSearchParams(`q=${encodeURIComponent(PACE)}`).get("q"));
    expect(query).toBe(PACE);
    expect(tipForDeepLink(query, tips)?.id).toBe("pace");
    expect(tipForDeepLink(`  ${PACE.toLowerCase()} `, tips)?.id).toBe("pace");
  });

  it("keeps a search that names no tip exactly, and ignores an empty one", () => {
    expect(tipDeepLinkQuery(["Pace", "ignored"])).toBe("Pace");
    expect(tipForDeepLink("Pace", tips)).toBeNull();
    expect(tipDeepLinkQuery("   ")).toBeNull();
    expect(tipDeepLinkQuery(undefined)).toBeNull();
    expect(tipDeepLinkQuery("x".repeat(900))).toHaveLength(500);
  });
});

describe("readMarketingCalendars", () => {
  const src = (id: string, file: string, project = "devshark") => ({
    id,
    project,
    label: id,
    file,
    calendarUrl: `https://example.com/admin/calendar?venture=${id}`,
  });

  it("reads each committed calendar and says why one could not be read", async () => {
    const result = await readMarketingCalendars(
      [
        src("ok", "content/marketing-calendars/marketingshark.json"),
        src("dneskai-cal", "content/marketing-calendars/caught-up.json", "dneskai"),
        src("missing", "content/marketing-calendars/does-not-exist.json"),
        // caught-up.json is DNESKAi, but this source asks for devShark.
        src("other", "content/marketing-calendars/caught-up.json"),
        // Not inside the committed calendar directory.
        src("bad", "../etc.json"),
      ],
      "2026-09-28T10:00:00.000Z",
    );
    expect(result.checkedAt).toBe("2026-09-28T10:00:00.000Z");
    expect(result.sources.map((item) => [item.id, item.status])).toEqual([
      ["ok", "ok"],
      ["dneskai-cal", "ok"],
      ["missing", "error"],
      ["other", "wrong-project"],
      ["bad", "error"],
    ]);
    expect(result.sources[0]!.calendar?.entries.length ?? 0).toBeGreaterThan(0);
    expect(result.sources.find((item) => item.id === "missing")!.calendar).toBeNull();
  });
});
