import { createHash } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LANGSMITH_DIAGNOSTIC_DEADLINE_MS, createMarketingTracer, marketingTraceMetadata, traceIdentifierHash, type MarketingTracer, type TraceFinish as DneskaiFinish } from "@/lib/marketing/tracing";
import { DNESKAI_SLIDES_VERSION, DneskaiDeckSchema, type DneskaiDeck, type DneskaiSlide } from "@/lib/marketing/dneskai-slides";
import { generateMarketingDraft, type GenerationDependencies, type MarketingModel } from "@/lib/marketing/generation";
import { MARKETING_BRIEF_PROMPT_ID } from "@/lib/marketing/dneskai-generation";
import { contentHash } from "@/lib/marketing/hashes";
import type { DneskaiSlideRenderProblem } from "@/lib/marketing/dneskai-render";
import { BRIEF_NOW, REVISION_ID, briefFixture, briefInput, briefPacket, briefPictures, validCopy, type BriefPictures } from "./marketing-dneskai-generation-fixture";

vi.mock("server-only", () => ({}));
const sdk = vi.hoisted(() => ({ config: {} as Record<string, unknown>, createRun: vi.fn(), updateRun: vi.fn(), readRun: vi.fn(), createFeedback: vi.fn() }));
vi.mock("langsmith", () => ({ Client: class {
  constructor(config: Record<string, unknown>) { sdk.config = config; }
  createRun = sdk.createRun; updateRun = sdk.updateRun; readRun = sdk.readRun; createFeedback = sdk.createFeedback;
} }));

let pictures: BriefPictures;
beforeAll(async () => { pictures = await briefPictures(); });
beforeEach(() => { vi.resetAllMocks(); sdk.createRun.mockResolvedValue(undefined); sdk.updateRun.mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); });

const loadMedia = vi.fn(async (sha256: string) => Object.values(pictures).find((entry) => entry.sha256 === sha256)!.bytes);
const clean = async (): Promise<DneskaiSlideRenderProblem[]> => [];
function model(answers: unknown[]) {
  const invoke = vi.fn(async () => ({ copy: answers.shift(), usage: { inputTokens: 3000, outputTokens: 1500 } }));
  return { model: "claude-sonnet-5-5", pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 10 }, invoke } satisfies MarketingModel;
}
const dependencies = (provider: MarketingModel, tracer?: MarketingTracer): GenerationDependencies => ({
  model: provider, now: () => BRIEF_NOW, loadDneskaiMedia: loadMedia, validateDneskaiDeck: clean, admitPaidCall: async () => {}, ...(tracer ? { tracer } : {}),
});
/** An answer the gate refuses (a picture the brief does not offer), then the valid one: one retry. */
const answers = () => {
  const refused = validCopy(pictures);
  refused.slides[1]!.images[0]!.assetSha256 = "f".repeat(64);
  return [refused, validCopy(pictures)];
};

/** Every string a LangSmith payload may hold: a sha256, a UUID or a short lowercase code. Anything with spaces, capitals, punctuation or a URL is text. */
const SAFE_STRING = /^(?:[a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9][a-z0-9.-]{0,79})$/;
const SAFE_KEYS = new Set([
  "id", "name", "run_type", "parent_run_id", "trace_id", "inputs", "outputs", "project_name", "start_time", "end_time", "extra", "metadata", "error",
  "revision_id", "source_id_hash", "source_revision_hash", "source_content_hash", "brand", "locale", "model", "prompt_version_hash", "template_version_hash", "knowledge_ids",
  "event_id_hash", "member_hash_hash", "media_count", "stage", "attempt", "latency_ms", "input_tokens", "output_tokens", "estimated_cost_usd", "issue_codes",
  "status", "revision_hash", "attempts", "retry_reasons", "format", "slide_types", "deck_media_count", "cover-photo", "figure", "split", "statement", "sources", "single",
  "asset_hashes", "template_sha256", "render_latency_ms",
]);
/** Fails on any field or string a redacted trace may not carry. */
function assertRedacted(value: unknown, path = "payload"): void {
  if (value === undefined || value === null || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") { expect(value, path).toMatch(SAFE_STRING); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => assertRedacted(item, `${path}[${index}]`)); return; }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    expect(SAFE_KEYS.has(key), `${path}.${key}`).toBe(true);
    assertRedacted(item, `${path}.${key}`);
  }
}
const payloads = () => [...sdk.createRun.mock.calls.map((call) => call[0]), ...sdk.updateRun.mock.calls.map((call) => ({ id: call[0], ...call[1] }))];

