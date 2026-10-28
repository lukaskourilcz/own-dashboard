import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { BoundedStreamError, boundedStreamBytes } from '@/lib/bounded-response';
import { MARKETING_CALENDAR_SOURCES } from '@/lib/marketing-calendars';
import type { GitHubFetch } from '@/lib/stack-detection-server';
import type { MarketingBrand } from './contracts';

export const MARKETING_CALENDAR_IMPORT_TIMEOUT_MS = 20_000;
const MAX_BYTES = 1024 * 1024;
type ImportedMarketingCalendar = Record<string, unknown> & {
 _importProvenance: { repository: string; path: string; sourceCommit: string; fileSha256: string };
};
const commitsSchema = z.array(z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })).min(1).max(1);
const discard = (response?: Response) => {
 if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
};

/** One complete header/body phase. Refused and late responses never retain a reader. */
async function sourceBytes(fetcher: GitHubFetch, path: string, original: AbortSignal, kind: 'repository' | 'source', headers?: HeadersInit) {
 const signal = AbortSignal.any([original, AbortSignal.timeout(10_000)]);
 let response: Response | undefined, consumed = false;
 try {
  signal.throwIfAborted();
  const pending = fetcher(path, { headers, signal });
  void pending.then(value => { if (signal.aborted) discard(value); }, () => undefined);
  response = await awaitWithSignal(pending, signal);
  signal.throwIfAborted();
  if (response.status !== 200 || !response.body || response.bodyUsed || response.body.locked) throw new Error('unavailable');
  if (kind === 'repository' && !/^application\/(?:json|[\w.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('unavailable');
  const declared = response.headers.get('content-length');
  if (declared !== null && !/^\d+$/.test(declared)) throw new Error('unavailable');
  if (declared !== null && Number(declared) > MAX_BYTES) throw new BoundedStreamError('size');
  const bytes = await boundedStreamBytes(response.body, MAX_BYTES, signal);
  signal.throwIfAborted(); consumed = true;
  return bytes;
 } catch (error) {
  if (original.aborted) throw new DOMException('Request aborted', 'AbortError');
  if (kind === 'source' && error instanceof BoundedStreamError && error.reason === 'size') throw new Error('calendar-too-large');
  throw new Error(kind === 'repository' ? 'calendar-repository-unavailable' : 'calendar-source-unavailable');
 } finally { if (!consumed) discard(response); }
}

/** Import the complete pinned file, preserving authored fields and its exact byte hash. */
export async function readFullMarketingCalendar(fetcher: GitHubFetch, brand: MarketingBrand, parent?: AbortSignal): Promise<ImportedMarketingCalendar> {
 const retirement = new AbortController();
 const original = AbortSignal.any([retirement.signal, AbortSignal.timeout(MARKETING_CALENDAR_IMPORT_TIMEOUT_MS), ...(parent ? [parent] : [])]);
 try {
  original.throwIfAborted();
  const source = MARKETING_CALENDAR_SOURCES.find(value => value.project === brand);
  if (!source) throw new Error('calendar-source-unavailable');
  let commit: string;
  try {
   const bytes = await sourceBytes(fetcher, `/repos/${source.repo}/commits?path=${encodeURIComponent(source.path)}&per_page=1`, original, 'repository');
   commit = commitsSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))[0].sha;
  } catch { throw new Error('calendar-repository-unavailable'); }
  original.throwIfAborted();
  const raw = await sourceBytes(fetcher, `/repos/${source.repo}/contents/${source.path}?ref=${commit}`, original, 'source', { Accept: 'application/vnd.github.raw+json' });
  let plan: Record<string, unknown>;
  try {
   plan = z.object({ schemaVersion: z.literal('marketing-calendar/1'), project: z.literal(brand) }).passthrough().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  } catch { throw new Error('calendar-source-unavailable'); }
  original.throwIfAborted();
  return { ...plan, _importProvenance: { repository: source.repo, path: source.path, sourceCommit: commit, fileSha256: createHash('sha256').update(raw).digest('hex') } };
 } catch (error) {
  if (original.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error;
 } finally { retirement.abort(); }
}
