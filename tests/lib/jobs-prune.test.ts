import { describe, expect, it } from "vitest";
import { isGone, selectDeadUrls } from "@/lib/jobs/prune";
import { JOB_SOURCE_META } from "@/lib/jobs/meta";

describe("isGone", () => {
  it("treats 404 and 410 as proof the posting was taken down", () => {
    expect(isGone(404)).toBe(true);
    expect(isGone(410)).toBe(true);
  });

  it("keeps the listing for anything ambiguous", () => {
    // A live page, a server fault, a bot block, and an unreachable host all
    // mean "we do not know", and deleting on those would lose live offers.
    for (const status of [200, 301, 403, 429, 500, 503, null]) {
      expect(isGone(status)).toBe(false);
    }
  });
});

describe("selectDeadUrls", () => {
  const urls = ["https://a.test/1", "https://b.test/2", "https://c.test/3"];

  it("returns only the URLs proven gone", async () => {
    const dead = await selectDeadUrls(urls, {
      probe: async (url) => (url.endsWith("/2") ? 404 : 200),
    });
    expect([...dead]).toEqual(["https://b.test/2"]);
  });

  it("keeps everything when every probe fails", async () => {
    const dead = await selectDeadUrls(urls, { probe: async () => null });
    expect(dead.size).toBe(0);
  });

  it("honours maxChecks so one run cannot probe an unbounded list", async () => {
    const probed: string[] = [];
    await selectDeadUrls(urls, {
      maxChecks: 2,
      batchSize: 1,
      probe: async (url) => {
        probed.push(url);
        return 404;
      },
    });
    expect(probed).toEqual(["https://a.test/1", "https://b.test/2"]);
  });

  it("stops probing once the time budget is spent and keeps the rest", async () => {
    const probed: string[] = [];
    let clock = 0;
    const dead = await selectDeadUrls(urls, {
      batchSize: 1,
      budgetMs: 10,
      now: () => (clock += 6), // first batch starts at 6, second checks at 12
      probe: async (url) => {
        probed.push(url);
        return 404;
      },
    });
    expect(probed).toEqual(["https://a.test/1"]);
    expect(dead.size).toBe(1);
  });

  it("probes in batches without dropping results", async () => {
    const many = Array.from({ length: 25 }, (_, i) => `https://x.test/${i}`);
    const dead = await selectDeadUrls(many, {
      batchSize: 10,
      probe: async (url) => (Number(url.split("/").pop()) % 5 === 0 ? 410 : 200),
    });
    expect(dead.size).toBe(5);
  });
});

describe("source completeness", () => {
  it("marks paginated and query-limited boards as incomplete", () => {
    // These read one page or a capped slice, so a live offer can fall out of
    // the response. Deleting them on absence alone would churn real listings.
    for (const id of ["startupjobs", "jobscz", "pracecz", "jobicy"]) {
      expect(JOB_SOURCE_META[id].complete).toBe(false);
    }
  });

  it("marks whole-board feeds as complete", () => {
    for (const id of ["remoteok", "remotive", "arbeitnow", "weworkremotely"]) {
      expect(JOB_SOURCE_META[id].complete).toBe(true);
    }
  });

  it("describes every source it labels", () => {
    for (const [id, meta] of Object.entries(JOB_SOURCE_META)) {
      expect(meta.label, id).toBeTruthy();
      expect(meta.endpoint, id).toMatch(/^https:\/\//);
      expect(meta.site, id).toMatch(/^https:\/\//);
      expect(meta.scope.en, id).toBeTruthy();
      expect(meta.scope.cs, id).toBeTruthy();
    }
  });
});
