/**
 * Comment-inbox capture (owner request, 8 November 2026). For each recent published post of an account whose inbox is
 * switched on — DNESKAi and devShark, Instagram and Threads — it reads the comments and stores each new one with its
 * author and text (`marketing_comments`), so the owner can read and answer it. A comment that looks like spam or abuse
 * is flagged and gets no draft and no notification; every other new comment raises one notification. Nothing is ever
 * sent here: drafting (Phase 3) and the owner's one-click send (Phase 5) are separate.
 *
 * This module is pure over its two ports; `comment-inbox-ports.ts` wires Supabase and the Graph.
 */

/** Per tick, far below the platforms' limits. */
export const COMMENT_INBOX_MEDIA_PER_TICK = 30;
export const COMMENT_INBOX_COMMENTS_PER_TICK = 300;

export type InboxBrand = 'dneskai' | 'devshark';
export type InboxPlatform = 'instagram' | 'threads';

export type InboxTarget = {
  accountId: string; publicationId: string | null; brand: InboxBrand; platform: InboxPlatform; mediaId: string; remoteAccountId: string;
};
/** A comment as a platform returns it. `authorId` and `permalink` may be absent depending on the platform and scopes. */
export type InboxComment = {
  commentId: string; parentCommentId?: string | null; author: string | null; authorId?: string | null; text: string; permalink?: string | null; timestamp: string;
};
export type CapturedComment = InboxTarget & { comment: InboxComment; flaggedReason: string | null };

export interface InboxStore {
  /** Recent published posts of inbox-enabled accounts, both brands and platforms; least recently checked first. */
  targets(now: Date): Promise<InboxTarget[]>;
  /** Stores a captured comment. Returns the new row's id when it was not stored before, or null when it already was. */
  capture(row: CapturedComment, now: Date): Promise<string | null>;
  /** Raises one owner notification for a newly captured, unflagged comment. */
  notify(row: CapturedComment, commentRowId: string, now: Date): Promise<void>;
}
export interface InboxGraph {
  comments(target: InboxTarget, after: string | null, signal: AbortSignal): Promise<{ comments: InboxComment[]; after: string | null }>;
}

export class InboxGraphError extends Error {
  constructor(readonly code: string, readonly scope: 'media' | 'account' | 'run' = 'media') { super(code); this.name = 'InboxGraphError'; }
}

/** A URL in a comment: the most common spam shape. */
const LINK = /(https?:\/\/|www\.|t\.me\/|bit\.ly\/|wa\.me\/|\b[a-z0-9-]+\.(?:com|net|ru|xyz|link|shop|store|online)\b)/i;
/** Common follower/crypto/adult/DM-bait spam, in English and Czech. */
const SPAM = /(free followers|buy followers|cheap followers|followers?\s*\+|crypto|bitcoin|forex|investment plan|onlyfans|promo code|dm me|check (my )?(bio|profile|page)|click (the )?link|odkaz v biu|sleduj mě|levné sledující)/i;
/** A flood of emoji with almost no words. */
const EMOJI_FLOOD = /^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍\s]{6,})$/u;

/**
 * Why a comment is held back from drafting, or null when it is an ordinary comment. Kept deliberately simple and
 * conservative: a false flag only means the owner writes that reply by hand, never that a comment is lost.
 */
export function commentFlagReason(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'empty';
  if (LINK.test(trimmed)) return 'link';
  if (SPAM.test(trimmed)) return 'spam';
  if (EMOJI_FLOOD.test(trimmed)) return 'emoji-flood';
  return null;
}

export type InboxCaptureResult = { targets: number; comments: number; captured: number; flagged: number; notified: number; stopCode: string | null };

/** One capture pass. Stops early on the signal, a run-wide Graph failure, or the per-tick budget. */
export async function runCommentInboxCapture(input: { store: InboxStore; graph: InboxGraph; now: () => Date; signal: AbortSignal; remainingMs?: () => number }): Promise<InboxCaptureResult> {
  const { store, graph, now, signal } = input;
  const result: InboxCaptureResult = { targets: 0, comments: 0, captured: 0, flagged: 0, notified: 0, stopCode: null };
  let budget = COMMENT_INBOX_COMMENTS_PER_TICK;
  const blocked = new Set<string>();
  const targets = (await store.targets(now())).slice(0, COMMENT_INBOX_MEDIA_PER_TICK);
  for (const target of targets) {
    if (signal.aborted || budget <= 0 || result.stopCode || (input.remainingMs && input.remainingMs() < 3_000)) break;
    if (blocked.has(target.accountId)) continue;
    result.targets += 1;
    let after: string | null = null;
    pages: while (budget > 0 && !signal.aborted) {
      let page: Awaited<ReturnType<InboxGraph['comments']>>;
      try { page = await graph.comments(target, after, signal); }
      catch (failure) {
        const error = failure instanceof InboxGraphError ? failure : new InboxGraphError('meta-request-uncertain', 'media');
        if (error.scope === 'run') result.stopCode = error.code;
        if (error.scope === 'account') blocked.add(target.accountId);
        break;
      }
      for (const comment of page.comments) {
        if (budget <= 0) break pages;
        budget -= 1; result.comments += 1;
        const flaggedReason = commentFlagReason(comment.text);
        const row: CapturedComment = { ...target, comment, flaggedReason };
        const rowId = await store.capture(row, now());
        if (!rowId) continue; // already captured on an earlier pass
        result.captured += 1;
        if (flaggedReason) { result.flagged += 1; continue; }
        await store.notify(row, rowId, now());
        result.notified += 1;
      }
      after = page.after;
      if (!after) break;
    }
  }
  return result;
}
