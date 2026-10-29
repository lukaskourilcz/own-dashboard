import { isJobUrl } from "./availability";
import { awaitWithSignal } from "@/lib/abortable";
/**
 * Deciding which stored listings are gone.
 *
 * A listing missing from a scrape means two different things depending on the
 * board. For a complete feed (`JobSourceMeta.complete`) the response is the
 * whole current set, so absence proves removal. For a paginated or query-driven
 * board it proves nothing: a live offer drops out of page one as soon as newer
 * ads push it down. Deleting on absence alone would churn perfectly good
 * listings out of the section and back in.
 *
 * So partial sources get an HTTP liveness check, and only a definite "gone"
 * answer deletes the row. Anything ambiguous — a timeout, a 500, a redirect,
 * a block — keeps the listing; the 45-day sweep in `scrape.ts` is the backstop
 * for boards that quietly stop answering.
 */

/** Statuses that prove the posting is gone rather than merely unreachable. */
const GONE_STATUSES = new Set([404, 410]);

type LivenessProbe = (url: string, signal?: AbortSignal) => Promise<number | null>;

export type LivenessOptions = {
  /** Concurrent requests. Boards are third parties, so stay polite. */
  batchSize?: number;
  /** Stop probing once the run has spent this long, and keep the rest. */
  budgetMs?: number;
  /** Hard cap on probes per run, independent of the time budget. */
  maxChecks?: number;
  /** Injected for tests; defaults to a real HEAD/GET probe. */
  probe?: LivenessProbe;
  /** Injected for tests. */
  now?: () => number;
  /** Retire the whole pass; cancellation never becomes closure evidence. */
  signal?: AbortSignal;
};

/**
 * Classify a probe result. Exported because it is the whole policy: only an
 * explicit 404/410 is treated as removal.
 */
export function isGone(status: number | null): boolean {
  return status !== null && GONE_STATUSES.has(status);
}

const PROBE_TIMEOUT_MS = 8_000;

/**
 * HEAD the posting, falling back to GET when a board rejects HEAD (405/501).
 * Returns the status, or null when the request could not be completed at all.
 */
async function probeUrl(url: string, parent?: AbortSignal): Promise<number | null> {
  if (!isJobUrl(url)) return null;
  const lifetime = new AbortController(), timer = setTimeout(() => lifetime.abort(), PROBE_TIMEOUT_MS);
  const signal = AbortSignal.any([lifetime.signal, ...(parent ? [parent] : [])]);
  const request = async (method: "HEAD" | "GET") => {
    signal.throwIfAborted();
    const pending = fetch(url, {
      method,
      redirect: "manual",
      signal,
      cache: "no-store",
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
        accept: "*/*",
      },
    });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => undefined); }).catch(() => undefined);
    const response = await awaitWithSignal(pending, signal);
    // Only the status matters, including on HEAD-refused GET fallback.
    void response.body?.cancel().catch(() => undefined);
    signal.throwIfAborted();
    return response.status;
  };

  try {
    const head = await request("HEAD");
    if (head === 405 || head === 501) {
      return await request("GET");
    }
    return head;
  } catch {
    return null;
  } finally { clearTimeout(timer); lifetime.abort(); }
}

/**
 * Probe `urls` and return only those proven gone.
 *
 * Bounded on purpose: the caller runs inside a request with a wall-clock
 * limit, so an unbounded probe list could starve the rest of the scrape.
 * Whatever is not reached this run is simply retried next run.
 */
export async function selectDeadUrls(
  urls: string[],
  options: LivenessOptions = {},
): Promise<Set<string>> {
  const {
    batchSize = 10,
    budgetMs = 15_000,
    maxChecks = 150,
    probe = probeUrl,
    now = () => performance.now(),
    signal: parent,
  } = options;

  const dead = new Set<string>();
  // Refuse invalid internal options rather than entering a non-advancing or unbounded loop.
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10 || !Number.isInteger(maxChecks) || maxChecks < 0 || maxChecks > 150
    || !Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 15_000) return dead;
  if (parent?.aborted) throw new DOMException("Request aborted", "AbortError");
  const queue = [...new Set(urls.slice(0, maxChecks))];
  const startedAt = now();
  if (!Number.isFinite(startedAt) || !queue.length) return dead;
  const lifetime = new AbortController(), timer = setTimeout(() => lifetime.abort(), budgetMs);
  const signal = AbortSignal.any([lifetime.signal, ...(parent ? [parent] : [])]);
  let observed = startedAt;
  const expired = () => {
    const current = now(), invalid = !Number.isFinite(current) || current < observed;
    observed = current;
    return invalid || current - startedAt >= budgetMs || signal.aborted;
  };
  try {
    for (let i = 0; i < queue.length; i += batchSize) {
      if (expired()) break;
      const batch = queue.slice(i, i + batchSize);
      let statuses: (number | null)[];
      try {
        statuses = await awaitWithSignal(Promise.all(batch.map(url => Promise.resolve().then(() => {
          signal.throwIfAborted(); return probe(url, signal);
        }).catch(() => null))), signal);
      } catch { break; }
      if (expired()) break;
      statuses.forEach((status, index) => { if (isGone(status)) dead.add(batch[index]); });
    }
    if (parent?.aborted) throw new DOMException("Request aborted", "AbortError");
    return dead;
  } finally { clearTimeout(timer); lifetime.abort(); }
}
