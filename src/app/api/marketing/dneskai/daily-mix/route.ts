import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { dneskaiDailyMixEnabled } from '@/lib/marketing/dneskai-evidence-rollout';
import { readDneskaiDailyMix, saveDneskaiDailyMix } from '@/lib/marketing/dneskai-daily-mix-read';
import { DneskaiDailyMixSaveSchema } from '@/lib/marketing/dneskai-daily-mix';
import { boundedRequestText } from '@/lib/marketing/http';
export const runtime = 'nodejs';

/**
 * GET and PUT /api/marketing/dneskai/daily-mix?projectId= (#156): the owner's daily mix (news and education posts a
 * day, active times). Through the owner's session, so RLS and the table's checks decide. Answers 404 until the
 * server-only DNESKAI_DAILY_MIX_ENABLED is "true".
 */
const headers = { 'Cache-Control': 'private, no-store' };
async function owner(request: Request) {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, response: Response.json({ error: 'unauthorized' }, { status: 401 }) } as const;
  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!z.uuid().safeParse(projectId).success) return { ok: false, response: Response.json({ error: 'invalid-project' }, { status: 400 }) } as const;
  try { await requireDneskaiProject(db, user.id, projectId!); } catch { return { ok: false, response: Response.json({ error: 'project-unavailable' }, { status: 404 }) } as const; }
  return { ok: true, db, userId: user.id, projectId: projectId! } as const;
}

export async function GET(request: Request): Promise<Response> {
  if (!dneskaiDailyMixEnabled()) return Response.json({ error: 'not-found' }, { status: 404 });
  const context = await owner(request); if (!context.ok) return context.response;
  try { return Response.json(await readDneskaiDailyMix(context.db, context.userId, context.projectId, { enabled: true }), { headers }); }
  catch { return Response.json({ error: 'daily-mix-unavailable' }, { status: 503, headers }); }
}

export async function PUT(request: Request): Promise<Response> {
  if (!dneskaiDailyMixEnabled()) return Response.json({ error: 'not-found' }, { status: 404 });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const context = await owner(request); if (!context.ok) return context.response;
  let raw: unknown;
  try { raw = JSON.parse(await boundedRequestText(request, 2048)); }
  catch { return Response.json({ error: 'invalid-daily-mix' }, { status: 400, headers }); }
  const input = DneskaiDailyMixSaveSchema.safeParse(raw);
  if (!input.success) return Response.json({ error: 'invalid-daily-mix' }, { status: 400, headers });
  try {
    const receipt = await saveDneskaiDailyMix(context.db, context.userId, context.projectId, input.data.mix, input.data.expectedVersion);
    return Response.json(receipt, { status: receipt.kind === 'conflict' ? 409 : 200, headers });
  } catch { return Response.json({ error: 'daily-mix-unavailable' }, { status: 503, headers }); }
}
