/**
 * Storage SDK object-info errors: typed absence is only a candidate for an owned database probe.
 * `404` is the legacy body statusCode, sent with HTTP 400 or 404.
 * Neither this predicate nor status/prose proves absence. Cache adapters require the exact owned private-path receipt.
 */
export function marketingStorageAbsenceCandidate(error: { status?: number; statusCode?: string } | null): boolean {
  if (!error) return false;
  if (error.statusCode === '404') return error.status === 400 || error.status === 404;
  return error.status === 404 && ['NoSuchKey', 'not_found'].includes(error.statusCode ?? '');
}
