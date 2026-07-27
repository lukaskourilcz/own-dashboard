// Client-safe display metadata for the Jobs section — kept apart from
// sources.ts so the panel never bundles the scraper code. `sources.ts` reads
// its labels from here, so a board is described in exactly one place.

/** How a board hands us its data. Shown in the panel's source list. */
export type JobSourceKind = "json" | "html" | "rss";

export type JobSourceMeta = {
  /** Human label. */
  label: string;
  /** Transport, so it is obvious which sources are real APIs. */
  kind: JobSourceKind;
  /** Endpoint the scraper calls, verified against the live boards (July 2026). */
  endpoint: string;
  /** Where a human can browse the same board. */
  site: string;
  /** What the scraper asks this board for. */
  scope: { en: string; cs: string };
  /**
   * True when one successful fetch returns the board's entire current set, so
   * a listing missing from the response has genuinely been taken down. False
   * for paginated or query-limited sources, where a live offer can simply fall
   * out of the slice we read — those need an HTTP liveness check before any
   * deletion. See `prune.ts`.
   */
  complete: boolean;
};

export const JOB_SOURCE_META: Record<string, JobSourceMeta> = {
  startupjobs: {
    label: "StartupJobs.cz",
    kind: "json",
    endpoint: "https://www.startupjobs.cz/api/offers",
    site: "https://www.startupjobs.cz",
    scope: {
      en: "Czech startup board, remote-flagged offers only",
      cs: "Český startupový portál, jen nabídky označené jako remote",
    },
    // Paginated: capped at 30 pages of 20.
    complete: false,
  },
  jobscz: {
    label: "Jobs.cz",
    kind: "html",
    endpoint: "https://www.jobs.cz/prace/?q[]=<role>+remote",
    site: "https://www.jobs.cz",
    scope: {
      en: "Full-text search per role, remote required in the query",
      cs: "Fulltextové hledání podle role, remote je součástí dotazu",
    },
    // Only the first result page per query.
    complete: false,
  },
  pracecz: {
    label: "Prace.cz",
    kind: "html",
    endpoint: "https://www.prace.cz/nabidky/?q=<role>+remote",
    site: "https://www.prace.cz",
    scope: {
      en: "Full-text search per role, remote required in the query",
      cs: "Fulltextové hledání podle role, remote je součástí dotazu",
    },
    // Only the first result page per query.
    complete: false,
  },
  remoteok: {
    label: "Remote OK",
    kind: "json",
    endpoint: "https://remoteok.com/api",
    site: "https://remoteok.com",
    scope: {
      en: "Remote-only board, filtered to Europe-friendly locations",
      cs: "Výhradně remote portál, filtrováno na lokality vstřícné k Evropě",
    },
    // One endpoint returns the whole live board.
    complete: true,
  },
  remotive: {
    label: "Remotive",
    kind: "json",
    endpoint: "https://remotive.com/api/remote-jobs?category=software-dev",
    site: "https://remotive.com",
    scope: {
      en: "Software-development category, Europe-friendly locations",
      cs: "Kategorie vývoj softwaru, lokality vstřícné k Evropě",
    },
    // The category endpoint returns every current job.
    complete: true,
  },
  arbeitnow: {
    label: "Arbeitnow",
    kind: "json",
    endpoint: "https://www.arbeitnow.com/api/job-board-api",
    site: "https://www.arbeitnow.com",
    scope: {
      en: "German and EU board, remote-flagged offers only",
      cs: "Německý a EU portál, jen nabídky označené jako remote",
    },
    // One endpoint returns the whole live board.
    complete: true,
  },
  jobicy: {
    label: "Jobicy",
    kind: "json",
    endpoint: "https://jobicy.com/api/v2/remote-jobs?geo=europe",
    site: "https://jobicy.com",
    scope: {
      en: "Remote board with a server-side Europe filter",
      cs: "Remote portál se serverovým filtrem na Evropu",
    },
    // Capped at count=100.
    complete: false,
  },
  weworkremotely: {
    label: "We Work Remotely",
    kind: "rss",
    endpoint:
      "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    site: "https://weworkremotely.com",
    scope: {
      en: "Programming category feed, Europe-friendly regions",
      cs: "Feed kategorie programování, regiony vstřícné k Evropě",
    },
    // The feed carries the whole category.
    complete: true,
  },
};

/** Human labels keyed by scraper source id. */
export const JOB_SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(JOB_SOURCE_META).map(([id, meta]) => [id, meta.label]),
);

export function jobSourceLabel(source: string): string {
  return JOB_SOURCE_META[source]?.label ?? source;
}
