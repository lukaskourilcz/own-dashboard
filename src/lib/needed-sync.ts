import { addDays, format } from "date-fns";
import type { GithubRepo } from "./github";
import { neededTodoItems } from "./needed";
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
