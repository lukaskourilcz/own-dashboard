type Environment = Record<string, string | undefined>;

/**
 * Comment inbox with owner-drafted replies (owner request, 8 November 2026). Two server-only switches, both off by
 * default, each set only after `20261108130000_marketing_comment_inbox.sql`:
 *
 * - `MARKETING_COMMENT_INBOX_ENABLED` turns on capture: the engagement step and the webhook store a new comment's
 *   author and text (`marketing_comments`) for the accounts whose `comment_inbox_enabled` switch is on, and raise a
 *   notification. Capture alone drafts nothing and never sends.
 * - `MARKETING_COMMENT_DRAFTS_ENABLED` additionally lets a model read a captured comment and draft a short reply in
 *   the owner's voice. This is the one place a model sees a comment, so it also requires `MARKETING_AI_CONSENT=true`
 *   (see docs/ai-and-privacy.md). A drafted reply is still never sent until the owner confirms with one click.
 */
export function commentInboxEnabled(env: Environment = process.env): boolean {
  return env.MARKETING_COMMENT_INBOX_ENABLED === 'true';
}

export function commentDraftsEnabled(env: Environment = process.env): boolean {
  return commentInboxEnabled(env) && env.MARKETING_COMMENT_DRAFTS_ENABLED === 'true' && env.MARKETING_AI_CONSENT === 'true';
}

/** The default reply signature (owner default, 8 November 2026); the owner may change it per reply before sending. */
export const DEFAULT_REPLY_SIGNATURE = '— Lukáš';