describe("redacted brief traces (#122)", () => {
  it("records hashed brief identity, the deck shape, cost, attempts and retry reasons, and no text", async () => {
    const brief = briefFixture(pictures);
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const draft = await generateMarketingDraft(briefInput(briefPacket(brief)), dependencies(model(answers()), tracer));
    expect(draft.traceId).toMatch(/^[0-9a-f-]{36}$/);
    const root = sdk.createRun.mock.calls[0]![0].extra.metadata;
    expect(root).toMatchObject({ revision_id: REVISION_ID, brand: "dneskai", locale: "cs", model: "claude-sonnet-5-5", prompt_version_hash: contentHash(MARKETING_BRIEF_PROMPT_ID),
      event_id_hash: createHash("sha256").update(brief.eventId).digest("hex"), member_hash_hash: traceIdentifierHash(brief.memberHash), media_count: 3 });
    const finished = sdk.updateRun.mock.calls.at(-1)![1].extra.metadata;
    expect(finished).toMatchObject({ status: "review", attempts: 2, input_tokens: 6000, output_tokens: 3000, estimated_cost_usd: 0.042, issue_codes: [], retry_reasons: ["unknown-asset"],
      format: "carousel", slide_types: { "cover-photo": 1, figure: 1, statement: 1, split: 1, sources: 1 }, deck_media_count: 3 });
    expect(sdk.createRun.mock.calls[1]![0].extra.metadata).toMatchObject({ stage: "generation", attempt: 1, issue_codes: ["unknown-asset"] });
    for (const payload of payloads()) assertRedacted(payload);
    // Belt and braces: none of the brief's or the post's own words, links, credits or raw ids appear anywhere.
    const sent = JSON.stringify(payloads());
    const words = [brief.eventId, brief.memberHash, brief.title, ...brief.evidence.flatMap((item) => [item.url, item.title, item.excerpt.slice(0, 40), item.sourceId]),
      ...brief.media.map((item) => item.credit), draft.revision.caption.slice(0, 40), draft.revision.title,
      ...draft.deck!.slides.flatMap((slide) => [slide.headline, slide.body, slide.kicker, slide.credit, slide.alt, ...(slide.sources ?? [])].filter((text): text is string => Boolean(text)))];
    for (const word of words) expect(sent).not.toContain(word);
    for (const picture of Object.values(pictures)) expect(sent).not.toContain(picture.sha256);
  });
  it("keeps the metadata filter closed to any field or slide type it does not know", async () => {
    await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const filter = sdk.config.hideMetadata as (value: object) => object;
    const start = marketingTraceMetadata({ revisionId: REVISION_ID, source: briefPacket(briefFixture(pictures)), model: "claude-sonnet-5-5", promptVersion: MARKETING_BRIEF_PROMPT_ID, templateVersion: "dneskai-photo/1", knowledgeIds: [] });
    expect(filter(start)).toEqual(start);
    expect(filter({ ...start, caption: "TEST PRIVATE CAPTION" })).toEqual({});
    const finish = { status: "review", revision_hash: "a".repeat(64), attempts: 1, input_tokens: 1, output_tokens: 1, estimated_cost_usd: 0, issue_codes: [] };
    expect(filter({ ...finish, slide_types: { statement: 2 } })).toEqual({ ...finish, slide_types: { statement: 2 } });
    expect(filter({ ...finish, slide_types: { "TEST PRIVATE HEADLINE": 1 } })).toEqual({});
    expect(filter({ ...finish, retry_reasons: ["TEST PRIVATE excerpt"] })).toEqual({});
  });
  it("drops issue codes that are not codes instead of sending or throwing on them", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const trace = await tracer.start({ revisionId: REVISION_ID, source: briefPacket(briefFixture(pictures)), model: "claude-sonnet-5-5", promptVersion: MARKETING_BRIEF_PROMPT_ID, templateVersion: "dneskai-photo/1", knowledgeIds: [] });
    await trace!.stage({ name: "generation", attempt: 1, latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, issues: ["text-clipped", "TEST PRIVATE Slide 2 text", "image-1-missing"] });
    await trace!.finish({ status: "failed", revisionHash: null, usage: { attempts: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }, issues: ["https://test-only.example/", "copy-validation-failed"] });
    expect(sdk.createRun.mock.calls[1]![0].extra.metadata.issue_codes).toEqual(["text-clipped", "image-1-missing"]);
    expect(sdk.updateRun.mock.calls[0]![1].extra.metadata).toMatchObject({ status: "failed", issue_codes: ["text-clipped", "image-1-missing", "copy-validation-failed"], retry_reasons: ["text-clipped", "image-1-missing"] });
    expect(JSON.stringify(payloads())).not.toContain("TEST PRIVATE");
  });
});

