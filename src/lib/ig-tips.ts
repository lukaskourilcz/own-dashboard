import { linkDescription } from "@/lib/link-export";
import { resourceKey } from "@/lib/link-library";
import type { AiLink } from "@/lib/types";

/**
 * IG TIPS: the library's idea records (`ai_links.record_type = 'idea'`),
 * shown as their own navigation section and grouped by topic. The groups
 * are a fixed list in display order, mirrored by the `ai_links_tip_group_check`
 * constraint in `supabase/migrations/20260926140000_ig_tips.sql`.
 */
export const TIP_GROUPS = [
  "content",
  "formats",
  "reach",
  "growth",
  "monetization",
  "research",
  "design",
  "ai",
  "operations",
] as const;

export type TipGroup = (typeof TIP_GROUPS)[number];

/** Tips without a group, listed after every group. */
export const UNGROUPED_TIPS = "ungrouped";

export type TipGroupKey = TipGroup | typeof UNGROUPED_TIPS;

export function isTipGroup(value: unknown): value is TipGroup {
  return typeof value === "string" && (TIP_GROUPS as readonly string[]).includes(value);
}

/** Every IG tip is an idea record in the link library. */
export function isTip(link: Pick<AiLink, "record_type">): boolean {
  return link.record_type === "idea";
}

/** A tip's group, or the ungrouped bucket for null or an unknown value. */
export function tipGroupKey(tip: Pick<AiLink, "tip_group">): TipGroupKey {
  return isTipGroup(tip.tip_group) ? tip.tip_group : UNGROUPED_TIPS;
}

/**
 * What a tip's card says: its plain summary, else the stored notes (for a tip
 * saved before summaries existed, or one the owner left without one).
 */
export function tipText(tip: AiLink): string {
  return tip.tip_summary?.trim() || linkDescription(tip)?.trim() || "";
}

export type TipSource =
  | { kind: "instagram"; count: number }
  | { kind: "web"; host: string }
  | { kind: "none" };

function isInstagram(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/**
 * Where a tip came from: the Instagram Reels it was saved from, else the site
 * its link points to. Derived from the stored URLs only.
 */
export function tipSource(tip: Pick<AiLink, "url" | "source_urls">): TipSource {
  const reels = new Set(
    [tip.url, ...(tip.source_urls ?? [])]
      .filter((url) => isInstagram(url) && resourceKey(url))
      .map((url) => resourceKey(url)!),
  );
  if (reels.size > 0) return { kind: "instagram", count: reels.size };
  if (resourceKey(tip.url)) {
    return { kind: "web", host: new URL(tip.url).hostname.replace(/^www\./, "") };
  }
  return { kind: "none" };
}

/** Tips grouped in `TIP_GROUPS` order, ungrouped last, each group by title. */
export function groupTips<T extends Pick<AiLink, "tip_group" | "title">>(
  tips: readonly T[],
): { group: TipGroupKey; tips: T[] }[] {
  const order: TipGroupKey[] = [...TIP_GROUPS, UNGROUPED_TIPS];
  return order
    .map((group) => ({
      group,
      tips: tips
        .filter((tip) => tipGroupKey(tip) === group)
        .sort((a, b) => a.title.localeCompare(b.title)),
    }))
    .filter((entry) => entry.tips.length > 0);
}

const searchable = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();

/**
 * Tips matching every word of the query, accent-insensitively, across the
 * title, the card text, the notes, why it is useful, the projects it names
 * and its group's label.
 */
export function searchTips<T extends AiLink>(
  tips: readonly T[],
  query: string,
  groupLabel: (group: TipGroupKey) => string,
): T[] {
  const words = searchable(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...tips];
  return tips.filter((tip) => {
    const text = searchable(
      [
        tip.title,
        tip.tip_summary ?? "",
        tip.description ?? "",
        tip.rating_rationale ?? "",
        ...(tip.project_relevance ?? []).map((project) => `${project.repository} ${project.reason}`),
        groupLabel(tipGroupKey(tip)),
      ].join(" "),
    );
    return words.every((word) => text.includes(word));
  });
}
