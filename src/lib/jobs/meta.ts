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
  'ashby-apify': {label:'Apify · Careers', kind:'json', endpoint:'https://api.ashbyhq.com/posting-api/job-board/apify', site:'https://apify.com/jobs', complete:false, scope:{en:'Direct employer feed, React roles in Prague or remote from Czechia',cs:'Přímý zdroj zaměstnavatele, React v Praze nebo na dálku z Česka'}},
  'ashby-rossum': {label:'Rossum · Careers', kind:'json', endpoint:'https://api.ashbyhq.com/posting-api/job-board/rossum.ai', site:'https://jobs.ashbyhq.com/rossum.ai', complete:false, scope:{en:'Direct employer feed with full descriptions',cs:'Přímý zdroj zaměstnavatele s plnými popisy'}},
  'lever-outreach': {label:'Outreach · Careers', kind:'json', endpoint:'https://api.lever.co/v0/postings/outreach?mode=json', site:'https://jobs.lever.co/outreach', complete:false, scope:{en:'Direct employer feed, Prague and eligible remote roles',cs:'Přímý zdroj zaměstnavatele, Praha a vhodná práce na dálku'}},
  startupjobs: {
    label: "StartupJobs.cz",
    kind: "json",
    endpoint: "https://www.startupjobs.cz/api/offers",
    site: "https://www.startupjobs.cz",
    scope: {
      en: "React roles in Prague and remote Czech roles",
      cs: "React pozice v Praze a vzdálená práce z Česka",
    },
    // Paginated: bounded discovery slice.
    complete: false,
  },
  jobscz: {
    label: "Jobs.cz",
    kind: "html",
    endpoint: "https://www.jobs.cz/prace/?q[]=<role>+remote",
    site: "https://www.jobs.cz",
    scope: {
      en: "React search covering Prague and remote",
      cs: "Hledání React pozic v Praze a na dálku",
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
      en: "React search covering Prague and remote",
      cs: "Hledání React pozic v Praze a na dálku",
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
    // Rolling/paginated feed: absence is not closure evidence.
    complete: false,
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
    // Treat omission conservatively, even for a successful category response.
    complete: false,
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
    // Rolling/paginated feed: absence is not closure evidence.
    complete: false,
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
    // RSS may be a rolling window rather than the full live category.
    complete: false,
  },
};

/** Human labels keyed by scraper source id. */
export const JOB_SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(JOB_SOURCE_META).map(([id, meta]) => [id, meta.label]),
);

export function jobSourceLabel(source: string): string {
  return JOB_SOURCE_META[source]?.label ?? source;
}
