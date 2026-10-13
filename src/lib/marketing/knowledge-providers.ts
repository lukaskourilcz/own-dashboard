import { z } from "zod";
import { contentHash } from "./hashes";
import { MediaEvidenceSchema, KnowledgeContentSchema, type KnowledgeSource, type KnowledgeContent } from "./knowledge";

export const APIFY_INSTAGRAM_ACTOR = "xMc5Ga1oCONPmWJIa";
/** Owner's observed Reel actor. Descriptor generation starts no paid run. */
export function prepareApifyKnowledgeRun(sources: readonly KnowledgeSource[], budgetUsd = 0.25, config: { actorId?: string; build?: string } = {}) {
  if (sources.length !== 1 || !Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 1) throw new Error("knowledge-provider-budget-invalid");
  const actorId = config.actorId ?? APIFY_INSTAGRAM_ACTOR;
  const build = config.build ?? null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(actorId) || (build !== null && !/^\d+\.\d+\.\d+$/.test(build))) throw new Error("knowledge-actor-configuration-invalid");
  const url = `https://www.instagram.com/reel/${sources[0].shortcode}/`;
  const input = { username: [url], resultsLimit: 1, includeTranscript: true, includeSharesCount: false, includeDownloadedVideo: false };
  const options = { actorId, build, input, maxItems: 1, maxTotalChargeUsd: budgetUsd, timeout: 120, restartOnError: false, waitForFinish: 0 };
  const params = new URLSearchParams({ timeout: "120", maxItems: "1", maxTotalChargeUsd: String(budgetUsd), restartOnError: "false", waitForFinish: "0" });
  if (build) params.set("build", build);
  return { version: "knowledge-apify/1", provider: "apify", actorId, actorBuild: build,
    reviewHash: contentHash(options), request: { method: "POST", url: `https://api.apify.com/v2/actors/${actorId}/runs?${params}`, input,
      credential: "Bearer APIFY_TOKEN from server/n8n credential store" },
    datasetRequest: { method: "GET", path: "/v2/datasets/<registeredDatasetId>/items", query: { format: "json", clean: true, limit: 2, offset: 0, fields: "url,shortCode,caption,transcript,timestamp,error,errorDescription" } },
    abortRequest: { method: "POST", path: "/v2/actor-runs/<registeredRunId>/abort" },
    maxCostUsd: budgetUsd, cookiesRequired: false, enumeratesPrivateSaved: false,
    note: "One captured reel URL; no publication-date filter. maxItems caps billable items, so reject additional dataset rows. Transcript timecodes stay unknown unless the provider returns them. A pinned build is required before execution.",
  };
}
export const WorkerKnowledgeCallbackSchema = z.strictObject({
  eventId: z.string().min(1).max(150), sourceId: z.uuid(), analysisKey: z.string().regex(/^[a-f0-9]{64}$/),
  runId: z.string().min(1).max(100), datasetId: z.string().max(100).nullable(),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT", "BUDGET-EXCEEDED", "INACCESSIBLE"]),
  capture: z.strictObject({ caption: z.string().max(30000).nullable(), publishedAt: z.iso.datetime({ offset: true }).nullable(), transcript: MediaEvidenceSchema, ocr: MediaEvidenceSchema }).nullable().default(null),
  extraction: z.unknown().nullable().default(null), usage: z.strictObject({ model: z.string().regex(/^claude-[a-z0-9.-]+$/), inputTokens: z.number().int().nonnegative().max(24000), outputTokens: z.number().int().nonnegative().max(4000), costUsd: z.number().nonnegative().max(1) }).nullable().default(null),
});
export type WorkerKnowledgeCallback = z.infer<typeof WorkerKnowledgeCallbackSchema>;
export function callbackContent(source: KnowledgeSource, callback: WorkerKnowledgeCallback): KnowledgeContent {
  if (callback.capture === null) return source.content;
  return KnowledgeContentSchema.parse({ caption: callback.capture.caption, captionProvider: "apify/instagram-scraper",
    transcript: callback.capture.transcript, ocr: callback.capture.ocr });
}
/** A caption remains caption evidence. This adapter cannot synthesize a transcript. */
export function captionOnlyDatasetItem(value: unknown): { shortcode: string; caption: string | null; publishedAt: string | null; inaccessible: boolean } {
  const row = z.object({ shortCode: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), caption: z.string().max(30000).nullable().optional(), timestamp: z.iso.datetime({ offset: true }).nullable().optional(), error: z.string().optional() }).parse(value);
  return { shortcode: row.shortCode, caption: row.caption ?? null, publishedAt: row.timestamp ?? null, inaccessible: !!row.error };
}
