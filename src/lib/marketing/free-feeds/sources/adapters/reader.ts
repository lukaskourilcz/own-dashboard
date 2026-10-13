import type { SourceFetchContext } from "../types";

export async function fetchReadable(_url: string, context: SourceFetchContext): Promise<null> {
  context.reportIssue?.("reader-disabled");
  return null;
}

export function linksFromMarkdown(
  markdown: string,
  max = 25
): Array<{ title: string; url: string }> {
  const pattern = /\[([^\]]{8,})\]\((https:\/\/[^)\s]+)\)/g;
  const seen = new Set<string>();
  const links: Array<{ title: string; url: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) && links.length < max) {
    const title = match[1]?.replace(/\s+/g, " ").trim();
    const url = match[2];
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    links.push({ title, url });
  }
  return links;
}
