import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { refreshMarketingSources, sourceRefreshConfig, type SourceRefreshConfig } from '@/lib/marketing/source-refresh';

vi.mock('server-only', () => ({}));
const privacy = vi.hoisted(() => ({ isolated: false, suppressed: false, clear: vi.fn(), processor: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  withIsolationScope: async (callback: (scope: unknown) => unknown) => {
    privacy.isolated = true;
    try { return await callback({ clear: privacy.clear, addEventProcessor: privacy.processor }); } finally { privacy.isolated = false; }
  },
  suppressTracing: async (callback: () => unknown) => {
    privacy.suppressed = true; try { return await callback(); } finally { privacy.suppressed = false; }
  },
}));
const now = new Date('2026-10-13T09:00:00.000Z');
const owner = '11111111-1111-4111-8111-111111111111';
const origin = 'https://source-pilot-test-only.vercel.app';
const token = 'TEST-ONLY-SHARE-TOKEN-NO-LIVE-CREDENTIAL';
const secret = 'TEST-ONLY-SOURCE-SECRET-AT-LEAST-32';
const cookie = '_vercel_jwt=TEST_ONLY_RESPONSE_COOKIE.stub';
const env = { VERCEL_ENV: 'preview', MARKETING_OWNER_ID: owner, MARKETING_PILOT_OWNER_ID: owner,
  MARKETING_PILOT_STARTS_AT: '2026-10-13T08:00:00.000Z', MARKETING_PILOT_EXPIRES_AT: '2026-10-15T08:00:00.000Z',
  MARKETING_DEVSHARK_SOURCE_URL: `${origin}/api/admin?public=kept`, MARKETING_DEVSHARK_SOURCE_SECRET: secret,
  MARKETING_DEVSHARK_SOURCE_PREVIEW_SHARE_TOKEN: token, MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN: origin };
