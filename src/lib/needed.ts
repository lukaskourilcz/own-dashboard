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
