import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateAutomation } from "@/lib/marketing/automation-auth";
import { executeMarketingJob, readBoundedMarketingJobBody, MarketingWorkerRuntimeError } from "@/lib/marketing/worker-runtime";
import { refreshSource } from "@/lib/marketing/source-refresh";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const raw = await readBoundedMarketingJobBody(request);
    const principal = authenticateAutomation(request, raw);
    if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (principal.role !== "worker") return Response.json({ error: "forbidden" }, { status: 403 });
    const { id } = await context.params;
    const body = z.strictObject({ jobId: z.uuid() }).parse(JSON.parse(raw));
    if (body.jobId !== id) return Response.json({ error: "job-id-mismatch" }, { status: 400 });
    return Response.json(await executeMarketingJob(createAdminClient(), principal.ownerId, body.jobId, { signal: request.signal, refreshSource }));
  } catch (error) {
    const code = error instanceof MarketingWorkerRuntimeError ? error.code : "job-execute-failed";
    return Response.json({ error: code }, { status: code === "payload-too-large" ? 413 : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 409 });
  }
}
