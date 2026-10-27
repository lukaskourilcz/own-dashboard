// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiCommentSubscription, DneskaiEngagementSwitch, DneskaiInstagramAccount, DneskaiInstagramAccountRecord } from '@/components/marketing/dneskai-instagram-account';
import { dneskaiAccount } from '@/lib/i18n/sections/dneskai-account';
import {OwnerPreferencesProvider} from '@/lib/owner-preferences';
import {qk} from '@/lib/queries/keys';
import type { MarketingAccountStatus } from '@/lib/marketing/accounts-client';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root; let client: QueryClient;
const owner='11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-20T12:00:00Z');
const account = (patch: Partial<MarketingAccountStatus> = {}): MarketingAccountStatus => ({ id: '44444444-4444-4444-8444-444444444444', brand: 'dneskai', platform: 'instagram', handle: 'dneskai',
  verifiedAt: '2026-10-20T10:00:00.123456+00:00', updatedAt:'2026-10-20T10:00:00.123456+00:00', enabled: false,
  token: { expiresAt: '2026-12-19T10:00:00+00:00', refreshedAt: '2026-10-20T10:00:00.123456+00:00', scopes: ['instagram_business_basic', 'instagram_business_content_publish'], loginMode: 'instagram' }, ...patch });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });
const render = (node: React.ReactNode) => act(() => root.render(<OwnerPreferencesProvider ownerId={owner}><QueryClientProvider client={client}>{node}</QueryClientProvider></OwnerPreferencesProvider>));
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
    const before=withEngagement({enabled:false,blockedCode:null,blockedAt:null});client.setQueryData(qk.marketingAccounts,[before]);
    const fetcher = vi.fn(async () => Response.json({receipt:{kind:'saved',ownerId:owner,id:before.id,expectedVersion:before.updatedAt,switch:'engagement',requestedEnabled:true,updatedAt:'2026-10-20T10:00:00.123457+00:00'}}));
    vi.stubGlobal('fetch', fetcher);
    render(<DneskaiEngagementSwitch account={withEngagement({ enabled: false, blockedCode: null, blockedAt: null })} lang="en" now={now} />);
    act(() => container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(fetcher).toHaveBeenCalledWith('/api/marketing/accounts/engagement', expect.objectContaining({ method: 'POST', body: JSON.stringify({ ownerId:owner,accountId: account().id,expectedVersion:account().updatedAt,enabled: true }) }));
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

describe('comment webhook subscription (#161)', () => {
  it('reads the state once, offers to subscribe when Instagram does not send comments, and shows the result', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { const action = JSON.parse(String(init?.body)).action as string; calls.push(action); return Response.json({ subscribed: action === 'subscribe' }); }));
    render(<DneskaiCommentSubscription account={account()} lang="cs" />);
    await settle();
    expect(container.textContent).toContain(dneskaiAccount.cs.engagement.webhookOff);
    act(() => container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(calls).toEqual(['status', 'subscribe']);
    expect(container.textContent).toContain(dneskaiAccount.cs.engagement.webhookOn);
    expect(container.querySelector('button')).toBeNull();
  });
  it('appears only when the server has the webhook configured', () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ subscribed: true })));
    render(<DneskaiEngagementSwitch account={account({ engagement: { enabled: true, blockedCode: null, blockedAt: null } })} lang="en" now={now} />);
    expect(container.querySelector('[data-testid="dneskai-comment-subscription"]')).toBeNull();
    act(() => root.unmount()); root = createRoot(container);
    render(<DneskaiEngagementSwitch account={account({ engagement: { enabled: true, blockedCode: null, blockedAt: null, webhook: true } })} lang="en" now={now} />);
    expect(container.querySelector('[data-testid="dneskai-comment-subscription"]')).not.toBeNull();
  });
});

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const publishButton = () => container.querySelector<HTMLButtonElement>('[data-testid="dneskai-publishing-switch"] button')!;
const saved = (before: MarketingAccountStatus, enabled = true) => ({ receipt: { kind: 'saved', ownerId: owner, id: before.id, expectedVersion: before.updatedAt, switch: 'publishing', requestedEnabled: enabled, updatedAt: '2026-10-20T10:00:00.123457Z' } });

