import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateAutomation } from "@/lib/marketing/automation-auth";
import { boundedRequestText } from "@/lib/marketing/http";
import { MarketingTickInputSchema, runMarketingTick } from "@/lib/marketing/scheduler";
import { createMarketingSchedulerPorts } from "@/lib/marketing/scheduler-ports";

export const runtime = "nodejs";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store" };

/**
 * A refused tick never reaches beginTick, so marketing_ticks has no row for it and pg_net forgets the answer after
 * about six hours (production-08). One JSON line in the function log keeps the status and a fixed code, plus
 * whether a scheduler secret of usable length is configured. Never the body, the headers or the secret itself.
 */
function rejected(status: number, code: string, detail: Record<string, boolean | string | null> = {}) {
  console.warn(JSON.stringify({ event: "marketing-tick-rejected", status, code, ...detail }));
  return Response.json({ error: code }, { status, headers });
}
const schedulerSecretConfigured = () => (process.env.MARKETING_SCHEDULER_SECRET?.length ?? 0) >= 32;
const SAFE_CODE = /^[a-z][a-z0-9-]{1,79}$/;

/**
 * The one scheduled entry point (#120). Supabase pg_cron signs `{ tick, kind }` with
 * MARKETING_SCHEDULER_SECRET (marketing_private.scheduler_post); nothing else may call it.
 * docs/marketing-scheduling.md describes what a tick does.
 */
export async function POST(request: Request) {
  let raw: string;
  try { raw = await boundedRequestText(request, 4000); }
  catch (error) {
    const tooLarge = error instanceof Error && error.message === "payload-too-large";
    return rejected(tooLarge ? 413 : 400, tooLarge ? "payload-too-large" : "tick-input-invalid");
  }
  const principal = authenticateAutomation(request, raw);
  if (!principal) return rejected(401, "unauthorized", { secretConfigured: schedulerSecretConfigured() });
  if (principal.role !== "scheduler") return rejected(403, "forbidden");
  let input: z.infer<typeof MarketingTickInputSchema>;
  try { input = MarketingTickInputSchema.parse(JSON.parse(raw)); } catch { return rejected(400, "tick-input-invalid"); }
  try {
    const db = createAdminClient();
    const result = await runMarketingTick({ owner: principal.ownerId, env: process.env, ports: createMarketingSchedulerPorts(db, principal.ownerId, process.env) }, input);
    return Response.json(result, { headers });
  } catch (error) {
    // Only a code-shaped message is kept (for example scheduler-state-unavailable); anything else is dropped.
    const cause = error instanceof Error && SAFE_CODE.test(error.message) ? error.message : null;
    return rejected(503, "tick-unavailable", { cause });
  }
}
