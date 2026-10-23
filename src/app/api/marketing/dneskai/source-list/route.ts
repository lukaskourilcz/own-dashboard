import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { dneskaiSourcesTableEnabled } from '@/lib/marketing/dneskai-evidence-rollout';
import { readDneskaiSourceRows } from '@/lib/marketing/dneskai-source-catalog';
import {
  DNESKAI_SOURCE_LIST_VERSION, DneskaiSourceActionSchema, DneskaiSourceListSchema, dneskaiRegistrySourceList, dneskaiSourceSeedRows,
} from '@/lib/marketing/dneskai-source-list';
export const runtime = 'nodejs';

/**
 * GET /api/marketing/dneskai/source-list?projectId= and POST (#174): the sources Zdroje lists, and the owner's save
 * and remove. Everything runs through the owner's session: RLS decides what is read and the security-definer functions
 * of 20261023110000 check ownership. While DNESKAI_SOURCES_TABLE_ENABLED is off, GET answers the registry file
 * read-only and POST answers 404. The first GET with the switch on seeds the owner's rows from the file, once.
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
async function sourceStates(db: Db, owner: string, project: string) {
  const { data } = await db.from('marketing_dneskai_source_states').select('source_id,last_success_at,last_attempt_at,item_count,error_code,status').eq('user_id', owner).eq('project_id', project);
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
  const states = await sourceStates(db, user.id, projectId!).catch(() => new Map());
  if (!dneskaiSourcesTableEnabled()) return Response.json(DneskaiSourceListSchema.parse(dneskaiRegistrySourceList(states)), { headers });
  try {
    let rows = await readDneskaiSourceRows(db as never, user.id, projectId!);
    if (!rows.length) {
      const { error } = await db.rpc('marketing_dneskai_sources_seed', { p_project: projectId, p_rows: dneskaiSourceSeedRows() });
      if (error) throw error;
      rows = await readDneskaiSourceRows(db as never, user.id, projectId!);
    }
    return Response.json(DneskaiSourceListSchema.parse({ schemaVersion: DNESKAI_SOURCE_LIST_VERSION, editable: true, notice: null,
      items: rows.map((row) => ({ row, ...(states.get(row.sourceId) ?? { lastReadAt: null, lastItems: null, lastErrorCode: null }) })) }), { headers });
  } catch {
    // The switch is on but the migration is not applied (or the read failed): the file, read-only, says so.
    return Response.json(DneskaiSourceListSchema.parse(dneskaiRegistrySourceList(states, 'sources-table-unavailable')), { headers });
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
