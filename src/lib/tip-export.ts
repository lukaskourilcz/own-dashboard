import { TIP_GROUPS, UNGROUPED_TIPS, isTipGroup, tipGroupKey, type TipGroup, type TipGroupKey } from "@/lib/ig-tips";
import { escapeMd, linkDescription, type LinkExportRelations } from "@/lib/link-export";
import type { AiLink } from "@/lib/types";

/*
 * IG TIPS export (version 5). Tips are grouped by topic (`tip_group`), not by
 * library category, and carry no pricing, so this export selects and groups by
 * topic and has no price filter. Each item carries `tip_group` and
 * `tip_summary` under their column names, so a plan generator can read the
 * card text directly.
 */

export type TipExportSelection = "all" | "topics" | "items";
export type TipExportShape = "detailed" | "compact" | "grouped";

export type TipExportOptions = {
  selection?: TipExportSelection;
  /** Topic keys for `topics`; `ungrouped` selects tips without a topic. */
  topics?: TipGroupKey[];
  itemIds?: string[];
  relations?: LinkExportRelations;
};

export function selectExportTips(links: AiLink[], options: TipExportOptions = {}) {
  const selection = options.selection ?? "all";
  const topics = new Set(options.topics ?? []);
  const itemIds = new Set(options.itemIds ?? []);
  return links.filter((link) => {
    if ((link.record_type ?? "link") !== "idea") return false;
    if (selection === "topics" && !topics.has(tipGroupKey(link))) return false;
    if (selection === "items" && !itemIds.has(link.id)) return false;
    return true;
  });
}

export function buildTipExport(links: AiLink[], options: TipExportOptions = {}) {
  const selection = options.selection ?? "all";
  const projectsById = new Map((options.relations?.projects ?? []).map((project) => [project.id, project]));
  const usedBy = (linkId: string) =>
    (options.relations?.projectLinks ?? [])
      .filter((relation) => relation.ai_link_id === linkId && projectsById.has(relation.project_id))
      .map((relation) => {
        const project = projectsById.get(relation.project_id)!;
        return { project: project.name, slug: project.slug, role: relation.role, note: relation.note };
      })
      .sort((a, b) => a.project.localeCompare(b.project));
  const order: TipGroupKey[] = [...TIP_GROUPS, UNGROUPED_TIPS];
  const tips = selectExportTips(links, options).sort(
    (a, b) => order.indexOf(tipGroupKey(a)) - order.indexOf(tipGroupKey(b)) || a.title.localeCompare(b.title),
  );
  return {
    // 5: the IG TIPS export selects and groups by topic, drops the category
    // and pricing fields, and names the card text `tip_summary`.
    version: 5,
    scope: "idea" as const,
    selection,
    topics: selection === "topics" ? order.filter((group) => (options.topics ?? []).includes(group)) : null,
    items: tips.map((tip) => ({
      id: tip.id,
      title: tip.title,
      url: tip.url,
      tip_group: isTipGroup(tip.tip_group) ? tip.tip_group : null,
      tip_summary: tip.tip_summary?.trim() || null,
      notes: linkDescription(tip),
      usefulnessRating: tip.usefulness_rating ?? null,
      ratingRationale: tip.rating_rationale ?? null,
      projectRelevance: tip.project_relevance ?? [],
      sources: tip.source_urls ?? [],
      reviewedAt: tip.reviewed_at ?? null,
      usedBy: usedBy(tip.id),
    })),
  };
}

export type TipExportData = ReturnType<typeof buildTipExport>;

export function shapeTipExport(data: TipExportData, shape: TipExportShape) {
  if (shape === "compact") {
    return {
      version: data.version,
      scope: data.scope,
      items: data.items.map(({ title, url, tip_group, tip_summary }) => ({ title, url, tip_group, tip_summary })),
    };
  }
  if (shape === "grouped") {
    const groups = new Map<TipGroup | null, TipExportData["items"]>();
    for (const item of data.items) groups.set(item.tip_group, [...(groups.get(item.tip_group) ?? []), item]);
    return {
      version: data.version,
      scope: data.scope,
      topics: [...groups].map(([tip_group, items]) => ({ tip_group, items })),
    };
  }
  return data;
}

/** Markdown with one section per topic; `topicName` names a topic key. */
export function tipExportMarkdown(data: TipExportData, topicName: (group: TipGroupKey) => string) {
  const lines = ["# IG tips", ""];
  let current: string | null = null;
  for (const tip of data.items) {
    const group = tip.tip_group ?? UNGROUPED_TIPS;
    if (group !== current) {
      current = group;
      lines.push("## " + escapeMd(topicName(group)), "");
    }
    lines.push(
      "### " + escapeMd(tip.title), "",
      "URL: " + tip.url,
      "Topic: " + (tip.tip_group ?? "none"),
      "Usefulness: " + (tip.usefulnessRating == null ? "Not rated" : tip.usefulnessRating + "/5"), "",
      ...(tip.tip_summary ? [tip.tip_summary, ""] : []),
      ...(tip.notes && tip.notes !== tip.tip_summary ? ["Notes: " + tip.notes, ""] : []),
      ...(tip.ratingRationale ? ["Benefit: " + tip.ratingRationale, ""] : []),
      ...(tip.usedBy.length ? ["Used by:", ...tip.usedBy.map((u) => "- " + escapeMd(u.project) + " (" + u.role + ")" + (u.note ? ": " + u.note : "")), ""] : []),
      ...(tip.sources.length ? ["Sources:", ...tip.sources.map((s) => "- " + s), ""] : []),
    );
  }
  return lines.join("\n");
}
