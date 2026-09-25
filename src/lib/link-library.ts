import type { AiCategory, AiLink, AiPricing } from "@/lib/types";

export type PricingFilter = "all" | "unknown" | AiPricing;
export type LinkSort = "name" | "newest";
export const UNCATEGORIZED_LINKS = "__uncategorized__";

const searchable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

export function resourceKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
    url.searchParams.sort();
    return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch { return null; }
}

/**
 * Ids of the records a merge would move. Pure, so the optimistic update in the
 * panel and the assertion in the test both ask the same function. Merging a
 * category into itself moves nothing; `null` as the target means Uncategorized.
 */
export function planCategoryMerge(links: AiLink[], sourceId: string, targetId: string | null): string[] {
  if (!sourceId || sourceId === targetId) return [];
  return links.filter(link => link.category_id === sourceId).map(link => link.id);
}

/**
 * Comparison key for category names: accents, case, separators and an English
 * trailing plural all collapse. The trailing "s" is only dropped when four
 * letters survive, so `CSS` stays `css` rather than colliding with `CS`.
 */
function categoryKey(name: string): string {
  const flat = searchable(name).replace(/[^a-z0-9]/g, "");
  return flat.endsWith("s") && flat.length - 1 >= 4 ? flat.slice(0, -1) : flat;
}

/**
 * Category pairs whose names read as the same thing, as `[keep, duplicate]`
 * in the order the categories were loaded. A suggestion for the merge control,
 * never an automatic action: only the owner knows whether two similar names
 * are one topic.
 */
export function duplicateCategoryCandidates(categories: AiCategory[]): [AiCategory, AiCategory][] {
  const firstByKey = new Map<string, AiCategory>();
  const pairs: [AiCategory, AiCategory][] = [];
  for (const category of categories) {
    const key = categoryKey(category.name);
    if (!key) continue;
    const first = firstByKey.get(key);
    if (first) pairs.push([first, category]);
    else firstByKey.set(key, category);
  }
  return pairs;
}

export function filterLibrary(links: AiLink[], categories: AiCategory[], query: string, pricing: PricingFilter, category: string, sort: LinkSort) {
  const names = new Map(categories.map(item => [item.id, item.name]));
  const words = searchable(query).trim().split(/\s+/).filter(Boolean);
  return links.filter(link => {
    const group = link.category_id && names.has(link.category_id) ? link.category_id : UNCATEGORIZED_LINKS;
    if (category !== "all" && group !== category) return false;
    if (pricing !== "all" && (link.pricing ?? "unknown") !== pricing) return false;
    const text = searchable(`${link.title} ${link.url} ${link.description ?? ""} ${names.get(group) ?? ""} ${link.rating_rationale ?? ""} ${(link.project_relevance ?? []).map(project => `${project.repository} ${project.reason}`).join(" ")}`);
    return words.every(word => text.includes(word));
  }).sort((a,b) => sort === "newest" ? b.created_at.localeCompare(a.created_at) || a.title.localeCompare(b.title) : a.title.localeCompare(b.title));
}
