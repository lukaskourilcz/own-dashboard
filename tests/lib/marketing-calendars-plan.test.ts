import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readPlanCalendarEntries } from "@/lib/marketing-calendars-plan";

const owner = "00000000-0000-4000-8000-000000000001";
const draftId = "11111111-1111-4111-8111-000000000001";
const topicId = "22222222-2222-4222-8222-000000000001";

/** A synthetic database: each table answers its rows, or an error for the tables in `failing`. */
function database(tables: Record<string, unknown[]>, failing: string[] = []) {
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const db = {
    from(table: string) {
      const read = { table, filters: [] as Array<[string, unknown]> };
      reads.push(read);
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => { read.filters.push([key, value]); return chain; },
        gte: (key: string, value: unknown) => { read.filters.push([`${key}>=`, value]); return chain; },
        lte: (key: string, value: unknown) => { read.filters.push([`${key}<=`, value]); return chain; },
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => void) =>
          resolve(failing.includes(table) ? { data: null, error: { message: "down" } } : { data: tables[table] ?? [], error: null }),
      };
      return chain;
    },
  };
  return { db: db as never, reads };
}

describe("readPlanCalendarEntries", () => {
  it("turns each plan slot into one entry per channel, titled by its concept or topic, for the owner only", async () => {
    const { db, reads } = database({
      marketing_devshark_plan: [{ id: "s1", date: "2026-11-14", local_time: "12:00:00", instagram: true, threads: true, status: "approved", draft_id: draftId }],
      marketing_devshark_drafts: [{ id: draftId, title: "CSS Grid in one slide" }],
      marketing_dneskai_plan: [{ id: "d1", date: "2026-11-13", local_time: "08:10:00", instagram: true, threads: false, status: "planned", kind: "education", topic_id: topicId },
        { id: "d2", date: "2026-11-15", local_time: null, instagram: false, threads: true, status: "planned", kind: null, topic_id: null }],
      marketing_dneskai_topics: [{ id: topicId, title_cs: "Co je to token" }],
    });
    const plan = await readPlanCalendarEntries(db, owner, "2026-11-13");
    expect(plan.devshark).toEqual([
      { id: "s1:instagram", date: "2026-11-14", time: "12:00", platform: "instagram", kind: "carousel", title: "CSS Grid in one slide", status: "approved", tipRefs: [] },
      { id: "s1:threads", date: "2026-11-14", time: "12:00", platform: "threads", kind: "carousel", title: "CSS Grid in one slide", status: "approved", tipRefs: [] },
    ]);
    expect(plan.dneskai!.map((entry) => [entry.id, entry.time, entry.kind, entry.title])).toEqual([
      ["d1:instagram", "08:10", "education", "Co je to token"],
      ["d2:threads", null, "carousel", "DNESKAi"],
    ]);
    expect(reads.every((read) => read.filters.some(([key, value]) => key === "user_id" && value === owner))).toBe(true);
    expect(reads.find((read) => read.table === "marketing_dneskai_plan")!.filters).toContainEqual(["date<=", "2026-12-12"]);
  });

  it("leaves out a project whose plan cannot be read and keeps the other", async () => {
    const { db } = database({ marketing_dneskai_plan: [] }, ["marketing_devshark_plan"]);
    const plan = await readPlanCalendarEntries(db, owner, "2026-11-13");
    expect(plan).toEqual({ dneskai: [] });
  });
});
