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

export type LivenessProbe = (url: string) => Promise<number | null>;

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
export async function probeUrl(url: string): Promise<number | null> {
  const request = (method: "HEAD" | "GET") =>
    fetch(url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
        accept: "*/*",
      },
    });

  try {
    const head = await request("HEAD");
    if (head.status === 405 || head.status === 501) {
      return (await request("GET")).status;
    }
    return head.status;
  } catch {
    return null;
  }
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
    now = () => Date.now(),
  } = options;

  const dead = new Set<string>();
  const queue = urls.slice(0, maxChecks);
  const startedAt = now();

  for (let i = 0; i < queue.length; i += batchSize) {
    if (now() - startedAt >= budgetMs) break;
    const batch = queue.slice(i, i + batchSize);
    const statuses = await Promise.all(batch.map((url) => probe(url)));
    statuses.forEach((status, index) => {
      if (isGone(status)) dead.add(batch[index]);
    });
  }

  return dead;
}
