import { differenceInCalendarDays, parseISO } from "date-fns";
import { childProjects, groupPortfolio, isPortfolioProject } from "@/lib/portfolio";
import { projectEngagement } from "@/lib/projects";
import type { Competitor, Project } from "@/lib/types";

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
 * strict local-calendar parsing. Parsing it with `new Date()`
 * would read it as UTC midnight and drift the verdict by a day either side of
 * the boundary. A missing or malformed value is "never" rather than stale, so
 * the reader can tell "nobody has checked" from "checked, long ago".
 */
export function competitorReviewState(reviewedAt: string | null | undefined, now: Date): CompetitorReviewState {
  if (!reviewedAt || !DATE_ONLY.test(reviewedAt)) return "never";
  // parseISO rejects impossible days instead of normalizing February 31 into
  // March. It retains local midnight and the calendar-day/DST comparison.
  const days = differenceInCalendarDays(parseISO(reviewedAt), now);
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

/** Registry order and child ordering stay canonical. Index membership and
 * children once instead of scanning every project for every parent. */
export function competitionProjectOrder(projects: Project[], competitors: Competitor[]): Project[] {
  const active = projects.filter(project => project.is_active && (isPortfolioProject(project) || projectEngagement(project) === "client"));
  const withCompetitors = new Set(competitors.map(item => item.project_id));
  const children = new Map<string, Project[]>();
  for (const project of projects) if (project.parent_id) {
    const list = children.get(project.parent_id);
    if (list) list.push(project); else children.set(project.parent_id, [project]);
  }
  const ordered: Project[] = [], seen = new Set<string>();
  const add = (project: Project) => { if (!seen.has(project.id)) { seen.add(project.id); ordered.push(project); } };
  for (const group of groupPortfolio(active)) for (const project of group.projects) {
    add(project);
    for (const child of childProjects(children.get(project.id) ?? [], project.id)) add(child);
  }
  for (const project of projects) if (!seen.has(project.id) && withCompetitors.has(project.id)) add(project);
  return ordered;
}

export const COMPETITOR_PAGE_SIZE = 50;
/** Paging is local to the complete confirmed collection; it never authorizes a
 * capped server read or turns a missing project into discarded research. */
export function competitorPage<T>(rows: T[], requestedIndex: number) {
  const pages = Math.max(1, Math.ceil(rows.length / COMPETITOR_PAGE_SIZE));
  const index = Math.min(pages - 1, Number.isInteger(requestedIndex) && requestedIndex > 0 ? requestedIndex : 0);
  const start = index * COMPETITOR_PAGE_SIZE;
  return { index, items: rows.slice(start, start + COMPETITOR_PAGE_SIZE), from: rows.length ? start + 1 : 0, to: Math.min(rows.length, start + COMPETITOR_PAGE_SIZE), total: rows.length, pages };
}
