import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchJson, makeItem } from "./util";

interface HnItem {
  id?: number;
  title?: string;
  url?: string;
  text?: string;
  by?: string;
  time?: number;
  type?: string;
  dead?: boolean;
  deleted?: boolean;
}

export function projectHnItem(
  item: HnItem,
  source: SourceConfig,
  now: Date
): SourceItem | null {
  if (
    !item.id ||
    !item.title ||
    item.type !== "story" ||
    item.dead ||
    item.deleted
  ) {
    return null;
  }
  return makeItem(
    item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
    {
      title: item.title,
      summary: item.text,
      publishedAt: item.time ? item.time * 1_000 : undefined,
      author: item.by,
      externalId: String(item.id)
    },
    source,
    now
  );
}

export async function fetchHn(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  const allIds = await fetchJson<unknown[]>(source.url, context);
  if (allIds.length > source.maxItems) context.reportIssue?.("upstream-cap");
  const ids = allIds
    .filter((value): value is number => Number.isInteger(value))
    .slice(0, source.maxItems);
  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        const url = new URL(`item/${id}.json`, source.url).toString();
        return projectHnItem(await fetchJson<HnItem>(url, context), source, context.now);
      } catch {
        context.reportIssue?.("fetch-failed");
        return null;
      }
    })
  );
  return items.filter((item): item is SourceItem => item !== null);
}
