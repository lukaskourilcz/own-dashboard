/**
 * The format a newly generated DNESKAi post starts in. The owner decided on 8 November 2026 that DNESKAi publishes
 * only carousels and classic single-photo posts, never Reels, so generation never starts a post as `reel`, whatever
 * `MARKETING_DNESKAI_REELS_ENABLED` says (#165's education Reels are retired). `category` and `env` stay in the
 * signature for the callers and tests written before.
 */
export const DNESKAI_EDUCATION_CATEGORIES: readonly string[] = ['tool', 'ai-project'];

export function dneskaiDefaultRevisionFormat(deckFormat: 'carousel' | 'single-image', category: string, env: Record<string, string | undefined> = process.env): 'carousel' | 'post' {
  void category; void env;
  return deckFormat === 'carousel' ? 'carousel' : 'post';
}
