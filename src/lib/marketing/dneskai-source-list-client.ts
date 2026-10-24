import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { readTextPrefix } from '@/lib/bounded-text';
import { DneskaiSourceActionSchema, DneskaiSourceListSchema, DneskaiSourceReceiptSchema, DneskaiSourceRefusalSchema,
  confirmDneskaiSourceReceipt, dneskaiRegistrySourceList, type DneskaiSourceAction, type DneskaiSourceList, type DneskaiSourceReceipt } from './dneskai-source-list';

/** Only recognized refusal codes reach UI dictionaries; upstream text never does. */
export class DneskaiSourceListError extends Error {
  constructor(readonly code: z.infer<typeof DneskaiSourceRefusalSchema>) { super(code); this.name = 'DneskaiSourceListError'; }
}
const budget = (parent?: AbortSignal) => AbortSignal.any([AbortSignal.timeout(20_000), ...(parent ? [parent] : [])]);
const refusal = z.strictObject({ error: DneskaiSourceRefusalSchema });
async function json(response: Response, maximum: number, signal: AbortSignal): Promise<unknown> {
  const body = await awaitWithSignal(readTextPrefix(response, maximum, signal), signal);
  if (body.truncated) throw new DneskaiSourceListError('sources-unavailable');
  return JSON.parse(body.text);
}
function failed(error: unknown, parent?: AbortSignal): never {
  if (parent?.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof DneskaiSourceListError ? error : new DneskaiSourceListError('sources-unavailable');
}

/** The preview reads only the registry; live lists have one whole-response deadline and a 1 MiB text cap. */
export async function loadDneskaiSourceList(projectId: string, preview: boolean, parent?: AbortSignal): Promise<DneskaiSourceList> {
  if (preview) return dneskaiRegistrySourceList();
  z.uuid().parse(projectId); const signal = budget(parent); signal.throwIfAborted();
  try {
    const response = await awaitWithSignal(fetch(`/api/marketing/dneskai/source-list?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store', signal }), signal);
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new DneskaiSourceListError('sources-unavailable'); }
    return DneskaiSourceListSchema.parse(await json(response, 1_048_576, signal));
  } catch (error) { failed(error, parent); }
}

/** No retries: an ambiguous write reconciles through the canonical list, never an automatic second mutation. */
export async function postDneskaiSourceAction(value: DneskaiSourceAction, parent?: AbortSignal): Promise<DneskaiSourceReceipt> {
  const action = DneskaiSourceActionSchema.parse(value), body = JSON.stringify(action), signal = budget(parent);
  if (new TextEncoder().encode(body).byteLength > 16_384) throw new DneskaiSourceListError('invalid-source');
  signal.throwIfAborted();
  try {
    const response = await awaitWithSignal(fetch('/api/marketing/dneskai/source-list', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body, signal }), signal);
    const result = await json(response, response.ok || response.status === 409 ? 16_384 : 4096, signal);
    if (response.ok || (response.status === 409 && DneskaiSourceReceiptSchema.safeParse(result).success)) {
      const receipt = confirmDneskaiSourceReceipt(result, action);
      if (receipt.kind === 'conflict') throw new DneskaiSourceListError('source-changed');
      if (!response.ok) throw new DneskaiSourceListError('sources-unavailable');
      return receipt;
    }
    const known = refusal.safeParse(result);
    throw new DneskaiSourceListError(known.success ? known.data.error : 'sources-unavailable');
  } catch (error) { failed(error, parent); }
}
