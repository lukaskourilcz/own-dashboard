type Environment = Record<string, string | undefined>;

/**
 * Which paid owner actions of the DNESKAi review this deployment offers (owner decisions 8 and 9). Regenerate needs
 * `20261022190000_dneskai_regenerate_with_note.sql` (the finished job supersedes the version it regenerates), so it
 * stays off until the server-only `DNESKAI_REGENERATE_ENABLED=true`. Generate now uses only existing functions. Both
 * need the marketing AI consent (`MARKETING_AI_CONSENT=true`).
 */
export function dneskaiPaidActionCapabilities(env: Environment = process.env) {
  const consent = env.MARKETING_AI_CONSENT === 'true';
  return { regenerate: consent && env.DNESKAI_REGENERATE_ENABLED === 'true', generateNow: consent };
}
