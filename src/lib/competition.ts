import { daysUntilDate } from "@/lib/date-keys";
import type { Competitor } from "@/lib/types";

/**
 * Competition research ages. A competitor's pricing page, feature list and
 * social cadence all move, so a review that is older than a quarter is a note
 * about a product that may no longer exist in that shape.
 *
 * Ninety days is the marker, not a deadline: nothing expires, nothing is
 * hidden, the row just says out loud that it has not been looked at since.
 */
export const COMPETITOR_REVIEW_STALE_DAYS = 90;

export type CompetitorReviewState = "fresh" | "stale" | "never";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Freshness of one `reviewed_at` value against a clock the caller owns.
 *
 * `reviewed_at` is a Postgres `date`, so it is compared through
 * `daysUntilDate`, which parses it in local time. Parsing it with `new Date()`
 * would read it as UTC midnight and drift the verdict by a day either side of
 * the boundary. A missing or malformed value is "never" rather than stale, so
 * the reader can tell "nobody has checked" from "checked, long ago".
 */
export function competitorReviewState(reviewedAt: string | null | undefined, now: Date): CompetitorReviewState {
  if (!reviewedAt || !DATE_ONLY.test(reviewedAt)) return "never";
  const days = daysUntilDate(reviewedAt, now);
  if (Number.isNaN(days)) return "never";
  return -days >= COMPETITOR_REVIEW_STALE_DAYS ? "stale" : "fresh";
}

/** True for both "needs a refresh" states, which is what the filter selects. */
export function isCompetitorReviewStale(competitor: Pick<Competitor, "reviewed_at">, now: Date): boolean {
  return competitorReviewState(competitor.reviewed_at, now) !== "fresh";
}

export function staleCompetitorCount(competitors: Pick<Competitor, "reviewed_at">[], now: Date): number {
  return competitors.reduce((total, competitor) => total + (isCompetitorReviewStale(competitor, now) ? 1 : 0), 0);
}

/**
 * Most relevant first, then the owner's manual order, then name. Lives here
 * rather than in the list component so it is testable outside a client file.
 */
export function sortCompetitors(list: Competitor[]): Competitor[] {
  return [...list].sort((a, b) =>
    (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
    || a.sort_order - b.sort_order
    || a.name.localeCompare(b.name),
  );
}
