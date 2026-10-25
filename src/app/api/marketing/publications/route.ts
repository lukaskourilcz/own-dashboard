import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { awaitWithSignal } from '@/lib/abortable';
import { readKnowledgeBody } from '@/lib/marketing/knowledge-body';
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
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  if (signal.aborted) return fail(503, 'publication-requeue-failed');
  try {
    const db = await awaitWithSignal(createClient(signal), signal);
    const { data: { user }, error: authError } = await awaitWithSignal(db.auth.getUser(), signal);
    if (authError || !user) return fail(401, 'unauthorized');
    let input: z.infer<typeof Input>;
    try { input = Input.parse(JSON.parse(await readKnowledgeBody(request, 4096, signal))); }
    catch (error) {
      const interrupted = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      return fail(interrupted ? 503 : 400, interrupted ? 'publication-requeue-failed' : 'invalid-request');
    }
    if (!marketingPublicationRequeueEnabled(process.env)) return fail(409, 'publication-requeue-unavailable');
    const { data, error } = await awaitWithSignal(db.rpc('marketing_requeue_publication', { p_publication: input.id }).retry(false).abortSignal(signal), signal);
    if (error) {
      if (marketingRequeueFunctionMissing(error)) return fail(409, 'publication-requeue-unavailable');
      const code = Object.hasOwn(MARKETING_REQUEUE_REFUSALS, error.message) ? MARKETING_REQUEUE_REFUSALS[error.message] : 'publication-requeue-failed';
      return fail(code === 'publication-unavailable' ? 404 : 409, code);
    }
    const result = z.enum(MARKETING_PUBLICATION_REQUEUE_RESULTS).safeParse(data);
    if (!result.success) return fail(409, 'publication-requeue-failed');
    return Response.json({ result: result.data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return fail(503, 'publication-requeue-failed'); }
}
