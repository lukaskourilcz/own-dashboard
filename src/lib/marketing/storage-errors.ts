/**
 * Storage SDK object-info errors: only a typed object absence permits new rendering.
 * `404` is the legacy body statusCode, sent with HTTP 400 or 404.
 * Named missing-bucket/tenant errors and other HTTP failures remain unavailable.
 */
export function marketingStorageObjectMissing(error: { status?: number; statusCode?: string } | null): boolean {
  if (!error) return false;
  if (error.statusCode === '404') return error.status === 400 || error.status === 404;
  return error.status === 404 && ['NoSuchKey', 'not_found'].includes(error.statusCode ?? '');
}
