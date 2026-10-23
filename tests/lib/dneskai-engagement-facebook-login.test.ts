import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/marketing/meta-credentials', () => ({ resolveMetaPublisherConfig: mocks.resolve }));
import { createDneskaiEngagementGraph, instagramCommentSubscription } from '@/lib/marketing/dneskai-engagement-ports';
import { resolveFacebookPage } from '@/lib/marketing/meta-facebook-page';
import { dneskaiCommentWebhookConfigured } from '@/lib/marketing/dneskai-engagement';
import type { EngagementTarget } from '@/lib/marketing/dneskai-engagement-watch';

// #216: the comment watcher and the webhook subscription under both login modes. Graph is a local stand-in; every
// token and id is synthetic.
const owner = '11111111-1111-4111-8111-111111111111';
const USER_TOKEN = 'TEST-ONLY-USER-TOKEN-00000001', PAGE_TOKEN = 'TEST-ONLY-PAGE-TOKEN-00000001';
const target = { publicationId: '22222222-2222-4222-8222-222222222222', mediaId: '18000000000000001', accountId: '33333333-3333-4333-8333-333333333333',
  igUserId: '17841400000000001', scheduledAt: '2026-10-23T08:00:00Z', keyword: 'SKILL', replyMessage: 'Tady je návod.', publicReply: 'Poslali jsme vám to do zpráv.',
  check: { afterCursor: null, passSeen: 0, passMatches: 0, passSkippedOld: 0 } } as EngagementTarget;
type Call = { url: URL; method: string; auth: string; body: string };

