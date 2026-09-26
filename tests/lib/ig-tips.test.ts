import { describe, expect, it } from "vitest";
import { dashboardDataKeysForTab } from "@/lib/dashboard-data";
import {
  TIP_GROUPS,
  UNGROUPED_TIPS,
  groupTips,
  isTip,
  searchTips,
  tipGroupKey,
  tipSource,
  tipText,
} from "@/lib/ig-tips";
import { NAV_TABS, isNavTab, tabFromSlug, tabToPath } from "@/lib/nav-tabs";
import { normalizeNavPreferenceIds } from "@/lib/use-prefs";
import type { AiLink } from "@/lib/types";

const TS = "2026-09-26T10:00:00Z";
const tip = (id: string, extra: Partial<AiLink> = {}): AiLink => ({
  id,
  user_id: "owner",
  category_id: null,
  title: id,
  url: "https://example.com/" + id,
  description: null,
  pricing: null,
  record_type: "idea",
  created_at: TS,
  updated_at: TS,
  ...extra,
});

describe("IG TIPS groups", () => {
  it("lists groups in display order and sorts each by title, ungrouped last", () => {
    const groups = groupTips([
      tip("b", { tip_group: "content" }),
      tip("z", { tip_group: null }),
      tip("a", { tip_group: "content" }),
      tip("m", { tip_group: "ai" }),
      tip("q", { tip_group: "retired-group" }),
    ]);
    expect(groups.map((group) => [group.group, group.tips.map((item) => item.id)])).toEqual([
      ["content", ["a", "b"]],
      ["ai", ["m"]],
      [UNGROUPED_TIPS, ["q", "z"]],
    ]);
    expect(TIP_GROUPS[0]).toBe("content");
    expect(tipGroupKey(tip("x", { tip_group: "reach" }))).toBe("reach");
  });

  it("treats only idea records as tips", () => {
    expect(isTip(tip("idea"))).toBe(true);
    expect(isTip({ record_type: "link" })).toBe(false);
    expect(isTip({ record_type: undefined })).toBe(false);
  });
});

describe("tip text and source", () => {
  it("shows the plain summary, else the stored notes without a legacy score", () => {
    expect(tipText(tip("s", { tip_summary: "  Plain words.  ", description: "Notes" }))).toBe("Plain words.");
    expect(tipText(tip("n", { description: "4/5 · Old notes", usefulness_rating: 4 }))).toBe("Old notes");
    expect(tipText(tip("e", { tip_summary: " " }))).toBe("");
  });

  it("counts distinct Instagram Reels, else names the site", () => {
    expect(
      tipSource(tip("r", {
        url: "https://www.instagram.com/p/AAA/",
        source_urls: ["https://www.instagram.com/p/AAA/", "https://instagram.com/p/BBB/?utm_source=x", "https://example.com/other"],
      })),
    ).toEqual({ kind: "instagram", count: 2 });
    expect(tipSource(tip("w", { url: "https://www.intercom.com/blog/rice", source_urls: [] }))).toEqual({ kind: "web", host: "intercom.com" });
    expect(tipSource(tip("x", { url: "javascript:alert(1)" }))).toEqual({ kind: "none" });
  });
});

describe("searchTips", () => {
  const label = (group: string) => (group === "growth" ? "Růst a udržení" : group);
  const tips = [
    tip("streak", { title: "Make the streak forgiving", tip_summary: "Celebrate day 7.", tip_group: "growth" }),
    tip("ledger", { title: "Keep the treasury ledger", description: "Double-entry postings", project_relevance: [{ repository: "quorum", reason: "Audit" }] }),
  ];

  it("matches every word across the fields, ignoring accents and case", () => {
    expect(searchTips(tips, "DAY 7", label).map((item) => item.id)).toEqual(["streak"]);
    expect(searchTips(tips, "rust udrzeni", label).map((item) => item.id)).toEqual(["streak"]);
    expect(searchTips(tips, "quorum double", label).map((item) => item.id)).toEqual(["ledger"]);
    expect(searchTips(tips, "streak ledger", label)).toEqual([]);
    expect(searchTips(tips, "  ", label)).toHaveLength(2);
  });
});

describe("IG TIPS navigation", () => {
  it("is a canonical Library destination at /ig-tips after Links", () => {
    expect(isNavTab("ig-tips")).toBe(true);
    expect(tabToPath("ig-tips")).toBe("/ig-tips");
    expect(tabFromSlug(["ig-tips"])).toBe("ig-tips");
    expect(NAV_TABS.indexOf("ig-tips")).toBe(NAV_TABS.indexOf("links") + 1);
    expect(normalizeNavPreferenceIds(["ig-tips", "links"])).toEqual(["ig-tips", "links"]);
  });

  it("loads the library records and their projects, nothing else", () => {
    expect([...dashboardDataKeysForTab("ig-tips")]).toEqual(["aiLinks", "aiCategories", "projectLinks", "projects"]);
  });
});
