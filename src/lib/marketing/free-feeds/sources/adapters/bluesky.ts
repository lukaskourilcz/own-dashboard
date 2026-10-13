import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchJson, makeItem } from "./util";

interface BlueskyPost {
  uri: string;
  author?: { handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string };
  indexedAt?: string;
}

interface BlueskyResponse {
  posts?: BlueskyPost[];
}

function postUrl(post: BlueskyPost): string | null {
  const handle = post.author?.handle;
  const rkey = post.uri.split("/").at(-1);
  return handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : null;
}

export function projectBluesky(
  data: BlueskyResponse,
  source: SourceConfig,
  now: Date
): SourceItem[] {
  return (data.posts ?? []).flatMap((post) => {
    const text = post.record?.text?.trim();
    const url = postUrl(post);
    if (!text || !url) return [];
    const firstLine = text.split("\n")[0]?.trim() ?? text;
    const item = makeItem(
      url,
      {
        title: firstLine.length > 140 ? `${firstLine.slice(0, 139)}…` : firstLine,
        summary: text,
        publishedAt: post.record?.createdAt ?? post.indexedAt,
        author: post.author?.displayName ?? post.author?.handle,
        externalId: post.uri
      },
      source,
      now
    );
    return item ? [item] : [];
  });
}

export async function fetchBluesky(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  const url = new URL(source.url);
  url.searchParams.set("q", source.query ?? "language model");
  url.searchParams.set("sort", "top");
  url.searchParams.set("limit", String(source.maxItems));
  const data = await fetchJson<BlueskyResponse>(url.toString(), context);
  if ((data.posts?.length ?? 0) >= source.maxItems) context.reportIssue?.("upstream-cap");
  return projectBluesky(data, source, context.now);
}
