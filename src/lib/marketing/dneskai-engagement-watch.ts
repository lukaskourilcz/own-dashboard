/**
 * The comment watcher of DNESKAi (#160, plan B4): for each Instagram post published in the last seven days whose
 * approved revision carries a keyword, it reads the comments, matches the keyword, and sends one private reply with
 * the approved DM text, then optionally one public reply under the comment.
 *
 * The one-reply rule is the store's: `claim` inserts the comment id under a unique key before anything is sent, so a
 * comment never gets a second private reply, even when the answer to the first is lost (that reply stays
 * `uncertain` and is never retried). Nothing about the commenter is kept: no username, no user id, no text.
 *
 * This module holds the rules and is pure over its two ports; `dneskai-engagement-ports.ts` wires Supabase and Graph.
 */

/** Instagram allows a private reply to a comment for seven days; older comments are skipped and counted. */
export const DNESKAI_ENGAGEMENT_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Per tick: at most this many posts and comments, far below Instagram's 750 calls an hour. */
export const DNESKAI_ENGAGEMENT_MEDIA_PER_TICK = 20;
export const DNESKAI_ENGAGEMENT_COMMENTS_PER_TICK = 200;
/** A comment of at most this many words may carry the keyword among other words. */
export const DNESKAI_ENGAGEMENT_SHORT_COMMENT_WORDS = 5;

/** Lower case, no diacritics, punctuation and emoji as spaces, single spaces. */
export function normalizeCommentText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * True when the comment is the keyword, or a short comment (five words at most) that has the keyword as a whole
 * word. „skill“, „SKILL!“ and „Skíll prosím“ match SKILL; „skills“ and a long sentence that mentions it do not.
 */
export function commentMatchesKeyword(text: string, keyword: string): boolean {
  const words = normalizeCommentText(text).split(' ').filter(Boolean);
  const wanted = keyword.toLowerCase();
  return words.includes(wanted) && words.length <= DNESKAI_ENGAGEMENT_SHORT_COMMENT_WORDS;
}

export type EngagementCheck = { afterCursor: string | null; passSeen: number; passMatches: number; passSkippedOld: number };
export type EngagementTarget = {
  publicationId: string; mediaId: string; accountId: string; igUserId: string; scheduledAt: string;
  keyword: string; replyMessage: string; publicReply: string | null; check: EngagementCheck;
};
export type EngagementComment = { id: string; text: string; timestamp: string };
export type ReplyFinish = { status: 'sent' | 'failed' | 'uncertain'; errorCode: string | null; privateSentAt: string | null;
  publicStatus: 'none' | 'sent' | 'failed' | 'uncertain'; publicCommentId: string | null };

export interface EngagementStore {
  /** Published DNESKAi Instagram posts younger than seven days, with a keyword, on an account whose switch is on and not blocked; least recently checked first. */
  targets(now: Date): Promise<EngagementTarget[]>;
  /** Inserts the reply row for this comment; false when the comment was claimed before. */
  claim(input: { publicationId: string; mediaId: string; commentId: string; keyword: string }): Promise<boolean>;
  finish(commentId: string, result: ReplyFinish): Promise<void>;
  /** A pass in progress (`after` set) or a finished one (`after` null, counts become the receipt). */
  saveCheck(target: EngagementTarget, check: EngagementCheck & { finished: boolean; errorCode: string | null; at: Date }): Promise<void>;
  blockAccount(accountId: string, code: string, at: Date): Promise<void>;
}

/**
 * A Graph failure. `definite`: Instagram answered with a refusal, so nothing was sent. `uncertain`: no usable answer,
 * so a send may have happened. `scope`: what it stops: this comment, the account (messaging switched off), or the run
 * (token, rate limit).
 */
export class EngagementGraphError extends Error {
  constructor(readonly code: string, readonly kind: 'definite' | 'uncertain', readonly scope: 'comment' | 'account' | 'run' = 'comment') { super(code); this.name = 'EngagementGraphError'; }
}
export interface EngagementGraph {
  comments(target: EngagementTarget, after: string | null, signal: AbortSignal): Promise<{ comments: EngagementComment[]; after: string | null }>;
  privateReply(target: EngagementTarget, commentId: string, signal: AbortSignal): Promise<void>;
  publicReply(target: EngagementTarget, commentId: string, signal: AbortSignal): Promise<{ id: string }>;
}

