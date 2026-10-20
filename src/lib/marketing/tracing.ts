import { randomUUID } from "node:crypto";
import { z } from "zod";
import { contentHash } from "./hashes";
import type { SourcePacket } from "./contracts";
import type { ModelUsage } from "./generation";
import type { MarketingBenchmarkResult } from "./generation-benchmark";
import { MARKETING_PREPARATION_FAILURE_CODES } from "./render";

export const LANGSMITH_EU_ENDPOINT = "https://eu.api.smith.langchain.com";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const metadataSchema = z.strictObject({
  revision_id: z.uuid(), source_id_hash: hash, source_revision_hash: hash, source_content_hash: hash,
  brand: z.enum(["dneskai", "devshark"]), locale: z.enum(["cs", "en"]),
  model: z.string().regex(/^claude-[a-z0-9.-]+$/), prompt_version_hash: hash, template_version_hash: hash,
  knowledge_ids: z.array(z.uuid()).max(8),
});
export type TraceStart = {
  revisionId: string; source: SourcePacket; model: string; promptVersion: string; templateVersion: string; knowledgeIds: string[];
};
export type TraceStage = { name: "generation" | "render" | "validation"; attempt: number; latencyMs: number; usage: ModelUsage; costUsd: number; issues: string[] };
export type TraceFinish = {
  status: "review" | "failed"; revisionHash: string | null;
  usage: ModelUsage & { attempts: number; estimatedCostUsd: number }; issues: string[];
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
  return metadataSchema.parse({
    revision_id: input.revisionId, source_id_hash: contentHash(input.source.sourceId),
    source_revision_hash: contentHash(input.source.sourceRevision), source_content_hash: input.source.contentHash,
    brand: input.source.brand, locale: input.source.locale, model: input.model,
    prompt_version_hash: contentHash(input.promptVersion), template_version_hash: contentHash(input.templateVersion),
    knowledge_ids: input.knowledgeIds,
  });
}
const diagnosticsSchema = z.strictObject({
  stage: z.enum(["generation", "render", "validation"]), attempt: z.number().int().min(0).max(3),
  latency_ms: z.number().nonnegative(), input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative(), issue_codes: z.array(z.string().regex(/^[a-z-]{1,80}$/)).max(30),
});
/** A failed trace keeps both attempts' issue codes and its final code, within the 30 the metadata holds. */
function failedIssueCodes(generationIssues: ReadonlySet<string>, issues: readonly string[]): string[] {
  const final = issues.at(-1);
  const earlier = [...new Set([...generationIssues, ...issues.slice(0, -1)])].filter((code) => code !== final);
  return final === undefined ? earlier.slice(0, 30) : [...earlier.slice(0, 29), final];
}
const finishSchema = z.strictObject({ status: z.enum(["review", "failed"]), revision_hash: hash.nullable(), attempts: z.number().int().min(0).max(3), input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(), estimated_cost_usd: z.number().nonnegative(), issue_codes: z.array(z.string().regex(/^[a-z-]{1,80}$/)).max(30) });
const preparedSchema = z.strictObject({ revision_id: z.uuid(), revision_hash: hash, asset_hashes: z.array(hash).max(10), template_sha256: hash, render_latency_ms: z.number().nonnegative() });
const fullMetadataSchema = metadataSchema.extend(finishSchema.shape).extend({ asset_hashes: z.array(hash).max(10).optional(), template_sha256: hash.optional(), render_latency_ms: z.number().nonnegative().optional() });
export type OwnerFeedback = { traceId: string; revisionId: string; revisionHash: string; decision: "approved" | "returned" | "skipped" | "edited"; qualityScore: number;
  generatedRevisionId?: string; generatedRevisionHash?: string };
