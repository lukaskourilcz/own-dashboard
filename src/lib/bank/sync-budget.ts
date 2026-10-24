/** One processing budget after the manual route's auth/input/rate checks (or
 * cron authentication). The platform's 60-second limit leaves monitoring room. */
export const BANK_SYNC_PROCESSING_MS = 40_000;
export function bankSyncSignal(request: Request): AbortSignal {
  return AbortSignal.any([request.signal, AbortSignal.timeout(BANK_SYNC_PROCESSING_MS)]);
}
