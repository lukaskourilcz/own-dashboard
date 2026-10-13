import { NextResponse } from "next/server";
import { authenticateAutomation } from "@/lib/marketing/automation-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { WorkerKnowledgeCallbackSchema } from "@/lib/marketing/knowledge-providers";
import { knowledgeSourceFromRow } from "@/lib/marketing/knowledge";
import { pollQueuedKnowledgeAnalysis } from "@/lib/marketing/knowledge-runner";
import { readKnowledgeBody } from "@/lib/marketing/knowledge-body";
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
/** Native Apify -> n8n -> signed notification. Captions/transcripts are fetched
 * from the registered run/dataset on the server, never trusted from callbacks. */
export async function POST(request: Request) {
  let raw: string;
  try { raw = await readKnowledgeBody(request); } catch { return fail(413, "knowledge-callback-too-large"); }
  let principal: ReturnType<typeof authenticateAutomation>;
  try { principal = authenticateAutomation(request, raw); } catch { return fail(401, "unauthorized"); }
  if (!principal || principal.role !== "worker") return fail(401, "unauthorized");
  try {
    const callback = WorkerKnowledgeCallbackSchema.parse(JSON.parse(raw));
    if (callback.capture || callback.extraction || callback.usage) return fail(400, "callback-source-text-forbidden");
    const db = createAdminClient();
    const { data: row, error } = await db.from("marketing_knowledge_sources").select("*").eq("user_id", principal.ownerId).eq("id", callback.sourceId).maybeSingle();
    if (error || !row) return fail(404, "source-unavailable");
    const source = knowledgeSourceFromRow(row);
    if (source.analysis_key !== callback.analysisKey) return fail(409, "stale-analysis");
    if (source.analysis_request?.provider !== "apify" || !source.run_id || source.run_id !== callback.runId || source.dataset_id !== callback.datasetId) return fail(409, "unexpected-registered-run");
    if (source.status !== "analyzing") return NextResponse.json({ duplicate: true, status: source.status });
    const result = await pollQueuedKnowledgeAnalysis(principal.ownerId, callback.sourceId);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return fail(400, "knowledge-callback-invalid"); }
}
