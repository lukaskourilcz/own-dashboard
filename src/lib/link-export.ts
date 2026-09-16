import type { AiCategory, AiLink } from "@/lib/types";

/** Older descriptions embedded a score; the structured review supersedes it. */
export function linkDescription(link: AiLink) {
  return link.usefulness_rating == null ? link.description : link.description?.replace(/^\s*[1-5]\/5\s*·\s*/, "") ?? null;
}

export const UNCATEGORIZED_EXPORT = "__uncategorized__";

export type LinkPricingFilter = "free" | "freemium" | "freemium-only" | "paid" | "unknown" | "all";
export type LinkExportScope = "link" | "idea" | "all";
export type LinkExportSelection = "all" | "categories" | "items";
export type LinkExportShape = "detailed" | "compact" | "grouped";

export type LinkExportOptions = {
  scope?: LinkExportScope;
  selection?: LinkExportSelection;
  categoryIds?: string[];
  itemIds?: string[];
};

function matchesPricing(link: AiLink, pricing: LinkPricingFilter) {
  if (pricing === "all") return true;
  if (pricing === "unknown") return link.pricing == null;
  if (pricing === "freemium") return link.pricing === "free" || link.pricing === "freemium";
  if (pricing === "freemium-only") return link.pricing === "freemium";
  return link.pricing === pricing;
}

export function selectExportLinks(
  links: AiLink[],
  pricing: LinkPricingFilter,
  query = "",
  options: LinkExportOptions = {},
) {
  const search = query.trim().toLowerCase();
  const scope = options.scope ?? "all";
  const selection = options.selection ?? "all";
  const categoryIds = new Set(options.categoryIds ?? []);
  const itemIds = new Set(options.itemIds ?? []);

  return links.filter((link) => {
    const type = link.record_type ?? "link";
    const categoryId = link.category_id ?? UNCATEGORIZED_EXPORT;
    if (scope !== "all" && type !== scope) return false;
    if (!matchesPricing(link, pricing)) return false;
    if (selection === "categories" && !categoryIds.has(categoryId)) return false;
    if (selection === "items" && !itemIds.has(link.id)) return false;
    return !search || [link.title, link.url, link.description, link.rating_rationale,
      ...(link.project_relevance ?? []).map((project) => project.repository + " " + project.reason)]
      .join("\n").toLowerCase().includes(search);
  });
}

export function buildLinkExport(
  links: AiLink[],
  categories: AiCategory[],
  pricing: LinkPricingFilter,
  query = "",
  options: LinkExportOptions = {},
) {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const scope = options.scope ?? "all";
  const selection = options.selection ?? "all";
  return {
    version: 2,
    scope,
    selection,
    pricingFilter: pricing,
    search: query.trim(),
    items: selectExportLinks(links, pricing, query, options).map((link) => ({
      id: link.id,
      type: link.record_type ?? "link",
      title: link.title,
      url: link.url,
      category: names.get(link.category_id ?? "") ?? null,
      description: linkDescription(link),
      pricing: link.pricing,
      usefulnessRating: link.usefulness_rating ?? null,
      ratingRationale: link.rating_rationale ?? null,
      projectRelevance: link.project_relevance ?? [],
      sources: link.source_urls ?? [],
      pricingEvidence: link.pricing_evidence ?? null,
      reviewedAt: link.reviewed_at ?? null,
    })),
  };
}

export type LinkExportData = ReturnType<typeof buildLinkExport>;

export function shapeLinkExport(data: LinkExportData, shape: LinkExportShape) {
  if (shape === "compact") {
    return {
      version: data.version,
      scope: data.scope,
      items: data.items.map(({ title, url, category, pricing, description }) => ({
        title, url, category, pricing, summary: description,
      })),
    };
  }
  if (shape === "grouped") {
    const groups = new Map<string, LinkExportData["items"]>();
    for (const item of data.items) {
      const category = item.category ?? "Uncategorized";
      groups.set(category, [...(groups.get(category) ?? []), item]);
    }
    return {
      version: data.version,
      scope: data.scope,
      pricingFilter: data.pricingFilter,
      categories: [...groups].map(([category, items]) => ({ category, items })),
    };
  }
  return data;
}

const escapeMd = (value: string) => value.replace(/[\\`*_{}[\]<>#|]/g, "\\$&");

export function linkExportMarkdown(data: LinkExportData) {
  const heading = data.scope === "idea" ? "# Ideas" : data.scope === "link" ? "# Links" : "# Links & ideas";
  return [
    heading, "", "Pricing filter: " + data.pricingFilter,
    ...(data.search ? ["Search: " + escapeMd(data.search)] : []), "",
    ...data.items.flatMap((l) => [
      "## " + escapeMd(l.title), "",
      "Type: " + l.type, "URL: " + l.url,
      "Category: " + escapeMd(l.category ?? "Uncategorized"),
      "Pricing: " + (l.pricing ?? "Unknown"),
      "Usefulness: " + (l.usefulnessRating == null ? "Not rated" : l.usefulnessRating + "/5"), "",
      l.description ?? "", "",
      ...(l.ratingRationale ? ["Benefit: " + l.ratingRationale, ""] : []),
      ...l.projectRelevance.map((p) => "- " + escapeMd(p.repository) + ": " + p.reason),
      ...(l.sources.length ? ["", "Sources:", ...l.sources.map((s) => "- " + s)] : []),
      ...(l.pricingEvidence ? ["", "Pricing evidence: " + l.pricingEvidence] : []),
      ...(l.reviewedAt ? ["Reviewed: " + l.reviewedAt] : []), "",
    ]),
  ].join("\n");
}
