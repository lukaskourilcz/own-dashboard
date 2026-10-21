import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { contentHash } from "./hashes";
import type { SourcePacket } from "./contracts";
import type { ModelUsage } from "./generation";
import type { MarketingBenchmarkResult } from "./generation-benchmark";
import { MARKETING_PREPARATION_FAILURE_CODES } from "./render";
import type { DneskaiDeck } from "./dneskai-slides";
import { OwnerEditCountsSchema, ownerEditCount, type OwnerEditCounts } from "./owner-edits";

export const LANGSMITH_EU_ENDPOINT = "https://eu.api.smith.langchain.com";
/**
 * Every LangSmith step gives up after this, whatever the SDK's own one-second request timeout does: a slow or hung
 * EU endpoint never holds a generation, a render or an owner decision (#122). A step is at most three requests.
 */
export const LANGSMITH_DIAGNOSTIC_DEADLINE_MS = 3000;
/** A dataset upload sends one request per batch of examples; it runs only from the owner's terminal. */
const LANGSMITH_DATASET_DEADLINE_MS = 60000;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const CODE = /^[a-z0-9-]{1,80}$/;
const code = z.string().regex(CODE);
/** Issue and failure codes only: anything else is dropped, never sent and never thrown on. */
const codes = (values: readonly unknown[]): string[] => values.filter((value): value is string => typeof value === "string" && CODE.test(value));
/** sha256 of an identifier's UTF-8 bytes, so `printf %s "$id" | sha256sum` finds the trace of a known brief. */
export function traceIdentifierHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
const slideCount = z.number().int().min(1).max(10).optional();
const metadataSchema = z.strictObject({
  revision_id: z.uuid(), source_id_hash: hash, source_revision_hash: hash, source_content_hash: hash,
  brand: z.enum(["dneskai", "devshark"]), locale: z.enum(["cs", "en"]),
  model: z.string().regex(/^claude-[a-z0-9.-]+$/), prompt_version_hash: hash, template_version_hash: hash,
  knowledge_ids: z.array(z.uuid()).max(8),
  // A DNESKAi brief (#115): which event and which member set, as hashes, and how many source pictures it offered.
  event_id_hash: hash.optional(), member_hash_hash: hash.optional(), media_count: z.number().int().min(0).max(30).optional(),
});
export type TraceStart = {
  revisionId: string; source: SourcePacket; model: string; promptVersion: string; templateVersion: string; knowledgeIds: string[];
};
export type TraceStage = { name: "generation" | "render" | "validation"; attempt: number; latencyMs: number; usage: ModelUsage; costUsd: number; issues: string[] };
export type TraceFinish = {
  status: "review" | "failed"; revisionHash: string | null;
  usage: ModelUsage & { attempts: number; estimatedCostUsd: number }; issues: string[];
  /** The generated deck of a brief. Only its format, slide types and picture count reach the trace. */
  deck?: Pick<DneskaiDeck, "format" | "slides"> | null;
};
export interface MarketingTrace {
  id: string;
  stage(event: TraceStage): Promise<void>;
  finish(event: TraceFinish): Promise<void>;
}
export type PreparedRevisionTrace = { traceId: string; revisionId: string; revisionHash: string; assetHashes: string[]; templateSha256: string; latencyMs: number };
export interface MarketingTracer {
  start(input: TraceStart): Promise<MarketingTrace | null>;
  recordPreparedRevision?(input: PreparedRevisionTrace): Promise<boolean>;
  recordPreparationFailure?(input: { traceId: string; revisionId: string; code: string }): Promise<boolean>;
}
/** Only identifiers needed to resolve the exact stored source/revision leave the worker. */
export function marketingTraceMetadata(input: TraceStart) {
  const brief = input.source.kind === "brief" ? input.source.brief : undefined;
  return metadataSchema.parse({
    revision_id: input.revisionId, source_id_hash: contentHash(input.source.sourceId),
    source_revision_hash: contentHash(input.source.sourceRevision), source_content_hash: input.source.contentHash,
    brand: input.source.brand, locale: input.source.locale, model: input.model,
    prompt_version_hash: contentHash(input.promptVersion), template_version_hash: contentHash(input.templateVersion),
    knowledge_ids: input.knowledgeIds,
    ...(brief ? { event_id_hash: traceIdentifierHash(brief.eventId), member_hash_hash: traceIdentifierHash(brief.memberHash), media_count: brief.media.length } : {}),
  });
}
/** What a trace says about a deck: its format, how many slides of each type and how many distinct pictures. No text. */
export function dneskaiDeckTraceShape(deck: Pick<DneskaiDeck, "format" | "slides">) {
  const slideTypes: Partial<Record<DneskaiDeck["slides"][number]["type"], number>> = {};
  for (const slide of deck.slides) slideTypes[slide.type] = (slideTypes[slide.type] ?? 0) + 1;
  return { format: deck.format, slide_types: slideTypes, deck_media_count: new Set(deck.slides.flatMap((slide) => slide.images.map((image) => image.assetSha256))).size };
}
const diagnosticsSchema = z.strictObject({
  stage: z.enum(["generation", "render", "validation"]), attempt: z.number().int().min(0).max(3),
  latency_ms: z.number().nonnegative(), input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative(), issue_codes: z.array(code).max(30),
});
/** A failed trace keeps both attempts' issue codes and its final code, within the 30 the metadata holds. */
function failedIssueCodes(generationIssues: ReadonlySet<string>, issues: readonly string[]): string[] {
  const final = issues.at(-1);
  const earlier = [...new Set([...generationIssues, ...issues.slice(0, -1)])].filter((value) => value !== final);
  return final === undefined ? earlier.slice(0, 30) : [...earlier.slice(0, 29), final];
}
const finishSchema = z.strictObject({
  status: z.enum(["review", "failed"]), revision_hash: hash.nullable(), attempts: z.number().int().min(0).max(3), input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(), estimated_cost_usd: z.number().nonnegative(), issue_codes: z.array(code).max(30),
  // Issue codes of the attempts that were answered with a retry; and, for a brief, the shape of the deck.
  retry_reasons: z.array(code).max(30).optional(),
  format: z.enum(["carousel", "single-image"]).optional(),
  slide_types: z.strictObject({ "cover-photo": slideCount, figure: slideCount, split: slideCount, statement: slideCount, sources: slideCount, single: slideCount }).optional(),
  deck_media_count: z.number().int().min(0).max(10).optional(),
});
const preparedSchema = z.strictObject({ revision_id: z.uuid(), revision_hash: hash, asset_hashes: z.array(hash).max(10), template_sha256: hash, render_latency_ms: z.number().nonnegative() });
const fullMetadataSchema = metadataSchema.extend(finishSchema.shape).extend({ asset_hashes: z.array(hash).max(10).optional(), template_sha256: hash.optional(), render_latency_ms: z.number().nonnegative().optional() });
type FullMetadata = z.infer<typeof fullMetadataSchema>;
export type OwnerFeedback = {
  traceId: string; revisionId: string; revisionHash: string; decision: "approved" | "returned" | "skipped" | "edited";
  /** Required on a decision, absent on an edit (`owner-feedback.ts` scores: 1, 0.5 after edits, 0). */
  qualityScore?: number;
  /** Edit-kind counts from the revision's `replaces_id` chain: the whole chain on a decision, the last save on an edit. */
  editKinds?: OwnerEditCounts;
  generatedRevisionId?: string; generatedRevisionHash?: string;
};
const ownerFeedbackSchema = z.strictObject({
  traceId: z.uuid(), revisionId: z.uuid(), revisionHash: hash, decision: z.enum(["approved", "returned", "skipped", "edited"]), qualityScore: z.number().min(0).max(1).optional(),
  editKinds: OwnerEditCountsSchema.optional(), generatedRevisionId: z.uuid().optional(), generatedRevisionHash: hash.optional(),
}).refine((value) => (value.generatedRevisionId === undefined) === (value.generatedRevisionHash === undefined), { message: "generated-revision-pair-required" })
  .refine((value) => (value.decision === "edited") === (value.qualityScore === undefined), { message: "owner-score-invalid" });
