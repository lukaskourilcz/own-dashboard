import { describe, expect, it } from "vitest";
import { buildTipExport, selectExportTips, shapeTipExport, tipExportMarkdown } from "@/lib/tip-export";
import type { AiLink, ProjectLink } from "@/lib/types";

const TS = "2026-09-28T10:00:00Z";
const tip = (id: string, extra: Partial<AiLink> = {}): AiLink => ({
  id,
  user_id: "private-owner",
  category_id: "cat",
  title: id,
  url: "https://example.com/" + id,
  description: null,
  pricing: "paid",
  record_type: "idea",
  created_at: TS,
  updated_at: TS,
  ...extra,
});

const tips = [
  tip("Zeta growth", { tip_group: "growth", tip_summary: "  Card text.  " }),
  tip("Alpha content", { tip_group: "content", tip_summary: "Plan a month.", description: "3/5 · Notes", usefulness_rating: 3 }),
  tip("Loose", { tip_group: null }),
  tip("Legacy", { tip_group: "retired-topic" as AiLink["tip_group"] }),
  { ...tip("A link"), record_type: "link" as const },
];

describe("IG TIPS export", () => {
  it("selects tips by topic or by item and ignores links and pricing", () => {
    expect(selectExportTips(tips).map((item) => item.id)).toEqual(["Zeta growth", "Alpha content", "Loose", "Legacy"]);
    expect(selectExportTips(tips, { selection: "topics", topics: ["growth"] }).map((item) => item.id)).toEqual(["Zeta growth"]);
    expect(selectExportTips(tips, { selection: "topics", topics: ["ungrouped"] }).map((item) => item.id)).toEqual(["Loose", "Legacy"]);
    expect(selectExportTips(tips, { selection: "items", itemIds: ["Loose", "A link"] }).map((item) => item.id)).toEqual(["Loose"]);
  });

  it("carries tip_group and tip_summary, in topic order, without category, pricing or owner", () => {
    const projectLinks: ProjectLink[] = [
      { id: "pl", user_id: "private-owner", project_id: "p1", ai_link_id: "Alpha content", role: "reference", note: "Posts", sort_order: 0, created_at: TS, updated_at: TS },
    ];
    const data = buildTipExport(tips, { relations: { projectLinks, projects: [{ id: "p1", name: "devShark", slug: "devshark" }] } });
    expect(data).toMatchObject({ version: 5, scope: "idea", selection: "all", topics: null });
    expect(data.items.map((item) => [item.title, item.tip_group])).toEqual([
      ["Alpha content", "content"],
      ["Zeta growth", "growth"],
      ["Legacy", null],
      ["Loose", null],
    ]);
    expect(data.items[0]).toMatchObject({ tip_summary: "Plan a month.", notes: "Notes", usefulnessRating: 3, usedBy: [{ project: "devShark", role: "reference" }] });
    expect(data.items[1]!.tip_summary).toBe("Card text.");
    const json = JSON.stringify(data);
    for (const absent of ["private-owner", "pricing", "category"]) expect(json).not.toContain(absent);
    expect(buildTipExport(tips, { selection: "topics", topics: ["growth", "content"] }).topics).toEqual(["content", "growth"]);
  });

  it("offers compact and topic-grouped JSON and Markdown with one section per topic", () => {
    const data = buildTipExport(tips);
    expect(shapeTipExport(data, "detailed")).toBe(data);
    expect(shapeTipExport(data, "compact")).toEqual({
      version: 5,
      scope: "idea",
      items: data.items.map(({ title, url, tip_group, tip_summary }) => ({ title, url, tip_group, tip_summary })),
    });
    expect(shapeTipExport(data, "grouped")).toMatchObject({
      topics: [
        { tip_group: "content", items: [{ title: "Alpha content" }] },
        { tip_group: "growth", items: [{ title: "Zeta growth" }] },
        { tip_group: null, items: [{ title: "Legacy" }, { title: "Loose" }] },
      ],
    });
    const md = tipExportMarkdown(data, (group) => ({ content: "Content ideas", growth: "Growth & retention", ungrouped: "Ungrouped" })[group as string] ?? group);
    expect(md.startsWith("# IG tips\n\n## Content ideas\n\n### Alpha content")).toBe(true);
    expect(md).toContain("Topic: content\nUsefulness: 3/5\n\nPlan a month.\n\nNotes: Notes");
    expect(md).toContain("## Growth & retention");
    expect(md).toContain("## Ungrouped");
    expect(md).not.toContain("Pricing");
  });
});
