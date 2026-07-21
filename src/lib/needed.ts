import type { GithubRepo } from "@/lib/github";

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
    const parsed = extractImportance(m[3].trim());
    // Strip the owner marker from the visible title too (assignee is captured
    // separately, below, and re-derived from `needed_raw` when filtering).
    const text = parsed.text.replace(ASSIGNEE_RE, "").replace(/\s{2,}/g, " ").trim();
    let importance = parsed.importance;
    let assignee = extractAssignee(m[3]);
    if (!text) continue;
    // A task can wrap onto indented continuation lines; if its `[imp:N]` /
    // `[owner:…]` marker sits on one of them, adopt it (needed_raw stays the
    // item's own line, so completion-removal still targets a single line).
    if (importance === null || assignee === null) {
      for (let j = i + 1; j < lines.length; j++) {
        const cont = lines[j];
        if (cont.trim() === "") break; // blank line ends the item
        if (ITEM_RE.test(cont)) break; // the next list item
        if (!/^\s+\S/.test(cont)) break; // non-indented → not a continuation
        if (importance === null) {
          const found = extractImportance(cont);
          if (found.importance !== null) importance = found.importance;
        }
        if (assignee === null) assignee = extractAssignee(cont);
        if (importance !== null && assignee !== null) break;
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
