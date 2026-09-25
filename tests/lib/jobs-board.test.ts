import { describe, it, expect } from "vitest";
import {
  BOARD_COLUMNS,
  columnForApplication,
  dueFollowUps,
  groupApplicationsByColumn,
  isBoardColumn,
  isFollowUpDue,
  statusForColumn,
} from "@/lib/jobs/board";
import { applicationStats } from "@/lib/jobs/stats";
import type {
  JobApplication,
  JobApplicationStatus,
  SavedJobPosition,
} from "@/lib/types";

const NOW = new Date("2026-05-12T12:00:00Z");

let seq = 0;

function app(
  applied_on: string,
  status: JobApplicationStatus = "applied",
  overrides: Partial<JobApplication> = {},
): JobApplication {
  seq += 1;
  return {
    id: `${applied_on}-${status}-${seq}`,
    user_id: "u1",
    listing_id: null,
    title: "Dev",
    company: null,
    url: null,
    source: null,
    location: null,
    cover_letter: "",
    status,
    applied_on,
    notes: null,
    created_at: `${applied_on}T10:00:00Z`,
    updated_at: `${applied_on}T10:00:00Z`,
    ...overrides,
  };
}

function saved(id: string, saved_at: string): SavedJobPosition {
  return {
    id,
    user_id: "u1",
    listing_id: null,
    title: `Saved ${id}`,
    company: "Example Studio",
    url: "https://example.com/careers",
    source: "manual",
    location: null,
    description: null,
    cover_letter: "",
    notes: null,
    saved_at,
    updated_at: saved_at,
  };
}

describe("board columns", () => {
  it("collapses rejected and withdrawn into one closed column", () => {
    expect(columnForApplication(app("2026-05-01", "applied"))).toBe("applied");
    expect(columnForApplication(app("2026-05-01", "interviewing"))).toBe("interviewing");
    expect(columnForApplication(app("2026-05-01", "offer"))).toBe("offer");
    expect(columnForApplication(app("2026-05-01", "rejected"))).toBe("closed");
    expect(columnForApplication(app("2026-05-01", "withdrawn"))).toBe("closed");
  });

  it("resolves a drop target to the status it writes", () => {
    expect(statusForColumn("applied")).toBe("applied");
    expect(statusForColumn("interviewing")).toBe("interviewing");
    expect(statusForColumn("offer")).toBe("offer");
    // Closed is written as a rejection; withdrawing stays an explicit choice.
    expect(statusForColumn("closed")).toBe("rejected");
    // Saved has no application row, so a drop cannot write a status.
    expect(statusForColumn("saved")).toBeNull();
  });

  it("recognises only the five board columns", () => {
    for (const column of BOARD_COLUMNS) expect(isBoardColumn(column)).toBe(true);
    expect(isBoardColumn("rejected")).toBe(false);
    expect(isBoardColumn("")).toBe(false);
  });
});

describe("groupApplicationsByColumn", () => {
  it("keeps saved positions in the saved column only", () => {
    const groups = groupApplicationsByColumn(
      [app("2026-05-10", "applied"), app("2026-05-09", "rejected")],
      [saved("s1", "2026-05-02T08:00:00Z"), saved("s2", "2026-05-06T08:00:00Z")],
    );
    expect(groups.saved.map((row) => row.id)).toEqual(["s2", "s1"]);
    expect(groups.applied).toHaveLength(1);
    expect(groups.closed).toHaveLength(1);
    expect(groups.interviewing).toEqual([]);
    expect(groups.offer).toEqual([]);
  });

  it("orders each application column newest first", () => {
    const groups = groupApplicationsByColumn([
      app("2026-05-01", "applied", { title: "Older" }),
      app("2026-05-11", "applied", { title: "Newest" }),
      app("2026-05-05", "applied", { title: "Middle" }),
    ]);
    expect(groups.applied.map((row) => row.title)).toEqual([
      "Newest",
      "Middle",
      "Older",
    ]);
  });

  it("works with no saved positions at all", () => {
    const groups = groupApplicationsByColumn([app("2026-05-10", "offer")]);
    expect(groups.saved).toEqual([]);
    expect(groups.offer).toHaveLength(1);
  });

  it("does not mutate the arrays it is handed", () => {
    const positions = [saved("s1", "2026-05-02T08:00:00Z"), saved("s2", "2026-05-06T08:00:00Z")];
    groupApplicationsByColumn([], positions);
    expect(positions.map((row) => row.id)).toEqual(["s1", "s2"]);
  });
});

describe("dueFollowUps", () => {
  it("returns only active stages whose follow-up date has arrived, oldest first", () => {
    const rows = dueFollowUps(
      [
        app("2026-05-01", "interviewing", { next_follow_up_at: "2026-05-11T09:00:00Z", title: "Second" }),
        app("2026-05-01", "applied", { next_follow_up_at: "2026-05-02T09:00:00Z", title: "First" }),
        // Future date — not due yet.
        app("2026-05-01", "applied", { next_follow_up_at: "2026-05-20T09:00:00Z", title: "Later" }),
        // No follow-up recorded.
        app("2026-05-01", "applied", { title: "None" }),
      ],
      NOW,
    );
    expect(rows.map((row) => row.title)).toEqual(["First", "Second"]);
  });

  it("ignores closed stages even with an overdue date", () => {
    const overdue = { next_follow_up_at: "2026-05-01T09:00:00Z" };
    expect(
      dueFollowUps(
        [
          app("2026-04-01", "offer", overdue),
          app("2026-04-01", "rejected", overdue),
          app("2026-04-01", "withdrawn", overdue),
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  it("skips a malformed timestamp instead of guessing", () => {
    const rows = dueFollowUps(
      [
        app("2026-05-01", "applied", { next_follow_up_at: "not-a-timestamp" }),
        app("2026-05-01", "applied", { next_follow_up_at: "2026-05-02T09:00:00Z", title: "Good" }),
      ],
      NOW,
    );
    expect(rows.map((row) => row.title)).toEqual(["Good"]);
  });

  it("agrees with the Applied strip's follow-up metric", () => {
    const apps = [
      app("2026-05-01", "applied", { next_follow_up_at: "2026-05-02T09:00:00Z" }),
      app("2026-05-01", "interviewing", { next_follow_up_at: "2026-05-10T09:00:00Z" }),
      app("2026-05-01", "rejected", { next_follow_up_at: "2026-05-02T09:00:00Z" }),
      app("2026-05-01", "applied", { next_follow_up_at: "2026-06-02T09:00:00Z" }),
    ];
    expect(dueFollowUps(apps, NOW)).toHaveLength(2);
    expect(applicationStats(apps, NOW).overdueFollowUps).toBe(2);
  });

  it("answers the per-card question with the same rule", () => {
    expect(isFollowUpDue(app("2026-05-01", "applied", { next_follow_up_at: "2026-05-02T09:00:00Z" }), NOW)).toBe(true);
    expect(isFollowUpDue(app("2026-05-01", "applied", { next_follow_up_at: "2026-05-22T09:00:00Z" }), NOW)).toBe(false);
    expect(isFollowUpDue(app("2026-05-01", "offer", { next_follow_up_at: "2026-05-02T09:00:00Z" }), NOW)).toBe(false);
    expect(isFollowUpDue(app("2026-05-01", "applied"), NOW)).toBe(false);
  });
});
