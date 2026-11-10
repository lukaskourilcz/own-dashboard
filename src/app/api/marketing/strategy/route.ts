import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { StrategyResultInputSchema, StrategyScopeSchema } from '@/lib/marketing/strategy/contracts';
import { readStrategy, requireStrategyProject } from '@/lib/marketing/strategy/server';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const parsed = StrategyScopeSchema.safeParse({ projectId: params.get('projectId'), brand: params.get('brand') });
  if (!parsed.success) return Response.json({ error: 'invalid-strategy-scope' }, { status: 400 });
  try {
    const { projectId, brand } = parsed.data;
    if (!await requireStrategyProject(db, user.id, projectId, brand)) return Response.json({ error: 'not-found' }, { status: 404 });
    return Response.json(await readStrategy(db, user.id, projectId, brand), { headers });
  } catch { return Response.json({ error: 'strategy-unavailable' }, { status: 503 }); }
}

/** Manual, attributed Insights snapshots. No provider requests or publication approvals. */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = StrategyResultInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Date.parse(parsed.data.observedAt) > Date.now() + 300_000) return Response.json({ error: 'invalid-strategy-result' }, { status: 400 });
  const input = parsed.data;
  try {
    if (!await requireStrategyProject(db, user.id, input.projectId, input.brand)) return Response.json({ error: 'not-found' }, { status: 404 });
    const { error } = await db.from('marketing_strategy_results').insert({
      user_id: user.id, project_id: input.projectId, brand: input.brand, publication_id: input.publicationId,
      published_at: input.publishedAt, observed_at: input.observedAt, experiment: input.experiment, variant: input.variant,
      evidence: input.evidence, metrics: input.metrics,
    });
    if (error) return Response.json({ error: error.code === '23505' ? 'snapshot-exists' : 'strategy-result-unavailable' }, { status: 409 });
    return Response.json({ ok: true }, { status: 201, headers });
  } catch { return Response.json({ error: 'strategy-unavailable' }, { status: 503 }); }
}