/** One example of the `dneskai-owner-edits` dataset: hashes, edit-kind counts, character deltas and the score. */
export const OwnerEditExampleSchema = z.strictObject({
  exampleId: z.uuid(), traceId: z.uuid().nullable(), revisionHash: hash, generatedRevisionHash: hash,
  model: z.string().regex(/^claude-[a-z0-9.-]+$/), promptVersionHash: hash,
  decision: z.enum(["approved", "returned", "skipped"]), score: z.number().min(0).max(1),
  editKinds: OwnerEditCountsSchema, editCount: z.number().int().min(0).max(10000), chainLength: z.number().int().min(1).max(20),
  captionLengthDelta: z.number().int().min(-10000).max(10000), slideTextLengthDelta: z.number().int().min(-100000).max(100000),
});
export type OwnerEditExample = z.infer<typeof OwnerEditExampleSchema>;
export interface LangSmithMarketingTracer extends MarketingTracer {
  recordOwnerFeedback(input: OwnerFeedback): Promise<boolean>;
  writeBenchmarkExamples(datasetId: string, results: MarketingBenchmarkResult[]): Promise<boolean>;
  /** Creates the dataset when missing and creates or updates each example by its id. `null` when LangSmith refused or timed out. */
  upsertOwnerEditExamples(datasetName: string, examples: OwnerEditExample[]): Promise<{ created: number; updated: number } | null>;
  getTraceUrl(traceId: string): Promise<string | null>;
  flush(): Promise<void>;
}
/** A UUID (version 8) derived from its parts: one owner decision on one revision hash is one feedback record. */
export function derivedUuid(...parts: string[]): string {
  const hex = createHash("sha256").update(["owner-dashboard-marketing/1", ...parts].join("\n")).digest("hex");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** Explicit SDK writes avoid LangChain callback/env tracing and raw prompts, URLs, logs, errors, or feedback text. */
export async function createMarketingTracer(config: { apiKey: string; projectName: string; endpoint?: string }): Promise<LangSmithMarketingTracer> {
  if (!config.apiKey || !/^[a-zA-Z0-9_-]{1,80}$/.test(config.projectName)) throw new Error("langsmith-configuration-required");
  if (config.endpoint && config.endpoint !== LANGSMITH_EU_ENDPOINT) throw new Error("langsmith-eu-required");
  const { Client } = await import("langsmith");
  const client = new Client({
    apiKey: config.apiKey, apiUrl: LANGSMITH_EU_ENDPOINT, webUrl: "https://eu.smith.langchain.com", hideInputs: true, hideOutputs: true,
    hideMetadata: (metadata) => {
      const combined = fullMetadataSchema.safeParse(metadata);
      if (combined.success) return combined.data;
      const start = metadataSchema.safeParse(metadata);
      if (start.success) return start.data;
      const stage = diagnosticsSchema.safeParse(metadata);
      if (stage.success) return stage.data;
      const finish = finishSchema.safeParse(metadata);
      return finish.success ? finish.data : {};
    },
    anonymizer: () => ({}), omitTracedRuntimeInfo: true, autoBatchTracing: false, debug: false, tracingMode: "langsmith", disablePromptCache: true, timeout_ms: 1000, callerOptions: { maxRetries: 0 },
  });
  const safeWrite = async (write: () => Promise<unknown>, deadlineMs = LANGSMITH_DIAGNOSTIC_DEADLINE_MS): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => { await write(); return true; })(),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), deadlineMs); timer.unref?.(); }),
      ]);
    } catch { return false; } finally { clearTimeout(timer); }
  };
  // The root metadata this tracer last wrote, so the render step does not depend on LangSmith having indexed the run.
  const roots = new Map<string, FullMetadata>();
  const remember = (id: string, metadata: FullMetadata) => {
    roots.set(id, metadata);
    while (roots.size > 50) roots.delete(roots.keys().next().value!);
  };
  const rootMetadata = async (traceId: string): Promise<FullMetadata> => roots.get(traceId) ?? fullMetadataSchema.parse((await client.readRun(traceId)).extra?.metadata);
  return {
    async start(input) {
      let metadata: z.infer<typeof metadataSchema>;
      try { metadata = marketingTraceMetadata(input); } catch { return null; }
      const id = randomUUID();
      if (!await safeWrite(() => client.createRun({ id, name: "marketing-generation", run_type: "chain", inputs: {}, project_name: config.projectName, start_time: Date.now(), extra: { metadata } }))) return null;
      const generationIssues = new Set<string>();
      return {
        id,
        async stage(event) {
          try {
            const metadata = diagnosticsSchema.parse({ stage: event.name, attempt: event.attempt, latency_ms: event.latencyMs, input_tokens: event.usage.inputTokens, output_tokens: event.usage.outputTokens, estimated_cost_usd: event.costUsd, issue_codes: [...new Set(codes(event.issues))].slice(0, 30) });
            if (event.name === "generation") for (const issue of metadata.issue_codes) generationIssues.add(issue);
            const child = randomUUID();
            await safeWrite(() => client.createRun({ id: child, name: `marketing-${event.name}`, run_type: event.name === "generation" ? "llm" : "tool", parent_run_id: id, trace_id: id, inputs: {}, project_name: config.projectName, start_time: Date.now() - event.latencyMs, end_time: Date.now(), extra: { metadata } }));
          } catch { /* Diagnostics never decide a generation. */ }
        },
        async finish(event) {
          try {
            const issues = codes(event.issues);
            const retryReasons = [...generationIssues].slice(0, 30);
            const finished = finishSchema.parse({ status: event.status, revision_hash: event.revisionHash, attempts: event.usage.attempts, input_tokens: event.usage.inputTokens, output_tokens: event.usage.outputTokens, estimated_cost_usd: event.usage.estimatedCostUsd,
              issue_codes: event.status === "failed" ? failedIssueCodes(generationIssues, issues) : [...new Set(issues)].slice(0, 30),
              ...(retryReasons.length ? { retry_reasons: retryReasons } : {}), ...(event.deck ? dneskaiDeckTraceShape(event.deck) : {}) });
            const full = fullMetadataSchema.parse({ ...metadata, ...finished });
            remember(id, full);
            await safeWrite(() => client.updateRun(id, { end_time: Date.now(), outputs: {}, error: event.status === "failed" ? "marketing-generation-failed" : undefined, extra: { metadata: full } }));
          } catch { /* Diagnostics never decide a generation. */ }
        },
      };
    },
    async recordPreparedRevision(input) {
      const traceId = z.uuid().parse(input.traceId);
      const prepared = preparedSchema.parse({ revision_id: input.revisionId, revision_hash: input.revisionHash, asset_hashes: input.assetHashes, template_sha256: input.templateSha256, render_latency_ms: input.latencyMs });
      return safeWrite(async () => {
        const previous = await rootMetadata(traceId);
        if (previous.revision_id !== prepared.revision_id) throw new Error("trace-revision-mismatch");
        await client.createRun({ id: randomUUID(), name: "marketing-render", run_type: "tool", parent_run_id: traceId, trace_id: traceId, inputs: {}, project_name: config.projectName, start_time: Date.now() - prepared.render_latency_ms, end_time: Date.now(), extra: { metadata: { stage: "render", attempt: 0, latency_ms: prepared.render_latency_ms, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, issue_codes: [] } } });
        const metadata = fullMetadataSchema.parse({ ...previous, ...prepared });
        await client.updateRun(traceId, { end_time: Date.now(), outputs: {}, extra: { metadata } });
        roots.delete(traceId);
      });
    },
    async recordPreparationFailure(input) {
      const parsed = z.strictObject({ traceId: z.uuid(), revisionId: z.uuid(), code: z.enum(MARKETING_PREPARATION_FAILURE_CODES) }).parse(input);
      return safeWrite(async () => {
        const previous = await rootMetadata(parsed.traceId);
        if (previous.revision_id !== parsed.revisionId) throw new Error("trace-revision-mismatch");
        const metadata = fullMetadataSchema.parse({ ...previous, status: "failed", issue_codes: [...new Set([...previous.issue_codes, parsed.code])].slice(-30) });
        await client.updateRun(parsed.traceId, { end_time: Date.now(), outputs: {}, error: "marketing-preparation-failed", extra: { metadata } });
        roots.delete(parsed.traceId);
      });
    },
    async recordOwnerFeedback(input) {
      const feedback = ownerFeedbackSchema.parse(input);
      const key = feedback.decision === "edited" ? "owner-edit" : "owner-review";
      return safeWrite(async () => {
        const run = await client.readRun(feedback.traceId);
        const metadata = fullMetadataSchema.parse(run.extra?.metadata);
        if (metadata.revision_id !== (feedback.generatedRevisionId ?? feedback.revisionId) || metadata.revision_hash !== (feedback.generatedRevisionHash ?? feedback.revisionHash)) throw new Error("trace-revision-mismatch");
        const sourceInfo = {
          revision_id: feedback.revisionId, revision_hash: feedback.revisionHash,
          ...(feedback.generatedRevisionId ? { generated_revision_id: feedback.generatedRevisionId, generated_revision_hash: feedback.generatedRevisionHash } : {}),
          ...(feedback.editKinds ? { edit_kinds: feedback.editKinds, edit_count: ownerEditCount(feedback.editKinds) } : {}),
          ...(feedback.decision === "skipped" ? { reason: "skip" } : {}),
        };
        const options = { ...(feedback.qualityScore === undefined ? {} : { score: feedback.qualityScore }), value: feedback.decision, sourceInfo,
          feedbackId: derivedUuid("owner-feedback", key, feedback.decision, feedback.revisionId, feedback.revisionHash) };
        // The project id lets LangSmith find the run without a server-info lookup, which deployments without it require.
        if (run.session_id) await client.createFeedback({ runId: feedback.traceId, sessionId: run.session_id, key, ...options });
        else await client.createFeedback(feedback.traceId, key, options);
      });
    },
    async writeBenchmarkExamples(datasetId, results) {
      z.uuid().parse(datasetId);
      const rows = z.array(z.strictObject({ exampleIdHash: hash, brand: z.enum(["dneskai", "devshark"]), sourceIdHash: hash, sourceRevisionHash: hash, sourceContentHash: hash, issueCodes: z.array(code).max(30), passed: z.boolean() })).max(50).parse(results);
      return safeWrite(async () => {
        for (const row of rows) {
          await client.createExample({ dataset_id: datasetId, inputs: { example_hash: row.exampleIdHash, brand: row.brand, source_id_hash: row.sourceIdHash, source_revision_hash: row.sourceRevisionHash, source_content_hash: row.sourceContentHash }, outputs: { issue_codes: row.issueCodes, passed: row.passed }, metadata: { evaluation_kind: "deterministic-qa/1" } });
        }
      });
    },
    async upsertOwnerEditExamples(datasetName, examples) {
      const name = z.string().regex(/^[a-z0-9-]{1,80}$/).parse(datasetName);
      const rows = z.array(OwnerEditExampleSchema).max(5000).parse(examples);
      let result: { created: number; updated: number } | null = null;
      const written = await safeWrite(async () => {
        const dataset = await client.hasDataset({ datasetName: name })
          ? await client.readDataset({ datasetName: name })
          : await client.createDataset(name, { description: "DNESKAi owner decisions: revision hashes, edit-kind counts and scores. No text.", metadata: { dataset_kind: "dneskai-owner-edits/1" } });
        const existing = new Set<string>();
        for await (const example of client.listExamples({ datasetId: dataset.id })) existing.add(example.id);
        const toExample = (row: OwnerEditExample) => ({
          id: row.exampleId, dataset_id: dataset.id,
          inputs: { generated_revision_hash: row.generatedRevisionHash, model: row.model, prompt_version_hash: row.promptVersionHash },
          outputs: { revision_hash: row.revisionHash, decision: row.decision, score: row.score, edit_kinds: row.editKinds, edit_count: row.editCount, chain_length: row.chainLength,
            caption_length_delta: row.captionLengthDelta, slide_text_length_delta: row.slideTextLengthDelta, ...(row.decision === "skipped" ? { reason: "skip" } : {}) },
          metadata: { dataset_kind: "dneskai-owner-edits/1", ...(row.traceId ? { trace_id: row.traceId } : {}) },
        });
        const created = rows.filter((row) => !existing.has(row.exampleId)).map(toExample);
        const updated = rows.filter((row) => existing.has(row.exampleId)).map(toExample);
        for (let offset = 0; offset < created.length; offset += 100) await client.createExamples(created.slice(offset, offset + 100));
        for (let offset = 0; offset < updated.length; offset += 100) await client.updateExamples(updated.slice(offset, offset + 100));
        result = { created: created.length, updated: updated.length };
      }, LANGSMITH_DATASET_DEADLINE_MS);
      return written ? result : null;
    },
    async getTraceUrl(traceId) {
      z.uuid().parse(traceId);
      try {
        const url = await client.getRunUrl({ runId: traceId });
        return new URL(url).hostname === "eu.smith.langchain.com" ? url : null;
      } catch { return null; }
    },
    async flush() { await safeWrite(() => client.awaitPendingTraceBatches()); },
  };
}
