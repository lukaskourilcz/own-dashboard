import { describe, expect, it } from "vitest";
import { mondayKey, previousMondayKey, weekRange } from "@/lib/date-keys";
import {
  carryForwardCandidates,
  channelShares,
  classifyEvent,
  containsWord,
  hoursAndMinutes,
  mergeCarriedObjectives,
  nextStep,
  organizationNeedles,
  previousStep,
  readObjectives,
  readStep,
  readTimeByChannel,
  latestFocusSets,
  summarizeFocusWeek,
  summarizeTimeByChannel,
  writeReviewItems,
} from "@/lib/weekly-planning";
import type { GcalEvent } from "@/lib/calendar";
import type { Organization, Project, Todo, WeeklyReview } from "@/lib/types";

const WEEK = "2026-09-07";
const RANGE = weekRange(WEEK);

function project(overrides: Partial<Project> & Pick<Project, "id" | "name" | "slug">): Project {
  return {
    user_id: "u1",
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

function organization(
  overrides: Partial<Organization> & Pick<Organization, "id" | "name" | "type">,
): Organization {
  return {
    user_id: "u1",
    website: null,
    logo_url: null,
    email: null,
    phone: null,
    address: null,
    city: null,
    zip: null,
    country: null,
    company_id: null,
    vat_id: null,
    notes: "",
    status: "active",
    ares_verified_at: null,
    vat_verification_status: "unchecked",
    vat_verified_at: null,
    vat_verified_id: null,
    vat_verified_name: null,
    vat_verified_address: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function todo(overrides: Partial<Todo> & Pick<Todo, "id" | "title" | "done">): Todo {
  return {
    user_id: "u1",
    due_date: null,
    category: null,
    created_at: "2026-01-01T00:00:00Z",
    source: null,
    repo_id: null,
    repo_full_name: null,
    repo_owner: null,
    repo_name: null,
    repo_url: null,
    needed_raw: null,
    generated_at: null,
    importance: null,
    ...overrides,
  };
}

function timed(id: string, summary: string, start: string, end: string): GcalEvent {
  return { id, summary, start: { dateTime: start }, end: { dateTime: end } };
}

const CLIENT = organization({ id: "org-1", name: "Acme s.r.o.", type: "client" });
const EMPLOYER = organization({ id: "org-2", name: "Globex", type: "employer" });
const OWN_PROJECT = project({ id: "p1", name: "aifirst", slug: "aifirst", engagement: "own" });
const CLIENT_PROJECT = project({
  id: "p2",
  name: "Gym Plzeň",
  slug: "gym-plzen",
  engagement: "client",
});
const RETAINED_PROJECT = project({
  id: "p3",
  name: "Portal",
  slug: "portal",
  engagement: "own",
  organization_id: "org-1",
});

const REFS = {
  projects: [OWN_PROJECT, CLIENT_PROJECT, RETAINED_PROJECT],
  organizations: [CLIENT, EMPLOYER],
};

describe("week keys", () => {
  it("resolves the Monday of a week and of the week before it", () => {
    // 2026-09-16 is a Wednesday.
    expect(mondayKey(new Date("2026-09-16T11:00:00"))).toBe("2026-09-14");
    expect(mondayKey(new Date("2026-09-14T00:30:00"))).toBe("2026-09-14");
    // Sunday still belongs to the week that started on Monday.
    expect(mondayKey(new Date("2026-09-20T23:00:00"))).toBe("2026-09-14");
    expect(previousMondayKey(new Date("2026-09-16T11:00:00"))).toBe("2026-09-07");
    expect(previousMondayKey(new Date("2026-09-14T00:05:00"))).toBe("2026-09-07");
  });

  it("returns a half-open Monday-to-Monday range", () => {
    const range = weekRange("2026-09-07");
    expect(range.start.getDay()).toBe(1);
    expect(range.endExclusive.getDay()).toBe(1);
    expect(range.endExclusive.getTime() - range.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("channel classification", () => {
  it("reads a client organization out of an event title", () => {
    const result = classifyEvent(timed("e", "Acme portal review", "", ""), REFS);
    expect(result).toEqual({ channel: "client", matched: "Acme s.r.o." });
  });

  it("matches the registered name as well as the trading name", () => {
    expect(organizationNeedles("Acme s.r.o.")).toEqual(["acme s.r.o.", "acme"]);
    expect(organizationNeedles("Globex")).toEqual(["globex"]);
    expect(
      classifyEvent(timed("e", "Call with Acme s.r.o.", "", ""), REFS).channel,
    ).toBe("client");
  });

  it("treats a client engagement project as client work and an own project as project work", () => {
    expect(classifyEvent(timed("e", "gym-plzen standup", "", ""), REFS)).toEqual({
      channel: "client",
      matched: "Gym Plzeň",
    });
    expect(classifyEvent(timed("e", "aifirst release", "", ""), REFS)).toEqual({
      channel: "project",
      matched: "aifirst",
    });
  });

  it("matches a renamed project by an earlier slug", () => {
    const renamed = project({ id: "p4", name: "DNESKAi", slug: "dneskai", previous_slugs: ["aifirst"], engagement: "own" });
    expect(classifyEvent(timed("e", "aifirst release check", "", ""), { projects: [renamed], organizations: [] })).toEqual({
      channel: "project",
      matched: "DNESKAi",
    });
  });

  it("treats a project owned by an organization as client work", () => {
    expect(classifyEvent(timed("e", "Portal handover", "", ""), REFS).channel).toBe("client");
  });

  it("does not read an employer as a client", () => {
    expect(classifyEvent(timed("e", "Globex interview", "", ""), REFS)).toEqual({
      channel: "admin",
      matched: null,
    });
  });

  it("falls back to admin when nothing is named", () => {
    expect(classifyEvent(timed("e", "Invoices and inbox", "", ""), REFS)).toEqual({
      channel: "admin",
      matched: null,
    });
    expect(classifyEvent({ id: "e", start: {}, end: {} }, REFS).channel).toBe("admin");
  });

  it("matches whole words only", () => {
    expect(containsWord("acmestore sync", "acme")).toBe(false);
    expect(containsWord("call with acme.", "acme")).toBe(true);
    expect(containsWord("a", "a")).toBe(false);
    expect(classifyEvent(timed("e", "aifirstly sorting mail", "", ""), REFS).channel).toBe(
      "admin",
    );
  });

  it("reads the location and description as well as the title", () => {
    const event: GcalEvent = {
      id: "e",
      summary: "Workshop",
      location: "Acme HQ",
      start: {},
      end: {},
    };
    expect(classifyEvent(event, REFS).channel).toBe("client");
  });
});

describe("time by channel", () => {
  it("sums minutes per channel across a week", () => {
    const summary = summarizeTimeByChannel(
      [
        timed("a", "Acme portal review", "2026-09-07T10:00:00", "2026-09-07T11:30:00"),
        timed("b", "aifirst release", "2026-09-08T09:00:00", "2026-09-08T10:00:00"),
        timed("c", "Invoices", "2026-09-09T08:30:00", "2026-09-09T09:15:00"),
      ],
      REFS,
      RANGE,
    );
    expect(summary.minutes).toEqual({ client: 90, project: 60, admin: 45 });
    expect(summary.totalMinutes).toBe(195);
    expect(summary.matchedEvents).toBe(2);
    expect(summary.unmatchedEvents).toBe(1);
    expect(summary.skippedAllDay).toBe(0);
  });

  it("clamps an event to the window on both edges", () => {
    const summary = summarizeTimeByChannel(
      [
        // Starts in the previous week, ends inside this one.
        timed("a", "Acme kickoff", "2026-09-06T23:00:00", "2026-09-07T01:00:00"),
        // Starts inside, runs past the following Monday midnight.
        timed("b", "Acme launch", "2026-09-13T23:00:00", "2026-09-14T02:00:00"),
      ],
      REFS,
      RANGE,
    );
    expect(summary.minutes.client).toBe(120);
  });

  it("counts all-day entries separately instead of guessing a duration", () => {
    const summary = summarizeTimeByChannel(
      [
        { id: "a", summary: "Conference", start: { date: "2026-09-08" }, end: { date: "2026-09-09" } },
        timed("b", "Acme review", "2026-09-08T09:00:00", "2026-09-08T10:00:00"),
      ],
      REFS,
      RANGE,
    );
    expect(summary.skippedAllDay).toBe(1);
    expect(summary.totalMinutes).toBe(60);
  });

  it("drops zero-length, reversed and out-of-window events", () => {
    const summary = summarizeTimeByChannel(
      [
        timed("a", "Acme ping", "2026-09-08T09:00:00", "2026-09-08T09:00:00"),
        timed("b", "Acme reversed", "2026-09-08T11:00:00", "2026-09-08T10:00:00"),
        timed("c", "Acme next week", "2026-09-15T09:00:00", "2026-09-15T10:00:00"),
        { id: "d", summary: "No times", start: {}, end: {} },
      ],
      REFS,
      RANGE,
    );
    expect(summary.totalMinutes).toBe(0);
    expect(summary.matchedEvents).toBe(0);
    expect(summary.unmatchedEvents).toBe(0);
  });

  it("reports shares as whole percents and an empty week as zero", () => {
    const summary = summarizeTimeByChannel(
      [
        timed("a", "Acme review", "2026-09-08T09:00:00", "2026-09-08T12:00:00"),
        timed("b", "Invoices", "2026-09-08T13:00:00", "2026-09-08T14:00:00"),
      ],
      REFS,
      RANGE,
    );
    expect(channelShares(summary)).toEqual({ client: 75, project: 0, admin: 25 });
    expect(
      channelShares(summarizeTimeByChannel([], REFS, RANGE)),
    ).toEqual({ client: 0, project: 0, admin: 0 });
  });

  it("splits minutes into hours for display", () => {
    expect(hoursAndMinutes(195)).toEqual({ hours: 3, minutes: 15 });
    expect(hoursAndMinutes(0)).toEqual({ hours: 0, minutes: 0 });
    expect(hoursAndMinutes(-5)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("stored review items", () => {
  it("reads objectives written as objects and as the legacy string list", () => {
    expect(
      readObjectives({
        objectives: [
          { id: "o1", text: "Ship the portal", done: true, carriedFrom: "focus-1" },
          { id: "", text: "  Write the proposal  ", done: false },
          { text: "" },
          42,
        ],
      }),
    ).toEqual([
      { id: "o1", text: "Ship the portal", done: true, carriedFrom: "focus-1" },
      { id: "objective-1", text: "Write the proposal", done: false },
    ]);

    expect(readObjectives({ objectives: ["Send the follow-up", "  "] })).toEqual([
      { id: "legacy-0", text: "Send the follow-up", done: false },
    ]);
    expect(readObjectives({})).toEqual([]);
    expect(readObjectives(null)).toEqual([]);
  });

  it("resumes at the stored step and falls back to the first one", () => {
    expect(readStep({ step: "carry" })).toBe("carry");
    expect(readStep({ step: "nonsense" })).toBe("time");
    expect(readStep(undefined)).toBe("time");
    expect(nextStep("time")).toBe("done");
    expect(nextStep("summary")).toBe("summary");
    expect(previousStep("done")).toBe("time");
    expect(previousStep("time")).toBe("time");
  });

  it("keeps the six legacy lists and unknown keys when writing a patch", () => {
    const stored = {
      facts: ["Portal discovery finished"],
      risks: ["Decision slipping"],
      decisions: ["Keep the scope"],
      priorities: ["Send the follow-up"],
      followUps: ["Confirm the contact"],
      sources: ["Discovery notes"],
      somethingOlder: { kept: true },
    };
    const next = writeReviewItems(stored, {
      objectives: [{ id: "o1", text: "Ship the portal", done: false }],
      step: "objectives",
      focusRecap: { completed: 4, total: 14, days: 2 },
      timeByChannel: {
        minutes: { client: 90, project: 60, admin: 45 },
        unmatchedEvents: 1,
        source: "google",
      },
    });

    expect(next.facts).toEqual(["Portal discovery finished"]);
    expect(next.sources).toEqual(["Discovery notes"]);
    expect(next.somethingOlder).toEqual({ kept: true });
    expect(next.step).toBe("objectives");
    expect(readObjectives(next)).toHaveLength(1);
    expect(readTimeByChannel(next)).toEqual({
      minutes: { client: 90, project: 60, admin: 45 },
      unmatchedEvents: 1,
      source: "google",
    });
    // No calendar event title is ever persisted.
    expect(JSON.stringify(next)).not.toContain("Acme");
  });

  it("replaces a legacy list when the patch names it", () => {
    const next = writeReviewItems({ facts: ["old"] }, { facts: ["new", "  "] });
    expect(next.facts).toEqual(["new"]);
  });

  it("reads a missing or malformed time snapshot honestly", () => {
    expect(readTimeByChannel({})).toBeNull();
    expect(readTimeByChannel({ timeByChannel: { minutes: { client: "x" } } })).toEqual({
      minutes: { client: 0, project: 0, admin: 0 },
      unmatchedEvents: 0,
      source: "unavailable",
    });
  });
});

describe("carry forward", () => {
  const previousReview: WeeklyReview = {
    id: "r1",
    user_id: "u1",
    week_start: WEEK,
    status: "completed",
    items: {
      objectives: [
        { id: "o1", text: "Ship the portal", done: true },
        { id: "o2", text: "Write the VAT review", done: false },
      ],
    },
    summary: "",
    completed_at: null,
    created_at: "2026-09-07T00:00:00Z",
    updated_at: "2026-09-07T00:00:00Z",
  };

  const todos = [
    todo({ id: "t1", title: "Write the VAT review", done: false }),
    todo({ id: "t2", title: "Renew the domain", done: false }),
    todo({ id: "t3", title: "Archive the old repo", done: true }),
  ];

  it("offers unfinished objectives and unfinished focus tasks exactly once", () => {
    const candidates = carryForwardCandidates({
      previousReview,
      focusItems: [
        // Same text as the open objective — offered once, from the objective.
        { id: "f1", todo_id: "t1", title_snapshot: "Write the VAT review", completed_at: null },
        { id: "f2", todo_id: "t2", title_snapshot: "Renew the domain", completed_at: null },
        // Finished last week.
        { id: "f3", todo_id: "t2", title_snapshot: "Renew the domain", completed_at: "2026-09-09T10:00:00Z" },
        // Its task is done, so the snapshot is stale.
        { id: "f4", todo_id: "t3", title_snapshot: "Archive the old repo", completed_at: null },
        // Its task was deleted.
        { id: "f5", todo_id: null, title_snapshot: "Orphan", completed_at: null },
      ],
      todos,
    });

    expect(candidates).toEqual([
      { id: "o2", text: "Write the VAT review", origin: "objective" },
      { id: "f2", text: "Renew the domain", origin: "focus" },
    ]);
  });

  it("has nothing to offer without a previous review or focus history", () => {
    expect(carryForwardCandidates({ previousReview: null, focusItems: [], todos })).toEqual([]);
  });

  it("merges carried items into objectives without duplicating them", () => {
    const candidates = carryForwardCandidates({
      previousReview,
      focusItems: [{ id: "f2", todo_id: "t2", title_snapshot: "Renew the domain", completed_at: null }],
      todos,
    });
    const first = mergeCarriedObjectives([], candidates);
    expect(first.map((objective) => objective.text)).toEqual([
      "Write the VAT review",
      "Renew the domain",
    ]);
    expect(first.every((objective) => objective.carriedFrom)).toBe(true);
    // Stepping back and forward again must not add them a second time.
    expect(mergeCarriedObjectives(first, candidates)).toBe(first);
    // Nor when the same text was typed by hand.
    expect(
      mergeCarriedObjectives(
        [{ id: "manual", text: "renew the domain", done: false }],
        candidates,
      ).map((objective) => objective.text),
    ).toEqual(["renew the domain", "Write the VAT review"]);
  });
});

describe("focus recap", () => {
  it("counts finished tasks and the days that had a focus set", () => {
    expect(
      summarizeFocusWeek([
        {
          focus_date: "2026-09-07",
          items: [{ completed_at: "2026-09-07T10:00:00Z" }, { completed_at: null }],
        },
        { focus_date: "2026-09-08", items: [{ completed_at: "2026-09-08T10:00:00Z" }] },
      ]),
    ).toEqual({ completed: 2, total: 3, days: 2 });
    expect(summarizeFocusWeek([])).toEqual({ completed: 0, total: 0, days: 0 });
  });

  it("counts a regenerated day once, from the generation actually worked from", () => {
    const sets = latestFocusSets([
      { focus_date: "2026-09-08", generation: 1, items: [{ completed_at: null }] },
      {
        focus_date: "2026-09-08",
        generation: 2,
        items: [{ completed_at: "2026-09-08T18:00:00Z" }, { completed_at: null }],
      },
      { focus_date: "2026-09-07", generation: 1, items: [{ completed_at: null }] },
    ]);

    expect(sets.map((set) => `${set.focus_date}/${set.generation}`)).toEqual([
      "2026-09-07/1",
      "2026-09-08/2",
    ]);
    expect(summarizeFocusWeek(sets)).toEqual({ completed: 1, total: 3, days: 2 });
  });
});
