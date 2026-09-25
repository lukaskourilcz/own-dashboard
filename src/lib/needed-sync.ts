import { addDays, format } from "date-fns";
import type { CommitOutcome, GithubRepo } from "./github";
import {
  loadNeededFile,
  neededTodoItems,
  removeNeededLine,
  type NeededFileResult,
  type NeededFilePath,
} from "./needed";
import type { TaskKind } from "./task-meta";
import type { Todo } from "./types";

/**
 * Turning a repo's NEEDED.md into rich task "cards" and keeping them in sync.
 *
 * A NEEDED task carries the full context needed to (a) render a per-repo card
 * with a 7-day timer, (b) refresh so only lines still present in NEEDED.md
 * survive, and (c) once finished, commit its removal from the source file.
 */

/** Every generated task gets this many days before it's due. */
export const TASK_TIMER_DAYS = 7;

/** The insert shape for a NEEDED-sourced task (before the DB fills id/created). */
export type NeededTodoRow = {
  user_id: string;
  title: string;
  category: string;
  done: boolean;
  source: "github";
  repo_id: string;
  repo_full_name: string;
  repo_owner: string;
  repo_name: string;
  repo_url: string;
  needed_raw: string;
  generated_at: string;
  due_date: string;
  /** Importance 1–5 (5 = highest) from the task's `[imp:N]` marker, else null. */
  importance: number | null;
  /** Estimated minutes from the task's `[time:N]` marker, else null. */
  estimated_minutes: number | null;
  /** Work kind from the task's `[kind:…]` marker, else null. */
  task_kind: TaskKind | null;
};

/** Due date (date-only, yyyy-MM-dd) for a task generated at `generatedIso`. */
export function dueDateFromGenerated(generatedIso: string): string {
  return format(addDays(new Date(generatedIso), TASK_TIMER_DAYS), "yyyy-MM-dd");
}

/**
 * Identity of a task within its repo. Prefer the exact source line (stable even
 * if the cleaned title changes); fall back to the title for legacy rows that
 * predate `needed_raw`.
 */
export function neededKey(
  repoId: string | null,
  raw: string | null,
  title: string,
): string {
  return `${repoId ?? ""}::${raw ?? title.trim().toLowerCase()}`;
}

/**
 * Build the candidate task rows for one repo from its NEEDED.md content. Each
 * open item becomes a card row; the 7-day timer starts at `nowIso`.
 */
export function buildNeededRows(
  userId: string,
  repo: GithubRepo,
  content: string,
  htmlUrl: string | null,
  nowIso: string,
): NeededTodoRow[] {
  const items = neededTodoItems(content, repo, htmlUrl);
  const dueDate = dueDateFromGenerated(nowIso);
  return items.map((it) => ({
    user_id: userId,
    title: it.text.slice(0, 500),
    category: repo.name,
    done: false,
    source: "github",
    repo_id: String(repo.id),
    repo_full_name: repo.full_name,
    repo_owner: repo.owner,
    repo_name: repo.name,
    repo_url: htmlUrl ?? repo.html_url,
    needed_raw: it.raw,
    generated_at: nowIso,
    due_date: dueDate,
    importance: it.importance,
    estimated_minutes: it.estimatedMinutes,
    task_kind: it.kind,
  }));
}

/**
 * Diff freshly-scanned NEEDED rows against the existing todos for the SAME set
 * of repos, returning what to insert and which open github tasks to delete
 * (their source line vanished from NEEDED.md — implemented or removed).
 *
 * Only tasks whose repo was actually scanned are eligible for deletion, so a
 * repo that failed to load never loses its tasks. Finished (done) tasks are
 * left untouched — they live on in "Finished" until explicitly cleared.
 */
export function diffNeededTodos(
  scannedRepoIds: Set<string>,
  freshRows: NeededTodoRow[],
  existing: Todo[],
): { toInsert: NeededTodoRow[]; toDeleteIds: string[] } {
  const freshKeys = new Set(
    freshRows.map((r) => neededKey(r.repo_id, r.needed_raw, r.title)),
  );

  // Existing github tasks in the scanned repos, indexed by identity.
  const existingKeys = new Set<string>();
  const toDeleteIds: string[] = [];
  for (const td of existing) {
    if (td.source !== "github") continue;
    if (!td.repo_id || !scannedRepoIds.has(td.repo_id)) continue;
    const key = neededKey(td.repo_id, td.needed_raw, td.title);
    existingKeys.add(key);
    // An OPEN task no longer backed by a NEEDED.md line is stale — drop it.
    if (!td.done && !freshKeys.has(key)) toDeleteIds.push(td.id);
  }

  const toInsert = freshRows.filter(
    (r) => !existingKeys.has(neededKey(r.repo_id, r.needed_raw, r.title)),
  );

  return { toInsert, toDeleteIds };
}

