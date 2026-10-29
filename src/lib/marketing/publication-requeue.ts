/**
 * Owner "give up and re-queue" for a stranded publication (audit finding approval-04). Browser-safe: no server
 * module is imported.
 *
 * The publisher's only durable intent is written after the numeric parent container ID is stored and before the
 * single media_publish request. A publication without a numeric container ID, a media ID, a URL or a recorded
 * publish intent therefore never reached media_publish and may go back to `queued` with its approval and bytes
 * unchanged. `marketing_requeue_publication` (migration 20261022110000) enforces the same rule in SQL;
 * this copy only decides whether the panel offers the action.
 */
export const MARKETING_PUBLICATION_REQUEUE_FLAG = 'MARKETING_PUBLICATION_REQUEUE_ENABLED';
export const MARKETING_PUBLICATION_REQUEUE_RESULTS = ['queued', 'queued-window-passed'] as const;
export type MarketingPublicationRequeueResult = (typeof MARKETING_PUBLICATION_REQUEUE_RESULTS)[number];

/** Server-only switch, off by default; enable only after the migration is deployed. */
export function marketingPublicationRequeueEnabled(env: Record<string, string | undefined>): boolean {
  return env[MARKETING_PUBLICATION_REQUEUE_FLAG] === 'true';
}

export type MarketingRequeueCandidate = {
  status: string; remoteContainerId: string | null; remoteMediaId: string | null; remoteUrl: string | null; errorCode: string | null; leaseUntil: string | null;
};
/** Stranded (reconciliation, or a claim whose lease ran out) and provably unpublished. */
export function marketingPublicationRequeueable(row: MarketingRequeueCandidate, now: Date): boolean {
  const lease = row.leaseUntil === null ? Number.NaN : Date.parse(row.leaseUntil);
  const stranded = row.status === 'reconciliation' || (row.status === 'claimed' && Number.isFinite(lease) && lease < now.getTime());
  return stranded && row.remoteMediaId === null && row.remoteUrl === null && row.errorCode !== 'publish-intent' && !/^\d{1,100}$/.test(row.remoteContainerId ?? '');
}

/** The SQL refusals, as owner-facing codes. */
export const MARKETING_REQUEUE_REFUSALS: Record<string, string> = {
  'publication unavailable': 'publication-unavailable',
  'publication not stranded': 'publication-not-stranded',
  'publication may be published': 'publication-may-be-published',
  'approval changed': 'publication-approval-changed',
};
/** PostgREST cannot find the function (PGRST202) or Postgres does not know it (42883): the migration is not applied. */
export function marketingRequeueFunctionMissing(error: { code?: string | null }): boolean {
  return error.code === 'PGRST202' || error.code === '42883';
}
