import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";

export const cronRunsSchema = z.object({
  days: z.number().int().min(1).max(14), partial: z.boolean(),
  runs: z.array(z.object({
    id: z.uuid(), name: z.string().max(200), endpoint: z.string().max(400),
    status: z.enum(["success", "failure", "running"]), source: z.string().max(100), detail: z.string().max(1000),
    fired_at: z.iso.datetime({ offset: true }), cron_id: z.uuid().nullable(),
  })).max(1000),
});

/** Validate provider data before date formatting or rendering a status pill. */
export async function loadCronRuns(parent?: AbortSignal) {
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(parent ? [parent] : [])]);
  signal.throwIfAborted();
  const response = await awaitWithSignal(fetch("/api/crons/runs?days=14", { cache: "no-store", signal }), signal);
  if (!response.ok) throw Error("Cron history unavailable");
  const body = await awaitWithSignal(readTextPrefix(response, 2_000_000), signal);
  if (body.truncated) throw Error("Cron history unavailable");
  const result = cronRunsSchema.parse(JSON.parse(body.text));
  if (result.days !== 14 || new Set(result.runs.map(run => run.id)).size !== result.runs.length) throw Error("Cron history unavailable");
  return result;
}
