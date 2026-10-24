import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { dneskaiSourcesTableEnabled } from '@/lib/marketing/dneskai-evidence-rollout';
import { readDneskaiSourceRows } from '@/lib/marketing/dneskai-source-catalog';
import { awaitWithSignal } from '@/lib/abortable';
import {
  DNESKAI_SOURCE_LIST_VERSION, DneskaiSourceActionSchema, DneskaiSourceListSchema, dneskaiRegistrySourceList, dneskaiSourceSeedRows,
} from '@/lib/marketing/dneskai-source-list';
export const runtime = 'nodejs';

/**
 * GET /api/marketing/dneskai/source-list?projectId= and POST (#174): the sources Zdroje lists, and the owner's save
 * and remove. Everything runs through the owner's session: RLS decides what is read and the security-definer functions
 * of 20261023110000 check ownership. While DNESKAI_SOURCES_TABLE_ENABLED is off, GET answers the registry file
 * read-only and POST answers 404. GET never writes or restores sources removed by the owner.
 */
const headers = { 'Cache-Control': 'private, no-store' };
const REFUSALS: Array<[RegExp, string, number]> = [
  [/source unavailable/, 'source-unavailable', 404],
  [/source address changed/, 'source-address-changed', 409],
  [/source limit/, 'source-limit', 409],
  [/source invalid|check constraint|duplicate key/, 'invalid-source', 400],
];

type Db = Awaited<ReturnType<typeof createClient>>;
/** When each source was last read, its item count and last error, from the collection's source states. */
async function sourceStates(db: Db, owner: string, project: string, ids: string[]) {
  if (!ids.length) return new Map();
  const signal = AbortSignal.timeout(15_000);
  const { data, error, count } = await awaitWithSignal(db.from('marketing_dneskai_source_states').select('source_id,last_success_at,last_attempt_at,item_count,error_code,status', { count: 'exact' }).eq('user_id', owner).eq('project_id', project).in('source_id', ids).retry(false).abortSignal(signal).limit(ids.length + 1), signal);
  if (error || !Array.isArray(data) || count !== data.length || data.length > ids.length || new Set(data.map(row => row.source_id)).size !== data.length || data.some(row => !ids.includes(row.source_id))) throw new Error('source-history-unavailable');
  return new Map((data ?? []).map((row) => [String(row.source_id), {
    lastReadAt: (row.last_success_at ?? row.last_attempt_at ?? null) as string | null,
    lastItems: typeof row.item_count === 'number' ? row.item_count : null,
    lastErrorCode: row.status === 'ok' ? null : (row.error_code ?? null) as string | null,
  }]));
}

async function owner() {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  return { db, user };
}

export async function GET(request: Request) {
  const { db, user } = await owner();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400 });
  try { await requireDneskaiProject(db, user.id, projectId!); } catch { return Response.json({ error: 'project-unavailable' }, { status: 404 }); }
  try {
    const enabled = dneskaiSourcesTableEnabled();
    const rows = enabled ? await readDneskaiSourceRows(db as never, user.id, projectId!) : dneskaiSourceSeedRows();
    const states = await sourceStates(db, user.id, projectId!, rows.map(row => row.sourceId));
    if (!enabled) return Response.json(DneskaiSourceListSchema.parse(dneskaiRegistrySourceList(states)), { headers });
    return Response.json(DneskaiSourceListSchema.parse({ schemaVersion: DNESKAI_SOURCE_LIST_VERSION, editable: true, notice: null,
      items: rows.map((row) => ({ row, ...(states.get(row.sourceId) ?? { lastReadAt: null, lastItems: null, lastErrorCode: null }) })) }), { headers });
  } catch {
    return Response.json({ error: 'sources-unavailable' }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!dneskaiSourcesTableEnabled()) return Response.json({ error: 'not-found' }, { status: 404 });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const { db, user } = await owner();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = DneskaiSourceActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid-source' }, { status: 400 });
  const input = parsed.data;
  try { await requireDneskaiProject(db, user.id, input.projectId); } catch { return Response.json({ error: 'project-unavailable' }, { status: 404 }); }
  const { data, error } = input.action === 'save'
    ? await db.rpc('marketing_dneskai_source_save', { p_project: input.projectId, p_source: input.source })
    : await db.rpc('marketing_dneskai_source_remove', { p_project: input.projectId, p_source_id: input.sourceId });
  if (error) {
    const known = REFUSALS.find(([pattern]) => pattern.test(error.message ?? ''));
    return known ? Response.json({ error: known[1] }, { status: known[2] }) : Response.json({ error: 'sources-unavailable' }, { status: 503 });
  }
  return Response.json({ ok: true, result: data }, { headers });
}