export type EngagementWatchResult = {
  media: number; comments: number; matches: number; sent: number; failed: number; uncertain: number; publicSent: number; skippedOld: number;
  blockedAccounts: number; stopCode: string | null;
};

/** One tick of the watcher. Stops early on the tick's signal, a run-wide Graph failure or the per-tick budget. */
export async function runDneskaiEngagementWatch(input: { store: EngagementStore; graph: EngagementGraph; now: () => Date; signal: AbortSignal; remainingMs?: () => number }): Promise<EngagementWatchResult> {
  const { store, graph, now, signal } = input;
  const result: EngagementWatchResult = { media: 0, comments: 0, matches: 0, sent: 0, failed: 0, uncertain: 0, publicSent: 0, skippedOld: 0, blockedAccounts: 0, stopCode: null };
  const blocked = new Set<string>();
  let budget = DNESKAI_ENGAGEMENT_COMMENTS_PER_TICK;
  const targets = (await store.targets(now())).slice(0, DNESKAI_ENGAGEMENT_MEDIA_PER_TICK);
  for (const target of targets) {
    if (signal.aborted || budget <= 0 || result.stopCode || (input.remainingMs && input.remainingMs() < 3_000)) break;
    if (blocked.has(target.accountId)) continue;
    result.media += 1;
    const check: EngagementCheck = { ...target.check };
    let after = check.afterCursor;
    let errorCode: string | null = null;
    let finished = false;
    pages: while (budget > 0 && !signal.aborted) {
      let page: Awaited<ReturnType<EngagementGraph['comments']>>;
      try { page = await graph.comments(target, after, signal); }
      catch (failure) {
        const error = failure instanceof EngagementGraphError ? failure : new EngagementGraphError('meta-request-uncertain', 'uncertain');
        errorCode = error.code;
        if (error.scope === 'run') result.stopCode = error.code;
        break;
      }
      const before = { ...check };
      for (const comment of page.comments) {
        // A page cut short is read again from its cursor next time: its counts start over then, its claims stay.
        if (budget <= 0) { Object.assign(check, { passSeen: before.passSeen, passMatches: before.passMatches, passSkippedOld: before.passSkippedOld }); break pages; }
        budget -= 1; result.comments += 1; check.passSeen += 1;
        const at = Date.parse(comment.timestamp);
        if (!Number.isFinite(at) || now().getTime() - at > DNESKAI_ENGAGEMENT_WINDOW_MS) { check.passSkippedOld += 1; result.skippedOld += 1; continue; }
        if (!commentMatchesKeyword(comment.text, target.keyword)) continue;
        check.passMatches += 1; result.matches += 1;
        const outcome = await answerComment({ store, graph, target, commentId: comment.id, signal, now }, result);
        if (outcome === 'account') { blocked.add(target.accountId); errorCode = 'engagement-messaging-disabled'; break pages; }
        if (outcome === 'run') { errorCode = result.stopCode; break pages; }
      }
      after = page.after;
      if (!after) { finished = true; break; }
    }
    await store.saveCheck(target, { ...check, afterCursor: finished ? null : after, finished, errorCode, at: now() });
  }
  return result;
}

/**
 * One matched comment: claim it, send the private reply and then the public one, record the result. Shared by the
 * polling pass and the webhook (#161), so both obey the same one-reply rule. Returns what the outcome stops.
 */
async function answerComment(input: { store: EngagementStore; graph: EngagementGraph; target: EngagementTarget; commentId: string; signal: AbortSignal; now: () => Date },
  result: EngagementWatchResult): Promise<'claimed-before' | 'comment' | 'account' | 'run'> {
  const { store, graph, target, commentId, signal, now } = input;
  if (!(await store.claim({ publicationId: target.publicationId, mediaId: target.mediaId, commentId, keyword: target.keyword }))) return 'claimed-before';
  const outcome = await reply(graph, target, commentId, signal, now);
  await store.finish(commentId, outcome.finish);
  if (outcome.finish.status === 'sent') result.sent += 1; else if (outcome.finish.status === 'failed') result.failed += 1; else result.uncertain += 1;
  if (outcome.finish.publicStatus === 'sent') result.publicSent += 1;
  if (outcome.scope === 'account') { result.blockedAccounts += 1; await store.blockAccount(target.accountId, outcome.finish.errorCode!, now()); }
  if (outcome.scope === 'run') result.stopCode = outcome.finish.errorCode;
  return outcome.scope;
}

