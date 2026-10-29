import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { requireDneskaiProject } from '@/lib/marketing/dneskai-store';
import { dneskaiSourcesTableEnabled } from '@/lib/marketing/dneskai-evidence-rollout';
import { readDneskaiSourceRows } from '@/lib/marketing/dneskai-source-catalog';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedRequestText, MarketingRequestBodyError } from '@/lib/marketing/http';
import {
  DNESKAI_SOURCE_LIST_VERSION, DneskaiSourceActionSchema, DneskaiSourceListSchema, dneskaiRegistrySourceList, dneskaiSourceSeedRows, confirmDneskaiSourceReceipt,
} from '@/lib/marketing/dneskai-source-list';
export const runtime = 'nodejs';

/**
 * GET /api/marketing/dneskai/source-list?projectId= and POST (#174): the sources Zdroje lists, and the owner's save
 * and remove. Everything runs through the owner's session: RLS decides what is read and the security-definer functions
 * check ownership. Captured source edits use migration 113. While DNESKAI_SOURCES_TABLE_ENABLED is off, GET answers the registry file
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
async function sourceStates(db: Db, owner: string, project: string, ids: string[], parent: AbortSignal) {
  if (!ids.length) return new Map();
  const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
  const { data, error, count } = await awaitWithSignal(db.from('marketing_dneskai_source_states').select('source_id,last_success_at,last_attempt_at,item_count,error_code,status', { count: 'exact' }).eq('user_id', owner).eq('project_id', project).in('source_id', ids).retry(false).abortSignal(signal).limit(ids.length + 1), signal);
  if (error || !Array.isArray(data) || count !== data.length || data.length > ids.length || new Set(data.map(row => row.source_id)).size !== data.length || data.some(row => !ids.includes(row.source_id))) throw new Error('source-history-unavailable');
  return new Map((data ?? []).map((row) => [String(row.source_id), {
    lastReadAt: (row.last_success_at ?? row.last_attempt_at ?? null) as string | null,
    lastItems: typeof row.item_count === 'number' ? row.item_count : null,
    lastErrorCode: row.status === 'ok' ? null : (row.error_code ?? null) as string | null,
  }]));
}

async function owner(signal: AbortSignal) {
  const db = await awaitWithSignal(createClient(signal), signal);
  const { data: { user }, error } = await awaitWithSignal(db.auth.getUser(), signal);
  if (error) {
    if (![400, 401, 403].includes(error.status ?? 0)) throw new Error('sources-unavailable');
    return { db, user: null };
  }
  return { db, user };
}
const requestBudget = (request: Request) => AbortSignal.any([request.signal, AbortSignal.timeout(18_000)]);
async function projectAvailable(db: Db, user: string, project: string, signal: AbortSignal): Promise<boolean> {
  try { await awaitWithSignal(requireDneskaiProject(db, user, project, signal), signal); return true; }
  catch (error) {
    if (!signal.aborted && error instanceof Error && error.message === 'collection-project-unavailable') return false;
    throw error;
  }
}

export async function GET(request: Request) {
  const signal = requestBudget(request);
  try {
    const { db, user } = await owner(signal);
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
    const projectId = new URL(request.url).searchParams.get('projectId');
    if (!z.uuid().safeParse(projectId).success) return Response.json({ error: 'invalid-project' }, { status: 400, headers });
    if (!await projectAvailable(db, user.id, projectId!, signal)) return Response.json({ error: 'project-unavailable' }, { status: 404, headers });
    const enabled = dneskaiSourcesTableEnabled();
    const rows = enabled ? await readDneskaiSourceRows(db as never, user.id, projectId!, signal) : dneskaiSourceSeedRows();
    const states = await sourceStates(db, user.id, projectId!, rows.map(row => row.sourceId), signal);
    if (!enabled) return Response.json(DneskaiSourceListSchema.parse(dneskaiRegistrySourceList(states)), { headers });
    return Response.json(DneskaiSourceListSchema.parse({ schemaVersion: DNESKAI_SOURCE_LIST_VERSION, editable: true, notice: null,
      items: rows.map((row) => ({ row, ...(states.get(row.sourceId) ?? { lastReadAt: null, lastItems: null, lastErrorCode: null }) })) }), { headers });
  } catch {
    return Response.json({ error: 'sources-unavailable' }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!dneskaiSourcesTableEnabled()) return Response.json({ error: 'not-found' }, { status: 404, headers });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = requestBudget(request);
  try {
    const { db, user } = await owner(signal);
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
    let body: unknown;
    try { body = JSON.parse(await awaitWithSignal(boundedRequestText(request, 16_384, signal), signal)); }
    catch (error) {
      if (signal.aborted) throw error;
      const timedOut = error instanceof MarketingRequestBodyError && error.code === 'request-body-timeout';
      return Response.json({ error: timedOut ? 'sources-unavailable' : 'invalid-source' }, { status: timedOut ? 408 : 400, headers });
    }
    const parsed = DneskaiSourceActionSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: 'invalid-source' }, { status: 400, headers });
    const input = parsed.data;
    if (!await projectAvailable(db, user.id, input.projectId, signal)) return Response.json({ error: 'project-unavailable' }, { status: 404, headers });
    signal.throwIfAborted();
    const { data, error } = await awaitWithSignal(db.rpc('change_dneskai_source', { p_project: input.projectId, p_action: input.action,
      p_expected: input.expected, p_source: input.action === 'save' ? input.source : null }).retry(false).abortSignal(signal), signal);
    if (error) {
      const known = REFUSALS.find(([pattern]) => pattern.test(error.message ?? ''));
      return known ? Response.json({ error: known[1] }, { status: known[2], headers }) : Response.json({ error: 'sources-unavailable' }, { status: 503, headers });
    }
    const receipt = confirmDneskaiSourceReceipt(data, input, user.id);
    return Response.json(receipt, { status: receipt.kind === 'conflict' ? 409 : 200, headers });
  } catch { return Response.json({ error: 'sources-unavailable' }, { status: 503, headers }); }
}
