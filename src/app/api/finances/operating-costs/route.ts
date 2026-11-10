import { createClient } from "@/lib/supabase/server";
import { operatingCost, OPERATING_COST_LIMIT, type OperatingCosts } from "@/lib/operating-costs";

export async function GET() {
  try {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const end = now.toISOString();
    const [projects, runs, jobs, drafts] = await Promise.all([
      db.from("projects").select("id,slug").eq("user_id", user.id).in("slug", ["devshark", "dneskai"]).limit(10),
      db.from("marketing_dneskai_runs").select("project_id,status,cost_usd", { count: "exact" }).eq("user_id", user.id).gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(OPERATING_COST_LIMIT + 1),
      db.from("marketing_jobs").select("status,cost:result->usage->>estimatedCostUsd,brand:request->generation->source->>brand", { count: "exact" }).eq("user_id", user.id).gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(OPERATING_COST_LIMIT + 1),
      db.from("marketing_devshark_drafts").select("project_id,status,cost_usd", { count: "exact" }).eq("user_id", user.id).gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(OPERATING_COST_LIMIT + 1),
    ]);
    if ([projects, runs, jobs, drafts].some(result => result.error)) throw Error("ledger-unavailable");
    const partial = (result: { data: unknown[] | null; count: number | null }) => (result.count ?? 0) > Math.min(result.data?.length ?? 0, OPERATING_COST_LIMIT);
    const items: OperatingCosts["items"] = [];
    for (const project of projects.data ?? []) {
      if (project.slug === "dneskai") {
        const rows = (runs.data ?? []).filter(row => row.project_id === project.id);
        const generation = (jobs.data ?? []).filter(row => row.brand === "dneskai" && row.status !== "queued");
        items.push(operatingCost("collection", project.id, rows.slice(0, OPERATING_COST_LIMIT).map(row => ({ cost: row.cost_usd, pending: row.status === "running" })), partial(runs)));
        items.push(operatingCost("generation", project.id, generation.filter(row => row.status === "review").slice(0, OPERATING_COST_LIMIT).map(row => ({ cost: row.cost })), partial(jobs)));
        items.push(operatingCost("generationReserved", project.id, generation.filter(row => row.status !== "review").slice(0, OPERATING_COST_LIMIT).map(row => ({ cost: row.cost, pending: !["failed", "reconciliation"].includes(row.status) })), partial(jobs)));
      } else {
        const rows = (drafts.data ?? []).filter(row => row.project_id === project.id);
        items.push(operatingCost("devshark", project.id, rows.slice(0, OPERATING_COST_LIMIT).map(row => ({ cost: row.cost_usd })), partial(drafts)));
      }
    }
    return Response.json({ start, end, items } satisfies OperatingCosts, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "operating-costs-unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
}