/** A comment as a webhook delivers it (#161): no timestamp, the time of delivery counts. */
export type EngagementCommentEvent = { commentId: string; mediaId: string; text: string };
/**
 * Comments delivered by the Instagram webhook (#161): each one is matched against the keyword of its post, when that
 * post is a current target, and answered through the same claim as the polling pass, so polling never answers it
 * again. Events for other posts, or after a blocked account or a run-wide failure, are skipped.
 */
export async function handleDneskaiCommentEvents(input: { store: EngagementStore; graph: EngagementGraph; now: () => Date; signal: AbortSignal; events: EngagementCommentEvent[] }): Promise<EngagementWatchResult> {
  const result: EngagementWatchResult = { media: 0, comments: 0, matches: 0, sent: 0, failed: 0, uncertain: 0, publicSent: 0, skippedOld: 0, blockedAccounts: 0, stopCode: null };
  if (!input.events.length) return result;
  const targets = await input.store.targets(input.now());
  const blocked = new Set<string>();
  for (const event of input.events.slice(0, 50)) {
    if (input.signal.aborted || result.stopCode) break;
    const target = targets.find((item) => item.mediaId === event.mediaId);
    if (!target || blocked.has(target.accountId)) continue;
    result.comments += 1;
    if (!commentMatchesKeyword(event.text, target.keyword)) continue;
    result.matches += 1;
    if ((await answerComment({ store: input.store, graph: input.graph, target, commentId: event.commentId, signal: input.signal, now: input.now }, result)) === 'account') blocked.add(target.accountId);
  }
  return result;
}

async function reply(graph: EngagementGraph, target: EngagementTarget, commentId: string, signal: AbortSignal, now: () => Date): Promise<{ finish: ReplyFinish; scope: 'comment' | 'account' | 'run' }> {
  try { await graph.privateReply(target, commentId, signal); }
  catch (failure) {
    const error = failure instanceof EngagementGraphError ? failure : new EngagementGraphError('meta-request-uncertain', 'uncertain');
    return { finish: { status: error.kind === 'definite' ? 'failed' : 'uncertain', errorCode: error.code, privateSentAt: null, publicStatus: 'none', publicCommentId: null }, scope: error.scope };
  }
  const sent: ReplyFinish = { status: 'sent', errorCode: null, privateSentAt: now().toISOString(), publicStatus: 'none', publicCommentId: null };
  if (!target.publicReply) return { finish: sent, scope: 'comment' };
  try {
    const posted = await graph.publicReply(target, commentId, signal);
    return { finish: { ...sent, publicStatus: 'sent', publicCommentId: posted.id }, scope: 'comment' };
  } catch (failure) {
    const error = failure instanceof EngagementGraphError ? failure : new EngagementGraphError('meta-request-uncertain', 'uncertain');
    // The private reply went out; a failed public line never undoes it, and is never retried.
    return { finish: { ...sent, publicStatus: error.kind === 'definite' ? 'failed' : 'uncertain', errorCode: error.code }, scope: error.scope === 'run' ? 'run' : 'comment' };
  }
}

/**
 * Graph's error answer as a code. Code 10 and the messaging subcodes mean the account does not allow connected tools
 * to message („Allow access to messages“ is off): replies stop for the account until the owner fixes it. 190 is a
 * dead token and 4, 17, 32 and 613 are rate limits: the run stops. Anything else refuses this comment only.
 */
export function engagementGraphError(status: number, body: unknown): EngagementGraphError {
  const error = body && typeof body === 'object' && 'error' in body ? (body as { error?: { code?: unknown; error_subcode?: unknown } }).error : undefined;
  const code = typeof error?.code === 'number' ? error.code : null;
  const subcode = typeof error?.error_subcode === 'number' ? error.error_subcode : null;
  if (code === 10 || code === 230 || subcode === 2534022 || subcode === 2018278) return new EngagementGraphError('engagement-messaging-disabled', 'definite', 'account');
  if (code === 190) return new EngagementGraphError('access-token-invalid', 'definite', 'run');
  if (code !== null && [4, 17, 32, 613].includes(code) || status === 429) return new EngagementGraphError('meta-rate-limited', 'definite', 'run');
  if (code === 551 || subcode === 2534014) return new EngagementGraphError('engagement-recipient-unavailable', 'definite');
  if (status >= 500) return new EngagementGraphError(`meta-http-${status}`, 'uncertain');
  return new EngagementGraphError(code !== null ? `meta-error-${code}` : `meta-http-${status}`, 'definite');
}