export interface LangSmithMarketingTracer extends MarketingTracer {
  recordOwnerFeedback(input: OwnerFeedback): Promise<boolean>;
  writeBenchmarkExamples(datasetId: string, results: MarketingBenchmarkResult[]): Promise<boolean>;
  getTraceUrl(traceId: string): Promise<string | null>;
  flush(): Promise<void>;
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
  const safeWrite = async (write: () => Promise<unknown>): Promise<boolean> => {
    try { await write(); return true; } catch { return false; }
  };
  return {
    async start(input) {
      const metadata = marketingTraceMetadata(input);
      const id = randomUUID();
      if (!await safeWrite(() => client.createRun({ id, name: "marketing-generation", run_type: "chain", inputs: {}, project_name: config.projectName, start_time: Date.now(), extra: { metadata } }))) return null;
      const generationIssues = new Set<string>();
      return {
        id,
        async stage(event) {
          const metadata = diagnosticsSchema.parse({ stage: event.name, attempt: event.attempt, latency_ms: event.latencyMs, input_tokens: event.usage.inputTokens, output_tokens: event.usage.outputTokens, estimated_cost_usd: event.costUsd, issue_codes: event.issues });
          if (event.name === "generation") for (const issue of metadata.issue_codes) generationIssues.add(issue);
          const child = randomUUID();
          await safeWrite(() => client.createRun({ id: child, name: `marketing-${event.name}`, run_type: event.name === "generation" ? "llm" : "tool", parent_run_id: id, trace_id: id, inputs: {}, project_name: config.projectName, start_time: Date.now() - event.latencyMs, end_time: Date.now(), extra: { metadata } }));
        },
        async finish(event) {
          const metadata = finishSchema.parse({ status: event.status, revision_hash: event.revisionHash, attempts: event.usage.attempts, input_tokens: event.usage.inputTokens, output_tokens: event.usage.outputTokens, estimated_cost_usd: event.usage.estimatedCostUsd, issue_codes: event.status === "failed" ? failedIssueCodes(generationIssues, event.issues) : event.issues });
          await safeWrite(() => client.updateRun(id, { end_time: Date.now(), outputs: {}, error: event.status === "failed" ? "marketing-generation-failed" : undefined, extra: { metadata: { ...marketingTraceMetadata(input), ...metadata } } }));
        },
      };
    },
    async recordPreparedRevision(input) {
      const traceId = z.uuid().parse(input.traceId);
      const prepared = preparedSchema.parse({ revision_id: input.revisionId, revision_hash: input.revisionHash, asset_hashes: input.assetHashes, template_sha256: input.templateSha256, render_latency_ms: input.latencyMs });
      return safeWrite(async () => {
        const run = await client.readRun(traceId);
        const previous = fullMetadataSchema.parse(run.extra?.metadata);
        if (previous.revision_id !== prepared.revision_id) throw new Error("trace-revision-mismatch");
        await client.createRun({ id: randomUUID(), name: "marketing-render", run_type: "tool", parent_run_id: traceId, trace_id: traceId, inputs: {}, project_name: config.projectName, start_time: Date.now() - prepared.render_latency_ms, end_time: Date.now(), extra: { metadata: { stage: "render", attempt: 0, latency_ms: prepared.render_latency_ms, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, issue_codes: [] } } });
        await client.updateRun(traceId, { end_time: Date.now(), outputs: {}, extra: { metadata: { ...previous, ...prepared } } });
      });
    },
    async recordPreparationFailure(input) {
      const parsed = z.strictObject({ traceId: z.uuid(), revisionId: z.uuid(), code: z.enum(MARKETING_PREPARATION_FAILURE_CODES) }).parse(input);
      return safeWrite(async () => {
        const run = await client.readRun(parsed.traceId);
        const previous = fullMetadataSchema.parse(run.extra?.metadata);
        if (previous.revision_id !== parsed.revisionId) throw new Error("trace-revision-mismatch");
        const metadata = fullMetadataSchema.parse({ ...previous, status: "failed", issue_codes: [...new Set([...previous.issue_codes, parsed.code])] });
        await client.updateRun(parsed.traceId, { end_time: Date.now(), outputs: {}, error: "marketing-preparation-failed", extra: { metadata } });
      });
    },
    async recordOwnerFeedback(input) {
      const feedback = z.strictObject({ traceId: z.uuid(), revisionId: z.uuid(), revisionHash: hash, decision: z.enum(["approved", "returned", "skipped", "edited"]), qualityScore: z.number().min(0).max(1),
        generatedRevisionId: z.uuid().optional(), generatedRevisionHash: hash.optional() }).refine((value) => (value.generatedRevisionId === undefined) === (value.generatedRevisionHash === undefined), { message: "generated-revision-pair-required" }).parse(input);
      return safeWrite(async () => {
        const run = await client.readRun(feedback.traceId);
        const metadata = fullMetadataSchema.parse(run.extra?.metadata);
        if (metadata.revision_id !== (feedback.generatedRevisionId ?? feedback.revisionId) || metadata.revision_hash !== (feedback.generatedRevisionHash ?? feedback.revisionHash)) throw new Error("trace-revision-mismatch");
        await client.createFeedback(feedback.traceId, "owner-review", { score: feedback.qualityScore, value: feedback.decision, sourceInfo: { revision_id: feedback.revisionId, revision_hash: feedback.revisionHash,
          ...(feedback.generatedRevisionId ? { generated_revision_id: feedback.generatedRevisionId, generated_revision_hash: feedback.generatedRevisionHash } : {}) } });
      });
    },
    async writeBenchmarkExamples(datasetId, results) {
      z.uuid().parse(datasetId);
      const rows = z.array(z.strictObject({ exampleIdHash: hash, brand: z.enum(["dneskai", "devshark"]), sourceIdHash: hash, sourceRevisionHash: hash, sourceContentHash: hash, issueCodes: z.array(z.string().regex(/^[a-z-]{1,80}$/)).max(30), passed: z.boolean() })).max(50).parse(results);
      return safeWrite(async () => {
        for (const row of rows) {
          await client.createExample({ dataset_id: datasetId, inputs: { example_hash: row.exampleIdHash, brand: row.brand, source_id_hash: row.sourceIdHash, source_revision_hash: row.sourceRevisionHash, source_content_hash: row.sourceContentHash }, outputs: { issue_codes: row.issueCodes, passed: row.passed }, metadata: { evaluation_kind: "deterministic-qa/1" } });
        }
      });
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
