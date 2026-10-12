import { marketingJobsHttpHandler } from "@/lib/marketing/worker-runtime";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try { return await marketingJobsHttpHandler(request); }
  catch { return Response.json({ error: "job-read-failed" }, { status: 409 }); }
}
