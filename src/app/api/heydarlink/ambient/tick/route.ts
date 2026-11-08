import { createAdminClient } from '@/lib/supabase/admin';
import { authenticateAutomation } from '@/lib/marketing/automation-auth';
import { boundedRequestText } from '@/lib/marketing/http';
import { runHeydarlinkAmbientTick } from '@/lib/heydarlink/ambient-batch';

export const runtime = 'nodejs';
export const maxDuration = 60;

const headers = { 'Cache-Control': 'no-store' };
/** The work stops with this much of the function's minute left, so a running frame can still record itself. */
const BUDGET_MS = 52_000;
const SAFE_CODE = /^[a-z][a-z0-9-]{1,79}$/;

/**
 * The HeyDarlink ambient tick: its own pg_cron job (`heydarlink-ambient-tick`, every five minutes, offset from the
 * marketing tick) signs `{ tick, kind }` with MARKETING_SCHEDULER_SECRET like the marketing tick, so the DNESKAi steps
 * never take its time. It checks HeyDarlink's stock and works open batches (`docs/heydarlink-ambient.md`).
 */
export async function POST(request: Request) {
  const started = Date.now();
  let raw: string;
  try { raw = await boundedRequestText(request, 4000); } catch { return Response.json({ error: 'tick-input-invalid' }, { status: 400, headers }); }
  const principal = authenticateAutomation(request, raw);
  if (!principal) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  if (principal.role !== 'scheduler') return Response.json({ error: 'forbidden' }, { status: 403, headers });
  const signal = AbortSignal.timeout(BUDGET_MS);
  try {
    const result = await runHeydarlinkAmbientTick(createAdminClient(), process.env, { signal, remainingMs: () => BUDGET_MS - (Date.now() - started) });
    console.info(JSON.stringify({ event: 'heydarlink-ambient-tick', ...result, costUsd: Number(result.costUsd.toFixed(4)) }));
    return Response.json(result, { headers });
  } catch (error) {
    const cause = error instanceof Error && SAFE_CODE.test(error.message) ? error.message : null;
    console.warn(JSON.stringify({ event: 'heydarlink-ambient-tick-failed', cause }));
    return Response.json({ error: 'ambient-tick-unavailable', cause }, { status: 503, headers });
  }
}
