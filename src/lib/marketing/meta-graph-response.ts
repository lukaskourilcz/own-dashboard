import 'server-only';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';

/** Fixed local reasons; provider bodies and credentials never enter diagnostics. */
export class MetaGraphRequestError extends Error {
  constructor(readonly code: 'meta-request-uncertain' | 'meta-invalid-response') {
    super('Meta request unavailable');
    this.name = 'MetaGraphRequestError';
  }
}

/** One no-retry Graph request, including bounded complete JSON, under the original scope. */
export async function metaGraphResponse(
  url: string,
  init: RequestInit,
  parent: AbortSignal,
  fetcher: typeof fetch = fetch,
  options: { maximum?: number; readErrors?: boolean } = {},
): Promise<{ status: number; body: unknown }> {
  const maximum = options.maximum ?? 16_384;
  const signal = AbortSignal.any([parent, AbortSignal.timeout(10_000), ...(init.signal ? [init.signal] : [])]);
  const discard = (response: Response) => {
    if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
  };
  let response: Response | undefined;
  try {
    signal.throwIfAborted();
    const pending = fetcher(url, { ...init, redirect: 'error', cache: 'no-store', signal });
    void pending.then(value => { if (signal.aborted) discard(value); }, () => undefined);
    response = await awaitWithSignal(pending, signal);
    signal.throwIfAborted();
  } catch {
    if (response) discard(response);
    throw new MetaGraphRequestError('meta-request-uncertain');
  }
  if (response.status !== 200 && options.readErrors === false) {
    discard(response);
    return { status: response.status, body: null };
  }
  try {
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new Error();
    const body: unknown = JSON.parse(await boundedResponseText(response, response.status === 200 ? maximum : 4096, signal));
    signal.throwIfAborted();
    return { status: response.status, body };
  } catch {
    discard(response);
    throw new MetaGraphRequestError(signal.aborted ? 'meta-request-uncertain' : 'meta-invalid-response');
  }
}
