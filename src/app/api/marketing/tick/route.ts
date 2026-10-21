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
 * The one scheduled entry point (#120). Supabase pg_cron signs `{ tick, kind }` with
 * MARKETING_SCHEDULER_SECRET (marketing_private.scheduler_post); nothing else may call it.
 * docs/marketing-scheduling.md describes what a tick does.
 */
export async function POST(request: Request) {
  let raw: string;
  try { raw = await boundedRequestText(request, 4000); }
  catch (error) {
    const tooLarge = error instanceof Error && error.message === "payload-too-large";
    return Response.json({ error: tooLarge ? "payload-too-large" : "tick-input-invalid" }, { status: tooLarge ? 413 : 400, headers });
  }
  const principal = authenticateAutomation(request, raw);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401, headers });
  if (principal.role !== "scheduler") return Response.json({ error: "forbidden" }, { status: 403, headers });
  let input: z.infer<typeof MarketingTickInputSchema>;
  try { input = MarketingTickInputSchema.parse(JSON.parse(raw)); } catch { return Response.json({ error: "tick-input-invalid" }, { status: 400, headers }); }
  try {
    const db = createAdminClient();
    const result = await runMarketingTick({ owner: principal.ownerId, env: process.env, ports: createMarketingSchedulerPorts(db, principal.ownerId, process.env) }, input);
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "tick-unavailable" }, { status: 503, headers });
  }
}