/** Reads one repository's NEEDED.md; `loadNeededFile` in the app. */
export type NeededFileLoader = (
  owner: string,
  repo: string,
) => Promise<NeededFileResult>;

/** What a Refresh learned from every repository's NEEDED.md. */
export type NeededScan = {
  /** Repositories whose file was read. Only their open tasks may be dropped. */
  scanned: Set<string>;
  /** Candidate task rows from every file that was read. */
  freshRows: NeededTodoRow[];
  /** Repositories with no NEEDED.md at any known path. Their tasks are kept. */
  missing: string[];
};

/**
 * Read every repository's NEEDED.md for a Refresh. A repository joins
 * `scanned`, and so becomes eligible for stale-task cleanup, only when its
 * file was actually read. A file found at no path is unavailable, not empty:
 * treating a 404 as "no open tasks" is how a Refresh once deleted every open
 * quorum task after quorum moved its list to docs/. A transient error skips
 * the repository the same way. A disconnected token aborts the whole scan.
 */
export async function scanNeededRepos(
  userId: string,
  repos: GithubRepo[],
  nowIso: string,
  load: NeededFileLoader = loadNeededFile,
): Promise<NeededScan> {
  const scanned = new Set<string>();
  const freshRows: NeededTodoRow[] = [];
  const missing: string[] = [];
  for (const repo of repos) {
    const res = await load(repo.owner, repo.name);
    if (res.kind === "disconnected") throw new Error("disconnected");
    if (res.kind === "ok") {
      scanned.add(String(repo.id));
      freshRows.push(
        ...buildNeededRows(userId, repo, res.content, res.htmlUrl, nowIso),
      );
    } else if (res.kind === "not-found") {
      missing.push(repo.full_name);
    }
  }
  return { scanned, freshRows, missing };
}

/** Commits new NEEDED.md content; `commitFile` in the app. */
export type NeededCommit = (input: {
  owner: string;
  repo: string;
  path: NeededFilePath;
  content: string;
  count: number;
}) => Promise<CommitOutcome>;

/** What "Delete from NEEDED.md" did. */
export type FinishedRemoval = {
  /** Finished rows that may now be deleted. */
  cleared: string[];
  /** Repositories with no NEEDED.md at any known path. Their finished rows
   *  are in `cleared` too: the lines left with the file, so nothing was
   *  committed there. */
  missing: string[];
};

/**
 * Remove finished GitHub tasks' lines from their repositories' NEEDED.md (one
 * commit per repository, to the path the file was found at) and report the
 * rows that may now be deleted. A repository whose file cannot be read right
 * now, or whose commit fails, keeps its rows, so the action can be retried and
 * no line survives in a file the dashboard still tracks. A repository with no
 * file at any known path has nothing left to edit: its finished rows are
 * cleared and it is named in `missing`, so the owner learns why no commit
 * happened. A disconnected token aborts with Error("disconnected").
 */
export async function removeFinishedFromNeeded(
  todos: Todo[],
  commit: NeededCommit,
  load: NeededFileLoader = loadNeededFile,
): Promise<FinishedRemoval> {
  const byRepo = new Map<string, Todo[]>();
  for (const td of todos) {
    if (
      !td.done ||
      td.source !== "github" ||
      !td.needed_raw ||
      !td.repo_owner ||
      !td.repo_name
    ) {
      continue;
    }
    const key = td.repo_id ?? `${td.repo_owner}/${td.repo_name}`;
    const group = byRepo.get(key);
    if (group) group.push(td);
    else byRepo.set(key, [td]);
  }

  const cleared: string[] = [];
  const missing: string[] = [];
  for (const tasks of byRepo.values()) {
    const owner = tasks[0].repo_owner!;
    const name = tasks[0].repo_name!;
    const res = await load(owner, name);
    if (res.kind === "disconnected") throw new Error("disconnected");
    if (res.kind === "not-found") {
      missing.push(`${owner}/${name}`);
      cleared.push(...tasks.map((td) => td.id));
      continue;
    }
    if (res.kind !== "ok") continue;

    let content = res.content;
    for (const td of tasks) {
      const { next, removed } = removeNeededLine(content, td.needed_raw!);
      if (removed) content = next;
    }
    if (content !== res.content) {
      const outcome = await commit({
        owner,
        repo: name,
        path: res.path,
        content,
        count: tasks.length,
      });
      if (!outcome.ok) {
        if (outcome.status === 401) throw new Error("disconnected");
        continue;
      }
    }
    cleared.push(...tasks.map((td) => td.id));
  }
  return { cleared, missing };
}
