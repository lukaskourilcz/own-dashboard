import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("no database in unit tests"); } }));
import { processCollectionPost, processCollectionQueue, type CollectionFinish, type CollectionStore } from "@/lib/marketing/ig-collection-runner";
import type { KnowledgeModel } from "@/lib/marketing/knowledge-extraction";

const owner = "11111111-1111-4111-8111-111111111111";
const sourceId = "33333333-3333-4333-8333-333333333333";
const env = { MARKETING_KNOWLEDGE_WORKER_ENABLED: "true", APIFY_TOKEN: "apify-test", APIFY_ACTOR_ID: "xMc5Ga1oCONPmWJIa", APIFY_ACTOR_BUILD: "0.0.1",
  MARKETING_CLAUDE_MODEL: "claude-test", MARKETING_CLAUDE_INPUT_USD_PER_MTOK: "1", MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK: "5" };
const empty = { status: "not-requested", provider: null, costUsd: null, segments: [], reason: "not-requested" };
const row = (patch: Record<string, unknown> = {}) => ({ id: sourceId, user_id: owner, shortcode: "ABC123", canonical_url: "https://www.instagram.com/p/ABC123/", saved_at: "2026-11-01T10:00:00+00:00", saved_at_status: "unverified",
  published_at: null, imported_at: "2026-11-09T10:00:00+00:00", cutoff: "2026-11-09T10:00:00+00:00", content: { caption: null, captionProvider: null, transcript: empty, ocr: empty }, provenance: "instagram-export",
  status: "partial", analysis_key: null, budget_usd: 0, run_id: null, dataset_id: null, analysis: null, analysis_request: null, author: "creator", ai_link_id: null, updated_at: "2026-11-09T10:00:01+00:00", ...patch });