function graph(options: { pageToken?: boolean } = {}) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (value: string, init: RequestInit) => {
    const url = new URL(value); const auth = (init.headers as Record<string, string>).Authorization;
    calls.push({ url, method: init.method ?? 'GET', auth, body: String(init.body ?? '') });
    if (url.pathname.endsWith('/me/accounts')) return options.pageToken ? Response.json({ error: { code: 100 } }, { status: 400 })
      : Response.json({ data: [{ id: '2020', access_token: 'TEST-ONLY-OTHER-PAGE-TOKEN-1' }, { id: '1010', access_token: PAGE_TOKEN, instagram_business_account: { id: '17841400000000001' } }] });
    if (url.pathname.endsWith('/me')) return Response.json({ id: '1010', instagram_business_account: { id: '17841400000000001' } });
    if (url.pathname.endsWith('/comments')) return Response.json({ data: [{ id: '17900000000000001', text: 'skill', timestamp: '2026-10-23T09:00:00+0000' }] });
    if (url.pathname.endsWith('/messages')) return Response.json({ recipient_id: '1', message_id: 'm.1' });
    if (url.pathname.endsWith('/replies')) return Response.json({ id: '17900000000000002' });
    if (url.pathname.endsWith('/subscribed_apps')) return init.method === 'POST' ? Response.json({ success: true }) : Response.json({ data: [{ subscribed_fields: ['comments'] }] });
    throw new Error(`unexpected ${url.pathname}`);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const instagram = { loginMode: 'instagram', apiVersion: 'v99.0', accessToken: USER_TOKEN, scopes: ['instagram_business_basic', 'instagram_business_manage_comments'], credentialHold: null };
const facebook = { loginMode: 'facebook', apiVersion: 'v99.0', accessToken: USER_TOKEN, scopes: ['instagram_basic', 'instagram_manage_comments', 'pages_messaging'], credentialHold: null };
const signal = () => AbortSignal.timeout(5000);

beforeEach(() => mocks.resolve.mockReset());

describe('comment watcher Graph calls (#216)', () => {
  it('keeps Instagram Login on graph.instagram.com with the stored token and the IG id for private replies', async () => {
    mocks.resolve.mockResolvedValue(instagram);
    const { fetcher, calls } = graph();
    const port = createDneskaiEngagementGraph({} as never, owner, {}, fetcher);
    await port.comments(target, null, signal());
    await port.privateReply(target, '17900000000000001', signal());
    await port.publicReply(target, '17900000000000001', signal());
    expect(calls.map((call) => `${call.method} ${call.url.host}${call.url.pathname}`)).toEqual([
      'GET graph.instagram.com/v99.0/18000000000000001/comments',
      'POST graph.instagram.com/v99.0/17841400000000001/messages',
      'POST graph.instagram.com/v99.0/17900000000000001/replies',
    ]);
    expect(calls.every((call) => call.auth === `Bearer ${USER_TOKEN}`)).toBe(true);
  });

  it('uses graph.facebook.com, the linked Page token and the Page for private replies under Facebook Login', async () => {
    mocks.resolve.mockResolvedValue(facebook);
    const { fetcher, calls } = graph();
    const port = createDneskaiEngagementGraph({} as never, owner, {}, fetcher);
    await port.comments(target, null, signal());
    await port.privateReply(target, '17900000000000001', signal());
    await port.publicReply(target, '17900000000000001', signal());
    expect(calls.map((call) => `${call.method} ${call.url.host}${call.url.pathname}`)).toEqual([
      'GET graph.facebook.com/v99.0/me/accounts',
      'GET graph.facebook.com/v99.0/18000000000000001/comments',
      'POST graph.facebook.com/v99.0/1010/messages',
      'POST graph.facebook.com/v99.0/17900000000000001/replies',
    ]);
    expect(calls.slice(1).every((call) => call.auth === `Bearer ${PAGE_TOKEN}`)).toBe(true);
    expect(JSON.parse(calls[2]!.body)).toEqual({ recipient: { comment_id: '17900000000000001' }, message: { text: 'Tady je návod.' } });
    expect(calls.map((call) => call.url.href).join(' ')).not.toContain('TEST-ONLY');
  });

  it('stops the run without its Facebook Login scopes', async () => {
    mocks.resolve.mockResolvedValue({ ...facebook, scopes: ['instagram_basic', 'instagram_manage_comments'] });
    const { fetcher, calls } = graph();
    await expect(createDneskaiEngagementGraph({} as never, owner, {}, fetcher).comments(target, null, signal())).rejects.toMatchObject({ code: 'engagement-scopes-unverified' });
    expect(calls).toEqual([]);
  });
});

describe('the linked Page (#216)', () => {
  it('takes a Page token as the Page itself', async () => {
    const { fetcher } = graph({ pageToken: true });
    expect(await resolveFacebookPage({ ...facebook, loginMode: 'facebook', accessToken: PAGE_TOKEN }, '17841400000000001', { fetcher })).toEqual({ pageId: '1010', pageToken: PAGE_TOKEN });
  });
  it('refuses a token whose Pages are not linked to the account', async () => {
    const { fetcher } = graph();
    await expect(resolveFacebookPage({ ...facebook, loginMode: 'facebook' }, '17841499999999999', { fetcher })).rejects.toMatchObject({ code: 'facebook-page-link-required' });
  });
});

describe('comment subscription (#216)', () => {
  it('subscribes the Instagram account under Instagram Login and the Page under Facebook Login', async () => {
    mocks.resolve.mockResolvedValue(instagram);
    const ig = graph();
    expect(await instagramCommentSubscription({} as never, owner, { id: target.accountId, remoteAccountId: target.igUserId }, 'subscribe', {}, ig.fetcher)).toEqual({ subscribed: true });
    expect(`${ig.calls[0]!.url.host}${ig.calls[0]!.url.pathname}?${ig.calls[0]!.url.searchParams}`).toBe('graph.instagram.com/v99.0/17841400000000001/subscribed_apps?subscribed_fields=comments');
    mocks.resolve.mockResolvedValue(facebook);
    const fb = graph();
    expect(await instagramCommentSubscription({} as never, owner, { id: target.accountId, remoteAccountId: target.igUserId }, 'subscribe', {}, fb.fetcher)).toEqual({ subscribed: true });
    const post = fb.calls.find((call) => call.method === 'POST')!;
    expect(`${post.url.host}${post.url.pathname}?${post.url.searchParams}`).toBe('graph.facebook.com/v99.0/1010/subscribed_apps?subscribed_fields=comments');
    expect(post.auth).toBe(`Bearer ${PAGE_TOKEN}`);
  });
  it('checks webhook signatures with the secret of the active login mode', () => {
    const base = { DNESKAI_ENGAGEMENT_ENABLED: 'true', MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-token-TEST-ONLY-0000' };
    expect(dneskaiCommentWebhookConfigured({ ...base, MARKETING_INSTAGRAM_APP_SECRET: 'ig-secret-TEST-ONLY-000000' })).toBe(true);
    expect(dneskaiCommentWebhookConfigured({ ...base, MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'facebook', MARKETING_INSTAGRAM_APP_SECRET: 'ig-secret-TEST-ONLY-000000' })).toBe(false);
    expect(dneskaiCommentWebhookConfigured({ ...base, MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'facebook', MARKETING_META_APP_SECRET: 'meta-secret-TEST-ONLY-00000' })).toBe(true);
  });
});
