import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { recordMarketingOwnerFeedback } from "@/lib/marketing/owner-feedback";
import type { MarketingOwnerFeedbackScope } from "@/lib/marketing/owner-feedback";
vi.mock("server-only", () => ({}));
const read = vi.hoisted(() => vi.fn());
vi.mock("langsmith", () => ({ Client: class { readRun = read; } }));
const owner = "11111111-1111-4111-8111-111111111111";
const input = { traceId: "55555555-5555-4555-8555-555555555555", revisionId: "44444444-4444-4444-8444-444444444444", revisionHash: "a".repeat(64), decision: "approved" as const };
const env = { MARKETING_LANGSMITH_ENABLED: "true", LANGSMITH_ENDPOINT: "https://eu.api.smith.langchain.com", LANGSMITH_API_KEY: "TEST ONLY", LANGSMITH_PROJECT: "test-only" };
function db(fetcher: typeof fetch) {
  return createClient("https://example.supabase.co", "test-only-anon", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } }) as unknown as MarketingOwnerFeedbackScope["db"];
}
beforeEach(() => read.mockReset());
afterEach(() => vi.restoreAllMocks());
it("the installed SDK makes one failed owned read without retrying or sending provider work", async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => { urls.push(String(url)); expect(init?.signal).toBeInstanceOf(AbortSignal); return new Response(JSON.stringify({ message: "PRIVATE TEST database error" }), { status: 503 }); };
  expect(await recordMarketingOwnerFeedback(input, env, { db: db(fetcher), ownerId: owner })).toBe(false);
  expect(urls).toHaveLength(1); const url = new URL(urls[0]!); expect(url.pathname).toBe("/rest/v1/marketing_revisions"); expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`); expect(url.searchParams.get("id")).toBe(`eq.${input.revisionId}`); expect(read).not.toHaveBeenCalled();
});
it("cancels a stalled installed-SDK read under the same total diagnostic signal", async () => {
  const controller = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  let seen: AbortSignal | undefined, release!: (response: Response) => void, requests = 0;
  const fetcher: typeof fetch = async (_url, init) => { requests++; seen = init?.signal ?? undefined; return new Promise(resolve => { release = resolve; }); };
  const pending = recordMarketingOwnerFeedback(input, env, { db: db(fetcher), ownerId: owner });
  await vi.waitFor(() => expect(requests).toBe(1)); controller.abort(); expect(await pending).toBe(false); expect(seen?.aborted).toBe(true);
  release(new Response("[]")); await new Promise(resolve => setTimeout(resolve, 0)); expect(requests).toBe(1); expect(read).not.toHaveBeenCalled();
}, 500);
