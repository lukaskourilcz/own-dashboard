import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchJson, makeItem } from "./util";

interface StackExchangeResponse {
  has_more?: boolean;
  items?: Array<{
    question_id?: number;
    title?: string;
    link?: string;
    body?: string;
    creation_date?: number;
    owner?: { display_name?: string };
  }>;
}

export function projectQuestions(
  data: StackExchangeResponse,
  source: SourceConfig,
  now: Date
): SourceItem[] {
  return (data.items ?? []).flatMap((question) => {
    if (!question.link) return [];
    const item = makeItem(
      question.link,
      {
        title: question.title,
        summary: question.body,
        publishedAt: question.creation_date ? question.creation_date * 1_000 : undefined,
        author: question.owner?.display_name,
        externalId: question.question_id ? String(question.question_id) : undefined
      },
      source,
      now
    );
    return item ? [item] : [];
  });
}

export async function fetchStackExchange(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  const url = new URL(source.url);
  url.searchParams.set("order", "desc");
  url.searchParams.set("sort", "activity");
  url.searchParams.set("tagged", source.query ?? "machine-learning");
  url.searchParams.set("site", source.site ?? "stackoverflow");
  url.searchParams.set("pagesize", String(source.maxItems));
  url.searchParams.set("filter", "withbody");
  const data = await fetchJson<StackExchangeResponse>(url.toString(), context);
  if ((data.items?.length ?? 0) >= source.maxItems || data.has_more === true) context.reportIssue?.("upstream-cap");
  return projectQuestions(data, source, context.now);
}
