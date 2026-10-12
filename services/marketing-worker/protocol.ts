import { z } from "zod";
import { GenerationInputSchema, generateMarketingDraft, type GeneratedMarketingDraft, type MarketingModel, type GenerationBudget } from "../../src/lib/marketing/generation";
import { MarketingTemplateSchema, renderMarketingAssets, validateMarketingTemplate, type MarketingAssetStorage, type MarketingTemplate } from "../../src/lib/marketing/render";
import { parseSourcePacket, sourceUsable, revisionReadiness } from "../../src/lib/marketing/contracts";
import { contentHash, revisionHash } from "../../src/lib/marketing/hashes";
import type { MarketingTracer } from "../../src/lib/marketing/tracing";

export const MarketingWorkerRequestSchema = z.strictObject({
  schemaVersion: z.literal("marketing-job/1"), idempotencyKey: z.uuid(),
  generation: GenerationInputSchema,
  template: MarketingTemplateSchema,
});
export type MarketingWorkerRequest = z.infer<typeof MarketingWorkerRequestSchema>;
export type MarketingWorkerResult = GeneratedMarketingDraft & { revisionHash: string };
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
      const job = await dependencies.queue.enqueue({ key: body.idempotencyKey, hash: contentHash(body), request: body });
      return Response.json({ schemaVersion: "marketing-job/1", ...job }, { status: job.duplicate ? 200 : 202 });
    } catch {
      return Response.json({ error: "job-not-accepted" }, { status: 422 });
    }
  };
}
/** The durable runner supplies a fenced claim and persists the returned result before acknowledging it. */
export async function runMarketingWorkerJob(request: MarketingWorkerRequest, dependencies: {
  model: MarketingModel; tracer?: MarketingTracer; storage: MarketingAssetStorage;
  budget?: GenerationBudget; signal?: AbortSignal; templateRoot?: string;
  reloadSource(sourceId: string): Promise<unknown>;
  reloadTemplate?(version: string): Promise<MarketingTemplate | null>;
}): Promise<MarketingWorkerResult> {
  const job = MarketingWorkerRequestSchema.parse(request);
  if (dependencies.reloadTemplate) {
    const currentTemplate = await dependencies.reloadTemplate(job.template.version);
    if (!currentTemplate || contentHash(currentTemplate) !== contentHash(job.template)) throw new Error("template-superseded");
  }
  validateMarketingTemplate(job.template as MarketingTemplate, true);
  const expected = parseSourcePacket(job.generation.source);
  const assertCurrentSource = async () => {
    const current = parseSourcePacket(await dependencies.reloadSource(expected.sourceId));
    if (!sourceUsable(current) || current.sourceRevision !== expected.sourceRevision || current.contentHash !== expected.contentHash || contentHash(current.content) !== expected.contentHash) throw new Error("source-superseded");
  };
  await assertCurrentSource();
  const draft = await generateMarketingDraft({ ...job.generation, source: expected }, dependencies);
  const renderStartedAt = Date.now();
  const assets = draft.revision.account.platform === "instagram"
    ? await renderMarketingAssets({ draft, template: job.template, revisionId: job.generation.revisionId, templateRoot: dependencies.templateRoot }, dependencies.storage)
    : [];
  await assertCurrentSource();
  const revision = { ...draft.revision, assets };
  if (revisionReadiness(revision).length) throw new Error("revision-not-ready");
  const finalHash = revisionHash(revision);
  if (draft.traceId) await dependencies.tracer?.recordPreparedRevision?.({ traceId: draft.traceId, revisionId: job.generation.revisionId, revisionHash: finalHash, assetHashes: assets.map((asset) => asset.sha256), templateSha256: job.template.templateSha256, latencyMs: Date.now() - renderStartedAt });
  return { ...draft, revision, revisionHash: finalHash };
}
