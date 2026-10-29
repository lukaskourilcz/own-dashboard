import "server-only";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import type { createGoogleFetcher } from "@/lib/google-token";

export class CalendarReadError extends Error {
  constructor(readonly reason: "no-token" | "unauthorized" | "error" = "error") { super("Calendar read unavailable"); }
}
export type CalendarReadBudget = { pages: number; items: number; characters: number };

/** Shared limits cover every selected calendar, not a fresh allowance per page. */
export async function readGooglePages<T>(
  fetcher: ReturnType<typeof createGoogleFetcher>, base: URL,
  parse: (value: unknown) => { items: T[]; nextPageToken?: string },
  signal: AbortSignal, budget: CalendarReadBudget,
): Promise<T[]> {
  const items: T[] = [], tokens = new Set<string>();
  let token: string | undefined;
  for (;;) {
    signal.throwIfAborted();
    if (--budget.pages < 0) throw new CalendarReadError();
    const url = new URL(base);
    if (token) url.searchParams.set("pageToken", token);
    const response = await awaitWithSignal(fetcher(url.href, { signal, cache: "no-store" }), signal);
    if (!response.ok) {
      if (response.body) void response.body.cancel().catch(() => undefined);
      throw new CalendarReadError(response.status === 401 ? response.statusText === "no-token" ? "no-token" : "unauthorized" : "error");
    }
    const prefix = await awaitWithSignal(readTextPrefix(response, Math.min(1_048_576, Math.max(1, budget.characters)), signal), signal);
    budget.characters -= prefix.text.length;
    if (prefix.truncated || budget.characters < 0) throw new CalendarReadError();
    const page = parse(JSON.parse(prefix.text));
    budget.items -= page.items.length;
    if (budget.items < 0) throw new CalendarReadError();
    items.push(...page.items);
    if (!page.nextPageToken) return items;
    if (tokens.has(page.nextPageToken)) throw new CalendarReadError();
    tokens.add(page.nextPageToken); token = page.nextPageToken;
  }
}
