import { describe, it, expect } from "vitest";
import { applicationStats } from "@/lib/jobs/stats";
import type { JobApplication, JobApplicationStatus } from "@/lib/types";

const NOW = new Date("2026-05-12T12:00:00Z");

function app(
  applied_on: string,
  status: JobApplicationStatus = "applied",
): JobApplication {
  return {
    id: `${applied_on}-${status}-${Math.random()}`,
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
  };
}

describe("applicationStats", () => {
  it("counts empty input as zeroes", () => {
    const s = applicationStats([], NOW);
    expect(s.total).toBe(0);
    expect(s.last7).toBe(0);
    expect(s.last30).toBe(0);
    expect(s.active).toBe(0);
    expect(s.byStatus.applied).toBe(0);
  });

  it("windows last7/last30 by applied_on", () => {
    const s = applicationStats(
      [
        app("2026-05-12"), // today
        app("2026-05-06"), // 6 days ago → in 7d window
        app("2026-05-04"), // 8 days ago → only 30d
        app("2026-04-13"), // 29 days ago → only 30d
        app("2026-04-01"), // 41 days ago → neither
      ],
      NOW,
    );
    expect(s.total).toBe(5);
    expect(s.last7).toBe(2);
    expect(s.last30).toBe(4);
  });

  it("tallies statuses and derives active", () => {
    const s = applicationStats(
      [
        app("2026-05-10", "applied"),
        app("2026-05-09", "interviewing"),
        app("2026-05-08", "offer"),
        app("2026-05-07", "rejected"),
        app("2026-05-06", "withdrawn"),
        app("2026-05-05", "interviewing"),
      ],
      NOW,
    );
    expect(s.byStatus).toEqual({
      applied: 1,
      interviewing: 2,
      offer: 1,
      rejected: 1,
      withdrawn: 1,
    });
    expect(s.active).toBe(3);
  });

  it("ignores malformed dates without crashing", () => {
    const bad = app("not-a-date");
    const s = applicationStats([bad, app("2026-05-12")], NOW);
    expect(s.total).toBe(2);
    expect(s.last7).toBe(1);
  });
});
