import { z } from "zod";
import { GenerationInputSchema, generateMarketingDraft, type GeneratedMarketingDraft, type GenerationDependencies, type MarketingModel, type GenerationBudget } from "../../src/lib/marketing/generation";
import { MarketingTemplateSchema, renderMarketingAssets, renderAuthoredMarketingPreflight, validateMarketingTemplate, MarketingRenderError, marketingPreparationFailureCode, type MarketingAssetStorage, type MarketingTemplate } from "../../src/lib/marketing/render";
import { parseSourcePacket, sourceUsable, revisionReadiness, type SourcePacket } from "../../src/lib/marketing/contracts";
import { contentHash, revisionContentHash } from "../../src/lib/marketing/hashes";
import type { MarketingTracer } from "../../src/lib/marketing/tracing";
import type { DneskaiDeck } from "../../src/lib/marketing/dneskai-slides";
import type { DneskaiDeckRenderResult } from "../../src/lib/marketing/dneskai-ports";
import { DNESKAI_DECK_TEMPLATE_VERSION } from "../../src/lib/marketing/dneskai-generation";
import { DNESKAI_STUDIO } from "../../src/lib/marketing/dneskai-render";

const jobFields = {
  schemaVersion: z.literal("marketing-job/1"), idempotencyKey: z.uuid(),
  calendarEntryId: z.uuid().optional(), calendarEntryVersion: z.number().int().positive().optional(),
};
const pairedCalendarEntry = (value: { calendarEntryId?: string; calendarEntryVersion?: number }) => !!value.calendarEntryId === !!value.calendarEntryVersion;
/** A job that renders through an approved single-layout template (devShark). */
export const MarketingWorkerRequestSchema = z.strictObject({
  ...jobFields,
  generation: GenerationInputSchema,
  template: MarketingTemplateSchema,
}).refine(pairedCalendarEntry, "Calendar entry/version must be paired");
export type MarketingWorkerRequest = z.infer<typeof MarketingWorkerRequestSchema>;
/**
 * A DNESKAi job (#116): one brief, rendered through the vendored carousel studio, so it carries no template.
 * Its `templateVersion` names the studio renderer (`DNESKAI_DECK_TEMPLATE_VERSION`), it takes no presentation
 * knowledge and it publishes to Instagram only, because a deck revision is an Instagram revision.
 */
export const DneskaiDeckJobRequestSchema = z.strictObject({
  ...jobFields,
  generation: GenerationInputSchema.extend({ knowledge: GenerationInputSchema.shape.knowledge.max(0) }),
}).refine(pairedCalendarEntry, "Calendar entry/version must be paired").superRefine((value, context) => {
  let source;
  try { source = parseSourcePacket(value.generation.source); } catch { context.addIssue({ code: "custom", message: "source packet invalid", path: ["generation", "source"] }); return; }
  if (source.brand !== "dneskai" || source.kind !== "brief") context.addIssue({ code: "custom", message: "a deck job generates from a DNESKAi brief", path: ["generation", "source"] });
  if (value.generation.account.platform !== "instagram") context.addIssue({ code: "custom", message: "a deck job publishes to Instagram", path: ["generation", "account", "platform"] });
});
export type DneskaiDeckJobRequest = z.infer<typeof DneskaiDeckJobRequestSchema>;
/** Every job the durable queue accepts. */
export const MarketingJobRequestSchema = z.union([MarketingWorkerRequestSchema, DneskaiDeckJobRequestSchema]);
export type MarketingJobRequest = MarketingWorkerRequest | DneskaiDeckJobRequest;
export function parseMarketingJobRequest(value: unknown): MarketingJobRequest {
  return MarketingJobRequestSchema.parse(value);
}
/** The template a job renders with, or null for a DNESKAi deck job. */
export function marketingJobTemplate(request: MarketingJobRequest): MarketingTemplate | null {
  return "template" in request && request.template ? request.template as MarketingTemplate : null;
}
/**
 * The DNESKAi job request for one brief packet (#115 admits it with `enqueueMarketingJob`): consent, no knowledge,
 * the brief's schedule and the studio renderer version. `revisionId` is also the idempotency key.
 */
