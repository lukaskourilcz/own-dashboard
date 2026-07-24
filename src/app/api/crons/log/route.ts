import { NextResponse } from "next/server";
import { logCronRun, type CronRunSource, type CronRunStatus } from "@/lib/cron-log";

/**
 * Ingestion endpoint for external cron runs — chiefly the linked repos' GitHub
 * Actions schedules, which POST here at the end of a run so the Home monitoring
 * panels can show them.
 *
 *   POST /api/crons/log
 *   Authorization: Bearer <CRON_REGISTRY_TOKEN>
 *   { "name": "...", "endpoint": "...", "status": "success|failure|running",
 *     "source": "github_actions", "detail": "...", "cron_id": "<uuid?>" }
 *
 * Guarded by CRON_REGISTRY_TOKEN (same secret as the read registry). The run is
 * attributed to DASHBOARD_OWNER_ID. No-ops with 503 until both are configured.
 */
export const dynamic = "force-dynamic";

const STATUSES: CronRunStatus[] = ["success", "failure", "running"];
const SOURCES: CronRunSource[] = ["app", "vercel", "github_actions", "external"];

export async function POST(request: Request) {
  const expected = process.env.CRON_REGISTRY_TOKEN;
  if (!expected || !process.env.DASHBOARD_OWNER_ID) {
    return NextResponse.json(
      { error: "Cron logging is not configured." },
      { status: 503 },
    );
  }
  const header = request.headers.get("authorization");
  const token = header?.replace(/^Bearer\s+/i, "");
  if (token !== expected) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  const status =
    typeof body.status === "string" && STATUSES.includes(body.status as CronRunStatus)
      ? (body.status as CronRunStatus)
      : "success";
  const source =
    typeof body.source === "string" && SOURCES.includes(body.source as CronRunSource)
      ? (body.source as CronRunSource)
      : "github_actions";

  await logCronRun({
    name,
    endpoint: typeof body.endpoint === "string" ? body.endpoint : "",
    detail: typeof body.detail === "string" ? body.detail : "",
    cronId: typeof body.cron_id === "string" ? body.cron_id : null,
    status,
    source,
  });

  return NextResponse.json({ ok: true });
}
