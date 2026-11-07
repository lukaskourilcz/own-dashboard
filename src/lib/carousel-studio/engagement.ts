/**
 * The one copy rule no owner, fact sheet or edit can change (second handoff, finding 5): no slide,
 * caption or hashtag may promise coins, discounts, access or any reward for following, liking,
 * sharing or commenting. Meta's spam standards forbid value in exchange for engagement, and LinkedIn
 * forbids artificial engagement.
 *
 * It lives in the studio because the marketingShark room's gates and the Admin's Queue and Design
 * Lab both read copy with it: the room on what CHUM wrote, the Admin on what the owner edits, saves
 * or re-renders (quorum#573 review). One function, so the two can never disagree.
 *
 * Engagement bait, in the one form a check can recognise without flagging ordinary developer copy:
 * a call to follow, like, share, comment on or tag the brand or the post, in the same sentence as a
 * reward. "Share this with a friend who still uses var" passes; "Follow us for 50 coins" does not.
 */
const ENGAGEMENT_CALL = /\b(?:follow|like|share|comment(?:\s+on)?|repost|tag|subscribe(?:\s+to)?|save)\s+(?:us|this|it|our|devshark|the\s+(?:page|post|carousel|profile)|a\s+friend|below)\b|\bfor\s+(?:following|liking|sharing|commenting|reposting|tagging|subscribing)\b|(?:^|\s)(?:sleduj(?:te)?|lajkni(?:te)?|sdílej(?:te)?|okomentuj(?:te)?)(?=\s|$)/iu;
const ENGAGEMENT_REWARD = /\b(?:coins?|discounts?|rewards?|giveaways?|prizes?|promo\s+codes?|unlock(?:s|ed)?|premium|free\s+(?:access|months?|trial))\b|\d+\s*%\s*off\b|(?:^|\s)(?:minc\p{L}*|slev\p{L}*|odměn\p{L}*)/iu;

/** Whether any sentence of a text promises a reward for engagement. */
export function promisesEngagementReward(text: string): boolean {
  return text.split(/[.!?\n]+/u).some((sentence) => ENGAGEMENT_CALL.test(sentence) && ENGAGEMENT_REWARD.test(sentence));
}

/** The sentence a refusal gives the owner or the writer. */
export const ENGAGEMENT_REWARD_REFUSAL = "no slide, caption or hashtag may promise coins, discounts, access or any reward for following, liking, sharing or commenting";
