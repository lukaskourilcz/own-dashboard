import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const resolve = vi.hoisted(() => vi.fn());
vi.mock('@/lib/marketing/meta-credentials', () => ({ resolveMetaPublisherConfig: resolve }));
import {
  commentMatchesKeyword, DNESKAI_ENGAGEMENT_COMMENTS_PER_TICK, engagementGraphError, normalizeCommentText, runDneskaiEngagementWatch,
  type EngagementCheck, type EngagementStore, type EngagementTarget, type ReplyFinish,
} from '@/lib/marketing/dneskai-engagement-watch';
import { createDneskaiEngagementGraph } from '@/lib/marketing/dneskai-engagement-ports';

const NOW = new Date('2026-10-25T10:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const target = (patch: Partial<EngagementTarget> = {}): EngagementTarget => ({
  publicationId: '11111111-1111-4111-8111-111111111111', mediaId: '1790000000000001', accountId: '22222222-2222-4222-8222-222222222222', igUserId: '17841400000000001',
  scheduledAt: ago(30), keyword: 'SKILL', replyMessage: 'Návod: otevřete aplikaci a začněte.', publicReply: 'Poslali jsme vám to do zpráv.',
  check: { afterCursor: null, passSeen: 0, passMatches: 0, passSkippedOld: 0 }, ...patch,
});

/** An in-memory store with the database's one-reply rule: a comment id is claimed once. */
function memoryStore(targets: EngagementTarget[]) {
  const replies = new Map<string, ReplyFinish | 'claimed'>();
  const checks: Array<EngagementCheck & { finished: boolean; errorCode: string | null; publicationId: string }> = [];
  const blocked: string[] = [];
  const store: EngagementStore = {
    targets: async () => targets,
    claim: async ({ commentId }) => { if (replies.has(commentId)) return false; replies.set(commentId, 'claimed'); return true; },
    finish: async (commentId, result) => { replies.set(commentId, result); },
    saveCheck: async (item, check) => { checks.push({ ...check, publicationId: item.publicationId }); },
    blockAccount: async (accountId, code) => { blocked.push(`${accountId}:${code}`); },
  };
  return { store, replies, checks, blocked };
}

