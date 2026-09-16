import { describe, expect, it } from "vitest";
import { buildLinkExport, linkExportMarkdown, selectExportLinks, linkDescription, shapeLinkExport, UNCATEGORIZED_EXPORT } from "@/lib/link-export";
import type { AiLink } from "@/lib/types";

const row = (id: string, pricing: AiLink["pricing"]): AiLink => ({
  id, pricing, title: id, url: "https://example.com/" + id, description: "Český popis\nSecond line",
  category_id: null, user_id: "private-owner", created_at: "2026-09-15", updated_at: "2026-09-15",
});
const links = [row("free", "free"), row("limited", "freemium"), row("paid", "paid"), row("unknown", null)];

describe("link export", () => {
  it("keeps unknown prices and paid trials out of both free filters", () => {
    expect(selectExportLinks(links, "free").map((l) => l.id)).toEqual(["free"]);
    expect(selectExportLinks(links, "freemium").map((l) => l.id)).toEqual(["free", "limited"]);
    expect(selectExportLinks(links, "all")).toHaveLength(4);
  });
  it("selects one record type, categories or explicit items before applying pricing", () => {
    const scoped = [
      { ...row("link-a", "free"), category_id: "design" },
      { ...row("idea-a", "free"), record_type: "idea" as const, category_id: "design" },
      { ...row("idea-b", "paid"), record_type: "idea" as const },
    ];
    expect(selectExportLinks(scoped, "all", "", { scope: "idea" }).map((item) => item.id)).toEqual(["idea-a", "idea-b"]);
    expect(selectExportLinks(scoped, "all", "", { scope: "idea", selection: "categories", categoryIds: ["design"] }).map((item) => item.id)).toEqual(["idea-a"]);
    expect(selectExportLinks(scoped, "paid", "", { scope: "idea", selection: "categories", categoryIds: [UNCATEGORIZED_EXPORT] }).map((item) => item.id)).toEqual(["idea-b"]);
    expect(selectExportLinks(scoped, "all", "", { selection: "items", itemIds: ["link-a", "idea-b"] }).map((item) => item.id)).toEqual(["link-a", "idea-b"]);
  });
  it("exports complete review metadata without owner identifiers", () => {
    const idea = { ...row("Idea [review]", "free"), record_type: "idea" as const,
      usefulness_rating: 5, rating_rationale: "Solves a measured bottleneck",
      project_relevance: [{ repository: "project", reason: "Reduce image payload" }],
      source_urls: ["https://example.com/source"], pricing_evidence: "Free reference",
      reviewed_at: "2026-09-15T00:00:00Z" };
    const data = buildLinkExport([idea], [], "all");
    expect(data.items[0]).toMatchObject({ type: "idea", usefulnessRating: 5, category: null,
      projectRelevance: idea.project_relevance, sources: idea.source_urls, pricingEvidence: "Free reference" });
    expect(JSON.stringify(data)).not.toContain("private-owner");
    const md = linkExportMarkdown(data);
    expect(md).toContain("## Idea \\[review\\]");
    expect(md).toContain("Český popis\nSecond line");
    expect(md).toContain("Usefulness: 5/5");
    expect(md).toContain("project: Reduce image payload");
    expect(md).toContain("https://example.com/source");
  });
  it("supersedes embedded legacy scores without changing stored descriptions", () => {
    const old = { ...row("old", "free"), description: "2/5 · Useful reference" };
    expect(linkDescription(old)).toBe(old.description);
    expect(linkDescription({ ...old, usefulness_rating: 5 })).toBe("Useful reference");
    expect(old.description).toBe("2/5 · Useful reference");
  });
  it("handles legacy records, empty filters and unknown categories", () => {
    expect(buildLinkExport([row("legacy", null)], [], "all").items[0]).toMatchObject({ type: "link", usefulnessRating: null, sources: [] });
    expect(buildLinkExport([row("paid", "paid")], [], "free").items).toEqual([]);
    expect(linkExportMarkdown(buildLinkExport([], [], "all"))).toContain("# Links & ideas");
  });
  it("offers detailed, compact and category-grouped JSON structures", () => {
    const categories = [{ id: "design", user_id: "private-owner", name: "Design", sort_order: 1, created_at: "2026-09-15" }];
    const data = buildLinkExport([{ ...row("a", "free"), category_id: "design" }, row("b", null)], categories, "all", "", { scope: "link" });
    expect(shapeLinkExport(data, "detailed")).toBe(data);
    expect(shapeLinkExport(data, "compact")).toMatchObject({ scope: "link", items: [{ title: "a", category: "Design" }, { title: "b", category: null }] });
    expect(shapeLinkExport(data, "grouped")).toMatchObject({ categories: [{ category: "Design" }, { category: "Uncategorized" }] });
  });
});
