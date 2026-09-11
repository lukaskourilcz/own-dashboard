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

export function filterLibrary(links: AiLink[], categories: AiCategory[], query: string, pricing: PricingFilter, category: string, sort: LinkSort) {
  const names = new Map(categories.map(item => [item.id, item.name]));
  const words = searchable(query).trim().split(/\s+/).filter(Boolean);
  return links.filter(link => {
    const group = link.category_id && names.has(link.category_id) ? link.category_id : UNCATEGORIZED_LINKS;
    if (category !== "all" && group !== category) return false;
    if (pricing !== "all" && (link.pricing ?? "unknown") !== pricing) return false;
    const text = searchable(`${link.title} ${link.url} ${link.description ?? ""} ${names.get(group) ?? ""}`);
    return words.every(word => text.includes(word));
  }).sort((a,b) => sort === "newest" ? b.created_at.localeCompare(a.created_at) || a.title.localeCompare(b.title) : a.title.localeCompare(b.title));
}
