import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * The owner's cron run history for the Home monitoring panels.
 *
 *   GET /api/crons/runs?days=14
 *
 * Returns the owner's runs from the last `days` (1–14, default 14), newest
 * first, so the client can render today's summary and navigate back day by day
 * from a single fetch. Own-only via RLS.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("days"));
  const days = Number.isFinite(requested)
    ? Math.min(14, Math.max(1, Math.trunc(requested)))
    : 14;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("cron_runs")
    .select("id, name, endpoint, status, source, detail, fired_at, cron_id")
    .eq("user_id", user.id)
    .gte("fired_at", since)
    .order("fired_at", { ascending: false })
    .limit(1000);
  if (error) {
    return NextResponse.json(
      { error: "Could not load cron runs." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { days, runs: data ?? [] },
    { headers: { "cache-control": "private, no-store" } },
  );
}
