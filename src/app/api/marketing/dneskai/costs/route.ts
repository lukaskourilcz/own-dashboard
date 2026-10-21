import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { DNESKAI_COST_RANGES, readDneskaiCosts } from '@/lib/marketing/dneskai-workspace-read';
import { dneskaiDailyGenerationCeiling } from '@/lib/marketing/worker-runtime';
import type { DneskaiCostsRead } from '@/lib/marketing/dneskai-workspace';

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
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId');
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400 });
  const range = z.enum(DNESKAI_COST_RANGES).safeParse(params.get('range') ?? '7d');
  if (!range.success) return Response.json({ error: 'invalid-range' }, { status: 400 });
  try { await requireDneskaiProject(db, user.id, projectId!); }
  catch { return Response.json({ error: 'project-unavailable' }, { status: 404 }); }
  let spentUsd: number | null = null;
  let spendCode: string | null = null;
  try {
    const { data, error } = await createAdminClient().rpc('marketing_dneskai_generation_spent', { p_owner: user.id });
    const amount = typeof data === 'number' ? data : typeof data === 'string' && /^\d+(?:\.\d+)?$/.test(data) ? Number(data) : Number.NaN;
    if (error || !Number.isFinite(amount) || amount < 0) spendCode = 'dneskai-daily-generation-budget-unavailable'; else spentUsd = amount;
  } catch { spendCode = 'dneskai-daily-generation-budget-unavailable'; }
  const limit = ceiling();
  try {
    const read = await readDneskaiCosts(db, user.id, projectId!, new Date(), { spentUsd, ceilingUsd: limit.ceilingUsd, code: limit.code ?? spendCode }, range.data);
    return Response.json(read, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'dneskai-costs-unavailable' }, { status: 503 });
  }
}
