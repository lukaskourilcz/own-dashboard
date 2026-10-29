import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { OSLO_JOBS } from "@/lib/jobs/oslo-research";
import { verifyListings } from "@/lib/jobs/availability";
import type { JobListing } from "@/lib/types";

export const maxDuration = 30;
/** Explicit one-role check; no background runs and no arbitrary destination. */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limit = await rateLimit(user.id, {
    key: "career-research-check",
    limit: 20,
    windowSec: 600,
  });
  if (!limit.ok)
    return NextResponse.json(
      { error: "Please wait" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  const body = await request.json().catch(() => null);
  const job = OSLO_JOBS.find((row) => row.id === body?.id);
  if (!job)
    return NextResponse.json(
      { error: "Unknown research position" },
      { status: 404 },
    );
  const states = await verifyListings([
    { id: job.id, title: job.title, url: job.url } as JobListing,
  ], undefined, request.signal);
  return NextResponse.json(
    { state: states[job.id] ?? "unknown", checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
