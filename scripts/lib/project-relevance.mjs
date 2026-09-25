/**
 * Pure planning for scripts/backfill-project-links.mjs, kept in plain
 * JavaScript so the owner can run the script with Node alone. Covered by
 * tests/lib/project-links.test.ts.
 */

const lower = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

/**
 * Resolve a free-text `project_relevance[].repository` value to a project:
 * the full repository name (current or previous), the repository name
 * without its owner, the slug (current or previous), then the display name.
 */
export function resolveRelevanceProject(repository, projects) {
  const target = lower(repository);
  if (!target) return null;
  const bare = target.includes("/") ? target.split("/").pop() : target;
  const names = (project) => [project.repo_full_name, ...(project.previous_repo_full_names ?? [])].map(lower).filter(Boolean);
  return (
    projects.find((project) => names(project).includes(target)) ??
    projects.find((project) => names(project).some((name) => name.split("/").pop() === bare)) ??
    projects.find((project) => [project.slug, ...(project.previous_slugs ?? [])].map(lower).includes(bare)) ??
    projects.find((project) => lower(project.name) === bare) ??
    null
  );
}

/**
 * Rows to insert into project_links from ai_links.project_relevance, skipping
 * pairs that already exist and repeated pairs. Unresolved repositories are
 * reported, never guessed.
 */
export function planProjectLinkBackfill(links, projects, existing) {
  const taken = new Set(existing.map((row) => `${row.project_id}:${row.ai_link_id}`));
  const nextOrder = new Map();
  for (const row of existing) {
    nextOrder.set(row.project_id, Math.max(nextOrder.get(row.project_id) ?? 0, (row.sort_order ?? 0) + 1));
  }
  const rows = [];
  const unresolved = [];
  for (const link of links) {
    for (const entry of Array.isArray(link.project_relevance) ? link.project_relevance : []) {
      const project = resolveRelevanceProject(entry?.repository, projects);
      if (!project) {
        unresolved.push({ link: link.title, repository: entry?.repository ?? "" });
        continue;
      }
      const key = `${project.id}:${link.id}`;
      if (taken.has(key)) continue;
      taken.add(key);
      const order = nextOrder.get(project.id) ?? 0;
      nextOrder.set(project.id, order + 1);
      rows.push({
        project_id: project.id,
        ai_link_id: link.id,
        role: "uses",
        note: typeof entry?.reason === "string" ? entry.reason.trim().slice(0, 500) : "",
        sort_order: order,
      });
    }
  }
  return { rows, unresolved };
}
