import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { DneskaiPaidActionError, generateDneskaiBriefNow } from '@/lib/marketing/dneskai-paid-actions';

export const runtime = 'nodejs';
// The job may be drafted within the request (one paid call under the daily ceiling), as in a scheduler tick.
export const maxDuration = 60;

/**
 * POST /api/marketing/dneskai/generate (owner decision 9, „Generate now“): a brief of today or tomorrow that waits for
 * the scheduler is admitted now through the scheduler's own brief step and drafted, under the $1 daily ceiling and the
 * job's reservation. Refusals carry a code the Lab words; nothing is approved.
 */
const Input = z.strictObject({ action: z.literal('generate-now'), briefId: z.uuid() });
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: 'invalid-generate-request' }, { status: 400 });
  try {
    const result = await generateDneskaiBriefNow({ admin: createAdminClient(), owner: user.id, briefId: input.data.briefId, env: process.env });
    return Response.json(result, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof DneskaiPaidActionError) return Response.json({ error: error.code }, { status: error.status });
    return Response.json({ error: 'generate-now-unavailable' }, { status: 503 });
  }
}
