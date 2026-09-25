import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { pingHeartbeat } from "@/lib/heartbeat";

/** A cron run's outcome. "running" = started but not yet reported complete. */
export type CronRunStatus = "success" | "failure" | "running";
export type CronRunSource = "app" | "vercel" | "github_actions" | "external";

export type CronRunInput = {
  name: string;
  endpoint?: string;
  status?: CronRunStatus;
  source?: CronRunSource;
  detail?: string;
  cronId?: string | null;
  /** Owner to attribute the run to; defaults to DASHBOARD_OWNER_ID. */
  userId?: string;
};

/**
 * Record one cron run in `cron_runs` for the Home monitoring panels. Best
 * effort and never throws — a logging failure must not fail the cron itself.
 * Requires the service role and a DASHBOARD_OWNER_ID (or an explicit userId);
 * silently no-ops when either is missing.
 *
 * A successful run also stamps the matching `crons` row's `last_success_at`
 * and pushes its stored heartbeat URL, so the freshness the dashboard shows and
 * the external monitor's alert both come from the same recorded fact. The row
 * is found by `cronId` when the caller knows it, otherwise by the endpoint the
 * run reports — that is what lets the app's own Vercel crons be monitored from
 * a cron record the owner created by hand.
 */
export async function logCronRun(input: CronRunInput): Promise<void> {
  try {
    const userId = input.userId ?? process.env.DASHBOARD_OWNER_ID;
    if (!userId) return;
    const supabase = createAdminClient();
    const status = input.status ?? "success";
    const endpoint = (input.endpoint ?? "").slice(0, 400);
    await supabase.from("cron_runs").insert({
      user_id: userId,
      cron_id: input.cronId ?? null,
      name: input.name.slice(0, 200),
      endpoint,
      status,
      source: input.source ?? "app",
      detail: (input.detail ?? "").slice(0, 1000),
    });
    if (status !== "success") return;
    await recordCronSuccess(supabase, userId, input.cronId ?? null, endpoint);
  } catch {
    // swallow — monitoring must never break the cron
  }
}

/**
 * Stamp the owning cron's last success and fire its heartbeat. Own-scoped: the
 * lookup always filters by `user_id`, so a service-role write cannot reach
 * another owner's cron even when an id is supplied by an external caller.
 */
async function recordCronSuccess(
  supabase: SupabaseClient,
  userId: string,
  cronId: string | null,
  endpoint: string,
): Promise<void> {
  if (!cronId && !endpoint) return;

  let query = supabase
    .from("crons")
    .select("id, heartbeat_url")
    .eq("user_id", userId)
    .limit(1);
  query = cronId ? query.eq("id", cronId) : query.eq("endpoint", endpoint);

  const { data } = await query;
  const row = (data ?? [])[0] as { id: string; heartbeat_url: string } | undefined;
  if (!row) return;

  const now = new Date().toISOString();
  await supabase
    .from("crons")
    .update({ last_success_at: now, last_run_at: now })
    .eq("id", row.id)
    .eq("user_id", userId);

  await pingHeartbeat(row.heartbeat_url);
}
