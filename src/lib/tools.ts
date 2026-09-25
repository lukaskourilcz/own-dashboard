import { toMonthlyIn } from "@/lib/subscriptions";
import type { AiLink, Project, ProjectLink, Subscription, Tool, ToolStatus } from "@/lib/types";

/** Status groups in display order. */
export const TOOL_STATUSES = ["in_use", "trial", "retired"] as const satisfies readonly ToolStatus[];

/** The name a tool shows: its own override, else the link title. */
export function toolName(tool: Pick<Tool, "name">, link: Pick<AiLink, "title"> | undefined): string {
  return tool.name?.trim() || link?.title || "";
}

/** Tools grouped by status in display order, empty groups left out, each
 * sorted by name. */
export function groupToolsByStatus<T extends Pick<Tool, "status" | "name" | "ai_link_id">>(
  tools: readonly T[],
  links: readonly Pick<AiLink, "id" | "title">[],
): { status: ToolStatus; tools: T[] }[] {
  const titles = new Map(links.map((link) => [link.id, link.title]));
  const nameOf = (tool: T) => tool.name?.trim() || titles.get(tool.ai_link_id) || "";
  return TOOL_STATUSES.map((status) => ({
    status,
    tools: tools
      .filter((tool) => tool.status === status)
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
  })).filter((group) => group.tools.length > 0);
}

export type ToolUsage<P extends Pick<Project, "id" | "name">> = { relation: ProjectLink; project: P };

/** The projects a tool is used in (project_links with role "tool"), by name. */
export function toolUsage<P extends Pick<Project, "id" | "name">>(
  tool: Pick<Tool, "ai_link_id">,
  relations: readonly ProjectLink[],
  projects: readonly P[],
): ToolUsage<P>[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return relations
    .filter((relation) => relation.ai_link_id === tool.ai_link_id && relation.role === "tool")
    .flatMap((relation) => {
      const project = byId.get(relation.project_id);
      return project ? [{ relation, project }] : [];
    })
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/** Tools used in one project, or all tools for "all". */
export function filterToolsByProject<T extends Pick<Tool, "ai_link_id">>(
  tools: readonly T[],
  relations: readonly ProjectLink[],
  projectId: string,
): T[] {
  if (projectId === "all") return [...tools];
  const used = new Set(
    relations
      .filter((relation) => relation.project_id === projectId && relation.role === "tool")
      .map((relation) => relation.ai_link_id),
  );
  return tools.filter((tool) => used.has(tool.ai_link_id));
}

/**
 * Monthly cost from the linked subscription in the display currency, using
 * the static FX table. Null when there is no linked, active subscription.
 */
export function toolMonthlyCost(
  tool: Pick<Tool, "subscription_id">,
  subscriptions: readonly Subscription[],
  displayCurrency: string,
): number | null {
  if (!tool.subscription_id) return null;
  const subscription = subscriptions.find((item) => item.id === tool.subscription_id);
  if (!subscription || subscription.is_active === false) return null;
  return toMonthlyIn(subscription, displayCurrency);
}
