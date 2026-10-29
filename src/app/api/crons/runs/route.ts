import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { awaitWithSignal } from "@/lib/abortable";
import { cronRunsSchema } from "@/lib/cron-runs";

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
export const maxDuration = 20;
const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), request.signal]);
  try {
    const supabase = await awaitWithSignal(createClient(signal), signal);
    const {
      data: { user },
    } = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    }

    const url = new URL(request.url);
    const raw = url.searchParams.get("days");
    const requested = raw?.trim() ? Number(raw) : 14;
    const days = Number.isFinite(requested)
      ? Math.min(14, Math.max(1, Math.trunc(requested)))
      : 14;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error, count } = await awaitWithSignal(supabase
      .from("cron_runs")
      .select("id, name, endpoint, status, source, detail, fired_at, cron_id", { count: "exact" })
      .eq("user_id", user.id)
      .gte("fired_at", since)
      .order("fired_at", { ascending: false })
      .order("id", { ascending: false }).limit(1000).abortSignal(signal), signal);
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count! < data.length
      || data.length !== Math.min(count!, 1000)) throw Error("Cron history unavailable");
    const result = cronRunsSchema.parse({ days, runs: data, partial: count! > data.length });

    return NextResponse.json(
      result,
      { headers },
    );
  } catch { return NextResponse.json({ error: "Could not load cron runs." }, { status: 503, headers }); }
}
