import type { GithubRepo } from "@/lib/github";
import { isTaskKind, parseTimeToMinutes, type TaskKind } from "@/lib/task-meta";

/** The file each repo exposes its open action-items in, read from the root. */
export const NEEDED_FILE = "NEEDED.md";

/** Who a task is for: the user ("me") or something Claude/AI can do ("ai"). */
export type Assignee = "me" | "ai";

export type NeededItem = {
  key: string;
  repoId: string;
  owner: string;
  repo: string;
  htmlUrl: string | null;
  text: string;
  /** The exact source line, so we can remove precisely on check-off. */
  raw: string;
  /** Importance 1–5 (5 = highest) parsed from an `[imp:N]` marker, else null. */
  importance: number | null;
  /** Who does it, from an `[owner:me]` / `[owner:ai]` marker, else null. */
  assignee: Assignee | null;
  /** Estimated minutes from a `[time:N]` marker (accepts 30/30m/2h/1h30m). */
  estimatedMinutes: number | null;
  /** Work kind from a `[kind:…]` marker, one of TASK_KINDS, else null. */
  kind: TaskKind | null;
};

// A markdown list item: bullet or ordered, optional task-checkbox. Items already
// ticked (`- [x]`) are treated as done and skipped — only open work surfaces.
const ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+(\[([ xX])\]\s+)?(.+?)\s*$/;

// An importance marker, e.g. `[imp:4]` (optionally wrapped in backticks). One
// per task line; 1–5, 5 = highest. Stripped from the visible title on parse.
const IMPORTANCE_RE = /`?\[imp:([1-5])\]`?/i;

// An owner marker, e.g. `[owner:ai]` (optionally in backticks): who does the
// task — "me" (the user) or "ai" (Claude can do it). Stripped from the title.
const ASSIGNEE_RE = /`?\[owner:(me|ai)\]`?/i;

// A time-estimate marker, e.g. `[time:30m]` / `[time:2h]` / `[time:90]`. The
// value is parsed to whole minutes. One per task line; stripped from the title.
const TIME_RE = /`?\[time:([^\]]+)\]`?/i;

// A work-kind marker, e.g. `[kind:setup]`. One of the five TASK_KINDS. Stripped
// from the visible title on parse (the kind is captured separately).
const KIND_RE = /`?\[kind:(setup|deploy|legal|content|decision)\]`?/i;

/** Pull the `[imp:N]` marker out of a task line, returning the score (or null)
 * and the line text with the marker removed. */
export function extractImportance(text: string): {
  importance: number | null;
  text: string;
} {
  const m = IMPORTANCE_RE.exec(text);
  if (!m) return { importance: null, text };
  const importance = Number(m[1]);
  const stripped = text.replace(IMPORTANCE_RE, "").replace(/\s{2,}/g, " ").trim();
  return { importance, text: stripped };
}

/** The `[owner:me|ai]` marker in a line, or null if absent. Used both on parse
 * and to derive a stored task's assignee from its `needed_raw` line. */
export function extractAssignee(text: string | null | undefined): Assignee | null {
  if (!text) return null;
  const m = ASSIGNEE_RE.exec(text);
  return m ? (m[1].toLowerCase() as Assignee) : null;
}

/** A stored task's effective assignee: the `[owner:…]` marker on its NEEDED.md
 * line, or "me" for hand-added tasks (no source line = the user's own work).
 * Returns null for a GitHub task whose line carries no owner marker. */
export function assigneeForTodo(
  neededRaw: string | null | undefined,
): Assignee | null {
  const who = extractAssignee(neededRaw);
  if (who) return who;
  return neededRaw ? null : "me";
}

/** Pull the `[time:…]` marker out of a task line, returning whole minutes (or
 * null) and the line text with the marker removed. */
export function extractTime(text: string): {
  minutes: number | null;
  text: string;
} {
  const m = TIME_RE.exec(text);
  if (!m) return { minutes: null, text };
  const minutes = parseTimeToMinutes(m[1]);
  const stripped = text.replace(TIME_RE, "").replace(/\s{2,}/g, " ").trim();
  return { minutes, text: stripped };
}

/** The `[kind:…]` marker in a line, or null if absent/invalid. */
export function extractKind(text: string | null | undefined): TaskKind | null {
  if (!text) return null;
  const m = KIND_RE.exec(text);
  const value = m?.[1]?.toLowerCase();
  return value && isTaskKind(value) ? value : null;
}