let finished: CollectionFinish[]; let staged: Record<string, unknown>[]; let claimed: number; let calls: string[];
let claimRow: Record<string, unknown> | null;
const store: CollectionStore = {
  queued: async () => [sourceId],
  claim: async () => { claimed++; return claimRow; },
  stage: async (_o, _s, patch) => { staged.push(patch); },
  finish: async (_o, _s, result) => { finished.push(result); },
};
type Answer = { limits?: unknown; user?: unknown; run?: unknown; items?: unknown };
function apify(answer: Answer = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url.replace("https://api.apify.com/v2/", "")}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("users/me/limits")) return json(answer.limits ?? { data: { limits: { maxMonthlyUsageUsd: 29 }, current: { monthlyUsageUsd: 3 } } });
    if (url.endsWith("users/me")) return json(answer.user ?? { data: { plan: { monthlyUsageCreditsUsd: 29 } } });
    if (url.includes("/runs?")) return json(answer.run ?? { data: { id: "run1", actId: "xMc5Ga1oCONPmWJIa", buildNumber: "0.0.1", status: "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.004 } });
    if (url.includes("datasets/")) return json(answer.items ?? [{ shortCode: "ABC123", caption: "Hook in one line. Then show the result.", transcript: "Say the result first.", ownerUsername: "creator", displayUrl: "https://cdn.example/thumb.jpg", type: "Video", timestamp: "2026-10-30T08:00:00.000Z" }]);
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}
const answer = { summary: "Open with the result. Keep the hook to one line.", tips: ["Hook in one line"], tags: ["hooks"], project: "devShark",
  procedures: [
    { title: "One-line hook", summary: "Open with one line.", steps: ["Write the hook in one line."], category: "marketing", tipGroup: null, tags: { goal: [], stage: [], format: [], tool: [], brand: [], effort: "small" },
      evidence: [{ shortcode: "ABC123", channel: "caption", quote: "Hook in one line.", startSeconds: null, endSeconds: null }], missingParts: [], contraryClaims: [] },
    { title: "Invented", summary: "Not in the post.", steps: ["Buy ads."], category: "marketing", tipGroup: null, tags: { goal: [], stage: [], format: [], tool: [], brand: [], effort: "small" },
      evidence: [{ shortcode: "ABC123", channel: "caption", quote: "Buy ads now.", startSeconds: null, endSeconds: null }], missingParts: [], contraryClaims: [] },
  ] };
const model = (pricing = { inputPerMillionUsd: 1, outputPerMillionUsd: 5 }, usage = { inputTokens: 1200, outputTokens: 400 }): KnowledgeModel & { invoke: ReturnType<typeof vi.fn> } =>
  ({ model: "claude-test", pricing, invoke: vi.fn(async () => ({ extraction: answer, usage })) });

beforeEach(() => { finished = []; staged = []; claimed = 0; calls = []; claimRow = row(); });

describe("IG Kolekce processing", () => {
  it("scrapes, summarizes and keeps only procedures whose quotes stand in the post", async () => {
    const m = model();
    const result = await processCollectionPost(owner, sourceId, { store, env, fetch: apify(), model: m });
    expect(result.status).toBe("done");
    expect(calls.some((c) => c.startsWith("POST acts/xMc5Ga1oCONPmWJIa/runs?build=0.0.1&") && c.includes("maxTotalChargeUsd=0.02") && c.includes("maxItems=1"))).toBe(true);
    expect(staged[0]).toMatchObject({ collection_status: "summarizing", author: "creator", media: { thumbnailUrl: "https://cdn.example/thumb.jpg", type: "Video" } });
    expect(finished[0]).toMatchObject({ status: "done", digest: { project: "devShark", tags: ["hooks"], procedures: 1, droppedProcedures: 1, apifyUsd: 0.004 } });
    expect(finished[0].items.map((i) => i.title)).toEqual(["One-line hook"]);
    expect(finished[0].knowledgeSource).toMatchObject({ status: "review", content: { transcript: { status: "available" } } });
    expect(result.costUsd).toBeLessThanOrEqual(0.05);
  });

  it("refuses to spend when the Apify prepaid credit is exhausted, before any claim or run", async () => {
    const result = await processCollectionPost(owner, sourceId, { store, env, model: model(), fetch: apify({ limits: { data: { limits: { maxMonthlyUsageUsd: 29 }, current: { monthlyUsageUsd: 29 } } } }) });
    expect(result).toMatchObject({ status: "held", reason: "collection-apify-prepaid-exhausted" });
    expect(claimed).toBe(0);
    expect(calls.some((c) => c.includes("/runs"))).toBe(false);
  });

  it("treats unreadable limits or a card-only plan as no prepaid headroom", async () => {
    expect((await processCollectionPost(owner, sourceId, { store, env, model: model(), fetch: apify({ limits: { error: "x" } }) })).reason).toBe("collection-apify-prepaid-exhausted");
    expect((await processCollectionPost(owner, sourceId, { store, env, model: model(), fetch: apify({ user: { data: { plan: { monthlyUsageCreditsUsd: 0 } } } }) })).reason).toBe("collection-apify-prepaid-exhausted");
    expect(claimed).toBe(0);
  });

  it("holds without spending while the worker or a provider is not configured", async () => {
    expect((await processCollectionPost(owner, sourceId, { store, env: { ...env, MARKETING_KNOWLEDGE_WORKER_ENABLED: "false" }, fetch: apify() })).reason).toBe("collection-worker-disabled");
    expect((await processCollectionPost(owner, sourceId, { store, env: { ...env, APIFY_ACTOR_BUILD: "latest" }, fetch: apify() })).reason).toBe("collection-apify-configuration-required");
    expect(calls).toEqual([]);
  });

  it("marks a private or removed post restricted and does not call Claude", async () => {
    const m = model();
    const result = await processCollectionPost(owner, sourceId, { store, env, model: m, fetch: apify({ items: [{ error: "restricted_page" }] }) });
    expect(result.status).toBe("restricted");
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it("fails without a call when the Claude reservation exceeds the per-post cap", async () => {
    const m = model({ inputPerMillionUsd: 15, outputPerMillionUsd: 75 });
    const result = await processCollectionPost(owner, sourceId, { store, env, model: m, fetch: apify() });
    expect(result).toMatchObject({ status: "failed", reason: "collection-claude-cap-exceeded" });
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it("skips a post another click already claimed", async () => {
    claimRow = null;
    expect((await processCollectionPost(owner, sourceId, { store, env, model: model(), fetch: apify() })).status).toBe("skipped");
    expect(calls.some((c) => c.includes("/runs"))).toBe(false);
  });

  it("does not add IG TIPS ideas again for a post already linked to one", async () => {
    claimRow = row({ ai_link_id: "44444444-4444-4444-8444-444444444444" });
    await processCollectionPost(owner, sourceId, { store, env, model: model(), fetch: apify() });
    expect(finished[0]).toMatchObject({ status: "done", items: [] });
  });

  it("runs only on the owner's explicit consent", async () => {
    await expect(processCollectionQueue(owner, { consent: false } as unknown as { consent: true }, { store, env, model: model(), fetch: apify() })).rejects.toThrow("collection-consent-required");
    expect(claimed).toBe(0);
    const run = await processCollectionQueue(owner, { consent: true }, { store, env, model: model(), fetch: apify() });
    expect(run.results.map((r) => r.status)).toEqual(["done"]);
  });
});
