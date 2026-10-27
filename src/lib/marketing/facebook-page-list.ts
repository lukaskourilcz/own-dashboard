import 'server-only';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { MetaGraphRequestError } from './meta-graph-response';

const cursor = z.string().min(1).max(4096).refine(value => !/[\u0000-\u0020\u007f]/.test(value));
const paging = z.object({ next: z.string().min(1).max(16384).optional(), cursors: z.object({ after: cursor.optional() }).optional() });
type Reply = { status: number; body: unknown };
export type FacebookPageList<T> = { kind: 'complete'; pages: T[] } | { kind: 'http'; status: number; first: boolean };
function invalid(): never { throw new MetaGraphRequestError('meta-invalid-response'); }

/** Complete bounded Page list. Rebuild the original request; never follow a credential-bearing next URL. */
export async function readFacebookPages<T extends { id: string }>(
  initial: URL,
  schema: z.ZodType<T>,
  get: (url: URL) => Promise<Reply>,
  signal: AbortSignal,
): Promise<FacebookPageList<T>> {
  const source = new URL(initial.href);
  const match = /^\/(v\d+\.\d+)\/me\/accounts$/.exec(source.pathname);
  if (source.origin !== 'https://graph.facebook.com' || !match || source.username || source.password || source.hash
    || [...source.searchParams.keys()].some(key => !['fields', 'limit'].includes(key))) invalid();
  source.searchParams.set('limit', '25');
  const pages: T[] = [], ids = new Set<string>(), cursors = new Set<string>();
  const envelope = z.object({ data: z.array(schema).max(25), paging: paging.optional() });
  for (let page = 0; page < 10; page++) {
    signal.throwIfAborted();
    const response = await awaitWithSignal(get(new URL(source.href)), signal);
    signal.throwIfAborted();
    if (response.status !== 200) return { kind: 'http', status: response.status, first: page === 0 };
    const parsed = envelope.safeParse(response.body);
    if (!parsed.success || response.body && typeof response.body === 'object' && 'error' in response.body) invalid();
    for (const row of parsed.data.data) {
      if (ids.has(row.id) || pages.length >= 250) invalid();
      ids.add(row.id);
      pages.push(row);
    }
    const continuation = parsed.data.paging;
    if (!continuation?.next) return { kind: 'complete', pages };
    let next: URL;
    try { next = new URL(continuation.next); } catch { return invalid(); }
    const parts = next.pathname.split('/');
    if (next.origin !== source.origin || next.username || next.password || next.hash
      || parts.length !== 4 || parts[1] !== match[1] || parts[3] !== 'accounts'
      || parts[2] !== 'me' && !/^[0-9]{1,100}$/.test(parts[2])) invalid();
    const values = next.searchParams.getAll('after');
    if (values.length > 1) invalid();
    const captured = cursor.safeParse(continuation.cursors?.after ?? values[0]);
    if (!captured.success) invalid();
    const after = captured.data;
    if (values[0] !== undefined && values[0] !== after || cursors.has(after)) invalid();
    if (page === 9) invalid();
    cursors.add(after);
    source.searchParams.set('after', after);
  }
  return invalid();
}
