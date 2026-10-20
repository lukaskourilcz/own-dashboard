import { z } from "zod";
import { GenerationInputSchema, generateMarketingDraft, type GeneratedMarketingDraft, type MarketingModel, type GenerationBudget } from "../../src/lib/marketing/generation";
import { MarketingTemplateSchema, renderMarketingAssets, renderAuthoredMarketingPreflight, validateMarketingTemplate, MarketingRenderError, marketingPreparationFailureCode, type MarketingAssetStorage, type MarketingTemplate } from "../../src/lib/marketing/render";
import { parseSourcePacket, sourceUsable, revisionReadiness } from "../../src/lib/marketing/contracts";
import { contentHash, revisionContentHash } from "../../src/lib/marketing/hashes";
import type { MarketingTracer } from "../../src/lib/marketing/tracing";
import type { DneskaiDeck } from "../../src/lib/marketing/dneskai-slides";
import type { DneskaiDeckRenderResult } from "../../src/lib/marketing/dneskai-ports";

export const MarketingWorkerRequestSchema = z.strictObject({
  schemaVersion: z.literal("marketing-job/1"), idempotencyKey: z.uuid(),
  calendarEntryId: z.uuid().optional(), calendarEntryVersion: z.number().int().positive().optional(),
  generation: GenerationInputSchema,
  template: MarketingTemplateSchema,
}).refine(value => !!value.calendarEntryId === !!value.calendarEntryVersion, "Calendar entry/version must be paired");
export type MarketingWorkerRequest = z.infer<typeof MarketingWorkerRequestSchema>;
export type MarketingWorkerResult = GeneratedMarketingDraft & { revisionHash: string };
/** Observation freshness is rechecked separately; it is not a new content identity. */
export function marketingJobIdentityHash(request: MarketingWorkerRequest): string {
 const source=parseSourcePacket(request.generation.source);
 return contentHash({...request,generation:{...request.generation,source:{...source,observedAt:null}}});
}
export type MarketingJobStatus = "queued" | "running" | "review" | "failed" | "reconciliation";
export interface DurableMarketingQueue {
  /** Persist before responding. Same key+hash returns original job; same key+different hash must throw. */
  enqueue(input: { key: string; hash: string; request: MarketingWorkerRequest }): Promise<{ jobId: string; status: MarketingJobStatus; duplicate: boolean }>;
  /** Results only within the authenticated owner's scope. Never return another owner's job. */
  read(jobId: string): Promise<{ jobId: string; status: MarketingJobStatus; result?: MarketingWorkerResult; errorCode?: string } | null>;
}
/** Mount on an authenticated external Node worker. No work runs after an HTTP response. */
export function createMarketingWorkerHandler(dependencies: {
  authenticate(request: Request): Promise<boolean>;
  queue: DurableMarketingQueue;
  resolveTemplate(version: string): Promise<MarketingTemplate | null>;
  now?: () => Date;
}) {
  return async function handle(request: Request): Promise<Response> {
    if (!await dependencies.authenticate(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (request.method === "GET") {
      const jobId = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
      if (!z.uuid().safeParse(jobId).success) return Response.json({ error: "invalid-job-id" }, { status: 400 });
      const job = await dependencies.queue.read(jobId!);
      return job ? Response.json(job) : Response.json({ error: "job-not-found" }, { status: 404 });
    }
    if (request.method !== "POST") return Response.json({ error: "method-not-allowed" }, { status: 405 });
    try {
      if (Number(request.headers.get("content-length")) > 200000) return Response.json({ error: "request-too-large" }, { status: 413 });
      // Stream cap works even if the sender omits or lies about content-length.
      const reader = request.body?.getReader();
      if (!reader) return Response.json({ error: "invalid-request" }, { status: 400 });
      let length = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 200000) { await reader.cancel(); return Response.json({ error: "request-too-large" }, { status: 413 }); }
        chunks.push(value);
      }
      const body = MarketingWorkerRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (body.idempotencyKey !== body.generation.revisionId) return Response.json({ error: "revision-key-mismatch" }, { status: 400 });
      if (!body.generation.consent) return Response.json({ error: "consent-required" }, { status: 403 });
      const source = parseSourcePacket(body.generation.source);
      if (!sourceUsable(source, (dependencies.now ?? (() => new Date()))()) || source.kind === "instagram-reference" || contentHash(source.content) !== source.contentHash) return Response.json({ error: "source-unavailable" }, { status: 409 });
      const trustedTemplate = await dependencies.resolveTemplate(body.template.version);
      if (!trustedTemplate || contentHash(trustedTemplate) !== contentHash(body.template)) return Response.json({ error: "template-not-approved" }, { status: 409 });
      validateMarketingTemplate(trustedTemplate, true);
      if (body.template.brand !== source.brand || body.template.version !== body.generation.templateVersion) return Response.json({ error: "template-revision-mismatch" }, { status: 400 });
      const job = await dependencies.queue.enqueue({ key: body.idempotencyKey, hash: marketingJobIdentityHash(body), request: body });
      return Response.json({ schemaVersion: "marketing-job/1", ...job }, { status: job.duplicate ? 200 : 202 });
    } catch {
      return Response.json({ error: "job-not-accepted" }, { status: 422 });
    }
  };
}
/** The owner-bound deck renderer (`RenderDneskaiDeck` from dneskai-render.ts with owner and media loader applied). */
export type RenderDneskaiRevisionDeck = (input: { revisionId: string; deck: DneskaiDeck; signal?: AbortSignal }) => Promise<DneskaiDeckRenderResult>;
/** Generation v5 (#116) attaches the slide deck to a DNESKAi draft. */
type DraftWithDeck = GeneratedMarketingDraft & { deck?: DneskaiDeck };
/**
 * DNESKAi renders through the carousel studio and only from a deck. A DNESKAi draft without one
 * (the retired article path) has nothing this worker may render; it never falls back to a layout.
 */
