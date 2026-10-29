import "server-only";
import { readTextPrefix } from "@/lib/bounded-text";
import { awaitWithSignal } from "@/lib/abortable";
import { BoundedStreamError, boundedStreamBytes } from "@/lib/bounded-response";
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

export type FileRead =
  | { kind: "ok"; text: string; truncated: boolean }
  | { kind: "not-found" }
  | { kind: "disconnected" }
  | { kind: "error"; status: number | null; reason?: "invalid-encoding" };

const discard = (response?: Response) => {
  if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
};
async function repositoryResponse(fetcher: GitHubFetch, path: string, signal: AbortSignal, headers?: HeadersInit) {
  signal.throwIfAborted();
  const pending = fetcher(path, { signal, ...(headers ? { headers } : {}) });
  void pending.then(response => { if (signal.aborted) discard(response); }, () => undefined);
  const response = await awaitWithSignal(pending, signal);
  if (signal.aborted) { discard(response); signal.throwIfAborted(); }
  return response;
}
/**
 * One text file from a repository's default branch, cut to `maxCharacters`
 * (the cut is reported, so a caller that needs the whole file can refuse it).
 */
export async function readRepoText(
  fetcher: GitHubFetch,
  repo: string,
  path: string,
  maxCharacters = MAX_FILE_CHARACTERS,
  options: { signal?: AbortSignal; /** Whole-file consumers may additionally require an actual-byte ceiling and strict UTF-8. */ maxBytes?: number } = {},
): Promise<FileRead> {
  const retirement = new AbortController();
  const signal = AbortSignal.any([retirement.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]);
  let response: Response | undefined;
  try {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1))) throw new Error();
    response = await repositoryResponse(fetcher, `/repos/${repo}/contents/${path}`, signal, { Accept: "application/vnd.github.raw+json" });
    if (response.status === 401) return { kind: "disconnected" };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status !== 200) return { kind: "error", status: response.status };
    if (options.maxBytes !== undefined) {
      const declared = response.headers.get('content-length');
      if (declared !== null && !/^\d+$/.test(declared)) throw new Error();
      if (declared !== null && Number(declared) > options.maxBytes) return { kind: 'ok', text: '', truncated: true };
      const bytes = response.body ? await boundedStreamBytes(response.body, options.maxBytes, signal) : new Uint8Array();
      signal.throwIfAborted();
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { return { kind: 'error', status: null, reason: 'invalid-encoding' }; }
      return { kind: 'ok', text: text.slice(0, maxCharacters), truncated: text.length > maxCharacters };
    }
    const value = await readTextPrefix(response, maxCharacters, signal); signal.throwIfAborted();
    return { kind: "ok", ...value };
  } catch (error) {
    if (!signal.aborted && error instanceof BoundedStreamError && error.reason === 'size') return { kind: 'ok', text: '', truncated: true };
    return { kind: "error", status: null };
  } finally { discard(response); retirement.abort(); }
}

/** Whether GitHub shows the repository to this token at all. Bodies are unused. */
export async function repositoryVisible(fetcher: GitHubFetch, repo: string, parent?: AbortSignal): Promise<boolean | null> {
  const retirement = new AbortController();
  const signal = AbortSignal.any([retirement.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(parent ? [parent] : [])]);
  let response: Response | undefined;
  try {
    response = await repositoryResponse(fetcher, `/repos/${repo}`, signal);
    if (response.status === 200) return true;
    if (response.status === 404 || response.status === 403) return false;
    return null;
  } catch { return null; }
  finally { discard(response); retirement.abort(); }
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
  if (about.kind === "ok" && about.truncated) return { status: "error" };
  if (about.kind === "ok") {
    const parsed = parseAboutProjectStack(about.text);
    if (parsed.entries.length > 0) return { status: "ok", source: "about-project", entries: parsed.entries };
  }
  const manifest = await readRepoText(fetcher, repo, "package.json");
  if (manifest.kind === "disconnected") return { status: "disconnected" };
  if (manifest.kind === "ok" && manifest.truncated) return { status: "error" };
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

export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid concurrency limit');
  const check = () => { if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError'); };
  check();
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      check();
      const index = next;
      next += 1;
      results[index] = signal ? await awaitWithSignal(work(items[index]!), signal) : await work(items[index]!);
      check();
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
