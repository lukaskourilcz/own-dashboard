import { z } from 'zod';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { DNESKAI_COST_RANGES, readDneskaiCosts } from '@/lib/marketing/dneskai-workspace-read';
import { dneskaiDailyGenerationCeiling } from '@/lib/marketing/worker-runtime';
import type { DneskaiCostsRead } from '@/lib/marketing/dneskai-workspace';
import { marketingPublicationRequeueEnabled } from '@/lib/marketing/publication-requeue';

export const runtime = 'nodejs';

/** The ceiling the worker applies, or the code it refuses with when the server value is malformed. */
function ceiling(): Pick<DneskaiCostsRead['generation'], 'ceilingUsd' | 'code'> {
  try { return { ceilingUsd: dneskaiDailyGenerationCeiling(process.env), code: null }; }
  catch { return { ceilingUsd: null, code: 'dneskai-daily-generation-budget-invalid' }; }
}

/**
 * GET /api/marketing/dneskai/costs?projectId=&range=1d…7d (#119, default 7d): errors and costs of the DNESKAi pipeline for the owner. The
 * 24-hour generation spend comes from `marketing_dneskai_generation_spent`, which only the service role may run; it
 * is called for the authenticated owner's own id and nothing else. Everything else reads through the session (RLS).
 */
export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  let context: Awaited<ReturnType<typeof readVerifiedServerContext>>;
  try { context = await readVerifiedServerContext(signal); }
  catch { return Response.json({ error: 'dneskai-costs-unavailable' }, { status: 503 }); }
  if (!context) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { db, ownerId } = context;
  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId');
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400 });
  const range = z.enum(DNESKAI_COST_RANGES).safeParse(params.get('range') ?? '7d');
  if (!range.success) return Response.json({ error: 'invalid-range' }, { status: 400 });
  try { await requireDneskaiProject(db, ownerId, projectId!, AbortSignal.any([signal, AbortSignal.timeout(5_000)])); }
  catch (error) { return error instanceof Error && error.message === 'collection-project-unavailable'
    ? Response.json({ error: 'project-unavailable' }, { status: 404 })
    : Response.json({ error: 'dneskai-costs-unavailable' }, { status: 503 }); }
  let spentUsd: number | null = null;
  let spendCode: string | null = null;
  try {
    signal.throwIfAborted();
    const spendSignal = AbortSignal.any([signal, AbortSignal.timeout(3_000)]);
    const { data, error } = await awaitWithSignal(createAdminClient(spendSignal).rpc('marketing_dneskai_generation_spent', { p_owner: ownerId }).retry(false).abortSignal(spendSignal), spendSignal);
    spendSignal.throwIfAborted();
    const amount = typeof data === 'number' ? data : typeof data === 'string' && /^\d+(?:\.\d+)?$/.test(data) ? Number(data) : Number.NaN;
    if (error || !Number.isFinite(amount) || amount < 0) spendCode = 'dneskai-daily-generation-budget-unavailable'; else spentUsd = amount;
  } catch { spendCode = 'dneskai-daily-generation-budget-unavailable'; }
  const limit = ceiling();
  try {
    signal.throwIfAborted();
    const readSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const read = await awaitWithSignal(readDneskaiCosts(db, ownerId, projectId!, new Date(), { spentUsd, ceilingUsd: limit.ceilingUsd, code: limit.code ?? spendCode }, range.data,
      { requeueEnabled: marketingPublicationRequeueEnabled(process.env), signal: readSignal }), readSignal);
    signal.throwIfAborted();
    return Response.json(read, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'dneskai-costs-unavailable' }, { status: 503 });
  }
}
