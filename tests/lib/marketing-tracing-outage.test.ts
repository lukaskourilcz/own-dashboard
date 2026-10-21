import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dneskaiBriefJobRequest, runMarketingWorkerJob } from "../../services/marketing-worker/protocol";
import { LANGSMITH_EU_ENDPOINT, createMarketingTracer, type MarketingTracer } from "@/lib/marketing/tracing";
import { parseContentRevision, revisionReadiness } from "@/lib/marketing/contracts";
import { revisionContentHash } from "@/lib/marketing/hashes";
import type { DneskaiDeckRenderResult } from "@/lib/marketing/dneskai-ports";
import type { DneskaiSlideRenderProblem } from "@/lib/marketing/dneskai-render";
import type { MarketingModel } from "@/lib/marketing/generation";
import { ACCOUNT, briefFixture, briefPacket, briefPictures, validCopy, type BriefPictures } from "./marketing-dneskai-generation-fixture";
import { deckRevision } from "./marketing-dneskai-revision-fixture";

const mocks = vi.hoisted(() => ({ user: vi.fn(), notify: vi.fn(async () => ({ status: "skipped" })), readRun: vi.fn(), createRun: vi.fn(), updateRun: vi.fn(), createFeedback: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.user() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/marketing/approval-notification", () => ({ notifyMarketingApproval: mocks.notify }));
vi.mock("@/lib/marketing/dneskai-wiring", () => ({ getRenderDneskaiDeck: vi.fn(), getDneskaiMediaLoader: vi.fn(), getBriefAssetHashLister: vi.fn() }));
vi.mock("langsmith", () => ({ Client: class { readRun = mocks.readRun; createRun = mocks.createRun; updateRun = mocks.updateRun; createFeedback = mocks.createFeedback; } }));
import { POST } from "@/app/api/marketing/revisions/route";

const revisionId = "90246ac5-0587-407c-9048-3fce5f968a16";
let pictures: BriefPictures;
beforeAll(async () => { pictures = await briefPictures(); });
beforeEach(() => {
  vi.clearAllMocks();
  for (const write of [mocks.readRun, mocks.createRun, mocks.updateRun, mocks.createFeedback]) write.mockRejectedValue(new Error("TEST LangSmith outage"));
});
afterEach(() => { vi.unstubAllEnvs(); });

const loadDneskaiMedia = vi.fn(async (sha256: string) => Object.values(pictures).find((entry) => entry.sha256 === sha256)!.bytes);
const renderDneskaiDeck = vi.fn(async ({ deck }: { deck: { slides: { alt: string }[] } }): Promise<DneskaiDeckRenderResult> => ({
  status: "rendered", renderKeys: deck.slides.map((_, index) => String(index).repeat(64).slice(0, 64)), problems: [],
  assets: deck.slides.map((slide, index) => ({ url: `https://test-only.supabase.co/storage/v1/object/sign/marketing-assets/slide-${index}.jpg?token=test-only`, sha256: String((index + 1) % 10).repeat(64), mimeType: "image/jpeg", width: 1080, height: 1350, alt: slide.alt })),
}));
const provider = (): MarketingModel => ({ model: "claude-sonnet-5-5", pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 10 }, invoke: vi.fn(async () => ({ copy: validCopy(pictures), usage: { inputTokens: 3000, outputTokens: 1500 } })) });
function job() {
  const now = Date.now();
  const scheduledAt = new Date(now + 3 * 3600000).toISOString();
  return dneskaiBriefJobRequest({ source: briefPacket(briefFixture(pictures, { observedAt: new Date(now - 1800000).toISOString(), expiresAt: new Date(now + 2 * 86400000).toISOString(), scheduledAt, targetDate: scheduledAt.slice(0, 10) })), account: ACCOUNT, revisionId });
}
async function run(tracer: MarketingTracer) {
  const request = job();
  return runMarketingWorkerJob(request, { model: provider(), tracer, storage: { put: vi.fn() }, reloadSource: async () => request.generation.source, loadDneskaiMedia,
    renderDneskaiDeck: (input) => renderDneskaiDeck(input), admitPaidCall: async () => {}, validateDneskaiDeck: async (): Promise<DneskaiSlideRenderProblem[]> => [] });
}
const expectRendered = (result: Awaited<ReturnType<typeof run>>) => {
  const revision = parseContentRevision(result.revision);
  expect(revisionReadiness(revision)).toEqual([]);
  expect(result.revisionHash).toBe(revisionContentHash(revision));
  expect(revision.assets).toHaveLength(revision.deck!.slides.length);
};

describe("a tracing outage never stops rendering (#122)", () => {
  it("renders and hashes the revision when LangSmith refuses every write", async () => {
    const result = await run(await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" }));
    expect(result.traceId).toBeNull();
    expectRendered(result);
  });
  it("renders when the trace exists but recording the prepared revision throws", async () => {
    const down = (): never => { throw new Error("TEST tracer down"); };
    const tracer: MarketingTracer = { start: async () => ({ id: "66666666-6666-4666-8666-666666666666", stage: async () => {}, finish: async () => {} }), recordPreparedRevision: down };
    const result = await run(tracer);
    expect(result.traceId).toBe("66666666-6666-4666-8666-666666666666");
    expectRendered(result);
  });
});

describe("a tracing outage never stops an owner decision (#122)", () => {
  const current = "33333333-3333-4333-8333-333333333333";
  const revision = { ...deckRevision(), traceId: "55555555-5555-4555-8555-555555555555" };
  const request = (body: unknown) => new Request("https://own.example/api/marketing/revisions", { method: "POST", headers: { Origin: "https://own.example", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  function userDb() {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: current, revision, content_hash: revisionContentHash(revision), replaces_id: null }, error: null }) };
    const rpc = vi.fn(async (name: string) => name === "marketing_approve_revision" ? { data: "88888888-8888-4888-8888-888888888888", error: null } : { data: null, error: null });
    return { auth: { getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } }) }, from: () => query, rpc };
  }
  beforeEach(() => {
    vi.stubEnv("MARKETING_LANGSMITH_ENABLED", "true"); vi.stubEnv("LANGSMITH_API_KEY", "test-only"); vi.stubEnv("LANGSMITH_PROJECT", "test-only"); vi.stubEnv("LANGSMITH_ENDPOINT", LANGSMITH_EU_ENDPOINT);
    mocks.user.mockReturnValue(userDb());
  });
  it("approves, queues the publication and notifies while LangSmith is down", async () => {
    const response = await POST(request({ action: "approve", id: current, expectedHash: revisionContentHash(revision) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicationId: "88888888-8888-4888-8888-888888888888", scheduling: { status: "skipped" } });
    expect(mocks.readRun).toHaveBeenCalledWith(revision.traceId);
    expect(mocks.createFeedback).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith("88888888-8888-4888-8888-888888888888");
  });
  it.each(["returned", "skipped"] as const)("records %s while LangSmith is down", async (action) => {
    const response = await POST(request({ action, id: current, feedback: "TEST owner note" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.readRun).toHaveBeenCalledTimes(1);
  });
});
