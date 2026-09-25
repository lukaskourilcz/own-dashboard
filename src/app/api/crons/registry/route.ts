import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Read-only cron registry for external consumers. Projects shows this URL for
 * them; no repository calls it today (the last reporter went in quorum
 * 627515fd, 2026-08-06).
 *
 *   GET /api/crons/registry?project=<slug>
 *   Authorization: Bearer <CRON_REGISTRY_TOKEN>
 *
 * Returns the *enabled* crons for the project(s) with that slug, including the
 * cost metadata every AI-API-call cron carries. The dashboard owns the
 * registry; only the "own"-scoped rows exist, so a slug maps to one owner's
 * project in practice.
 *
 * Fails closed: 503 until CRON_REGISTRY_TOKEN is set, 403 for any other
 * token. The token travels only in the header, never in the query string,
 * where request logs would keep it. Answers an empty list when the service
 * role key is missing so a fresh deploy doesn't 500.
 */
export const dynamic = "force-dynamic";

// An authenticated answer must never sit in a shared cache, where a caller
// without the token could be served it.
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("project")?.trim();

  const expected = process.env.CRON_REGISTRY_TOKEN;
  if (!expected?.trim()) {
    return NextResponse.json(
      { error: "Cron registry is not configured." },
      { status: 503 },
    );
  }
  if (!bearerMatches(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Service role not configured yet — behave as an empty registry.
    return NextResponse.json(
      { project: slug ?? null, crons: [] },
      { headers: PRIVATE },
    );
  }

  let projectQuery = admin.from("projects").select("id, slug, name");
  if (slug) projectQuery = projectQuery.eq("slug", slug);
  let { data: projectRows, error: projErr } = await projectQuery;
  // A renamed project keeps answering to its earlier slug (e.g. aifirst →
  // dneskai), so existing consumers keep their registry URL.
  if (!projErr && slug && (projectRows ?? []).length === 0) {
    ({ data: projectRows, error: projErr } = await admin
      .from("projects")
      .select("id, slug, name")
      .contains("previous_slugs", [slug]));
  }
  if (projErr) {
    return NextResponse.json({ error: projErr.message }, { status: 500 });
  }
  const ids = (projectRows ?? []).map((p) => p.id as string);
  if (ids.length === 0) {
    return NextResponse.json(
      { project: slug ?? null, crons: [] },
      { headers: PRIVATE },
    );
  }

  const { data: cronRows, error: cronErr } = await admin
    .from("crons")
    .select(
      "id, project_id, name, schedule, description, endpoint, is_ai_call, cost_per_run, currency, runs_per_month, enabled, last_run_at, heartbeat_url, last_success_at",
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
    lastSuccessAt: c.last_success_at,
    // Whether a push monitor is configured, never which one: the push URL is a
    // credential and this endpoint is readable by every consumer of the token.
    monitored: String(c.heartbeat_url ?? "").trim() !== "",
  }));

  return NextResponse.json(
    { project: slug ?? null, count: crons.length, crons },
    { headers: PRIVATE },
  );
}
