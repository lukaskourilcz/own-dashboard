import type { GithubRepo } from "./github";
import type { Project, Todo } from "./types";

/**
 * One place that decides which project a task or a GitHub repository belongs
 * to. The GitHub repository id is the primary key because it survives renames;
 * the current and previous full names are the fallback for rows imported
 * before the id was known. Every comparison of names is case-insensitive,
 * because GitHub treats owner/name case-insensitively.
 */

export type ProjectRepoIdentity = Pick<Project, "id" | "repo_full_name"> &
  Partial<Pick<Project, "repo_id" | "previous_repo_full_names">>;

export type TaskRepoIdentity = Pick<Todo, "repo_id" | "repo_full_name"> &
  Partial<Pick<Todo, "project_id">>;

function lower(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLocaleLowerCase() : null;
}

/** Current and previous repository names of a project, lowercased. */
export function projectRepoNames(project: ProjectRepoIdentity): string[] {
  const names = new Set<string>();
  const current = lower(project.repo_full_name);
  if (current) names.add(current);
  for (const previous of project.previous_repo_full_names ?? []) {
    const name = lower(previous);
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * Whether a task belongs to a project. An explicit `project_id` always wins;
 * otherwise the task's GitHub repository id, current name or any previous
 * name of the project's repository decides.
 */
export function taskBelongsToProject(
  task: TaskRepoIdentity,
  project: ProjectRepoIdentity,
): boolean {
  if (task.project_id) return task.project_id === project.id;
  if (
    project.repo_id != null &&
    task.repo_id != null &&
    String(project.repo_id) === String(task.repo_id)
  ) {
    return true;
  }
  const taskRepo = lower(task.repo_full_name);
  return taskRepo != null && projectRepoNames(project).includes(taskRepo);
}

/** The project a task belongs to, preferring an explicit `project_id`. */
export function findProjectForTask<P extends ProjectRepoIdentity>(
  task: TaskRepoIdentity,
  projects: readonly P[],
): P | undefined {
  if (task.project_id) {
    return projects.find((project) => project.id === task.project_id);
  }
  return projects.find((project) => taskBelongsToProject(task, project));
}

export type RepoIdentity = Pick<GithubRepo, "id" | "full_name">;

/** Columns the auto-sync writes when it links a project to a repository. */
export type ProjectRepoUpdate = {
  repo_id?: number;
  repo_full_name?: string;
  previous_repo_full_names?: string[];
};

export type RepositorySyncPlan<P extends ProjectRepoIdentity> = {
  /** Existing projects whose repository id or name must be written. */
  updates: { project: P; repo: RepoIdentity; update: ProjectRepoUpdate }[];
  /** Repositories that already have their project (after updates). */
  linked: { project: P; repo: RepoIdentity }[];
  /** Repositories with no project at all: the only ones a sync may create. */
  missing: RepoIdentity[];
};

/**
 * The update that brings a project in line with the repository it matched by
 * id. A rename changes `repo_full_name` only and records the old name.
 */
export function repositoryIdentityUpdate(
  project: ProjectRepoIdentity,
  repo: RepoIdentity,
): ProjectRepoUpdate | null {
  const update: ProjectRepoUpdate = {};
  if (project.repo_id == null || Number(project.repo_id) !== repo.id) {
    update.repo_id = repo.id;
  }
  const current = project.repo_full_name?.trim() || null;
  if (current !== repo.full_name) {
    update.repo_full_name = repo.full_name;
    const previous = project.previous_repo_full_names ?? [];
    if (
      current &&
      lower(current) !== lower(repo.full_name) &&
      !previous.some((name) => lower(name) === lower(current))
    ) {
      update.previous_repo_full_names = [...previous, current];
    }
  }
  return Object.keys(update).length > 0 ? update : null;
}

/**
 * Plan a Repositories → Projects sync without touching the database.
 *
 * 1. A repository whose id is already stored on a project updates that
 *    project: a changed full name is written and the old one remembered.
 * 2. Otherwise a project without an id whose current or previous name matches
 *    receives the id (self-healing the rows created before ids were stored).
 * 3. A name already claimed by a project linked to another repository id is
 *    left alone rather than duplicated.
 * 4. Everything else is missing and may get a new project.
 */
export function planRepositorySync<P extends ProjectRepoIdentity>(
  repos: readonly RepoIdentity[],
  projects: readonly P[],
): RepositorySyncPlan<P> {
  const plan: RepositorySyncPlan<P> = { updates: [], linked: [], missing: [] };
  const claimed = new Set<string>();

  for (const repo of repos) {
    const byId = projects.find(
      (project) =>
        !claimed.has(project.id) &&
        project.repo_id != null &&
        Number(project.repo_id) === repo.id,
    );
    const repoName = lower(repo.full_name);
    const byName = byId
      ? undefined
      : projects.find(
          (project) =>
            !claimed.has(project.id) &&
            project.repo_id == null &&
            repoName != null &&
            projectRepoNames(project).includes(repoName),
        );
    const match = byId ?? byName;
    if (match) {
      claimed.add(match.id);
      plan.linked.push({ project: match, repo });
      const update = byId
        ? repositoryIdentityUpdate(match, repo)
        : { repo_id: repo.id };
      if (update) plan.updates.push({ project: match, repo, update });
      continue;
    }
    const nameTaken = projects.some(
      (project) => repoName != null && lower(project.repo_full_name) === repoName,
    );
    if (!nameTaken) plan.missing.push(repo);
  }

  return plan;
}

/**
 * Projects that still carry a repository name but no id and matched none of
 * the listed repositories. Their name may be an old one; a lookup by name
 * (GitHub redirects renamed repositories) resolves the id before the sync
 * would create a duplicate for the new name.
 */
export function unresolvedRepositoryProjects<P extends ProjectRepoIdentity>(
  plan: RepositorySyncPlan<P>,
  projects: readonly P[],
): P[] {
  const linked = new Set(plan.linked.map((entry) => entry.project.id));
  return projects.filter(
    (project) =>
      project.repo_id == null &&
      Boolean(project.repo_full_name?.trim()) &&
      !linked.has(project.id),
  );
}