const clean = () => {
  const url = new URL(env.MARKETING_DEVSHARK_SOURCE_URL); url.searchParams.set('resource', 'marketing-source'); url.searchParams.set('limit', '20'); return url;
};
const preflight = (url = clean(), setCookie: string | null = `${cookie}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax`, status = 307) => {
  const headers = new Headers({ Location: url.href }); if (setCookie) headers.set('Set-Cookie', setCookie);
  return new Response(null, { status, headers });
};
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });
describe('protected producer share preflight; offline fixtures only', () => {
  it('keeps legacy configuration/requests unchanged and never uses an automation-token fallback', async () => {
    const legacy = { MARKETING_DEVSHARK_SOURCE_URL: 'https://source.example.invalid/api/admin', MARKETING_DEVSHARK_SOURCE_SECRET: secret,
      VERCEL_ENV: 'production', VERCEL_AUTOMATION_BYPASS_SECRET: 'TEST-ONLY-UNUSED', MARKETING_PILOT_OWNER_ID: 'invalid' };
    expect(sourceRefreshConfig('devshark', legacy)).toEqual({ url: legacy.MARKETING_DEVSHARK_SOURCE_URL, secret });
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers); expect(headers.get('Cookie')).toBeNull(); expect(headers.get('x-vercel-protection-bypass')).toBeNull();
      expect(headers.get('Authorization')).toBe(`Bearer ${secret}`); expect(init?.redirect).toBe('error'); return Response.json({ packets: [] });
    });
    await refreshMarketingSources({ brand: 'devshark', env: legacy, now, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(privacy.clear).not.toHaveBeenCalled();
  });
  it('preserves the exact public query, keeps auth off preflight, and uses one response cookie only on the source request', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(privacy.isolated).toBe(true); expect(privacy.suppressed).toBe(true);
      const target = new URL(String(url)); const headers = new Headers(init?.headers);
      expect(init?.cache).toBe('no-store'); expect(init?.credentials).toBe('omit');
      if (target.searchParams.has('_vercel_share')) {
        expect(target.searchParams.get('_vercel_share')).toBe(token);
        target.searchParams.delete('_vercel_share'); expect(target.href).toBe(clean().href);
        expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('manual'); expect(init?.body).toBeUndefined(); expect([...headers]).toEqual([]);
        return preflight();
      }
      expect(target.href).toBe(clean().href); expect(headers.get('Cookie')).toBe(cookie); expect(headers.get('Authorization')).toBe(`Bearer ${secret}`);
      expect(headers.get('x-vercel-protection-bypass')).toBeNull(); expect(init?.redirect).toBe('error'); return Response.json({ packets: [], nextCursor: null });
    });
    expect((await refreshMarketingSources({ brand: 'devshark', env: { ...env, NODE_ENV: 'production' }, now, fetcher })).packets).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(privacy.clear).toHaveBeenCalledTimes(2);
    expect(privacy.processor.mock.calls.every(([process]) => process() === null)).toBe(true);
  });
  it('preserves DNESKAi POST/body HMAC only on the second request', async () => {
    const url = new URL(`${origin}/admin/api/marketing-source`);
    const dneEnv = { ...env, MARKETING_DNESKAI_SOURCE_URL: url.href, MARKETING_DNESKAI_SOURCE_SECRET: secret,
      MARKETING_DNESKAI_SOURCE_PREVIEW_ORIGIN: origin, MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN: token };
    const fetcher = vi.fn<typeof fetch>(async (target, init) => {
      if (new URL(String(target)).searchParams.has('_vercel_share')) {
        expect(init?.method).toBe('GET'); expect(init?.body).toBeUndefined(); expect([...new Headers(init?.headers)]).toEqual([]); return preflight(url);
      }
      const headers = new Headers(init?.headers), body = String(init?.body);
      expect(String(target)).toBe(url.href); expect(init?.method).toBe('POST'); expect(headers.get('Cookie')).toBe(cookie);
      expect(headers.get('x-marketing-signature')).toBe(createHmac('sha256', secret).update(`${headers.get('x-marketing-timestamp')}.${body}`).digest('hex'));
      return Response.json({ schemaVersion: 'marketing-source-query/1', brand: 'dneskai', sources: [{ sourceId: 'held-test-only', status: 'held', packet: null }] });
    });
    expect((await refreshMarketingSources({ brand: 'dneskai', sourceIds: ['held-test-only'], env: dneEnv, now, fetcher })).held).toEqual([{ sourceId: 'held-test-only', reason: 'article-not-approved-or-unavailable' }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects production, inactive/partial/foreign owner configuration and mismatched origins before any request', async () => {
    for (const invalid of [
      { ...env, VERCEL_ENV: 'production' }, { ...env, VERCEL_ENV: undefined }, { ...env, MARKETING_OWNER_ID: undefined },
      { ...env, MARKETING_OWNER_ID: '22222222-2222-4222-8222-222222222222' }, { ...env, MARKETING_PILOT_EXPIRES_AT: now.toISOString() },
      { ...env, MARKETING_PILOT_STARTS_AT: '2026-10-13T10:00:00.000Z' }, { ...env, MARKETING_PILOT_EXPIRES_AT: undefined },
      { ...env, MARKETING_DEVSHARK_SOURCE_PREVIEW_SHARE_TOKEN: undefined }, { ...env, MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN: undefined },
      { ...env, MARKETING_DEVSHARK_SOURCE_PREVIEW_SHARE_TOKEN: '' }, { ...env, MARKETING_DEVSHARK_SOURCE_PREVIEW_SHARE_TOKEN: 'bad\r\nvalue' },
      { ...env, MARKETING_DEVSHARK_SOURCE_URL: 'https://foreign-test-only.vercel.app/api/admin' },
      { ...env, MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN: `${origin}/` }, { ...env, MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN: `${origin}:8443` },
      { ...env, MARKETING_DEVSHARK_SOURCE_URL: 'https://not-vercel.example.invalid/api/admin', MARKETING_DEVSHARK_SOURCE_PREVIEW_ORIGIN: 'https://not-vercel.example.invalid' },
      { ...env, MARKETING_DEVSHARK_SOURCE_URL: `${origin}/api/admin?_vercel_share=forbidden-in-config` },
    ]) {
      const fetcher = vi.fn<typeof fetch>();
      await expect(refreshMarketingSources({ brand: 'devshark', env: invalid, now, fetcher })).rejects.toThrow('source-preview-configuration-invalid');
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it('cannot bypass the preview gate through an injected config object', async () => {
    const config: SourceRefreshConfig = { url: env.MARKETING_DEVSHARK_SOURCE_URL, secret, previewShare: { token, origin } };
    const fetcher = vi.fn<typeof fetch>();
    await expect(refreshMarketingSources({ brand: 'devshark', env: { ...env, VERCEL_ENV: 'production' }, config, now, fetcher })).rejects.toThrow('source-preview-configuration-invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects foreign/path/query redirects and any status other than the verified307', async () => {
    const redirects = [new URL('https://foreign-test-only.vercel.app/api/admin'), new URL(`${origin}/different`), new URL(`${origin}/api/admin?public=kept`), new URL(`${clean().href}&extra=unexpected`)];
    for (const response of [...redirects.map(url => preflight(url)), ...[200, 301, 302, 308].map(status => preflight(clean(), undefined, status))]) {
      const fetcher = vi.fn<typeof fetch>(async () => response);
      await expect(refreshMarketingSources({ brand: 'devshark', env, now, fetcher })).rejects.toThrow('source-preview-redirect-invalid');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects missing, unexpected, duplicate or unsafe cookies without an authenticated request', async () => {
    const responses = [null, 'other_session=TEST_ONLY; Path=/; Secure; HttpOnly', `${cookie}; Path=/; HttpOnly`, `${cookie}; Path=/; Secure`,
      `${cookie}; Path=/foreign; Secure; HttpOnly`, `${cookie}; Path=/; Secure; HttpOnly; Domain=foreign-test-only.vercel.app`, '_vercel_jwt=; Path=/; Secure; HttpOnly'];
    const duplicate = preflight(); duplicate.headers.append('Set-Cookie', `${cookie}; Path=/; Secure; HttpOnly`);
    for (const response of [...responses.map(value => preflight(clean(), value)), duplicate]) {
      const fetcher = vi.fn<typeof fetch>(async () => response);
      await expect(refreshMarketingSources({ brand: 'devshark', env, now, fetcher })).rejects.toThrow('source-preview-cookie-invalid');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('holds expiry during preflight and masks raw transport failures containing credentials', async () => {
    const slow = vi.fn<typeof fetch>(async () => { vi.setSystemTime(new Date(env.MARKETING_PILOT_EXPIRES_AT)); return preflight(); });
    await expect(refreshMarketingSources({ brand: 'devshark', env, now, fetcher: slow })).rejects.toThrow('source-preview-configuration-invalid');
    expect(slow).toHaveBeenCalledTimes(1); vi.setSystemTime(now);
    const failed = vi.fn<typeof fetch>(async () => { throw new Error(`${token} ${cookie}`); });
    await expect(refreshMarketingSources({ brand: 'devshark', env, now, fetcher: failed })).rejects.toThrow('source-preview-unavailable');
  });
  it('refuses source redirects/errors after cookie acquisition without following or reusing credentials', async () => {
    for (const status of [307, 401, 403, 500]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(preflight()).mockResolvedValueOnce(new Response(null, { status, headers: { Location: 'https://foreign-test-only.vercel.app/' } }));
      await expect(refreshMarketingSources({ brand: 'devshark', env, now, fetcher })).rejects.toThrow('source-current-unavailable');
      expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[1][1]?.redirect).toBe('error');
    }
  });
  it('performs a new bounded preflight for every request and never persists the prior cookie', async () => {
    let calls = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (new URL(String(url)).searchParams.has('_vercel_share')) {
        calls++; expect(new Headers(init?.headers).get('Cookie')).toBeNull(); return preflight(clean(), `_vercel_jwt=TEST_ONLY_${calls}; Path=/; Secure; HttpOnly`);
      }
      expect(new Headers(init?.headers).get('Cookie')).toBe(`_vercel_jwt=TEST_ONLY_${calls}`); return Response.json({ packets: [] });
    });
    await refreshMarketingSources({ brand: 'devshark', env, now, fetcher }); await refreshMarketingSources({ brand: 'devshark', env, now, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(4); expect(calls).toBe(2);
  });
});
