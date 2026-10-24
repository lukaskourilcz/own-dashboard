import { awaitWithSignal } from '@/lib/abortable';

const BODY_READ_TIMEOUT_MS = 5_000;
const aborted = () => new DOMException('Request aborted', 'AbortError');

/** Bound UTF-8 bytes and elapsed read time before allocating an untrusted body. */
export async function readKnowledgeBody(request: Request, limit = 1_100_000, parent?: AbortSignal): Promise<string> {
  if (request.signal.aborted || parent?.aborted) throw aborted();
  const claimed = request.headers.get('content-length');
  if (!Number.isSafeInteger(limit) || limit < 1 || (claimed !== null && (!/^\d+$/.test(claimed) || Number(claimed) > limit))) throw new Error('capture-too-large');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const deadline = new AbortController();
  const signal = AbortSignal.any([request.signal, deadline.signal, ...(parent ? [parent] : [])]);
  const timer = setTimeout(() => deadline.abort(), BODY_READ_TIMEOUT_MS);
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    // A hostile/incomplete stream must not extend the deadline through its cancel hook.
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await awaitWithSignal(reader.read(), signal);
      if (signal.aborted) throw aborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error('capture-too-large');
      parts.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    cancel();
    if (signal.aborted) throw aborted();
    if (error instanceof Error && error.message === 'capture-too-large') throw error;
    throw new Error('capture-read-failed');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
