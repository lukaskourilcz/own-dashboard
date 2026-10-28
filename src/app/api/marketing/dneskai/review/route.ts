import { z } from 'zod';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { readDneskaiCalendar, readDneskaiWorkspace } from '@/lib/marketing/dneskai-workspace-read';
import { DneskaiDecisionCursorSchema, pragueDayAfter } from '@/lib/marketing/dneskai-workspace';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';
import { dneskaiPaidActionCapabilities } from '@/lib/marketing/dneskai-paid-switches';
import { dneskaiEngagementEditorEnabled, dneskaiEngagementWatchEnabled } from '@/lib/marketing/dneskai-engagement';
import { dneskaiTopicBriefsEnabled } from '@/lib/marketing/dneskai-evidence-rollout';

export const runtime = 'nodejs';

/**
 * GET /api/marketing/dneskai/review?projectId=&date= (#119): the DNESKAi workspace read for the owner. Posts to
 * review with their exact decks, rendered slides, render problems, briefs and publications, plus drafting jobs and
 * the slots of the seven days from `date` (a Prague date within a week of today, default today). Read-only; reads
 * through the owner's session, so own-only RLS decides what is visible.
 */
export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  let context: Awaited<ReturnType<typeof readVerifiedServerContext>>;
  try { context = await readVerifiedServerContext(signal); }
  catch { return Response.json({ error: 'dneskai-workspace-unavailable' }, { status: 503 }); }
  if (!context) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { db, ownerId } = context;
  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId');
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400 });
  const view=z.enum(['review','calendar']).safeParse(params.get('view')??'review');
  if(!view.success)return Response.json({error:'invalid-view'},{status:400});
  const now = new Date();
  const today = pragueMarketingDate(now);
  const date = params.get('date') ?? today;
  if (!z.iso.date().safeParse(date).success || date < pragueDayAfter(today, -7) || date > pragueDayAfter(today, 7)) return Response.json({ error: 'invalid-date' }, { status: 400 });
  let decisionsBefore;
  try {
    const before = params.get('before');
    if (before && before.length > 200) throw new Error('cursor');
    decisionsBefore = before ? DneskaiDecisionCursorSchema.parse(JSON.parse(before)) : undefined;
  } catch { return Response.json({ error: 'invalid-cursor' }, { status: 400 }); }
  try { await requireDneskaiProject(db, ownerId, projectId!, AbortSignal.any([signal, AbortSignal.timeout(5_000)])); }
  catch (error) { return error instanceof Error && error.message === 'collection-project-unavailable'
    ? Response.json({ error: 'project-unavailable' }, { status: 404 })
    : Response.json({ error: 'dneskai-workspace-unavailable' }, { status: 503 }); }
  try {
    signal.throwIfAborted();
    if(view.data==='calendar'){
      const read=await awaitWithSignal(readDneskaiCalendar(db,ownerId,projectId!,now,date,{signal,topicTitles:dneskaiTopicBriefsEnabled()}),signal);
      signal.throwIfAborted();
      return Response.json(read,{headers:{'Cache-Control':'private, no-store'}});
    }
    const read = await awaitWithSignal(readDneskaiWorkspace(db, ownerId, now, date, { signal, decisionsBefore, capabilities: { ...dneskaiPaidActionCapabilities(), engagement: dneskaiEngagementEditorEnabled() }, engagement: dneskaiEngagementWatchEnabled(), topicTitles: dneskaiTopicBriefsEnabled() }), signal);
    signal.throwIfAborted();
    return Response.json(read, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'dneskai-workspace-unavailable' }, { status: 503 });
  }
}
