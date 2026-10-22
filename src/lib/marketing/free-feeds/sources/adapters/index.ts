import { fetchArxiv } from "./arxiv";
import { fetchBluesky } from "./bluesky";
import { fetchGithub } from "./github";
import { fetchHn } from "./hn";
import { fetchHnSearch } from "./hnsearch";
import { fetchHtml } from "./html";
import { fetchRss } from "./rss";
import { fetchSpaceflight } from "./spaceflight";
import { fetchStackExchange } from "./stackexchange";
import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";

export async function fetchSource(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  switch (source.kind) {
    case "arxiv":
      return fetchArxiv(source, context);
    case "bluesky":
      return fetchBluesky(source, context);
    case "github":
      return fetchGithub(source, context);
    case "hn":
      return fetchHn(source, context);
    case "hnsearch":
      return fetchHnSearch(source, context);
    case "html":
      return fetchHtml(source, context);
    case "rss":
      return fetchRss(source, context);
    case "spaceflight":
      return fetchSpaceflight(source, context);
    case "stackexchange":
      return fetchStackExchange(source, context);
  }
}
