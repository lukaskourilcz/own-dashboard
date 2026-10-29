import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/cron-auth";
import { logCronRun } from "@/lib/cron-log";
import { externalCronRun } from "@/lib/cron-log-contract";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Ingestion endpoint for external cron runs, such as a linked repository's
 * GitHub Actions schedule, which POSTs here at the end of a run so the Home
 * monitoring panels can show it. No repository posts here today: quorum
 * 627515fd (2026-08-06) removed the reporter from quorum and aifirst.
 *
 *   POST /api/crons/log
 *   Authorization: Bearer <CRON_REGISTRY_TOKEN>
 *   { "name": "...", "endpoint": "...", "status": "success|failure|running",
 *     "source": "github_actions", "detail": "...", "cron_id": "<uuid?>" }
 *
 * Guarded by CRON_REGISTRY_TOKEN (same secret as the read registry). The run is
 * attributed to DASHBOARD_OWNER_ID. No-ops with 503 until both are configured.
 *
 * A successful run also stamps the owning cron's `last_success_at` and pushes
 * its stored heartbeat URL. The owning row is found by `cron_id`, or by the
 * reported `endpoint` when no id is sent — so a caller that wants the heartbeat
 * has to identify its cron one of those two ways.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 25;
const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  const expected = process.env.CRON_REGISTRY_TOKEN;
  if (!expected?.trim() || !process.env.DASHBOARD_OWNER_ID) {
    return NextResponse.json(
      { error: "Cron logging is not configured." },
      { status: 503, headers },
    );
  }
  if (!bearerMatches(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403, headers });
  }
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), request.signal]);
  try {
    const limited = await awaitWithSignal(rateLimit(process.env.DASHBOARD_OWNER_ID!, { key: "cron-log", limit: 60, windowSec: 60 }), signal);
    if (!limited.ok) return NextResponse.json({ error: "Too many run reports." }, { status: 429, headers: { ...headers, "retry-after": String(limited.retryAfter) } });
    const prefix = await awaitWithSignal(readTextPrefix(new Response(request.body), 16_384), signal);
    if (prefix.truncated) return NextResponse.json({ error: "Report too large." }, { status: 413, headers });
    let json: unknown;
    try { json = JSON.parse(prefix.text); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    const parsed = externalCronRun.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid run report." }, { status: 400, headers });
    const body = parsed.data;
    const outcome = await awaitWithSignal(logCronRun({ name: body.name, endpoint: body.endpoint, detail: body.detail, cronId: body.cron_id, status: body.status, source: body.source }, signal), signal);
    if (!outcome.recorded) return NextResponse.json({ error: "Run recording unconfirmed." }, { status: 503, headers });
    return NextResponse.json({ ok: true, successStamped: outcome.successStamped }, { headers });
  } catch {
    return NextResponse.json({ error: "Run recording unconfirmed." }, { status: 503, headers });
  }
}
