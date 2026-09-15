import type { AiCategory, AiLink } from "@/lib/types";

/** Older descriptions embedded a score; the structured review supersedes it. */
export function linkDescription(link: AiLink) {
  return link.usefulness_rating == null ? link.description : link.description?.replace(/^\s*[1-5]\/5\s*·\s*/, "") ?? null;
}

export type LinkPricingFilter = "free" | "freemium" | "all";

export function selectExportLinks(links: AiLink[], pricing: LinkPricingFilter, query = "") {
  const search = query.trim().toLowerCase();
  return links.filter((link) =>
    (pricing === "all" || link.pricing === "free" || (pricing === "freemium" && link.pricing === "freemium")) &&
    (!search || [link.title, link.url, link.description, link.rating_rationale,
      ...(link.project_relevance ?? []).map((p) => p.repository + " " + p.reason)]
      .join("\n").toLowerCase().includes(search)),
  );
}

export function buildLinkExport(links: AiLink[], categories: AiCategory[], pricing: LinkPricingFilter, query = "") {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return {
    version: 1,
    pricingFilter: pricing,
    search: query.trim(),
    items: selectExportLinks(links, pricing, query).map((l) => ({
      id: l.id, type: l.record_type ?? "link", title: l.title, url: l.url,
      category: names.get(l.category_id ?? "") ?? null,
      description: linkDescription(l), pricing: l.pricing,
      usefulnessRating: l.usefulness_rating ?? null,
      ratingRationale: l.rating_rationale ?? null,
      projectRelevance: l.project_relevance ?? [],
      sources: l.source_urls ?? [], pricingEvidence: l.pricing_evidence ?? null,
      reviewedAt: l.reviewed_at ?? null,
    })),
  };
}

const escapeMd = (value: string) => value.replace(/[\\`*_{}[\]<>#|]/g, "\\$&");

export function linkExportMarkdown(data: ReturnType<typeof buildLinkExport>) {
  return [
    "# Links & ideas", "", "Pricing filter: " + data.pricingFilter,
    ...(data.search ? ["Search: " + escapeMd(data.search)] : []), "",
    ...data.items.flatMap((l) => [
      "## " + escapeMd(l.title), "",
      "Type: " + l.type, "URL: " + l.url,
      "Category: " + escapeMd(l.category ?? "Uncategorized"),
      "Pricing: " + (l.pricing ?? "Unknown"),
      "Usefulness: " + (l.usefulnessRating == null ? "Not rated" : l.usefulnessRating + "/5"), "",
      l.description ?? "", "",
      ...(l.ratingRationale ? ["Rating rationale: " + l.ratingRationale, ""] : []),
      ...l.projectRelevance.map((p) => "- " + escapeMd(p.repository) + ": " + p.reason),
      ...(l.sources.length ? ["", "Sources:", ...l.sources.map((s) => "- " + s)] : []),
      ...(l.pricingEvidence ? ["", "Pricing evidence: " + l.pricingEvidence] : []),
      ...(l.reviewedAt ? ["Reviewed: " + l.reviewedAt] : []), "",
    ]),
  ].join("\n");
}
