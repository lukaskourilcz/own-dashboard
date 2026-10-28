import { z } from 'zod';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { readKnowledgeBody } from '@/lib/marketing/knowledge-body';
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
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  let context: Awaited<ReturnType<typeof readVerifiedServerContext>>;
  try { context = await readVerifiedServerContext(signal); }
  catch { return Response.json({ error: 'generate-now-unavailable' }, { status: 503 }); }
  if (!context) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let input: z.infer<typeof Input>;
  try { input = Input.parse(JSON.parse(await readKnowledgeBody(request, 4096, signal))); signal.throwIfAborted(); }
  catch (error) {
    const interrupted = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    return Response.json({ error: interrupted ? 'generate-now-unavailable' : 'invalid-generate-request' }, { status: interrupted ? 503 : 400 });
  }
  try {
    const result = await generateDneskaiBriefNow({ admin: createAdminClient(), owner: context.ownerId, briefId: input.briefId, env: process.env });
    return Response.json(result, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof DneskaiPaidActionError) return Response.json({ error: error.code }, { status: error.status });
    return Response.json({ error: 'generate-now-unavailable' }, { status: 503 });
  }
}