/** Parse a NEEDED.md into open action items — one per open markdown list line. */
export function parseNeeded(
  content: string,
  repo: GithubRepo,
  htmlUrl: string | null,
): NeededItem[] {
  const items: NeededItem[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m = ITEM_RE.exec(raw);
    if (!m) continue;
    const checkbox = m[2];
    if (checkbox && checkbox.toLowerCase() === "x") continue; // already done
    const impParsed = extractImportance(m[3].trim());
    const timeParsed = extractTime(impParsed.text);
    // Strip the owner and kind markers from the visible title too (both are
    // captured separately; assignee is also re-derived from `needed_raw`).
    const text = timeParsed.text
      .replace(ASSIGNEE_RE, "")
      .replace(KIND_RE, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    let importance = impParsed.importance;
    let minutes = timeParsed.minutes;
    let assignee = extractAssignee(m[3]);
    let kind = extractKind(m[3]);
    if (!text) continue;
    // A task can wrap onto indented continuation lines; if any of its markers
    // sit on one of them, adopt it (needed_raw stays the item's own line, so
    // completion-removal still targets a single line).
    if (
      importance === null ||
      assignee === null ||
      minutes === null ||
      kind === null
    ) {
      for (let j = i + 1; j < lines.length; j++) {
        const cont = lines[j];
        if (cont.trim() === "") break; // blank line ends the item
        if (ITEM_RE.test(cont)) break; // the next list item
        if (!/^\s+\S/.test(cont)) break; // non-indented → not a continuation
        if (importance === null) {
          const found = extractImportance(cont);
          if (found.importance !== null) importance = found.importance;
        }
        if (minutes === null) {
          const found = extractTime(cont);
          if (found.minutes !== null) minutes = found.minutes;
        }
        if (assignee === null) assignee = extractAssignee(cont);
        if (kind === null) kind = extractKind(cont);
        if (
          importance !== null &&
          assignee !== null &&
          minutes !== null &&
          kind !== null
        ) {
          break;
        }
      }
    }
    // De-dupe identical lines within one file so the key stays unique.
    let key = `${repo.id}:${text.toLowerCase()}`;
    let n = 1;
    while (seen.has(key)) key = `${repo.id}:${text.toLowerCase()}:${n++}`;
    seen.add(key);
    items.push({
      key,
      repoId: String(repo.id),
      owner: repo.owner,
      repo: repo.name,
      htmlUrl,
      text,
      raw,
      importance,
      assignee,
      estimatedMinutes: minutes,
      kind,
    });
  }
  return items;
}

/** Light markdown → plain text for a task title: unwrap links, bold and code,
 * drop trailing "→ §x.y" cross-refs, collapse whitespace. */
export function cleanNeededText(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
    .replace(/`([^`]+)`/g, "$1") // `code` → code
    .replace(/\[imp:[1-5]\]/gi, "") // any stray importance marker
    .replace(/\[owner:(?:me|ai)\]/gi, "") // any stray owner marker
    .replace(/\[time:[^\]]+\]/gi, "") // any stray time marker
    .replace(/\[kind:(?:setup|deploy|legal|content|decision)\]/gi, "") // stray kind
    .replace(/\s*→\s*§[\w.]+\s*$/, "") // trailing "→ §0.2"
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The items to import as todos. Prefers explicit task checkboxes (`- [ ]`) when
 * a file uses them — that's the file's real action list — and otherwise falls
 * back to every open list item (same as the on-screen checklist). Titles are
 * cleaned of markdown.
 */
export function neededTodoItems(
  content: string,
  repo: GithubRepo,
  htmlUrl: string | null,
): NeededItem[] {
  const all = parseNeeded(content, repo, htmlUrl);
  const CHECKBOX_RE = /^\s*(?:[-*+]|\d+\.)\s+\[[ xX]?\]/;
  const usesCheckboxes = all.some((it) => CHECKBOX_RE.test(it.raw));
  const chosen = usesCheckboxes
    ? all.filter((it) => CHECKBOX_RE.test(it.raw))
    : all;
  return chosen.map((it) => ({ ...it, text: cleanNeededText(it.text) }));
}

/** Remove the first line exactly equal to `raw` from `content`. Returns the new
 * content plus whether a line was removed (false = it was already gone). */
export function removeNeededLine(
  content: string,
  raw: string,
): { next: string; removed: boolean } {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => l === raw);
  if (idx === -1) return { next: content, removed: false };
  lines.splice(idx, 1);
  return { next: lines.join("\n"), removed: true };
}
