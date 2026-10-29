import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { pingHeartbeat } from "@/lib/heartbeat";
import { awaitWithSignal } from "@/lib/abortable";
import { externalCronRun } from "@/lib/cron-log-contract";
import { z } from "zod";

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
 * returns an unconfirmed outcome when either is missing.
 *
 * A successful run also stamps the matching `crons` row's `last_success_at`
 * and pushes its stored heartbeat URL, so the freshness the dashboard shows and
 * the external monitor's alert both come from the same recorded fact. The row
 * is found by `cronId` when the caller knows it, otherwise by the endpoint the
 * run reports — that is what lets the app's own Vercel crons be monitored from
 * a cron record the owner created by hand.
 */
export async function logCronRun(input: CronRunInput, parent?: AbortSignal): Promise<{ recorded: boolean; successStamped: boolean }> {
  const outcome = { recorded: false, successStamped: false };
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
  try {
    const userId = input.userId ?? process.env.DASHBOARD_OWNER_ID;
    if (!z.uuid().safeParse(userId).success) return outcome;
    const parsed = externalCronRun.safeParse({ name: input.name, status: input.status ?? "success", source: input.source ?? "app", endpoint: input.endpoint, detail: input.detail, cron_id: input.cronId });
    if (!parsed.success) return outcome;
    const { name, endpoint, status, source, detail, cron_id: cronId } = parsed.data;
    signal.throwIfAborted();
    const supabase = createAdminClient(signal);
    let cron: { id: string; user_id: string; heartbeat_url: string; updated_at: string } | null = null;
    if (cronId || endpoint) {
      let query = supabase.from("crons").select("id,user_id,heartbeat_url,updated_at").eq("user_id", userId).limit(2);
      query = cronId ? query.eq("id", cronId) : query.eq("endpoint", endpoint);
      const found = await awaitWithSignal(query.abortSignal(signal).maybeSingle(), signal);
      if (found.error) return outcome;
      if (found.data) {
        cron = z.object({ id: z.uuid(), user_id: z.uuid(), heartbeat_url: z.string(), updated_at: z.iso.datetime({ offset: true }) }).parse(found.data);
        if (cron.user_id !== userId || (cronId && cron.id !== cronId)) return outcome;
      } else if (cronId) return outcome;
    }
    const payload = {
      id: crypto.randomUUID(),
      user_id: userId,
      cron_id: cron?.id ?? null,
      name,
      endpoint,
      status,
      source, detail,
    };
    const inserted = await awaitWithSignal(supabase.from("cron_runs").insert(payload).select("id,user_id,cron_id,name,endpoint,status,source,detail").abortSignal(signal).single(), signal);
    if (inserted.error || !inserted.data || Object.entries(payload).some(([key, value]) => inserted.data[key as keyof typeof payload] !== value)) return outcome;
    outcome.recorded = true;
    if (status !== "success" || !cron || signal.aborted) return outcome;
    const now = new Date().toISOString();
    const stamped = await awaitWithSignal(supabase.from("crons")
      .update({ last_success_at: now, last_run_at: now }).eq("id", cron.id).eq("user_id", userId).eq("updated_at", cron.updated_at)
      .select("id,user_id,last_success_at,last_run_at,heartbeat_url").abortSignal(signal).maybeSingle(), signal);
    const row = stamped.data;
    if (stamped.error || !row || row.id !== cron.id || row.user_id !== userId || row.heartbeat_url !== cron.heartbeat_url
      || Date.parse(row.last_success_at) !== Date.parse(now) || Date.parse(row.last_run_at) !== Date.parse(now)) return outcome;
    outcome.successStamped = true;
    await pingHeartbeat(cron.heartbeat_url, signal);
    return outcome;
  } catch {
    // swallow — monitoring must never break the cron
    return outcome;
  }
}
