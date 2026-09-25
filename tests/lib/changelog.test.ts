import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHANGELOG,
  SHIPPED_ENTRY_LIMIT,
  entriesSince,
  previousCompletedReviewDate,
  renderChangelogMarkdown,
} from "@/lib/changelog";
import type { ChangelogEntry, ReviewWindow } from "@/lib/changelog";

const repositoryRoot = process.cwd();

function entry(date: string, title = `Entry ${date}`): ChangelogEntry {
  return {
    date,
    title,
    features: [{ title: `${title} feature`, summary: "A summary.", media: null }],
    fixes: [],
  };
}

function review(week_start: string, status: ReviewWindow["status"]): ReviewWindow {
  return { week_start, status };
}

describe("changelog entries", () => {
  it("are newest first, uniquely dated, and use ISO dates", () => {
    const dates = CHANGELOG.map((item) => item.date);

    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("describe every feature and never ship an empty entry", () => {
    for (const item of CHANGELOG) {
      expect(item.title.trim()).not.toBe("");
      expect(item.features.length).toBeGreaterThan(0);
      for (const feature of item.features) {
        expect(feature.title.trim()).not.toBe("");
        expect(feature.summary.trim()).not.toBe("");
      }
      for (const fix of item.fixes) expect(fix.trim()).not.toBe("");
    }
  });

  it("only reference screenshots that exist, with alt text", () => {
    for (const item of CHANGELOG) {
      for (const feature of item.features) {
        if (!feature.media) continue;
        expect(feature.media.alt.trim()).not.toBe("");
        expect(feature.media.path.startsWith("media/changelog/")).toBe(true);
        expect(existsSync(resolve(repositoryRoot, feature.media.path))).toBe(true);
      }
    }
  });
});

describe("renderChangelogMarkdown", () => {
  it("matches the committed CHANGELOG.md byte for byte", () => {
    const committed = readFileSync(resolve(repositoryRoot, "CHANGELOG.md"), "utf8");

    expect(renderChangelogMarkdown(CHANGELOG)).toBe(committed);
  });

  it("writes a Shipped list, an image only when one was captured, and no empty Fixes heading", () => {
    const markdown = renderChangelogMarkdown([
      {
        date: "2026-01-08",
        title: "With a capture",
        features: [
          {
            title: "Captured",
            summary: "Has a screenshot.",
            media: { path: "media/changelog/2026-01-08-captured.png", alt: "The captured panel" },
          },
          { title: "Deferred", summary: "Has none yet.", media: null },
        ],
        fixes: ["Something small."],
      },
      { ...entry("2026-01-01", "Without fixes"), fixes: [] },
    ]);

    expect(markdown).toContain("## 2026-01-08 — With a capture");
    expect(markdown).toContain("- **Captured** — Has a screenshot.\n\n  ![The captured panel](media/changelog/2026-01-08-captured.png)");
    expect(markdown).toContain("- **Deferred** — Has none yet.");
    expect(markdown.match(/### Fixes/g)).toHaveLength(1);
    expect(markdown.match(/### Shipped/g)).toHaveLength(2);
    expect(markdown.endsWith("\n")).toBe(true);
  });
});

describe("previousCompletedReviewDate", () => {
  const current = "2026-09-14";

  it("picks the newest completed week that closed before the current one", () => {
    const reviews = [
      review("2026-08-24", "completed"),
      review("2026-09-07", "completed"),
      review("2026-08-31", "completed"),
    ];

    expect(previousCompletedReviewDate(reviews, current)).toBe("2026-09-07");
  });

  it("ignores drafts, the current week and anything later", () => {
    const reviews = [
      review("2026-09-07", "draft"),
      review(current, "completed"),
      review("2026-09-21", "completed"),
      review("2026-08-31", "completed"),
    ];

    expect(previousCompletedReviewDate(reviews, current)).toBe("2026-08-31");
  });

  it("returns null when no earlier review was completed", () => {
    expect(previousCompletedReviewDate([], current)).toBeNull();
    expect(previousCompletedReviewDate([review("2026-09-07", "draft")], current)).toBeNull();
    expect(previousCompletedReviewDate([review(current, "completed")], current)).toBeNull();
  });
});

describe("entriesSince", () => {
  const entries = [entry("2026-09-16"), entry("2026-09-11"), entry("2026-09-07"), entry("2026-08-31")];

  it("keeps only entries published strictly after the given date", () => {
    expect(entriesSince(entries, "2026-09-11", 10).map((item) => item.date)).toEqual(["2026-09-16"]);
    expect(entriesSince(entries, "2026-09-06", 10).map((item) => item.date)).toEqual([
      "2026-09-16",
      "2026-09-11",
      "2026-09-07",
    ]);
  });

  it("caps the list at the limit, newest first", () => {
    expect(entriesSince(entries, "2026-08-01", 2).map((item) => item.date)).toEqual(["2026-09-16", "2026-09-11"]);
    expect(entriesSince(entries, "2026-08-01")).toHaveLength(SHIPPED_ENTRY_LIMIT);
    expect(entriesSince(entries, "2026-08-01", 0)).toEqual([]);
  });

  it("falls back to the newest entries when there is no review to measure from", () => {
    expect(entriesSince(entries, null, 3).map((item) => item.date)).toEqual([
      "2026-09-16",
      "2026-09-11",
      "2026-09-07",
    ]);
  });

  it("returns nothing when the last review is newer than every entry", () => {
    expect(entriesSince(entries, "2026-09-16", 10)).toEqual([]);
  });

  it("gives the demo fixture's completed review a non-empty window", async () => {
    const { weeklyReviews } = await import("@/lib/demo/fixtures");
    const since = previousCompletedReviewDate(weeklyReviews, "2099-01-05");

    expect(since).not.toBeNull();
    expect(entriesSince(CHANGELOG, since).length).toBeGreaterThan(0);
  });
});