export async function renderDneskaiRevisionAssets(draft: DraftWithDeck, revisionId: string, render: RenderDneskaiRevisionDeck | undefined, signal?: AbortSignal) {
  if (!draft.deck) throw new MarketingRenderError("dneskai-deck-required");
  if (!render) throw new MarketingRenderError("dneskai-renderer-unavailable");
  const result = await render({ revisionId, deck: draft.deck, signal });
  // The per-slide problems travel with the code, so the job result can say what to fix.
  if (result.status !== "rendered") throw new MarketingRenderError("dneskai-render-refused", result.problems);
  return result.assets;
}
/**
 * Checked before the paid generation: a DNESKAi Instagram job without a deck renderer (no media
 * loader wired) could only fail after paying for its copy.
 */
export function assertDneskaiRendererAvailable(source: { brand: string }, platform: string, render: RenderDneskaiRevisionDeck | undefined) {
  if (platform === "instagram" && source.brand === "dneskai" && !render) throw new MarketingRenderError("dneskai-renderer-unavailable");
}
/** The durable runner supplies a fenced claim and persists the returned result before acknowledging it. */
export async function runMarketingWorkerJob(request: MarketingWorkerRequest, dependencies: {
  model: MarketingModel; tracer?: MarketingTracer; storage: MarketingAssetStorage;
  budget?: GenerationBudget; signal?: AbortSignal;
  reloadSource(sourceId: string): Promise<unknown>;
  reloadTemplate?(version: string): Promise<MarketingTemplate | null>;
  renderDneskaiDeck?: RenderDneskaiRevisionDeck;
}): Promise<MarketingWorkerResult> {
  const job = MarketingWorkerRequestSchema.parse(request);
  if (dependencies.reloadTemplate) {
    const currentTemplate = await dependencies.reloadTemplate(job.template.version);
    if (!currentTemplate || contentHash(currentTemplate) !== contentHash(job.template)) throw new Error("template-superseded");
  }
  validateMarketingTemplate(job.template as MarketingTemplate, true);
  const expected = parseSourcePacket(job.generation.source);
  assertDneskaiRendererAvailable(expected, job.generation.account.platform, dependencies.renderDneskaiDeck);
  const authorityFields = ["brand", "kind", "sourceId", "sourceRevision", "canonicalUrl", "locale", "contentHash"] as const;
  const assertCurrentSource = async () => {
    const current = parseSourcePacket(await dependencies.reloadSource(expected.sourceId));
    // Observation time may advance during a fresh producer read. Stable authority may not change.
    if (!sourceUsable(current) || authorityFields.some((field) => current[field] !== expected[field]) || contentHash(current.content) !== current.contentHash || contentHash(expected.content) !== expected.contentHash) throw new Error("source-superseded");
  };
  await assertCurrentSource();
  if (job.generation.consent && job.generation.account.platform === "instagram" && ["question", "coding-task"].includes(expected.kind)) {
    // Exercise authored layout/files/native encoders before the first paid attempt. No upload or revision write.
    await renderAuthoredMarketingPreflight({ source: expected, account: job.generation.account, scheduledAt: job.generation.scheduledAt, template: job.template, revisionId: job.generation.revisionId, signal: dependencies.signal });
  }
  const draft: DraftWithDeck = await generateMarketingDraft({ ...job.generation, source: expected }, dependencies);
  const renderStartedAt = Date.now();
  try {
    const assets = draft.revision.account.platform !== "instagram" ? []
      : draft.revision.brand === "dneskai" ? await renderDneskaiRevisionAssets(draft, job.generation.revisionId, dependencies.renderDneskaiDeck, dependencies.signal)
      : await renderMarketingAssets({ draft, template: job.template, revisionId: job.generation.revisionId }, dependencies.storage);
    await assertCurrentSource();
    const revision = { ...draft.revision, assets };
    if (revisionReadiness(revision).length) throw new Error("revision-not-ready");
    const finalHash = revisionContentHash(revision);
    if (draft.traceId) await dependencies.tracer?.recordPreparedRevision?.({ traceId: draft.traceId, revisionId: job.generation.revisionId, revisionHash: finalHash, assetHashes: assets.map((asset) => asset.sha256), templateSha256: job.template.templateSha256, latencyMs: Date.now() - renderStartedAt });
    return { ...draft, revision, revisionHash: finalHash };
  } catch (failure) {
    const code = marketingPreparationFailureCode(failure);
    if (draft.traceId) {
      // Diagnostics are best effort; a trace outage never changes or retries the failed preparation.
      try { await dependencies.tracer?.recordPreparationFailure?.({ traceId: draft.traceId, revisionId: job.generation.revisionId, code }); } catch {}
    }
    throw new MarketingRenderError(code, failure instanceof MarketingRenderError ? failure.problems : undefined);
  }
}
