import { DneskaiSourceListSchema, dneskaiRegistrySourceList, type DneskaiSourceAction, type DneskaiSourceList } from './dneskai-source-list';

/** A refused owner action: the stable code from /api/marketing/dneskai/source-list. */
export class DneskaiSourceListError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Zdroje's list (#174). The preview reads the registry file in the browser and never calls a server. */
export async function loadDneskaiSourceList(projectId: string, preview: boolean, signal?: AbortSignal): Promise<DneskaiSourceList> {
  if (preview) return dneskaiRegistrySourceList();
  const response = await fetch(`/api/marketing/dneskai/source-list?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store', signal });
  if (!response.ok) throw new DneskaiSourceListError('sources-unavailable');
  return DneskaiSourceListSchema.parse(await response.json());
}

export async function postDneskaiSourceAction(action: DneskaiSourceAction): Promise<void> {
  let response: Response;
  try { response = await fetch('/api/marketing/dneskai/source-list', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }); }
  catch { throw new DneskaiSourceListError('sources-unavailable'); }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new DneskaiSourceListError(typeof body?.error === 'string' ? body.error : 'sources-unavailable');
  }
}
