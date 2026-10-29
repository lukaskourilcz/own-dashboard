/** Reject promptly without exposing caller-supplied abort reasons. The original
 * promise remains observed, so a late rejection cannot become unhandled. */
export function awaitWithSignal<T>(pending: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(pending);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Request aborted", "AbortError"));
    if (signal.aborted) { Promise.resolve(pending).catch(() => undefined); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(pending).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A request-scoped fetch boundary. Normalize TimeoutError to AbortError so the
 * installed database SDK does not treat an expired budget as a retryable error.
 * Keep the builder's own signal too, to interrupt its Retry-After/backoff sleep. */
export function fetchWithSignal(parent: AbortSignal, fetcher: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const signals = [parent];
    if (init?.signal) signals.push(init.signal);
    if (input instanceof Request) signals.push(input.signal);
    const signal = AbortSignal.any(signals);
    try {
      if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
      return await fetcher(input, { ...init, signal });
    } catch (error) {
      if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
      throw error;
    }
  };
}
