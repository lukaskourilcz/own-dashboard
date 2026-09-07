import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { isCareerRelevant } from "@/lib/jobs/filter";
import {
  EMPLOYER_BOARDS,
  fetchEmployerBoard,
} from "@/lib/jobs/employer-sources";
import type { Availability } from "@/lib/jobs/availability";
import { verifyListings } from "@/lib/jobs/availability";
import type { JobListing } from "@/lib/types";

export const maxDuration = 60;
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limit = await rateLimit(user.id, {
    key: "jobs-availability",
    limit: 20,
    windowSec: 600,
  });
  if (!limit.ok)
    return NextResponse.json(
      { error: "Please wait before checking again" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  const { data, error } = await supabase
    .from("job_listings")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (error)
    return NextResponse.json(
      { error: "Could not load positions" },
      { status: 500 },
    );
  const payload = await request.json().catch(() => ({}));
  const checkedIds = Array.isArray(payload?.checkedIds)
    ? payload.checkedIds
        .filter((id: unknown): id is string => typeof id === "string")
        .slice(0, 500)
    : [];
  const alreadyChecked = new Set(checkedIds);
  const allCandidates = (data as JobListing[]).filter(isCareerRelevant);
  const candidates = allCandidates.filter((j) => !alreadyChecked.has(j.id));
  const nativeIds = new Set<string>(EMPLOYER_BOARDS.map((b) => b.id));
  const states: Record<string, Availability> = {};
  await Promise.all(
    EMPLOYER_BOARDS.map(async (board) => {
      const stored = candidates.filter((j) => j.source === board.id);
      if (!stored.length) return;
      try {
        const current = new Set(
          (await fetchEmployerBoard(board)).map((j) => j.externalId),
        );
        stored.forEach((j) => {
          states[j.id] = current.has(j.external_id) ? "open" : "closed";
        });
      } catch {
        stored.forEach((j) => {
          states[j.id] = "unknown";
        });
      }
    }),
  );
  Object.assign(
    states,
    await verifyListings(candidates.filter((j) => !nativeIds.has(j.source))),
  );
  return NextResponse.json(
    {
      states,
      checkedAt: new Date().toISOString(),
      candidates: allCandidates.length,
      remaining: allCandidates.filter(
        (j) => !alreadyChecked.has(j.id) && !(j.id in states),
      ).length,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
