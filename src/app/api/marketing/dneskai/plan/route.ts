import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { readDneskaiPlan } from '@/lib/marketing/dneskai-plan-read';
import { dneskaiPlanEnabled } from '@/lib/marketing/dneskai-evidence-rollout';
import { DNESKAI_PLAN_READ_MAX_DAYS } from '@/lib/marketing/dneskai-plan-view';
import { pragueDayAfter } from '@/lib/marketing/dneskai-workspace';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';

export const runtime = 'nodejs';

/**
 * GET /api/marketing/dneskai/plan?from=&days=&projectId= (owner decision, 7 November 2026): the publishing plan for
 * the "Dnes a zítra" tab (default today and tomorrow) and the 30-day calendar (`days=30`). `from` is a Prague date
 * within a week of today. Read-only, through the owner's session, so own-only RLS decides what is visible.
 */
export async function GET(request: Request) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const now = new Date();
  const today = pragueMarketingDate(now);
  const from = params.get('from') ?? today;
  const days = Number(params.get('days') ?? '2');
  const projectId = params.get('projectId');
  if (!z.iso.date().safeParse(from).success || from < pragueDayAfter(today, -7) || from > pragueDayAfter(today, 7)) return Response.json({ error: 'invalid-date' }, { status: 400 });
  if (!Number.isInteger(days) || days < 1 || days > DNESKAI_PLAN_READ_MAX_DAYS) return Response.json({ error: 'invalid-days' }, { status: 400 });
  if (projectId !== null && !z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400 });
  try {
    const read = await readDneskaiPlan(db, user.id, now, { from, days, enabled: dneskaiPlanEnabled(), ...(projectId ? { projectId } : {}) });
    return Response.json(read, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'dneskai-plan-unavailable' }, { status: 503 });
  }
}
