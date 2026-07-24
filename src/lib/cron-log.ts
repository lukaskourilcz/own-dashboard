import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

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
 */
export async function logCronRun(input: CronRunInput): Promise<void> {
  try {
    const userId = input.userId ?? process.env.DASHBOARD_OWNER_ID;
    if (!userId) return;
    const supabase = createAdminClient();
    await supabase.from("cron_runs").insert({
      user_id: userId,
      cron_id: input.cronId ?? null,
      name: input.name.slice(0, 200),
      endpoint: (input.endpoint ?? "").slice(0, 400),
      status: input.status ?? "success",
      source: input.source ?? "app",
      detail: (input.detail ?? "").slice(0, 1000),
    });
  } catch {
    // swallow — monitoring must never break the cron
  }
}
