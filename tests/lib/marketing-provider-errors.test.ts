import { describe, expect, it } from 'vitest';
import { classifyMarketingProviderError, MARKETING_PROVIDER_FAILURE_CODES, marketingProviderFailureUnbilled } from '@/lib/marketing/provider-errors';

describe('provider status/code classification without messages, URLs, credentials or source', () => {
  it('maps representative HTTP and provider/SDK codes into the fixed trace-compatible allowlist', () => {
    const cases = [
      [{ status: 400, error: { error: { type: 'invalid_request_error' } } }, 'provider-bad-request'],
      [{ status: 401, error: { type: 'authentication_error' } }, 'provider-authentication-failed'],
      [{ status: 403 }, 'provider-permission-denied'], [{ status: 404 }, 'provider-model-not-found'], [{ status: 413 }, 'provider-request-too-large'],
      [{ status: 429 }, 'provider-rate-limited'], [{ status: 500 }, 'provider-api-error'], [{ status: 529 }, 'provider-overloaded'],
      [{ status: 418 }, 'provider-http-client-error'], [{ status: 599 }, 'provider-http-server-error'],
      [{ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, 'provider-sdk-setup-failed'], [{ lc_error_code: 'CONTEXT_OVERFLOW' }, 'provider-context-overflow'],
    ] as const;
    for (const [failure, code] of cases) {
      const diagnostic = classifyMarketingProviderError(failure); expect(diagnostic.code).toBe(code);
      expect(MARKETING_PROVIDER_FAILURE_CODES).toContain(code); expect(code).toMatch(/^[a-z-]{1,80}$/);
    }
  });
  it('drops unknown/malformed status and code values rather than reflecting them into a diagnostic', () => {
    for (const failure of [null, 'TEST_ONLY_PRIVATE', { status: '401', code: 'TEST_ONLY_PRIVATE' }, { status: NaN }, { status: 200 },
      { error: { type: 'TEST_ONLY_PRIVATE' }, code: 'TEST_ONLY_PRIVATE' }, new Error('TEST_ONLY_PRIVATE_MESSAGE')])
      expect(classifyMarketingProviderError(failure)).toEqual({ code: 'provider-failed', httpStatus: null, providerCode: null });
  });
  it('reads no message/headers/request/body/source fields and ignores getters/inherited properties', () => {
    const failure = { status: 401, error: { type: 'authentication_error' }, apiKey: 'TEST_ONLY_PRIVATE', source: 'TEST_ONLY_PRIVATE' };
    for (const key of ['message', 'url', 'headers', 'request_id', 'cause', 'stack']) Object.defineProperty(failure, key, { get() { throw new Error('private-field-read-forbidden'); } });
    expect(classifyMarketingProviderError(failure)).toEqual({ code: 'provider-authentication-failed', httpStatus: 401, providerCode: 'authentication_error' });
    const accessor = Object.defineProperty({}, 'status', { get() { throw new Error('status-getter-forbidden'); } });
    expect(classifyMarketingProviderError(accessor).code).toBe('provider-failed');
    expect(classifyMarketingProviderError(Object.create({ status: 401 })).httpStatus).toBeNull();
    expect(classifyMarketingProviderError(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('proxy-forbidden'); } })).code).toBe('provider-failed');
    expect(JSON.stringify(classifyMarketingProviderError(failure))).not.toContain('TEST_ONLY_PRIVATE');
  });
});

describe('calls that provably billed nothing (decision 16)', () => {
  it('are only whole-request HTTP rejections, never a failure without a status', () => {
    for (const status of [400, 401, 402, 403, 404, 413, 429, 529]) expect(marketingProviderFailureUnbilled(classifyMarketingProviderError({ status })), String(status)).toBe(true);
    for (const status of [408, 409, 422, 500, 502, 503, 504, 418]) expect(marketingProviderFailureUnbilled(classifyMarketingProviderError({ status })), String(status)).toBe(false);
    expect(marketingProviderFailureUnbilled(classifyMarketingProviderError({ lc_error_code: 'CONTEXT_OVERFLOW' }))).toBe(true);
    for (const failure of [new Error('socket hang up'), { error: { type: 'error', error: { type: 'overloaded_error' } } }, { lc_error_code: 'MODEL_RATE_LIMIT' }, { code: 'ERR_MODULE_NOT_FOUND' }])
      expect(marketingProviderFailureUnbilled(classifyMarketingProviderError(failure))).toBe(false);
    expect(marketingProviderFailureUnbilled(null)).toBe(false);
  });
});
