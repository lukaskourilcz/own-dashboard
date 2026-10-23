/** The public reply a new keyword starts with (owner decision 4, 22 October 2026); the owner may change or empty it. */
export const DNESKAI_DEFAULT_PUBLIC_REPLY = 'Poslali jsme vám to do zpráv.';

type Environment = Record<string, string | undefined>;

/**
 * The comment keyword and DM reply of a DNESKAi post (#157, #159). The owner edits them in the Design Lab only when
 * the server-only `DNESKAI_ENGAGEMENT_EDITOR_ENABLED=true`; off, the edit route refuses an `engagement` field and the
 * Lab shows no editor. Revisions that already carry engagement keep it through every edit either way.
 */
/**
 * #160: the comment watcher (scheduler step `engagement`), the per-account reply switch and the account read of its
 * columns. Server-only `DNESKAI_ENGAGEMENT_ENABLED=true`, set only after `20261023120000_dneskai_comment_replies.sql`.
 */
export function dneskaiEngagementWatchEnabled(env: Environment = process.env): boolean {
  return env.DNESKAI_ENGAGEMENT_ENABLED === 'true';
}
/** #161: the comment webhook exists once the watcher runs and both Meta values are set on the server. */
export function dneskaiCommentWebhookConfigured(env: Environment = process.env): boolean {
  // #216: the signing secret is the Meta app's under Facebook Login, the Instagram app's under Instagram Login.
  const secret = env.MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE === 'facebook' ? env.MARKETING_META_APP_SECRET : env.MARKETING_INSTAGRAM_APP_SECRET;
  return dneskaiEngagementWatchEnabled(env) && (env.MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN ?? '').length >= 16 && (secret ?? '').length >= 16;
}
export function dneskaiEngagementEditorEnabled(env: Environment = process.env): boolean {
  return env.DNESKAI_ENGAGEMENT_EDITOR_ENABLED === 'true';
}
