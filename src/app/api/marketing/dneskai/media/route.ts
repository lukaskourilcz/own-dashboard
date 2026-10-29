import { z } from 'zod';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { readDneskaiMedia } from '@/lib/marketing/dneskai-media';

export const runtime = 'nodejs';

/**
 * The owner's DNESKAi media tray (#114, #119): collected source pictures per candidate with credit, order,
 * size, resolution flags, duplicate marker and one-hour signed preview links. Reads through the owner's
 * session, so row-level security and the bucket's owner-prefix policy decide what is visible.
 */
export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  let context: Awaited<ReturnType<typeof readVerifiedServerContext>>;
  try { context = await readVerifiedServerContext(signal); }
  catch { return Response.json({ error: 'media-unavailable' }, { status: 503 }); }
  if (!context) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { db, ownerId } = context;
  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId');
  const candidateId = params.get('candidateId');
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400 });
  if (candidateId !== null && !/^[A-Za-z0-9_.:-]{1,200}$/.test(candidateId)) return Response.json({ error: 'invalid-candidate' }, { status: 400 });
  try {
    await requireDneskaiProject(db, ownerId, projectId!, AbortSignal.any([signal, AbortSignal.timeout(5_000)]));
  } catch (error) {
    return error instanceof Error && error.message === 'collection-project-unavailable'
      ? Response.json({ error: 'project-unavailable' }, { status: 404 })
      : Response.json({ error: 'media-unavailable' }, { status: 503 });
  }
  try {
    signal.throwIfAborted();
    const media = await awaitWithSignal(readDneskaiMedia(db, ownerId, projectId!, { signal, ...(candidateId ? { candidateId } : {}), sign: true }), signal);
    signal.throwIfAborted();
    return Response.json(media, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'media-unavailable' }, { status: 503 });
  }
}
