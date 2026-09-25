import type { AiLink, Project, ProjectLink, ProjectLinkRole } from "@/lib/types";

/**
 * Pure helpers for the project ↔ library-link relation (`project_links`).
 * The relation is the only source of "which links does a project use"; the
 * older free-text `ai_links.project_relevance` is deprecated.
 */

export const PROJECT_LINK_ROLES = ["uses", "reference", "tool"] as const satisfies readonly ProjectLinkRole[];

export type ProjectLinkEntry = { relation: ProjectLink; link: AiLink };

function byOrder(a: ProjectLink, b: ProjectLink): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

/** The library links a project uses, in the project's own order. Relations
 * whose link is not loaded (deleted or out of scope) are skipped. */
export function linksForProject(
  projectId: string,
  relations: readonly ProjectLink[],
  links: readonly AiLink[],
): ProjectLinkEntry[] {
  const byId = new Map(links.map((link) => [link.id, link]));
  return relations
    .filter((relation) => relation.project_id === projectId)
    .sort(byOrder)
    .flatMap((relation) => {
      const link = byId.get(relation.ai_link_id);
      return link ? [{ relation, link }] : [];
    });
}

export type LinkUsage<P extends Pick<Project, "id" | "name" | "slug">> = {
  relation: ProjectLink;
  project: P;
};

/** The projects that use one link, ordered by project name. */
export function projectsUsingLink<P extends Pick<Project, "id" | "name" | "slug">>(
  linkId: string,
  relations: readonly ProjectLink[],
  projects: readonly P[],
): LinkUsage<P>[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return relations
    .filter((relation) => relation.ai_link_id === linkId)
    .flatMap((relation) => {
      const project = byId.get(relation.project_id);
      return project ? [{ relation, project }] : [];
    })
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/** At most `max` chips, plus how many are hidden behind a "+n" count. */
export function chipOverflow<T>(items: readonly T[], max = 3): { shown: T[]; hidden: number } {
  return { shown: items.slice(0, max), hidden: Math.max(0, items.length - max) };
}

/** Link ids used by a project — the picker hides them. */
export function linkIdsForProject(projectId: string, relations: readonly ProjectLink[]): Set<string> {
  return new Set(
    relations.filter((relation) => relation.project_id === projectId).map((relation) => relation.ai_link_id),
  );
}

/** Next sort_order at the end of a project's list. */
export function nextProjectLinkOrder(projectId: string, relations: readonly ProjectLink[]): number {
  return relations
    .filter((relation) => relation.project_id === projectId)
    .reduce((max, relation) => Math.max(max, relation.sort_order + 1), 0);
}

/** Library links used by at least one of the given projects. */
export function linkIdsUsedByProject(projectId: string | "all", relations: readonly ProjectLink[]): Set<string> | null {
  if (projectId === "all") return null;
  return linkIdsForProject(projectId, relations);
}
