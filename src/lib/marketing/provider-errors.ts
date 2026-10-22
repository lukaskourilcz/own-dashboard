/** Only these fixed codes may classify provider failures; no exception text is inspected. */
const httpCodes: Record<number, string> = {
  400: 'provider-bad-request', 401: 'provider-authentication-failed', 402: 'provider-payment-required',
  403: 'provider-permission-denied', 404: 'provider-model-not-found', 408: 'provider-request-timeout',
  413: 'provider-request-too-large', 422: 'provider-unprocessable-request', 429: 'provider-rate-limited',
  500: 'provider-api-error', 502: 'provider-bad-gateway', 503: 'provider-unavailable', 504: 'provider-gateway-timeout', 529: 'provider-overloaded',
};
const errorCodes: Record<string, string> = {
  invalid_request_error: 'provider-bad-request', authentication_error: 'provider-authentication-failed', permission_error: 'provider-permission-denied',
  not_found_error: 'provider-model-not-found', request_too_large: 'provider-request-too-large', rate_limit_error: 'provider-rate-limited',
  api_error: 'provider-api-error', overloaded_error: 'provider-overloaded',
  MODEL_AUTHENTICATION: 'provider-authentication-failed', MODEL_NOT_FOUND: 'provider-model-not-found', MODEL_RATE_LIMIT: 'provider-rate-limited',
  CONTEXT_OVERFLOW: 'provider-context-overflow', INVALID_TOOL_RESULTS: 'provider-bad-request', MESSAGE_COERCION_FAILURE: 'provider-sdk-setup-failed',
  ERR_MODULE_NOT_FOUND: 'provider-sdk-setup-failed', ERR_PACKAGE_PATH_NOT_EXPORTED: 'provider-sdk-setup-failed', ERR_REQUIRE_ESM: 'provider-sdk-setup-failed',
};
export const MARKETING_PROVIDER_FAILURE_CODES = [...new Set([...Object.values(httpCodes), ...Object.values(errorCodes),
  'provider-http-client-error', 'provider-http-server-error', 'provider-sdk-setup-failed', 'provider-failed'])] as readonly string[];
export type MarketingProviderFailure = { code: string; httpStatus: number | null; providerCode: string | null };
function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}
export function classifyMarketingProviderError(value: unknown): MarketingProviderFailure {
  const status = ownData(value, 'status');
  const httpStatus = typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
  const body = ownData(value, 'error');
  const codes = [ownData(ownData(body, 'error'), 'type'), ownData(body, 'type'), ownData(value, 'code'), ownData(value, 'lc_error_code')];
  const providerCode = codes.find((code): code is string => typeof code === 'string' && Object.hasOwn(errorCodes, code)) ?? null;
  const code = httpStatus !== null ? httpCodes[httpStatus] ?? (httpStatus < 500 ? 'provider-http-client-error' : 'provider-http-server-error')
    : providerCode ? errorCodes[providerCode] : 'provider-failed';
  return { code, httpStatus, providerCode };
}

/**
 * Owner decision 16: HTTP answers the Messages API gives instead of running the model, so no token is billed.
 * The request is rejected whole: invalid (400, including LangChain's CONTEXT_OVERFLOW, which it raises only for a
 * 400 "prompt is too long"), unauthenticated (401), billing (402), forbidden (403), unknown model (404), too large
 * (413), rate limited (429) or overloaded (529). The calls are non-streaming with retries off, so the status is the
 * whole answer. Excluded on purpose: any failure without an HTTP status (a dropped connection, a timeout, an error
 * event inside a response), 408, 409, 500, 502, 503, 504 and any other status, since the model may have run.
 */
const UNBILLED_HTTP_STATUSES: ReadonlySet<number> = new Set([400, 401, 402, 403, 404, 413, 429, 529]);
export function marketingProviderFailureUnbilled(failure: MarketingProviderFailure | null | undefined): boolean {
  if (!failure) return false;
  if (failure.httpStatus !== null) return UNBILLED_HTTP_STATUSES.has(failure.httpStatus);
  return failure.providerCode === 'CONTEXT_OVERFLOW';
}
