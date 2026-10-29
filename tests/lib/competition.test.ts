import { describe, expect, it } from "vitest";
import {
  COMPETITOR_REVIEW_STALE_DAYS,
  competitorPage,
  competitionProjectOrder,
  competitorReviewState,
  isCompetitorReviewStale,
  sortCompetitors,
  staleCompetitorCount,
} from "@/lib/competition";
import { projects } from "@/lib/demo/fixtures";
import type { Competitor, Project } from "@/lib/types";

const now = new Date("2026-09-16T09:00:00");

function competitor(overrides: Partial<Competitor>): Competitor {
  return {
    id: overrides.id ?? "c",
    user_id: "u",
    project_id: "p",
    name: overrides.name ?? "Competitor",
    url: null,
    summary: "",
    category: "direct",
    useful_features: [],
    social_content: "",
    pricing_model: "",
    lessons: "",
    relevance_score: null,
    score_rationale: "",
    social_links: [],
    source_urls: [],
    reviewed_at: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** `now` minus `days`, as the plain `yyyy-MM-dd` Postgres stores. */
function daysAgo(days: number): string {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("competitor review freshness", () => {
  it("turns stale exactly on the ninetieth day and not before", () => {
    expect(COMPETITOR_REVIEW_STALE_DAYS).toBe(90);
    expect(competitorReviewState(daysAgo(0), now)).toBe("fresh");
    expect(competitorReviewState(daysAgo(89), now)).toBe("fresh");
    expect(competitorReviewState(daysAgo(90), now)).toBe("stale");
    expect(competitorReviewState(daysAgo(91), now)).toBe("stale");
    expect(competitorReviewState(daysAgo(400), now)).toBe("stale");
  });

  it("separates a missing or unreadable review date from an old one", () => {
    expect(competitorReviewState(null, now)).toBe("never");
    expect(competitorReviewState("", now)).toBe("never");
    expect(competitorReviewState("not-a-date", now)).toBe("never");
    expect(competitorReviewState(undefined, now)).toBe("never");
  });

  it("reads a date-only value in local time rather than as UTC midnight", () => {
    // Just past local midnight, a same-day review must still read as today's.
    const justAfterMidnight = new Date("2026-09-16T00:30:00");
    expect(competitorReviewState("2026-09-16", justAfterMidnight)).toBe("fresh");
    // A review dated in the future (a planned re-check) is never stale.
    expect(competitorReviewState("2026-12-01", now)).toBe("fresh");
  });
  it("rejects impossible Gregorian dates instead of normalizing them into a fresh review", () => {
    for (const date of ["2026-02-29", "2026-02-31", "2026-04-31", "1900-02-29", "2026-00-12", "2026-13-01", "2026-01-00", "2026-01-32", "2026-2-01", "2026-02-01T00:00:00Z"]) expect(competitorReviewState(date, now)).toBe("never");
    expect(competitorReviewState("2000-02-29", new Date("2000-03-01T00:01:00"))).toBe("fresh");
    expect(competitorReviewState("2024-02-29", now)).toBe("stale");
  });

  it("counts the rows a refresh filter would show", () => {
    const list = [
      competitor({ id: "a", reviewed_at: daysAgo(3) }),
      competitor({ id: "b", reviewed_at: daysAgo(120) }),
      competitor({ id: "c", reviewed_at: null }),
    ];
    expect(list.filter((item) => isCompetitorReviewStale(item, now)).map((item) => item.id)).toEqual(["b", "c"]);
    expect(staleCompetitorCount(list, now)).toBe(2);
    expect(staleCompetitorCount([], now)).toBe(0);
  });
});

describe("sortCompetitors", () => {
  it("orders by relevance, then manual order, then name, without mutating the input", () => {
    const list = [
      competitor({ id: "1", name: "Zed", relevance_score: 3, sort_order: 0 }),
      competitor({ id: "2", name: "Alpha", relevance_score: null, sort_order: 0 }),
      competitor({ id: "3", name: "Beta", relevance_score: 5, sort_order: 2 }),
      competitor({ id: "4", name: "Gamma", relevance_score: 5, sort_order: 1 }),
      competitor({ id: "5", name: "Aha", relevance_score: 3, sort_order: 0 }),
    ];
    expect(sortCompetitors(list).map((item) => item.id)).toEqual(["4", "3", "5", "1", "2"]);
    expect(list.map((item) => item.id)).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("complete collection paging", () => {
  it.each([0, 1, 49, 50, 51, 100, 101, 1201])("keeps every record reachable exactly once for %i records", total => {
    const rows = Array.from({ length: total }, (_, id) => ({ id }));
    const first = competitorPage(rows, 0), traversed = Array.from({ length: first.pages }, (_, page) => competitorPage(rows, page).items).flat();
    expect(traversed).toEqual(rows); expect(first.items.length).toBeLessThanOrEqual(50);
    for (const requested of [-1, 2.5, NaN, Infinity]) expect(competitorPage(rows, requested).index).toBe(0);
    const last = competitorPage(rows, 99999); expect(last.index).toBe(first.pages - 1); expect(last.to).toBe(total);
    expect(rows).toEqual(Array.from({ length: total }, (_, id) => ({ id })));
  });
  it("clamps a shortened collection without losing its previous page", () => {
    const rows = Array.from({ length: 100 }, (_, id) => id); const page = competitorPage(rows, 2);
    expect(page.index).toBe(1); expect(page.items).toEqual(rows.slice(50)); expect([page.from, page.to, page.total]).toEqual([51, 100, 100]);
  });
});
it("retains canonical parent/child order and inactive researched projects without mutating inputs", () => {
 const base=projects[1]!,root:Project={...base,id:'root',parent_id:null,portfolio_key:'own-dashboard',repo_full_name:null,is_active:true},child:Project={...base,id:'child',parent_id:'root',portfolio_key:null,repo_full_name:null,is_active:false},client:Project={...base,id:'client',parent_id:null,portfolio_key:null,repo_full_name:null,engagement:'client',is_active:true},archived:Project={...client,id:'archived',is_active:false};
 const input=[archived,client,child,root],before=structuredClone(input),research=[competitor({project_id:'archived'})];
 expect(competitionProjectOrder(input,research).map(project=>project.id)).toEqual(['root','child','client','archived']);expect(input).toEqual(before);
});
