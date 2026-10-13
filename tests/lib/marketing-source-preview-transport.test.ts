import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshMarketingSources } from '@/lib/marketing/source-refresh';

vi.mock('server-only', () => ({}));
const transport = vi.hoisted(() => ({ request: vi.fn(), suppressed: false }));
vi.mock('node:https', () => ({ request: transport.request }));
vi.mock('@sentry/nextjs', () => ({
  withIsolationScope: async (callback: (scope: unknown) => unknown) => callback({ clear: vi.fn(), addEventProcessor: vi.fn() }),
  suppressTracing: async (callback: () => unknown) => { transport.suppressed = true; try { return await callback(); } finally { transport.suppressed = false; } },
}));
const origin = 'https://native-pilot-test-only.vercel.app';
const now = new Date('2026-10-13T09:00:00.000Z');
const owner = '11111111-1111-4111-8111-111111111111';
const env = { VERCEL_ENV: 'preview', MARKETING_OWNER_ID: owner, MARKETING_PILOT_OWNER_ID: owner,
  MARKETING_PILOT_STARTS_AT: '2026-10-13T08:00:00.000Z', MARKETING_PILOT_EXPIRES_AT: '2026-10-15T08:00:00.000Z',
  MARKETING_DEVSHARK_SOURCE_URL: `${origin}/api/admin`, MARKETING_DEVSHARK_SOURCE_SECRET: 'TEST-ONLY-SOURCE-SECRET-AT-LEAST-32',
  MARKETING_DEVSHARK_SOURCE_PREVIEW_SHARE_TOKEN: 'TEST-ONLY-SHARE-TOKEN', MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN: origin };
type NativeResponse = EventEmitter & { statusCode: number; headers: Record<string, string | string[] | undefined>; destroy: ReturnType<typeof vi.fn> };
function install(actualStatus = 200, bytes?: Buffer) {
  const responses: NativeResponse[] = [];
  transport.request.mockImplementation((url: string, options: { headers: Record<string, string>; signal: AbortSignal }, callback: (response: NativeResponse) => void) => {
    expect(transport.suppressed).toBe(true); expect(options.signal).toBeInstanceOf(AbortSignal);
    const preflight = new URL(url).searchParams.has('_vercel_share');
    const response = Object.assign(new EventEmitter(), { statusCode: preflight ? 307 : actualStatus,
      headers: preflight ? { location: `${origin}/api/admin?resource=marketing-source&limit=20`, 'set-cookie': ['_vercel_jwt=TEST_ONLY_NATIVE_COOKIE; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax'] }
        : { location: 'https://foreign-test-only.vercel.app/', 'content-type': 'application/json' }, destroy: vi.fn() });
    responses.push(response);
    const outgoing = Object.assign(new EventEmitter(), { write: vi.fn(), destroy: vi.fn(), end: () => {
      queueMicrotask(() => { callback(response); response.emit('data', preflight ? Buffer.from('') : bytes ?? Buffer.from('{"packets":[]}')); response.emit('end'); });
    } });
    return outgoing;
  });
  return responses;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('instrumented-global-fetch-forbidden'); })); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('native protected source transport; mocked sockets, zero network', () => {
  it('avoids global Next fetch, forwards only the one cookie to the exact source, and suppresses instrumentation', async () => {
    install(); expect((await refreshMarketingSources({ brand: 'devshark', env, now })).packets).toEqual([]);
    expect(transport.request).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled();
    expect(transport.request.mock.calls[0][1].headers).toEqual({});
    expect(transport.request.mock.calls[1][0]).toBe(`${origin}/api/admin?resource=marketing-source&limit=20`);
    expect(transport.request.mock.calls[1][1].headers).toEqual({ accept: 'application/json', authorization: `Bearer ${env.MARKETING_DEVSHARK_SOURCE_SECRET}`, cookie: '_vercel_jwt=TEST_ONLY_NATIVE_COOKIE' });
  });
  it('returns source redirects as a hold without opening the foreign origin', async () => {
    install(307); await expect(refreshMarketingSources({ brand: 'devshark', env, now })).rejects.toThrow('source-current-unavailable');
    expect(transport.request).toHaveBeenCalledTimes(2);
    expect(transport.request.mock.calls.every(([url]) => new URL(url).origin === origin)).toBe(true);
  });
  it('bounds the native response buffer before JSON parsing', async () => {
    const responses = install(200, Buffer.alloc(2_000_001));
    await expect(refreshMarketingSources({ brand: 'devshark', env, now })).rejects.toThrow('source-current-unavailable');
    expect(responses[1].destroy).toHaveBeenCalled(); expect(transport.request).toHaveBeenCalledTimes(2);
  });
});
