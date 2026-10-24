import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { awaitWithSignal } from "@/lib/abortable";

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
 * registry; both service queries explicitly filter DASHBOARD_OWNER_ID.
 *
 * Fails closed: 503 until CRON_REGISTRY_TOKEN is set, 403 for any other
 * token. The token travels only in the header, never in the query string,
 * where request logs would keep it. Missing service configuration or an
 * incomplete read returns unavailable rather than a false empty registry.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// An authenticated answer must never sit in a shared cache, where a caller
// without the token could be served it.
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("project")?.trim();

  const expected = process.env.CRON_REGISTRY_TOKEN;
  const owner = process.env.DASHBOARD_OWNER_ID;
  if (!expected?.trim() || !owner?.trim()) {
    return NextResponse.json(
      { error: "Cron registry is not configured." },
      { status: 503, headers: PRIVATE },
    );
  }
  if (!bearerMatches(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403, headers: PRIVATE });
  }
  if (slug && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) return NextResponse.json({ error: "Invalid project." }, { status: 400, headers: PRIVATE });
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), request.signal]);
  try {
    const admin = createAdminClient(signal);

    let projectQuery = admin.from("projects").select("id, slug, user_id", { count: "exact" }).eq("user_id", owner).limit(501).abortSignal(signal);
    if (slug) projectQuery = projectQuery.eq("slug", slug);
    let { data: projectRows, error: projErr, count: projectCount } = await awaitWithSignal(projectQuery, signal);
    // A renamed project keeps answering to its earlier slug (e.g. aifirst →
    // dneskai), so existing consumers keep their registry URL.
    if (!projErr && slug && (projectRows ?? []).length === 0) {
      ({ data: projectRows, error: projErr, count: projectCount } = await awaitWithSignal(admin
        .from("projects")
        .select("id, slug, user_id", { count: "exact" }).eq("user_id", owner)
        .contains("previous_slugs", [slug]).limit(501).abortSignal(signal), signal));
    }
    if (projErr || !Array.isArray(projectRows) || projectRows.length > 500 || projectCount !== projectRows.length
      || projectRows.some(row => row.user_id !== owner || typeof row.id !== "string" || typeof row.slug !== "string")) throw Error("Registry unavailable");
    const ids = (projectRows ?? []).map((p) => p.id as string);
    if (ids.length === 0) {
      return NextResponse.json(
        { project: slug ?? null, count: 0, crons: [] },
        { headers: PRIVATE },
      );
    }

    const { data: cronRows, error: cronErr, count: cronCount } = await awaitWithSignal(admin
      .from("crons")
      .select(
        "id, user_id, project_id, name, schedule, description, endpoint, is_ai_call, cost_per_run, currency, runs_per_month, enabled, last_run_at, heartbeat_url, last_success_at", { count: "exact" },
      )
      .eq("user_id", owner)
      .in("project_id", ids)
      .eq("enabled", true).limit(5001).abortSignal(signal), signal);
    const projectIds = new Set(ids);
    if (cronErr || !Array.isArray(cronRows) || cronRows.length > 5000 || cronCount !== cronRows.length
      || cronRows.some(row => row.user_id !== owner || !projectIds.has(row.project_id) || row.enabled !== true
        || !Number.isFinite(Number(row.cost_per_run)) || !Number.isFinite(Number(row.runs_per_month)))) throw Error("Registry unavailable");

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
  } catch { return NextResponse.json({ error: "Cron registry unavailable." }, { status: 503, headers: PRIVATE }); }
}
