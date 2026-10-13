import { marketingJobsHttpHandler, MarketingWorkerRuntimeError } from "@/lib/marketing/worker-runtime";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try { return await marketingJobsHttpHandler(request); }
  catch (error) { return Response.json({ error: error instanceof MarketingWorkerRuntimeError ? error.code : "job-request-failed" }, { status: error instanceof MarketingWorkerRuntimeError && error.code === "payload-too-large" ? 413 : 400 }); }
}