describe('captured account controls and recovery', () => {
  beforeEach(() => vi.stubGlobal('confirm', vi.fn(() => true)));
  afterEach(() => vi.restoreAllMocks());
  it('retains confirmed details after a failed refresh and resumes only after an explicit successful reload', async () => {
    const before = account(); client.setQueryData(qk.marketingAccounts, [before]);
    let available = false;
    const fetcher = vi.fn(async () => available ? Response.json({ accounts: [before] }) : Response.json({ error: 'account-store-failed' }, { status: 503 })); vi.stubGlobal('fetch', fetcher);
    render(<DneskaiInstagramAccount lang="en" now={now} />); await settle();
    expect(container.textContent).toContain('@dneskai'); expect(container.textContent).toContain(dneskaiAccount.en.cachedUnavailable); expect(publishButton().disabled).toBe(true);
    available = true;
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="dneskai-account-recovery"] button')!.click()); await settle();
    expect(container.querySelector('[data-testid="dneskai-account-recovery"]')).toBeNull(); expect(publishButton().disabled).toBe(false); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reserves the original version synchronously, sends once, and patches a saved result without a second GET', async () => {
    const before = account(), response = deferred<Response>(), writes: RequestInit[] = []; let reads = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => { if (init?.method === 'POST') { writes.push(init); return response.promise; } reads++; return Promise.resolve(Response.json({ accounts: [before] })); }));
    render(<DneskaiInstagramAccount lang="en" now={now} />); await settle();
    act(() => { publishButton().click(); publishButton().click(); });
    expect(writes).toHaveLength(1); expect(JSON.parse(String(writes[0].body))).toEqual({ ownerId: owner, accountId: before.id, expectedVersion: before.updatedAt, enabled: true });
    await act(async () => response.resolve(Response.json(saved(before)))); await settle();
    expect(reads).toBe(1); expect(client.getQueryData<MarketingAccountStatus[]>(qk.marketingAccounts)?.[0]).toMatchObject({ enabled: true, updatedAt: saved(before).receipt.updatedAt });
    expect(publishButton().textContent).toBe(dneskaiAccount.en.disable);
  });
  it('keeps a newer cached row and requires a read when an older save completes', async () => {
    const before = account(), response = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? response.promise : Promise.resolve(Response.json({ accounts: [before] }))));
    render(<DneskaiInstagramAccount lang="en" now={now} />); await settle(); act(() => publishButton().click());
    const newer = { ...before, handle: 'newer_handle', updatedAt: '2026-10-20T10:00:00.123458Z' };
    act(() => client.setQueryData(qk.marketingAccounts, [newer]));
    await act(async () => response.resolve(Response.json(saved(before)))); await settle();
    expect(client.getQueryData(qk.marketingAccounts)).toEqual([newer]); expect(container.textContent).toContain(dneskaiAccount.en.changed); expect(publishButton().disabled).toBe(true);
  });
  it('holds an uncertain write without replay, then clears the hold after a fresh explicit read', async () => {
    const before = account(); let writes = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { if (init?.method === 'POST') { writes++; throw new Error('PRIVATE transport detail'); } return Response.json({ accounts: [before] }); }));
    render(<DneskaiInstagramAccount lang="cs" now={now} />); await settle(); await act(async () => publishButton().click()); await settle();
    expect(writes).toBe(1); expect(publishButton().disabled).toBe(true); expect(container.textContent).toContain(dneskaiAccount.cs.operationFailed); expect(container.textContent).not.toContain('PRIVATE');
    act(() => publishButton().click()); expect(writes).toBe(1);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="dneskai-account-recovery"] button')!.click()); await settle();
    expect(publishButton().disabled).toBe(false); expect(container.textContent).not.toContain(dneskaiAccount.cs.operationFailed);
  });
  it('invalidates the original cache and ignores a late acknowledgment after unmount', async () => {
    client.setQueryDefaults(qk.marketingAccounts, { gcTime: Infinity });
    const before = account(), response = deferred<Response>(); let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => { if (init?.method === 'POST') { signal = init.signal!; return response.promise; } return Promise.resolve(Response.json({ accounts: [before] })); }));
    render(<DneskaiInstagramAccount lang="en" now={now} />); await settle(); act(() => publishButton().click());
    act(() => root.unmount()); root = createRoot(container); expect(signal.aborted).toBe(true);
    await act(async () => response.resolve(Response.json(saved(before)))); await settle();
    expect(client.getQueryState(qk.marketingAccounts)?.isInvalidated).toBe(true); expect(client.getQueryData(qk.marketingAccounts)).toEqual([before]);
  });
  it('does not transplant a pending result into a replacement owner scope', async () => {
    client.setQueryDefaults(qk.marketingAccounts, { gcTime: Infinity });
    const before = account(), response = deferred<Response>(); let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => { if (init?.method === 'POST') { signal = init.signal!; return response.promise; } return Promise.resolve(Response.json({ accounts: [before] })); }));
    render(<DneskaiInstagramAccount lang="en" now={now} />); await settle(); act(() => publishButton().click());
    act(() => root.render(<OwnerPreferencesProvider ownerId="99999999-9999-4999-8999-999999999999"><QueryClientProvider client={client}><p>Replacement owner</p></QueryClientProvider></OwnerPreferencesProvider>));
    expect(signal.aborted).toBe(true); await act(async () => response.resolve(Response.json(saved(before)))); await settle();
    expect(container.textContent).toBe('Replacement owner'); expect(client.getQueryData(qk.marketingAccounts)).toEqual([before]);
  });
  it('requires a fresh read for a changed business receipt and does not claim success', async () => {
    const before = account(); let writes = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { if (init?.method === 'POST') { writes++; return Response.json({ receipt: { ...saved(before).receipt, kind: 'changed' } }); } return Response.json({ accounts: [before] }); }));
    render(<DneskaiInstagramAccount lang="en" now={now} />); await settle(); await act(async () => publishButton().click()); await settle();
    expect(writes).toBe(1); expect(container.textContent).toContain(dneskaiAccount.en.changed); expect(container.textContent).not.toContain(dneskaiAccount.en.enabledNow); expect(publishButton().disabled).toBe(true);
  });
  it('keeps the known comment subscription visible when a refresh fails', async () => {
    const before = account(), key = [...qk.marketingAccounts, 'comment-subscription', before.id]; client.setQueryData(key, true);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'account-request-failed' }, { status: 503 })));
    render(<DneskaiCommentSubscription account={before} lang="en" />); await settle();
    expect(container.textContent).toContain(dneskaiAccount.en.engagement.webhookOn); expect(container.textContent).toContain(dneskaiAccount.en.operationFailed); expect(container.textContent).not.toContain(dneskaiAccount.en.failed);
  });
});
