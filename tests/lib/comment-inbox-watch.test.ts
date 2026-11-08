import { describe, expect, it } from 'vitest';
import {
  commentFlagReason, runCommentInboxCapture, InboxGraphError,
  type CapturedComment, type InboxComment, type InboxGraph, type InboxStore, type InboxTarget,
} from '@/lib/marketing/comment-inbox-watch';

const target: InboxTarget = { accountId: 'acc-1', publicationId: 'pub-1', brand: 'dneskai', platform: 'instagram', mediaId: '900100', remoteAccountId: '17841400000000001' };
const comment = (id: string, text: string, author = 'someone'): InboxComment => ({ commentId: id, author, text, timestamp: new Date().toISOString() });

function fakes(pages: InboxComment[][], opts: { captured?: Set<string> } = {}) {
  const captured = opts.captured ?? new Set<string>();
  const notified: string[] = [];
  const stored: CapturedComment[] = [];
  let pageIndex = 0;
  const store: InboxStore = {
    async targets() { return [target]; },
    async capture(row) { if (captured.has(row.comment.commentId)) return null; captured.add(row.comment.commentId); stored.push(row); return `row-${row.comment.commentId}`; },
    async notify(_row, rowId) { notified.push(rowId); },
  };
  const graph: InboxGraph = {
    async comments() { const page = pages[pageIndex] ?? []; pageIndex += 1; return { comments: page, after: pageIndex < pages.length ? `c${pageIndex}` : null }; },
  };
  return { store, graph, notified, stored };
}
const run = (f: ReturnType<typeof fakes>) => runCommentInboxCapture({ store: f.store, graph: f.graph, now: () => new Date(), signal: new AbortController().signal });

describe('commentFlagReason', () => {
  it('flags links, spam, emoji floods and empty; passes ordinary comments', () => {
    expect(commentFlagReason('Zdroj? Díky!')).toBeNull();
    expect(commentFlagReason('super video, díky moc')).toBeNull();
    expect(commentFlagReason('check my bio for free followers')).toBe('spam');
    expect(commentFlagReason('great! visit https://spam.example')).toBe('link');
    expect(commentFlagReason('odkaz v biu, sleduj mě')).toBe('spam');
    expect(commentFlagReason('🔥🔥🔥🔥🔥🔥🔥')).toBe('emoji-flood');
    expect(commentFlagReason('   ')).toBe('empty');
  });
});

describe('runCommentInboxCapture', () => {
  it('captures each new comment and notifies for the unflagged ones', async () => {
    const f = fakes([[comment('1', 'Zdroj?'), comment('2', 'free followers here')]]);
    const r = await run(f);
    expect(r).toMatchObject({ comments: 2, captured: 2, flagged: 1, notified: 1 });
    expect(f.notified).toEqual(['row-1']); // the spam comment (2) is captured but not notified
    expect(f.stored.find((s) => s.comment.commentId === '2')!.flaggedReason).toBe('spam');
  });

  it('does not re-capture a comment seen on an earlier pass', async () => {
    const f = fakes([[comment('1', 'Zdroj?')]], { captured: new Set(['1']) });
    const r = await run(f);
    expect(r).toMatchObject({ comments: 1, captured: 0, notified: 0 });
    expect(f.notified).toEqual([]);
  });

  it('follows pages until the cursor runs out', async () => {
    const f = fakes([[comment('1', 'a')], [comment('2', 'b')], [comment('3', 'c')]]);
    const r = await run(f);
    expect(r).toMatchObject({ comments: 3, captured: 3, notified: 3 });
  });

  it('stops the run on a run-scoped graph failure and captures nothing from that account', async () => {
    const store: InboxStore = { async targets() { return [target]; }, async capture() { return 'x'; }, async notify() {} };
    const graph: InboxGraph = { async comments() { throw new InboxGraphError('token-invalid', 'run'); } };
    const r = await runCommentInboxCapture({ store, graph, now: () => new Date(), signal: new AbortController().signal });
    expect(r.stopCode).toBe('token-invalid');
    expect(r.captured).toBe(0);
  });
});