export function dneskaiBriefJobRequest(input: { source: SourcePacket; account: { id: string; handle: string }; revisionId: string; scheduledAt?: string; calendarEntry?: { id: string; version: number } }): DneskaiDeckJobRequest {
  const source = parseSourcePacket(input.source);
  if (source.kind !== "brief" || !source.brief) throw new Error("brief-source-required");
  return DneskaiDeckJobRequestSchema.parse({
    schemaVersion: "marketing-job/1", idempotencyKey: input.revisionId,
    ...(input.calendarEntry ? { calendarEntryId: input.calendarEntry.id, calendarEntryVersion: input.calendarEntry.version } : {}),
    generation: { source, account: { id: input.account.id, platform: "instagram", handle: input.account.handle }, scheduledAt: input.scheduledAt ?? source.brief.scheduledAt,
      templateVersion: DNESKAI_DECK_TEMPLATE_VERSION, knowledge: [], consent: true, revisionId: input.revisionId },
  });
}
export type MarketingWorkerResult = GeneratedMarketingDraft & { revisionHash: string };
/** Observation freshness is rechecked separately; it is not a new content identity. */
export function marketingJobIdentityHash(request: MarketingJobRequest): string {
 const source=parseSourcePacket(request.generation.source);
 return contentHash({...request,generation:{...request.generation,source:{...source,observedAt:null}}});
}
export type MarketingJobStatus = "queued" | "running" | "review" | "failed" | "reconciliation";
export interface DurableMarketingQueue {
  /** Persist before responding. Same key+hash returns original job; same key+different hash must throw. */
  enqueue(input: { key: string; hash: string; request: MarketingJobRequest }): Promise<{ jobId: string; status: MarketingJobStatus; duplicate: boolean }>;
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
      const body = parseMarketingJobRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (body.idempotencyKey !== body.generation.revisionId) return Response.json({ error: "revision-key-mismatch" }, { status: 400 });
      if (!body.generation.consent) return Response.json({ error: "consent-required" }, { status: 403 });
      const source = parseSourcePacket(body.generation.source);
      if (!sourceUsable(source, (dependencies.now ?? (() => new Date()))()) || source.kind === "instagram-reference" || contentHash(source.content) !== source.contentHash) return Response.json({ error: "source-unavailable" }, { status: 409 });
      const template = marketingJobTemplate(body);
      if (template) {
        const trustedTemplate = await dependencies.resolveTemplate(template.version);
        if (!trustedTemplate || contentHash(trustedTemplate) !== contentHash(template)) return Response.json({ error: "template-not-approved" }, { status: 409 });
        validateMarketingTemplate(trustedTemplate, true);
        if (template.brand !== source.brand || template.version !== body.generation.templateVersion) return Response.json({ error: "template-revision-mismatch" }, { status: 400 });
      } else if (body.generation.templateVersion !== DNESKAI_DECK_TEMPLATE_VERSION) return Response.json({ error: "template-revision-mismatch" }, { status: 400 });
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
type DraftWithDeck = GeneratedMarketingDraft;
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
export async function runMarketingWorkerJob(request: MarketingJobRequest, dependencies: {
  model: MarketingModel; tracer?: MarketingTracer; storage: MarketingAssetStorage;
  budget?: GenerationBudget; signal?: AbortSignal;
  reloadSource(sourceId: string): Promise<unknown>;
  reloadTemplate?(version: string): Promise<MarketingTemplate | null>;
  renderDneskaiDeck?: RenderDneskaiRevisionDeck;
} & Pick<GenerationDependencies, "admitPaidCall" | "onUsage" | "loadDneskaiMedia" | "validateDneskaiDeck" | "evidencePublishers">): Promise<MarketingWorkerResult> {
  const job = parseMarketingJobRequest(request);
  const template = marketingJobTemplate(job);
  if (template) {
    if (dependencies.reloadTemplate) {
      const currentTemplate = await dependencies.reloadTemplate(template.version);
      if (!currentTemplate || contentHash(currentTemplate) !== contentHash(template)) throw new Error("template-superseded");
    }
    validateMarketingTemplate(template, true);
  } else if (job.generation.templateVersion !== DNESKAI_DECK_TEMPLATE_VERSION) {
    // Queued for a studio the deployment no longer vendors: a new job renders with the current one.
    throw new Error("template-superseded");
  }
  const expected = parseSourcePacket(job.generation.source);
  assertDneskaiRendererAvailable(expected, job.generation.account.platform, dependencies.renderDneskaiDeck);
  const authorityFields = ["brand", "kind", "sourceId", "sourceRevision", "canonicalUrl", "locale", "contentHash"] as const;
  const assertCurrentSource = async () => {
    const current = parseSourcePacket(await dependencies.reloadSource(expected.sourceId));
    // Observation time may advance during a fresh producer read. Stable authority may not change.
    if (!sourceUsable(current) || authorityFields.some((field) => current[field] !== expected[field]) || contentHash(current.content) !== current.contentHash || contentHash(expected.content) !== expected.contentHash) throw new Error("source-superseded");
  };
  await assertCurrentSource();
  if (template && job.generation.consent && job.generation.account.platform === "instagram" && ["question", "coding-task"].includes(expected.kind)) {
    // Exercise authored layout/files/native encoders before the first paid attempt. No upload or revision write.
    await renderAuthoredMarketingPreflight({ source: expected, account: job.generation.account, scheduledAt: job.generation.scheduledAt, template, revisionId: job.generation.revisionId, signal: dependencies.signal });
  }
  const draft: DraftWithDeck = await generateMarketingDraft({ ...job.generation, source: expected }, dependencies);
  const renderStartedAt = Date.now();
  try {
    const assets = draft.revision.account.platform !== "instagram" ? []
      : draft.revision.brand === "dneskai" ? await renderDneskaiRevisionAssets(draft, job.generation.revisionId, dependencies.renderDneskaiDeck, dependencies.signal)
      : template ? await renderMarketingAssets({ draft, template, revisionId: job.generation.revisionId }, dependencies.storage)
      : (() => { throw new MarketingRenderError("template-revision-mismatch"); })();
    await assertCurrentSource();
    const revision = { ...draft.revision, assets };
    if (revisionReadiness(revision).length) throw new Error("revision-not-ready");
    const finalHash = revisionContentHash(revision);
    if (draft.traceId) await dependencies.tracer?.recordPreparedRevision?.({ traceId: draft.traceId, revisionId: job.generation.revisionId, revisionHash: finalHash, assetHashes: assets.map((asset) => asset.sha256), templateSha256: template?.templateSha256 ?? DNESKAI_STUDIO.treeSha256, latencyMs: Date.now() - renderStartedAt });
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