/** A carousel whose slides hold the given numbers of distinct pictures, with TEST PRIVATE text on every slide; `DneskaiDeckSchema` accepts it. */
const pictureHash = (index: number) => createHash("sha256").update(`test-only picture ${index}`).digest("hex");
const words = (index: number) => ({ headline: `TEST PRIVATE headline ${index}`, body: `TEST PRIVATE body ${index}`, kicker: "TEST PRIVATE", alt: `TEST PRIVATE alt ${index}` });
function deckWithPictures(slides: { type: DneskaiSlide["type"]; pictures: number }[]): DneskaiDeck {
  let next = 0;
  return DneskaiDeckSchema.parse({
    schemaVersion: DNESKAI_SLIDES_VERSION, format: "carousel",
    slides: slides.map((slide, index) => slide.type === "sources"
      ? { type: "sources", headline: "", sources: ["TEST PRIVATE https://test-only.example/"], images: [], alt: `TEST PRIVATE sources ${index}` }
      : { type: slide.type, ...words(index), credit: "TEST PRIVATE credit", images: Array.from({ length: slide.pictures }, (_, image) => ({ slot: `image-${image + 1}`, assetSha256: pictureHash(next++) })) }),
  });
}

describe("the deck shape never costs a trace its finish (#122)", () => {
  const start = async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const trace = await tracer.start({ revisionId: REVISION_ID, source: briefPacket(briefFixture(pictures)), model: "claude-sonnet-5-5", promptVersion: MARKETING_BRIEF_PROMPT_ID, templateVersion: "dneskai-photo/1", knowledgeIds: [] });
    return { tracer, trace: trace! };
  };
  const finish = (deck: DneskaiFinish["deck"]): DneskaiFinish => ({ status: "review", revisionHash: "a".repeat(64), usage: { attempts: 1, inputTokens: 3000, outputTokens: 1500, estimatedCostUsd: 0.021 }, issues: [], deck });
  it("finishes, records the rendered revision and takes owner feedback for a carousel of 12 distinct pictures", async () => {
    // Cover photo, five split pairs, one figure and the sources slide: 8 slides, 12 pictures (the first offer holds 12).
    const deck = deckWithPictures([{ type: "cover-photo", pictures: 1 }, ...Array.from({ length: 5 }, () => ({ type: "split" as const, pictures: 2 })), { type: "figure", pictures: 1 }, { type: "sources", pictures: 0 }]);
    const { tracer, trace } = await start();
    await trace.finish(finish(deck));
    expect(sdk.updateRun).toHaveBeenCalledTimes(1);
    const finished = sdk.updateRun.mock.calls[0]![1].extra.metadata;
    expect(finished).toMatchObject({ status: "review", revision_hash: "a".repeat(64), attempts: 1, estimated_cost_usd: 0.021, format: "carousel", slide_types: { "cover-photo": 1, split: 5, figure: 1, sources: 1 }, deck_media_count: 12 });
    // The render step finds the finished root it wrote, and owner feedback binds to the rendered hash.
    const rendered = "b".repeat(64);
    await expect(tracer.recordPreparedRevision!({ traceId: trace.id, revisionId: REVISION_ID, revisionHash: rendered, assetHashes: Array.from({ length: 8 }, (_, index) => pictureHash(100 + index)), templateSha256: "c".repeat(64), latencyMs: 40 })).resolves.toBe(true);
    expect(sdk.readRun).not.toHaveBeenCalled();
    const root = sdk.updateRun.mock.calls[1]![1].extra.metadata;
    expect(root).toMatchObject({ revision_hash: rendered, deck_media_count: 12 });
    sdk.readRun.mockResolvedValue({ id: trace.id, extra: { metadata: root } });
    sdk.createFeedback.mockResolvedValue(undefined);
    await expect(tracer.recordOwnerFeedback({ traceId: trace.id, revisionId: REVISION_ID, revisionHash: rendered, decision: "approved", qualityScore: 1 })).resolves.toBe(true);
    expect(sdk.createFeedback).toHaveBeenCalledTimes(1);
    for (const payload of payloads()) assertRedacted(payload);
    expect(JSON.stringify([payloads(), sdk.createFeedback.mock.calls])).not.toContain("TEST PRIVATE");
  });
  it("counts up to the 40 distinct pictures the deck contract allows", async () => {
    const deck = deckWithPictures(Array.from({ length: 10 }, () => ({ type: "figure" as const, pictures: 4 })));
    const { trace } = await start();
    await trace.finish(finish(deck));
    expect(sdk.updateRun.mock.calls[0]![1].extra.metadata).toMatchObject({ slide_types: { figure: 10 }, deck_media_count: 40 });
  });
  it("leaves out a deck shape it cannot describe and still sends status, hash and cost", async () => {
    const deck = deckWithPictures([{ type: "figure", pictures: 1 }, { type: "sources", pictures: 0 }]);
    const unknown = { ...deck, slides: [...deck.slides, { ...deck.slides[0]!, type: "TEST PRIVATE poll" }] } as unknown as DneskaiDeck;
    const { trace } = await start();
    await trace.finish(finish(unknown));
    await trace.finish(finish({ format: "carousel", slides: null } as unknown as DneskaiDeck));
    expect(sdk.updateRun).toHaveBeenCalledTimes(2);
    for (const call of sdk.updateRun.mock.calls) {
      const metadata = call[1].extra.metadata;
      expect(metadata).toMatchObject({ status: "review", revision_hash: "a".repeat(64), estimated_cost_usd: 0.021 });
      for (const field of ["format", "slide_types", "deck_media_count"]) expect(metadata).not.toHaveProperty(field);
    }
    expect(JSON.stringify(payloads())).not.toContain("TEST PRIVATE");
  });
});

