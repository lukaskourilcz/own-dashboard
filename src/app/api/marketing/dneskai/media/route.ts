import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { readDneskaiMedia } from '@/lib/marketing/dneskai-media';

export const runtime = 'nodejs';

/**
 * The owner's DNESKAi media tray (#114, #119): collected source pictures per candidate with credit, order,
 * size, resolution flags, duplicate marker and one-hour signed preview links. Reads through the owner's
 * session, so row-level security and the bucket's owner-prefix policy decide what is visible.
 */
export async function GET(request: Request) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId');
  const candidateId = params.get('candidateId');
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400 });
  if (candidateId !== null && !/^[A-Za-z0-9_.:-]{1,200}$/.test(candidateId)) return Response.json({ error: 'invalid-candidate' }, { status: 400 });
  try {
    await requireDneskaiProject(db, user.id, projectId!);
  } catch {
    return Response.json({ error: 'project-unavailable' }, { status: 404 });
  }
  try {
    const media = await readDneskaiMedia(db, user.id, projectId!, { ...(candidateId ? { candidateId } : {}), sign: true });
    return Response.json(media, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'media-unavailable' }, { status: 503 });
  }
}
