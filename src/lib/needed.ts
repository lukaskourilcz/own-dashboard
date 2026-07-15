import type { GithubRepo } from "@/lib/github";

/** The file each repo exposes its open action-items in, read from the root. */
export const NEEDED_FILE = "NEEDED.md";

export type NeededItem = {
  key: string;
  repoId: string;
  owner: string;
  repo: string;
  htmlUrl: string | null;
  text: string;
  /** The exact source line, so we can remove precisely on check-off. */
  raw: string;
};

// A markdown list item: bullet or ordered, optional task-checkbox. Items already
// ticked (`- [x]`) are treated as done and skipped — only open work surfaces.
const ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+(\[([ xX])\]\s+)?(.+?)\s*$/;

/** Parse a NEEDED.md into open action items — one per open markdown list line. */
export function parseNeeded(
  content: string,
  repo: GithubRepo,
  htmlUrl: string | null,
): NeededItem[] {
  const items: NeededItem[] = [];
  const seen = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const m = ITEM_RE.exec(raw);
    if (!m) continue;
    const checkbox = m[2];
    if (checkbox && checkbox.toLowerCase() === "x") continue; // already done
    const text = m[3].trim();
    if (!text) continue;
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
