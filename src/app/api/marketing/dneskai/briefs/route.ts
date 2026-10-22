import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { DneskaiRecoveryError, dneskaiRecoveryCapabilities, releaseDneskaiBrief, reslotDneskaiBrief, retryDneskaiBrief } from '@/lib/marketing/dneskai-recovery';
export const runtime = 'nodejs';

/**
 * Owner actions on a dead-end DNESKAi brief (briefs-07): `retry`, `reslot` and `release`. None of them admits a job,
 * approves a post or changes a ceiling; there is deliberately no `generate-now`.
 */
const Input = z.strictObject({ action: z.enum(['retry', 'reslot', 'release']), briefId: z.uuid() });
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: 'invalid-recovery-request' }, { status: 400 });
  const context = { user: db, admin: createAdminClient(), owner: user.id, capabilities: dneskaiRecoveryCapabilities(), now: new Date() };
  try {
    const result = input.data.action === 'retry' ? await retryDneskaiBrief(context, input.data.briefId)
      : input.data.action === 'reslot' ? await reslotDneskaiBrief(context, input.data.briefId) : await releaseDneskaiBrief(context, input.data.briefId);
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof DneskaiRecoveryError) return Response.json({ error: error.code }, { status: error.status });
    return Response.json({ error: 'recovery-unavailable' }, { status: 503 });
  }
}
