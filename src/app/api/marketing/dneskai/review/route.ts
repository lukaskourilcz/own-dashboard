import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { readDneskaiWorkspace } from '@/lib/marketing/dneskai-workspace-read';
import { pragueDayAfter } from '@/lib/marketing/dneskai-workspace';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';

export const runtime = 'nodejs';

/**
 * GET /api/marketing/dneskai/review?projectId=&date= (#119): the DNESKAi workspace read for the owner. Posts to
 * review with their exact decks, rendered slides, render problems, briefs and publications, plus drafting jobs and
 * the slots of the seven days from `date` (a Prague date within a week of today, default today). Read-only; reads
 * through the owner's session, so own-only RLS decides what is visible.
 */
export async function GET(request: Request) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId');
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400 });
  const now = new Date();
  const today = pragueMarketingDate(now);
  const date = params.get('date') ?? today;
  if (!z.iso.date().safeParse(date).success || date < pragueDayAfter(today, -7) || date > pragueDayAfter(today, 7)) return Response.json({ error: 'invalid-date' }, { status: 400 });
  try { await requireDneskaiProject(db, user.id, projectId!); }
  catch { return Response.json({ error: 'project-unavailable' }, { status: 404 }); }
  try {
    return Response.json(await readDneskaiWorkspace(db, user.id, now, date), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'dneskai-workspace-unavailable' }, { status: 503 });
  }
}
