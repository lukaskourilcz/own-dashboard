import "server-only";
import { ABOUT_PROJECT_FILE } from "@/lib/about-project";
import {
  MAX_DETECTED_REPOSITORIES,
  mergeDetectedTools,
  parseAboutProjectStack,
  parsePackageJsonStack,
  type DetectedToolsResponse,
  type ProjectStack,
  type ProjectStackStatus,
  type StackEntry,
  type StackSource,
} from "@/lib/stack-detection";

/**
 * Reads the stack of each active project's repository for the Tools section.
 *
 * GitHub is reached through `fetchWithGitHubAuth` (passed in, so tests can
 * stand in for it): the owner's token stays on the server and nothing but
 * the parsed tool names and notes leaves this module. The fan-out is bounded
 * in repositories, concurrency, time per request and bytes per file.
 */

const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_FILE_CHARACTERS = 256 * 1024;
const REPOSITORY_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export type GitHubFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type StackProject = {
  id: string;
  name: string;
  repo_full_name: string | null;
  parent_id: string | null;
};

type FileRead =
  | { kind: "ok"; text: string }
  | { kind: "not-found" }
  | { kind: "disconnected" }
  | { kind: "error" };

async function readRepoText(fetcher: GitHubFetch, repo: string, path: string): Promise<FileRead> {
  try {
    const response = await fetcher(`/repos/${repo}/contents/${path}`, {
      headers: { Accept: "application/vnd.github.raw+json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401) return { kind: "disconnected" };
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "error" };
    return { kind: "ok", text: (await response.text()).slice(0, MAX_FILE_CHARACTERS) };
  } catch {
    return { kind: "error" };
  }
}

/** Whether GitHub shows the repository to this token at all. */
async function repositoryVisible(fetcher: GitHubFetch, repo: string): Promise<boolean | null> {
  try {
    const response = await fetcher(`/repos/${repo}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.ok) return true;
    if (response.status === 404 || response.status === 403) return false;
    return null;
  } catch {
    return null;
  }
}

type RepoRead =
  | { status: "ok"; source: StackSource; entries: StackEntry[] }
  | { status: "empty"; source: StackSource }
  | { status: "not-found" | "unreadable" | "error" | "disconnected" };

/**
 * about-project.md first; the root package.json when that file is missing,
 * has neither stack section, or lists nothing in the `Name — what it does`
 * form.
 */
async function readRepoStack(fetcher: GitHubFetch, repo: string): Promise<RepoRead> {
  const about = await readRepoText(fetcher, repo, ABOUT_PROJECT_FILE);
  if (about.kind === "disconnected") return { status: "disconnected" };
  if (about.kind === "ok") {
    const parsed = parseAboutProjectStack(about.text);
    if (parsed.entries.length > 0) return { status: "ok", source: "about-project", entries: parsed.entries };
  }
  const manifest = await readRepoText(fetcher, repo, "package.json");
  if (manifest.kind === "disconnected") return { status: "disconnected" };
  if (manifest.kind === "ok") {
    const entries = parsePackageJsonStack(manifest.text) ?? [];
    if (entries.length > 0) return { status: "ok", source: "package-json", entries };
    return { status: "empty", source: about.kind === "ok" ? "about-project" : "package-json" };
  }
  if (about.kind === "ok") return { status: "empty", source: "about-project" };
  if (about.kind === "error" || manifest.kind === "error") return { status: "error" };
  // Both files answered 404: a missing file, or a repository GitHub will not show.
  const visible = await repositoryVisible(fetcher, repo);
  if (visible === null) return { status: "error" };
  return { status: visible ? "not-found" : "unreadable" };
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The detected tools of the given active projects, in their order, with one
 * status per project. A subsection without a repository of its own (Design
 * Lab, GoVIRAL) is covered by its parent's repository when the parent is
 * active too.
 */
export async function detectProjectStacks(
  projects: readonly StackProject[],
  fetcher: GitHubFetch,
  checkedAt = new Date().toISOString(),
): Promise<DetectedToolsResponse> {
  const withRepo = projects.filter((project) => project.repo_full_name);
  const targets = withRepo.slice(0, MAX_DETECTED_REPOSITORIES);
  const reads = await mapWithConcurrency(targets, CONCURRENCY, (project) =>
    REPOSITORY_RE.test(project.repo_full_name!)
      ? readRepoStack(fetcher, project.repo_full_name!)
      : Promise.resolve<RepoRead>({ status: "unreadable" }),
  );
  const readById = new Map(targets.map((project, index) => [project.id, reads[index]!]));
  const byId = new Map(projects.map((project) => [project.id, project]));

  if (reads.some((read) => read.status === "disconnected")) {
    return { connected: false, checkedAt, projects: [], tools: [] };
  }

  const stacks: ProjectStack[] = [];
  const statuses: ProjectStackStatus[] = projects.map((project) => {
    const base = { projectId: project.id, projectName: project.name, repo: project.repo_full_name };
    if (!project.repo_full_name) {
      const parent = project.parent_id ? byId.get(project.parent_id) : undefined;
      if (parent && readById.has(parent.id)) {
        return { ...base, status: "inherited", source: null, toolCount: 0, parentName: parent.name };
      }
      return { ...base, status: "no-repository", source: null, toolCount: 0 };
    }
    const read = readById.get(project.id);
    if (!read) return { ...base, status: "skipped", source: null, toolCount: 0 };
    if (read.status === "ok") {
      stacks.push({ project: { id: project.id, name: project.name }, source: read.source, entries: read.entries });
      return { ...base, status: "ok", source: read.source, toolCount: new Set(read.entries.map((entry) => entry.key)).size };
    }
    if (read.status === "empty") return { ...base, status: "empty", source: read.source, toolCount: 0 };
    return { ...base, status: read.status === "disconnected" ? "error" : read.status, source: null, toolCount: 0 };
  });

  return { connected: true, checkedAt, projects: statuses, tools: mergeDetectedTools(stacks) };
}
