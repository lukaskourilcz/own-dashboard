import type { AiLink, AiLinkProject, Project } from "@/lib/types";

/**
 * Pure helpers for the link-to-project references. Framework-free so the
 * library card, the project workspace and the unit tests read one truth.
 */

export type ReferenceStatus = AiLinkProject["status"];
export type ConnectionFilter = "all" | "connected" | "unconnected";

export type ProjectReference = AiLinkProject & { project: Project };
export type LinkReference = AiLinkProject & { link: AiLink };

/** References of one library record, joined to the projects that still exist. */
export function referencesForLink(
  linkId: string,
  references: readonly AiLinkProject[],
  projects: readonly Project[],
): ProjectReference[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return references
    .filter((reference) => reference.link_id === linkId)
    .flatMap((reference) => {
      const project = byId.get(reference.project_id);
      return project ? [{ ...reference, project }] : [];
    })
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/** References of one project, joined to the library records that still exist. */
export function referencesForProject(
  projectId: string,
  references: readonly AiLinkProject[],
  links: readonly AiLink[],
): LinkReference[] {
  const byId = new Map(links.map((link) => [link.id, link]));
  return references
    .filter((reference) => reference.project_id === projectId)
    .flatMap((reference) => {
      const link = byId.get(reference.link_id);
      return link ? [{ ...reference, link }] : [];
    })
    .sort((a, b) => a.link.title.localeCompare(b.link.title));
}

/** Link ids that have at least one reference; the source of the "connected" tag. */
export function connectedLinkIds(references: readonly AiLinkProject[]): Set<string> {
  return new Set(references.map((reference) => reference.link_id));
}

export function matchesConnection(
  linkId: string,
  filter: ConnectionFilter,
  connected: ReadonlySet<string>,
): boolean {
  if (filter === "all") return true;
  return filter === "connected" ? connected.has(linkId) : !connected.has(linkId);
}

/**
 * Resolve a repository slug from an idea's `project_relevance` to a project.
 * Relevance slugs are free text ("goviral", "react-express-app"); a project
 * matches on its slug, or on the repository name after the owner prefix.
 */
export function projectForRepository(repository: string, projects: readonly Project[]): Project | null {
  const wanted = repository.trim().toLowerCase();
  if (!wanted) return null;
  return projects.find((project) => {
    const slug = project.slug.toLowerCase();
    const repoName = project.repo_full_name?.split("/").pop()?.toLowerCase();
    return slug === wanted || repoName === wanted || project.name.toLowerCase() === wanted;
  }) ?? null;
}
