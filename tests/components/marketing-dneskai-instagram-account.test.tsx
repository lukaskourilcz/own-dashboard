// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiEngagementSwitch, DneskaiInstagramAccount, DneskaiInstagramAccountRecord } from '@/components/marketing/dneskai-instagram-account';
import { dneskaiAccount } from '@/lib/i18n/sections/dneskai-account';
import type { MarketingAccountStatus } from '@/lib/marketing/accounts-client';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root; let client: QueryClient;
const now = new Date('2026-10-20T12:00:00Z');
const account = (patch: Partial<MarketingAccountStatus> = {}): MarketingAccountStatus => ({ id: '44444444-4444-4444-8444-444444444444', brand: 'dneskai', platform: 'instagram', handle: 'dneskai',
  verifiedAt: '2026-10-20T10:00:00.123456+00:00', enabled: false,
  token: { expiresAt: '2026-12-19T10:00:00+00:00', refreshedAt: '2026-10-20T10:00:00.123456+00:00', scopes: ['instagram_business_basic', 'instagram_business_content_publish'], loginMode: 'instagram' }, ...patch });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });
const render = (node: React.ReactNode) => act(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
const settle = () => act(async () => { await new Promise(done => setTimeout(done, 20)); });

describe('DNESKAi Instagram account status', () => {
  it.each(['en', 'cs'] as const)('shows a verified, disabled account with token metadata and no secret (%s)', lang => {
    render(<DneskaiInstagramAccountRecord account={account()} lang={lang} now={now} />); const t = dneskaiAccount[lang];
    for (const text of [t.verified, t.publishingOff, t.token.valid, '@dneskai', 'instagram_business_content_publish', t.tokenExpires, t.tokenRefreshed]) expect(container.textContent).toContain(text);
    expect(container.querySelector('time[datetime="2026-12-19T10:00:00+00:00"]')).not.toBeNull();
    expect(container.textContent).not.toContain('TEST-ONLY');
  });
  it.each([
    ['expiring', { token: { ...account().token!, expiresAt: '2026-10-29T12:00:00Z' } }],
    ['expired', { token: { ...account().token!, expiresAt: '2026-10-20T11:59:00Z' } }],
    ['missing', { token: null }],
  ] as const)('warns about a %s token with a text cue, not colour alone', (state, patch) => {
    render(<DneskaiInstagramAccountRecord account={account(patch)} lang="cs" now={now} />);
    expect(container.textContent).toContain(dneskaiAccount.cs.token[state]);
    expect(container.textContent).toContain(dneskaiAccount.cs.tokenHelp[state]);
  });
  it('shows a not-verified state without inventing an account', () => {
    render(<DneskaiInstagramAccountRecord account={null} lang="en" now={now} />);
    expect(container.textContent).toContain(dneskaiAccount.en.notVerified); expect(container.textContent).toContain(dneskaiAccount.en.noAccount);
    expect(container.querySelectorAll('dl')).toHaveLength(0);
  });
  it('loads nothing and disables verification in the public preview', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<DneskaiInstagramAccount lang="cs" disabled now={now} />);
    expect(fetcher).not.toHaveBeenCalled(); expect(container.textContent).toContain(dneskaiAccount.cs.preview);
    expect(container.querySelector('button')?.disabled).toBe(true);
  });
  it('verifies on request with one POST, then reloads the status', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []; let verified = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') { verified = true; return Response.json({ account: account(), accountType: 'BUSINESS', tokenStored: true }); }
      return Response.json({ accounts: verified ? [account()] : [] });
    }));
    render(<DneskaiInstagramAccount lang="en" now={now} />); await settle();
    expect(container.textContent).toContain(dneskaiAccount.en.noAccount);
    const button = container.querySelector('button')!; expect(button.textContent).toBe(dneskaiAccount.en.verify);
    await act(async () => { button.click(); }); await settle();
    const posts = calls.filter(call => call.init?.method === 'POST');
    expect(posts).toHaveLength(1); expect(posts[0]!.url).toBe('/api/marketing/accounts/verify');
    expect(JSON.parse(String(posts[0]!.init!.body))).toEqual({ brand: 'dneskai', platform: 'instagram' });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(dneskaiAccount.en.verifiedNow);
    expect(container.textContent).toContain('@dneskai'); expect(calls.filter(call => call.url === '/api/marketing/accounts')).toHaveLength(2);
  });
  it.each([
    [409, { error: 'professional-account-required' }, dneskaiAccount.cs.errors['professional-account-required']],
    [502, { error: 'meta-http-400' }, dneskaiAccount.cs.metaHttp('400')],
    [429, { error: 'rate-limited' }, dneskaiAccount.cs.errors['rate-limited']],
    [503, { error: 'PRIVATE server detail' }, dneskaiAccount.cs.failed],
  ] as const)('explains a failed verification (%s) without server detail', async (status, body, message) => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json(body, { status }) : Response.json({ accounts: [] })));
    render(<DneskaiInstagramAccount lang="cs" now={now} />); await settle();
    await act(async () => { container.querySelector('button')!.click(); }); await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(container.textContent).not.toContain('PRIVATE');
  });
});

describe('replies to keyword comments (#160)', () => {
  const t = dneskaiAccount.en;
  const withEngagement = (engagement: NonNullable<MarketingAccountStatus['engagement']>) => account({ token: { ...account().token!, scopes: [...account().token!.scopes, 'instagram_business_manage_comments'] }, engagement });
  it('shows no switch while the server does not run the watcher', () => {
    render(<DneskaiEngagementSwitch account={withEngagement({ enabled: false, blockedCode: null, blockedAt: null })} lang="en" now={now} />);
    expect(container.textContent).toContain(t.engagement.off);
    act(() => root.unmount()); root = createRoot(container);
    render(<DneskaiInstagramAccountRecord account={account()} lang="en" now={now} />);
    expect(container.querySelector('[data-testid="dneskai-engagement-switch"]')).toBeNull();
  });
  it('turns replies on with one POST and explains a block in both languages', async () => {
    const fetcher = vi.fn(async () => Response.json({ account: withEngagement({ enabled: true, blockedCode: null, blockedAt: null }) }));
    vi.stubGlobal('fetch', fetcher);
    render(<DneskaiEngagementSwitch account={withEngagement({ enabled: false, blockedCode: null, blockedAt: null })} lang="en" now={now} />);
    act(() => container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(fetcher).toHaveBeenCalledWith('/api/marketing/accounts/engagement', expect.objectContaining({ method: 'POST', body: JSON.stringify({ accountId: account().id, enabled: true }) }));
    expect(container.textContent).toContain(t.engagement.enabledNow);
    for (const lang of ['en', 'cs'] as const) {
      act(() => root.unmount()); root = createRoot(container);
      render(<DneskaiEngagementSwitch account={withEngagement({ enabled: true, blockedCode: 'engagement-messaging-disabled', blockedAt: '2026-10-20T11:00:00Z' })} lang={lang} now={now} />);
      expect(container.textContent).toContain(dneskaiAccount[lang].engagement.blocked);
      expect(container.textContent).toContain(dneskaiAccount[lang].engagement.blockedHelp);
      expect(container.querySelector('button')!.textContent).toBe(dneskaiAccount[lang].engagement.enable);
    }
  });
  it('names a missing comment scope instead of a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'engagement-scopes-unverified' }, { status: 409 })));
    render(<DneskaiEngagementSwitch account={withEngagement({ enabled: false, blockedCode: null, blockedAt: null })} lang="cs" now={now} />);
    act(() => container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(dneskaiAccount.cs.engagement.errors['engagement-scopes-unverified']);
  });
});