describe("a tracing outage never stops a generation (#122)", () => {
  const untraced = async () => generateMarketingDraft(briefInput(briefPacket(briefFixture(pictures))), dependencies(model(answers())));
  const sameDraft = (left: Awaited<ReturnType<typeof untraced>>, right: Awaited<ReturnType<typeof untraced>>) => {
    expect({ ...left.revision, traceId: null }).toEqual({ ...right.revision, traceId: null });
    expect(left.usage).toEqual(right.usage);
  };
  it("generates the same draft when LangSmith refuses every write", async () => {
    sdk.createRun.mockRejectedValue(new Error("TEST network down")); sdk.updateRun.mockRejectedValue(new Error("TEST network down"));
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    const draft = await generateMarketingDraft(briefInput(briefPacket(briefFixture(pictures))), dependencies(model(answers()), tracer));
    expect(draft.traceId).toBeNull();
    sameDraft(draft, await untraced());
  });
  it("keeps the trace id when only the later writes fail", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    sdk.createRun.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("TEST child write down")); sdk.updateRun.mockRejectedValue(new Error("TEST root update down"));
    const draft = await generateMarketingDraft(briefInput(briefPacket(briefFixture(pictures))), dependencies(model(answers()), tracer));
    expect(draft.traceId).toMatch(/^[0-9a-f-]{36}$/);
    sameDraft(draft, await untraced());
  });
  it("generates with a tracer that throws, synchronously or not, at every step", async () => {
    const down = (): never => { throw new Error("TEST tracer down"); };
    const startThrows = { start: down } as unknown as MarketingTracer;
    expect((await generateMarketingDraft(briefInput(briefPacket(briefFixture(pictures))), dependencies(model(answers()), startThrows))).traceId).toBeNull();
    const stepsThrow: MarketingTracer = { start: async () => ({ id: "66666666-6666-4666-8666-666666666666", stage: async () => down(), finish: down as never }) };
    const draft = await generateMarketingDraft(briefInput(briefPacket(briefFixture(pictures))), dependencies(model(answers()), stepsThrow));
    expect(draft.traceId).toBe("66666666-6666-4666-8666-666666666666");
    sameDraft(draft, await untraced());
  });
  it("gives up on a hung LangSmith endpoint after the diagnostic deadline", async () => {
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    sdk.createRun.mockReturnValue(new Promise(() => {})); sdk.readRun.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const started = tracer.start({ revisionId: REVISION_ID, source: briefPacket(briefFixture(pictures)), model: "claude-sonnet-5-5", promptVersion: MARKETING_BRIEF_PROMPT_ID, templateVersion: "dneskai-photo/1", knowledgeIds: [] });
    const feedback = tracer.recordOwnerFeedback({ traceId: "67a15323-4a6f-4463-a03b-c4c010015d80", revisionId: REVISION_ID, revisionHash: "a".repeat(64), decision: "approved", qualityScore: 1 });
    await vi.advanceTimersByTimeAsync(LANGSMITH_DIAGNOSTIC_DEADLINE_MS - 1);
    let settled = false; void started.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(started).resolves.toBeNull();
    await expect(feedback).resolves.toBe(false);
  });
});
