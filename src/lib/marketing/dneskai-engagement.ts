/** The public reply a new keyword starts with (owner decision 4, 22 October 2026); the owner may change or empty it. */
export const DNESKAI_DEFAULT_PUBLIC_REPLY = 'Poslali jsme vám to do zpráv.';

type Environment = Record<string, string | undefined>;

/**
 * The comment keyword and DM reply of a DNESKAi post (#157, #159). The owner edits them in the Design Lab only when
 * the server-only `DNESKAI_ENGAGEMENT_EDITOR_ENABLED=true`; off, the edit route refuses an `engagement` field and the
 * Lab shows no editor. Revisions that already carry engagement keep it through every edit either way.
 */
export function dneskaiEngagementEditorEnabled(env: Environment = process.env): boolean {
  return env.DNESKAI_ENGAGEMENT_EDITOR_ENABLED === 'true';
}
