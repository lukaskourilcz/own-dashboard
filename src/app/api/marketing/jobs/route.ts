import { marketingJobsHttpHandler, MarketingWorkerRuntimeError } from "@/lib/marketing/worker-runtime";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try { return await marketingJobsHttpHandler(request); }
  catch (error) {
    const code = error instanceof MarketingWorkerRuntimeError ? error.code : "job-request-failed";
    return Response.json({ error: code }, { status: code === "payload-too-large" ? 413 : code === "request-body-timeout" ? 408 : 400 });
  }
}
