import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { MARKETING_PUBLICATION_REQUEUE_RESULTS, MARKETING_REQUEUE_REFUSALS, marketingPublicationRequeueEnabled, marketingRequeueFunctionMissing } from '@/lib/marketing/publication-requeue';

export const runtime = 'nodejs';
const Input = z.strictObject({ action: z.literal('requeue'), id: z.uuid() });

/**
 * POST /api/marketing/publications {action:'requeue', id} (audit finding approval-04): the owner gives up on a
 * stranded publication that provably published nothing and returns its post to approved-but-unpublished. The
 * session client calls `marketing_requeue_publication`, which checks ownership with auth.uid(), refuses any row
 * with a numeric container, a media ID, a URL or a publish intent, and never touches the approval. It sends
 * nothing to Meta. Off unless the server-only MARKETING_PUBLICATION_REQUEUE_ENABLED is `true`; without the
 * migration the call answers `publication-requeue-unavailable` as well.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let input: z.infer<typeof Input>;
  try { input = Input.parse(await request.json()); } catch { return Response.json({ error: 'invalid-request' }, { status: 400 }); }
  if (!marketingPublicationRequeueEnabled(process.env)) return Response.json({ error: 'publication-requeue-unavailable' }, { status: 409 });
  const { data, error } = await db.rpc('marketing_requeue_publication', { p_publication: input.id });
  if (error) {
    if (marketingRequeueFunctionMissing(error)) return Response.json({ error: 'publication-requeue-unavailable' }, { status: 409 });
    const code = MARKETING_REQUEUE_REFUSALS[error.message] ?? 'publication-requeue-failed';
    return Response.json({ error: code }, { status: code === 'publication-unavailable' ? 404 : 409 });
  }
  const result = z.enum(MARKETING_PUBLICATION_REQUEUE_RESULTS).safeParse(data);
  return Response.json({ result: result.success ? result.data : 'queued' }, { headers: { 'Cache-Control': 'private, no-store' } });
}