/** A stand-in Graph server: comments in pages of two, every call recorded, answers chosen per path. */
function standInGraph(comments: Array<{ id: string; text: string; timestamp: string }>, answers: { messages?: () => Response; replies?: () => Response } = {}) {
  const calls: Array<{ method: string; url: URL; body: string | undefined; auth: string | null }> = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body as string | undefined, auth: new Headers(init?.headers).get('authorization') });
    if (url.pathname.endsWith('/comments')) {
      const start = Number(url.searchParams.get('after') ?? 0);
      const page = comments.slice(start, start + 2);
      const next = start + 2 < comments.length;
      return Response.json({ data: page, paging: { cursors: { after: String(start + 2) }, ...(next ? { next: 'https://graph.instagram.com/next' } : {}) } });
    }
    if (url.pathname.endsWith('/messages')) return answers.messages?.() ?? Response.json({ recipient_id: '1', message_id: 'm1' });
    if (url.pathname.endsWith('/replies')) return answers.replies?.() ?? Response.json({ id: '1790000000009999' });
    return new Response('{}', { status: 404 });
  });
  return { fetcher, calls };
}
const config = (patch = {}) => ({ enabled: true, apiVersion: 'v24.0', apiVersionVerifiedAt: '2026-10-20T00:00:00Z', loginMode: 'instagram', accessToken: 'TEST-ONLY-TOKEN-0000000000',
  tokenExpiresAt: '2026-12-01T00:00:00Z', scopes: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments'], approvedAssetHosts: [], ...patch });
const run = (store: EngagementStore, fetcher: typeof fetch) =>
  runDneskaiEngagementWatch({ store, graph: createDneskaiEngagementGraph({} as never, '33333333-3333-4333-8333-333333333333', {}, fetcher), now: () => NOW, signal: new AbortController().signal });

describe('keyword matching (#160)', () => {
  it('ignores case, diacritics and punctuation and takes the keyword inside a short comment', () => {
    expect(normalizeCommentText('  Skíll!!! 🙏 ')).toBe('skill');
    for (const text of ['SKILL', 'skill', 'Skill!', 'skíll', '„SKILL“', 'skill prosím', 'Chci SKILL, díky moc', '#skill']) expect(commentMatchesKeyword(text, 'SKILL'), text).toBe(true);
  });
  it('never matches another word that contains the keyword, or a long comment', () => {
    for (const text of ['skills', 'superskill', 'skil', 'ski ll', 'To je dobrý skill, ale ten návod bych chtěl vidět celý']) expect(commentMatchesKeyword(text, 'SKILL'), text).toBe(false);
    expect(commentMatchesKeyword('ai', 'AI')).toBe(true);
    expect(commentMatchesKeyword('aipro', 'AI')).toBe(false);
  });
});

describe('Graph errors (#160)', () => {
  it('maps messaging disabled to the account, token and rate limits to the run, the rest to the comment', () => {
    expect(engagementGraphError(400, { error: { code: 10 } })).toMatchObject({ code: 'engagement-messaging-disabled', kind: 'definite', scope: 'account' });
    expect(engagementGraphError(400, { error: { code: 190 } })).toMatchObject({ code: 'access-token-invalid', scope: 'run' });
    for (const code of [4, 17, 32, 613]) expect(engagementGraphError(400, { error: { code } })).toMatchObject({ code: 'meta-rate-limited', scope: 'run' });
    expect(engagementGraphError(429, null)).toMatchObject({ code: 'meta-rate-limited', scope: 'run' });
    expect(engagementGraphError(400, { error: { code: 100, error_subcode: 2534014 } })).toMatchObject({ code: 'engagement-recipient-unavailable', scope: 'comment' });
    expect(engagementGraphError(502, null)).toMatchObject({ code: 'meta-http-502', kind: 'uncertain', scope: 'comment' });
    expect(engagementGraphError(400, { error: { code: 100 } })).toMatchObject({ code: 'meta-error-100', kind: 'definite' });
  });
});

describe('the watcher over a stand-in Graph server (#160)', () => {
  const comments = [
    { id: '1801', text: 'SKILL', timestamp: ago(2) },
    { id: '1802', text: 'Pěkné, díky', timestamp: ago(2) },
    { id: '1803', text: 'skíll prosím', timestamp: ago(1) },
    { id: '1804', text: 'skill', timestamp: ago(24 * 8) },
  ];
  it('replies privately then publicly once per matching comment, skips old ones and records the finished pass', async () => {
    resolve.mockResolvedValue(config());
    const { store, replies, checks } = memoryStore([target()]);
    const graph = standInGraph(comments);
    const result = await run(store, graph.fetcher);
    expect(result).toMatchObject({ media: 1, comments: 4, matches: 2, sent: 2, publicSent: 2, skippedOld: 1, stopCode: null });
    const messages = graph.calls.filter((call) => call.url.pathname.endsWith('/messages'));
    expect(messages.map((call) => call.url.pathname)).toEqual(['/v24.0/17841400000000001/messages', '/v24.0/17841400000000001/messages']);
    expect(JSON.parse(messages[0]!.body!)).toEqual({ recipient: { comment_id: '1801' }, message: { text: 'Návod: otevřete aplikaci a začněte.' } });
    expect(graph.calls.filter((call) => call.url.pathname.endsWith('/replies')).map((call) => call.url.pathname)).toEqual(['/v24.0/1801/replies', '/v24.0/1803/replies']);
    expect(graph.calls.every((call) => call.auth === 'Bearer TEST-ONLY-TOKEN-0000000000' && !call.url.search.includes('TOKEN'))).toBe(true);
    expect(replies.get('1801')).toMatchObject({ status: 'sent', publicStatus: 'sent', publicCommentId: '1790000000009999' });
    expect(replies.has('1802')).toBe(false); expect(replies.has('1804')).toBe(false);
    expect(checks.at(-1)).toMatchObject({ finished: true, afterCursor: null, passSeen: 4, passMatches: 2, passSkippedOld: 1 });
  });
  it('never replies twice: a second pass over the same comments claims nothing new', async () => {
    resolve.mockResolvedValue(config());
    const { store } = memoryStore([target()]);
    await run(store, standInGraph(comments).fetcher);
    const again = standInGraph(comments);
    const result = await run(store, again.fetcher);
    expect(result).toMatchObject({ matches: 2, sent: 0 });
    expect(again.calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('sends no public reply when the post has none, and keeps a lost answer uncertain, never retried', async () => {
    resolve.mockResolvedValue(config());
    const { store, replies } = memoryStore([target({ publicReply: null })]);
    const graph = standInGraph(comments, { messages: () => new Response('not json', { status: 502 }) });
    const result = await run(store, graph.fetcher);
    expect(result).toMatchObject({ sent: 0, uncertain: 2, publicSent: 0 });
    expect(graph.calls.some((call) => call.url.pathname.endsWith('/replies'))).toBe(false);
    expect(replies.get('1801')).toMatchObject({ status: 'uncertain', errorCode: 'meta-http-502' });
    const second = standInGraph(comments);
    await run(store, second.fetcher);
    expect(second.calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('blocks the account when messaging is off and stops its other posts', async () => {
    resolve.mockResolvedValue(config());
    const { store, blocked, replies } = memoryStore([target(), target({ publicationId: '44444444-4444-4444-8444-444444444444', mediaId: '1790000000000002' })]);
    const graph = standInGraph(comments, { messages: () => Response.json({ error: { code: 10, message: 'not allowed' } }, { status: 403 }) });
    const result = await run(store, graph.fetcher);
    expect(blocked).toEqual(['22222222-2222-4222-8222-222222222222:engagement-messaging-disabled']);
    expect(result).toMatchObject({ media: 1, failed: 1, blockedAccounts: 1 });
    expect(replies.get('1801')).toMatchObject({ status: 'failed', errorCode: 'engagement-messaging-disabled' });
    expect(graph.calls.filter((call) => call.url.pathname.includes('1790000000000002'))).toEqual([]);
  });
  it('makes no Graph call without the comment scope or with a held credential', async () => {
    for (const held of [config({ scopes: ['instagram_business_basic'] }), config({ credentialHold: 'access-token-expired', accessToken: '' })]) {
      resolve.mockResolvedValue(held);
      const graph = standInGraph(comments);
      const result = await run(memoryStore([target()]).store, graph.fetcher);
      expect(graph.fetcher).not.toHaveBeenCalled();
      expect(result.stopCode).toMatch(/engagement-scopes-unverified|access-token-expired/);
    }
  });
  it('continues an unfinished pass from its cursor when the per-tick budget runs out', async () => {
    resolve.mockResolvedValue(config());
    const many = Array.from({ length: DNESKAI_ENGAGEMENT_COMMENTS_PER_TICK + 4 }, (_, index) => ({ id: String(2000 + index), text: 'pěkné', timestamp: ago(1) }));
    const { store, checks } = memoryStore([target()]);
    const result = await run(store, standInGraph(many).fetcher);
    expect(result.comments).toBe(DNESKAI_ENGAGEMENT_COMMENTS_PER_TICK);
    expect(checks.at(-1)).toMatchObject({ finished: false, afterCursor: String(DNESKAI_ENGAGEMENT_COMMENTS_PER_TICK), passSeen: DNESKAI_ENGAGEMENT_COMMENTS_PER_TICK });
  });
});
