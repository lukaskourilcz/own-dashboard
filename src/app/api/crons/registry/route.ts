import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Read-only cron registry for external consumers (e.g. the aifirst site,
 * which wants to know its own schedules and per-run AI costs).
 *
 *   GET /api/crons/registry?project=<slug>
 *
 * Returns the *enabled* crons for the project(s) with that slug, including the
 * cost metadata every AI-API-call cron carries. Schedules and costs aren't
 * secret, so this is an open read — but if CRON_REGISTRY_TOKEN is set, callers
 * must send it as `Authorization: Bearer <token>` (or `?token=`). The dashboard
 * owns the registry; only the "own"-scoped rows exist, so a slug maps to one
 * owner's project in practice.
 *
 * No-ops gracefully (empty list) when the service role key is missing so a
 * fresh deploy doesn't 500.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("project")?.trim();

  const expected = process.env.CRON_REGISTRY_TOKEN;
  if (expected) {
    const header = request.headers.get("authorization");
    const token = header?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("token");
    if (token !== expected) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Service role not configured yet — behave as an empty registry.
    return NextResponse.json({ project: slug ?? null, crons: [] });
  }

  let projectQuery = admin.from("projects").select("id, slug, name");
  if (slug) projectQuery = projectQuery.eq("slug", slug);
  const { data: projectRows, error: projErr } = await projectQuery;
  if (projErr) {
    return NextResponse.json({ error: projErr.message }, { status: 500 });
  }
  const ids = (projectRows ?? []).map((p) => p.id as string);
  if (ids.length === 0) {
    return NextResponse.json({ project: slug ?? null, crons: [] });
  }

  const { data: cronRows, error: cronErr } = await admin
    .from("crons")
    .select(
      "id, project_id, name, schedule, description, endpoint, is_ai_call, cost_per_run, currency, runs_per_month, enabled, last_run_at",
    )
    .in("project_id", ids)
    .eq("enabled", true);
  if (cronErr) {
    return NextResponse.json({ error: cronErr.message }, { status: 500 });
  }

  const slugById = new Map(
    (projectRows ?? []).map((p) => [p.id as string, p.slug as string]),
  );

  const crons = (cronRows ?? []).map((c) => ({
    id: c.id,
    project: slugById.get(c.project_id as string) ?? null,
    name: c.name,
    schedule: c.schedule,
    description: c.description,
    endpoint: c.endpoint,
    isAiCall: c.is_ai_call,
    costPerRun: Number(c.cost_per_run),
    currency: c.currency,
    runsPerMonth: c.runs_per_month,
    // Convenience: the estimated monthly spend the dashboard shows.
    estimatedMonthlyCost: c.is_ai_call
      ? Number(c.cost_per_run) * Number(c.runs_per_month)
      : 0,
    lastRunAt: c.last_run_at,
  }));

  return NextResponse.json(
    { project: slug ?? null, count: crons.length, crons },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
