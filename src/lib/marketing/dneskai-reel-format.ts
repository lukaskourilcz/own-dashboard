/** Private MP4 bucket ceiling, shared with the native output consumer. */
export const DNESKAI_REEL_MAX_BYTES = 64 * 1024 * 1024;

/**
 * The format a newly generated DNESKAi post starts in (#165, plan C3): education posts as a Reel, news as a carousel.
 * Only while `MARKETING_DNESKAI_REELS_ENABLED=true`; off, every carousel deck stays a carousel as before. Until topics
 * carry their own kind (#150), a brief's category stands in: `tool` and `ai-project` are the education categories.
 * The owner can switch either way in the Lab before approval.
 */
export const DNESKAI_EDUCATION_CATEGORIES: readonly string[] = ['tool', 'ai-project'];

export function dneskaiDefaultRevisionFormat(deckFormat: 'carousel' | 'single-image', category: string, env: Record<string, string | undefined> = process.env): 'carousel' | 'reel' | 'post' {
  if (deckFormat !== 'carousel') return 'post';
  return env.MARKETING_DNESKAI_REELS_ENABLED === 'true' && DNESKAI_EDUCATION_CATEGORIES.includes(category) ? 'reel' : 'carousel';
}
