import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { dneskaiTopicsEnabled } from '@/lib/marketing/dneskai-evidence-rollout';
import { readDneskaiTopics } from '@/lib/marketing/dneskai-workspace-read';
import { DneskaiTopicActionResultSchema, DneskaiTopicActionSchema, type DneskaiTopicActionResult, type DneskaiTopicStatus } from '@/lib/marketing/dneskai-topics';
export const runtime = 'nodejs';

/**
 * GET /api/marketing/dneskai/topics?projectId= and POST (#150): the owner's topics (náměty) and the owner actions
 * approve, reject, restore (up to 40 topics at once), edit (title and keyword) and create (a manual topic from a URL
 * or a title). Everything runs through the owner's session: RLS decides what is read and the security-definer
 * functions of 20261023100000 check ownership and status. Nothing here writes a brief, admits a job or spends money.
 * Answers 404 until the server-only DNESKAI_TOPICS_ENABLED is "true".
 */
const headers = { 'Cache-Control': 'private, no-store' };
const notFound = () => Response.json({ error: 'not-found' }, { status: 404 });

/** The SQL refusals the owner functions raise, as stable codes and statuses. */
const REFUSALS: Array<[RegExp, string, number]> = [
  [/topic unavailable/, 'topic-unavailable', 404],
  [/topic status/, 'topic-status-changed', 409],
  [/topic exists/, 'topic-exists', 409],
  [/topic (url|title|action) invalid|check constraint/, 'invalid-topic', 400],
];
const refusal = (error: { message?: string } | null) => REFUSALS.find(([pattern]) => pattern.test(error?.message ?? '')) ?? null;

export async function GET(request: Request) {
  if (!dneskaiTopicsEnabled()) return notFound();
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400 });
  try { await requireDneskaiProject(db, user.id, projectId!); } catch { return Response.json({ error: 'project-unavailable' }, { status: 404 }); }
  try { return Response.json(await readDneskaiTopics(db, user.id, projectId!, new Date(), { enabled: true }), { headers }); }
  catch { return Response.json({ error: 'dneskai-topics-unavailable' }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!dneskaiTopicsEnabled()) return notFound();
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = DneskaiTopicActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid-topic-request' }, { status: 400 });
  const input = parsed.data;
  try { await requireDneskaiProject(db, user.id, input.projectId); } catch { return Response.json({ error: 'project-unavailable' }, { status: 404 }); }
  try {
    if (input.action === 'approve' || input.action === 'reject' || input.action === 'restore') {
      // One call per topic, so one topic that changed meanwhile does not undo the others.
      const results: DneskaiTopicActionResult['results'] = [];
      for (const topicId of [...new Set(input.topicIds)]) {
        const { data, error } = await db.rpc('marketing_dneskai_topic_decide', { p_topic: topicId, p_action: input.action });
        if (error) { const known = refusal(error); if (!known) throw error; results.push({ id: topicId, error: known[1] }); continue; }
        results.push({ id: topicId, status: (data as { status: DneskaiTopicStatus }).status });
      }
      return Response.json(DneskaiTopicActionResultSchema.parse({ ok: true, results }), { headers });
    }
    const { data, error } = input.action === 'edit'
      ? await db.rpc('marketing_dneskai_topic_edit', { p_topic: input.topicId, p_title: input.title, p_keyword: input.keyword })
      : input.action === 'create'
        ? await db.rpc('marketing_dneskai_topic_create', { p_project: input.projectId, p_kind: input.kind, p_title: input.title ?? null, p_url: input.url ?? null, p_keyword: input.keyword ?? null })
        : { data: null, error: { message: 'topic action invalid' } };
    if (error) {
      const known = refusal(error);
      return known ? Response.json({ error: known[1] }, { status: known[2] }) : Response.json({ error: 'dneskai-topics-unavailable' }, { status: 503 });
    }
    const result = data as { id: string; status: DneskaiTopicStatus };
    return Response.json(DneskaiTopicActionResultSchema.parse({ ok: true, results: [{ id: result.id, status: result.status }] }), { status: input.action === 'create' ? 201 : 200, headers });
  } catch {
    return Response.json({ error: 'dneskai-topics-unavailable' }, { status: 503 });
  }
}
