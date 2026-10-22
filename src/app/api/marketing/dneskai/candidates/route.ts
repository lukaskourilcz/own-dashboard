import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { DneskaiRecoveryError, dneskaiRecoveryCapabilities, releaseHeldDneskaiCandidate } from '@/lib/marketing/dneskai-recovery';
export const runtime = 'nodejs';

/** C3: the owner returns a held report to the next nightly review. Releasing is not approval and does not bypass Jev. */
const Input = z.strictObject({ action: z.literal('release'), projectId: z.uuid(), candidateId: z.string().min(1).max(200) });
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: 'invalid-recovery-request' }, { status: 400 });
  try {
    const result = await releaseHeldDneskaiCandidate({ user: db, owner: user.id, capabilities: dneskaiRecoveryCapabilities(), now: new Date() }, input.data.projectId, input.data.candidateId);
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof DneskaiRecoveryError) return Response.json({ error: error.code }, { status: error.status });
    return Response.json({ error: 'recovery-unavailable' }, { status: 503 });
  }
}
