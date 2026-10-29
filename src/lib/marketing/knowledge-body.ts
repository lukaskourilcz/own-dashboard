import { boundedStreamBytes, BoundedStreamError } from '@/lib/bounded-response';

const BODY_READ_TIMEOUT_MS = 5_000;
const aborted = () => new DOMException('Request aborted', 'AbortError');

/** Bound UTF-8 bytes and elapsed read time before allocating an untrusted body. */
export async function readKnowledgeBody(request: Request, limit = 1_100_000, parent?: AbortSignal): Promise<string> {
  if (request.signal.aborted || parent?.aborted) throw aborted();
  const claimed = request.headers.get('content-length');
  if (!Number.isSafeInteger(limit) || limit < 1 || (claimed !== null && (!/^\d+$/.test(claimed) || Number(claimed) > limit))) throw new Error('capture-too-large');
  if (!request.body) return '';
  if (request.bodyUsed || request.body.locked) throw new Error('capture-read-failed');
  const deadline = new AbortController();
  const signal = AbortSignal.any([request.signal, deadline.signal, ...(parent ? [parent] : [])]);
  const timer = setTimeout(() => deadline.abort(), BODY_READ_TIMEOUT_MS);
  try {
    const bytes = await boundedStreamBytes(request.body, limit, signal);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (signal.aborted) throw aborted();
    throw new Error(error instanceof BoundedStreamError && error.reason === 'size' ? 'capture-too-large' : 'capture-read-failed');
  } finally {
    clearTimeout(timer);
  }
}
