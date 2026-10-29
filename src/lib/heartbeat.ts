import "server-only";
import { awaitWithSignal } from "@/lib/abortable";

/**
 * Ping an external push monitor (Uptime Kuma, Better Stack, UptimeRobot) after
 * a successful run.
 *
 * The direction matters: the job pushes, the monitor waits. A cron that stops
 * being invoked, crashes before this line, or fails its own work sends nothing,
 * and the monitor's missed-ping alert is what makes the silence visible. So the
 * call belongs after the work succeeded and nowhere else.
 *
 * Best effort in both directions: it never throws, and it never delays a cron
 * by more than the timeout. A monitor being down is not a cron failure.
 */
export async function pingHeartbeat(
  url: string | null | undefined,
  parent?: AbortSignal,
): Promise<boolean> {
  const target = url?.trim();
  if (!target) return false;
  try {
    const parsed = new URL(target);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(parent ? [parent] : [])]);
    signal.throwIfAborted();
    const response = await awaitWithSignal(fetch(target, {
      cache: "no-store",
      signal,
    }), signal);
    // Only the status matters; don't retain a monitor's response body.
    if (response.body) void response.body.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    // Swallow — the heartbeat reports on the cron, it is not part of it.
    return false;
  }
}

/** The app's own scheduled jobs, each with its own optional push URL. */
export type HeartbeatJob =
  | "bank-sync"
  | "payment-match"
  | "renewal-warnings"
  | "jobs-scrape";

/**
 * The push URL for one of the app's own Vercel crons: the per-job variable
 * first, then the single shared `HEARTBEAT_URL`. Unset everywhere means
 * unmonitored, which is the default and is silent.
 *
 * The variables are read by name rather than built from the job id so the
 * lookup survives any environment that substitutes `process.env` statically.
 */
export function heartbeatUrlForJob(job: HeartbeatJob): string | undefined {
  const specific = {
    "bank-sync": process.env.HEARTBEAT_URL_BANK_SYNC,
    "payment-match": process.env.HEARTBEAT_URL_PAYMENT_MATCH,
    "renewal-warnings": process.env.HEARTBEAT_URL_RENEWAL_WARNINGS,
    "jobs-scrape": process.env.HEARTBEAT_URL_JOBS_SCRAPE,
  }[job];
  return specific?.trim() ? specific : process.env.HEARTBEAT_URL;
}
