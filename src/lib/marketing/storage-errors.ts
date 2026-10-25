/**
 * Storage SDK object-info errors: only a typed 404 object absence permits new rendering.
 * `404` is the legacy SDK statusCode; named missing-bucket/tenant errors remain failures.
 */
export function marketingStorageObjectMissing(error: { status?: number; statusCode?: string } | null): boolean {
  return error?.status === 404 && ['NoSuchKey', 'not_found', '404'].includes(error.statusCode ?? '');
}
