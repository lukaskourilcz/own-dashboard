import { z } from "zod";
import { contentHash } from "./hashes";
import { MediaEvidenceSchema, KnowledgeContentSchema, type KnowledgeSource, type KnowledgeContent } from "./knowledge";

export const APIFY_INSTAGRAM_ACTOR = "apify~instagram-scraper";
/** Reviewable descriptors only. Neither this helper nor the owner API starts a paid run. */
export function prepareApifyKnowledgeRun(sources: readonly KnowledgeSource[], budgetUsd = 0.25) {
  if (!sources.length || sources.length > 50 || !Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 1) throw new Error("knowledge-provider-budget-invalid");
  const urls = [...new Set(sources.map((s) => s.canonical_url))];
  const input = { directUrls: urls, resultsType: "posts", resultsLimit: 1 };
  return { version: "knowledge-apify/1", provider: "apify", actorId: APIFY_INSTAGRAM_ACTOR,
    reviewHash: contentHash({ actor: APIFY_INSTAGRAM_ACTOR, input, maxItems: urls.length, maxTotalChargeUsd: budgetUsd, timeout: 120 }),
    request: { method: "POST", url: `https://api.apify.com/v2/acts/${APIFY_INSTAGRAM_ACTOR}/runs?timeout=120&maxItems=${urls.length}&maxTotalChargeUsd=${budgetUsd}`, input,
      credential: "Bearer APIFY_TOKEN from n8n credential store" },
    datasetRequest: { method: "GET", path: "/v2/datasets/<registeredDatasetId>/items", query: { format: "json", clean: true, limit: 50, offset: 0, fields: "url,shortCode,caption,timestamp,error,errorDescription" } },
    abortRequest: { method: "POST", path: "/v2/actor-runs/<registeredRunId>/abort" },
    maxCostUsd: budgetUsd, cookiesRequired: false, enumeratesPrivateSaved: false,
    note: "Captured URLs only. The post timestamp is published_at, never saved_at. Transcript/OCR require a separate reviewed adapter.",
  };
}
export const WorkerKnowledgeCallbackSchema = z.strictObject({
  eventId: z.string().min(1).max(150), sourceId: z.uuid(), analysisKey: z.string().regex(/^[a-f0-9]{64}$/),
  runId: z.string().min(1).max(100), datasetId: z.string().max(100).nullable(),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT", "BUDGET-EXCEEDED", "INACCESSIBLE"]),
  capture: z.strictObject({ caption: z.string().max(30000).nullable(), publishedAt: z.iso.datetime({ offset: true }).nullable(), transcript: MediaEvidenceSchema, ocr: MediaEvidenceSchema }).nullable(),
  extraction: z.unknown().nullable(), usage: z.strictObject({ model: z.string().regex(/^claude-[a-z0-9.-]+$/), inputTokens: z.number().int().nonnegative().max(24000), outputTokens: z.number().int().nonnegative().max(4000), costUsd: z.number().nonnegative().max(1) }).nullable(),
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
