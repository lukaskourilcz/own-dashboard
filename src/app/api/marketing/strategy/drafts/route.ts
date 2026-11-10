import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { StrategyDraftRequestSchema, StrategyLinkSchema } from '@/lib/marketing/strategy/contracts';
import { strategyBrief, strategyDevsharkDraft, strategyIdea } from '@/lib/marketing/strategy/content';
import { requireStrategyProject } from '@/lib/marketing/strategy/server';
import { dneskaiTopicsEnabled } from '@/lib/marketing/dneskai-evidence-rollout';

export const runtime = 'nodejs';

/** Add an unapproved concept/topic once. The server supplies the reviewed seed, never arbitrary browser content. */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = StrategyDraftRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid-strategy-idea' }, { status: 400 });
  const { projectId, brand, ideaId } = parsed.data;
  const idea = strategyIdea(brand, ideaId);
  if (!idea) return Response.json({ error: 'not-found' }, { status: 404 });
  if (brand === 'dneskai' && !dneskaiTopicsEnabled()) return Response.json({ error: 'topics-disabled' }, { status: 409 });
  try {
    if (!await requireStrategyProject(db, user.id, projectId, brand)) return Response.json({ error: 'not-found' }, { status: 404 });
    const draft = brand === 'devshark' ? strategyDevsharkDraft(idea) : null;
    const { data, error } = await db.rpc('marketing_strategy_draft', {
      p_project: projectId, p_brand: brand, p_idea: ideaId, p_title: idea.title,
      p_deck: draft?.deck ?? null, p_caption: draft?.caption ?? null, p_url: idea.sourceUrl,
      p_keyword: idea.keyword, p_brief: strategyBrief(idea, brand === 'dneskai' ? 'cs' : 'en'),
    });
    if (error) return Response.json({ error: 'strategy-draft-unavailable' }, { status: 503 });
    return Response.json(StrategyLinkSchema.parse(data), { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ error: 'strategy-draft-unavailable' }, { status: 503 }); }
}
