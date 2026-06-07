/**
 * Walk a BlockNote document (the JSON shape we persist as `notes.content`)
 * and flatten to a single newline-joined plain-text string. Used both for
 * the in-app substring search and as the source for Postgres' tsvector
 * index (`notes.search_tsv` is generated from title + plain_text).
 *
 * Stored opaquely as `unknown` in our row type, so the walker is defensive
 * about shapes — it returns "" for anything that doesn't look like a
 * BlockNote block.
 */
export function blocksToPlainText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) walkBlock(block, parts);
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function walkBlock(block: unknown, out: string[]): void {
  if (!block || typeof block !== "object") return;
  const b = block as { content?: unknown; children?: unknown };
  const line: string[] = [];
  walkInline(b.content, line);
  if (line.length > 0) out.push(line.join(""));
  if (Array.isArray(b.children)) {
    for (const child of b.children) walkBlock(child, out);
  }
}

function walkInline(content: unknown, out: string[]): void {
  if (typeof content === "string") {
    out.push(content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const piece of content) {
    if (!piece || typeof piece !== "object") continue;
    const p = piece as { text?: unknown; content?: unknown };
    if (typeof p.text === "string") out.push(p.text);
    else if (Array.isArray(p.content)) walkInline(p.content, out);
  }
}
