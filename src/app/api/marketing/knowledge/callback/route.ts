import { NextResponse } from "next/server";
import { authenticateAutomation } from "@/lib/marketing/automation-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { WorkerKnowledgeCallbackSchema, callbackContent } from "@/lib/marketing/knowledge-providers";
import { KnowledgeSourceSchema, KnowledgeItemSchema, KNOWLEDGE_PROMPT_VERSION, emptyReferences, procedureHash, validateProcedureEvidence, type KnowledgeItem } from "@/lib/marketing/knowledge";
import { KnowledgeExtractionSchema, knowledgeAnalysisKey } from "@/lib/marketing/knowledge-extraction";
import { readKnowledgeBody } from "@/lib/marketing/knowledge-body";
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
/** n8n verifies the Apify event/run/dataset, then forwards this signed wrapper.
 * Native Apify webhooks cannot calculate this dynamic HMAC. */
export async function POST(request: Request) {
  let raw: string;
  try { raw = await readKnowledgeBody(request); } catch { return fail(413, "knowledge-callback-too-large"); }
  let principal: ReturnType<typeof authenticateAutomation>;
  try { principal = authenticateAutomation(request, raw); } catch { return fail(401, "unauthorized"); }
  if (!principal || principal.role !== "worker") return fail(401, "unauthorized");
  try {
    const callback = WorkerKnowledgeCallbackSchema.parse(JSON.parse(raw));
    const db = createAdminClient();
    const { data: row, error } = await db.from("marketing_knowledge_sources").select("*").eq("user_id", principal.ownerId).eq("id", callback.sourceId).maybeSingle();
    if (error || !row) return fail(404, "source-unavailable");
    const source = KnowledgeSourceSchema.parse({ shortcode: row.shortcode, canonical_url: row.canonical_url, saved_at: row.saved_at, saved_at_status: row.saved_at_status,
      published_at: row.published_at, imported_at: row.imported_at, cutoff: row.cutoff, content: row.content, status: row.status, provenance: row.provenance,
      analysis_key: row.analysis_key, budget_usd: Number(row.budget_usd), run_id: row.run_id, dataset_id: row.dataset_id, analysis: row.analysis });
    if (source.analysis_key !== callback.analysisKey) return fail(409, "stale-analysis");
    if (source.run_id && source.run_id !== callback.runId) return fail(409, "unexpected-run");
    if (source.dataset_id && source.dataset_id !== callback.datasetId) return fail(409, "unexpected-dataset");
    if (["captured", "partial"].includes(source.status) && source.run_id === callback.runId && callback.status === "SUCCEEDED" && callback.capture) return NextResponse.json({ duplicate: true, status: source.status });
    if (["review", "cancelled", "failed", "inaccessible"].includes(source.status)) return NextResponse.json({ duplicate: true, status: source.status });
    if (!["queued", "analyzing"].includes(source.status)) return fail(409, "analysis-not-queued");
    let items: KnowledgeItem[] = [];
    const updated = { ...source, content: callbackContent(source, callback), run_id: callback.runId, dataset_id: callback.datasetId,
      published_at: callback.capture?.publishedAt ?? source.published_at };
    if (callback.status === "RUNNING") {
      if (callback.capture || callback.extraction || callback.usage) return fail(400, "invalid-running-callback");
      updated.status = "analyzing";
    } else if (callback.status === "SUCCEEDED") {
      if (!!callback.capture === !!callback.extraction) return fail(400, "one-callback-stage-required");
      if (callback.extraction) {
        if (!callback.usage || callback.usage.costUsd > source.budget_usd || knowledgeAnalysisKey(source, callback.usage.model) !== callback.analysisKey) return fail(400, "analysis-usage-or-key-invalid");
        const extraction = KnowledgeExtractionSchema.parse(callback.extraction);
        if (extraction.procedures.some((procedure) => validateProcedureEvidence(procedure, [source]).length > 0)) return fail(400, "unsupported-evidence");
        items = extraction.procedures.map((item) => KnowledgeItemSchema.parse({ ...item, aiLinkId: null, procedureHash: procedureHash(item), sourceShortcodes: [source.shortcode], references: emptyReferences(), evidenceStatus: "needs-review" }));
        updated.analysis = { model: callback.usage.model, promptVersion: KNOWLEDGE_PROMPT_VERSION, inputTokens: callback.usage.inputTokens, outputTokens: callback.usage.outputTokens, costUsd: callback.usage.costUsd,
          missingParts: [...extraction.missingParts, ...(source.content.transcript.status !== "available" ? ["Actual transcript unavailable"] : []), ...(source.content.ocr.status !== "available" ? ["OCR unavailable"] : [])] };
        updated.status = "review";
      } else {
        if (callback.usage) return fail(400, "caption-stage-is-not-model-analysis");
        updated.status = updated.content.caption || updated.content.transcript.status === "available" || updated.content.ocr.status === "available" ? "captured" : "partial";
      }
    } else {
      if (callback.capture || callback.extraction || callback.usage) return fail(400, "invalid-failure-callback");
      updated.status = callback.status === "ABORTED" ? "cancelled" : callback.status === "INACCESSIBLE" ? "inaccessible" : "failed";
    }
    const { data, error: savedError } = await db.rpc("marketing_import_knowledge", { p_owner: principal.ownerId, p_sources: [updated], p_items: items, p_event_id: `callback:${callback.eventId}` });
    return savedError ? fail(503, "knowledge-callback-save-failed") : NextResponse.json({ saved: data, status: updated.status });
  } catch { return fail(400, "knowledge-callback-invalid"); }
}
