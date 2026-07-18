// Shared shapes for the Jobs feature. `ScrapedJob` is the normalized output
// every source fetcher produces; the orchestrator maps it onto the
// `job_listings` row shape (snake_case) when upserting.

export type JobRole = "frontend" | "fullstack" | "software";

export type ScrapedJob = {
  /** Scraper source id, e.g. "startupjobs", "jobscz", "remoteok". */
  source: string;
  /** The source's own id/slug — upsert key together with `source`. */
  externalId: string;
  title: string;
  company: string | null;
  /** Absolute link to the original posting. */
  url: string;
  /** Raw location string as scraped ("Praha", "Europe, UK", "Anywhere"…). */
  location: string | null;
  remote: boolean;
  role: JobRole;
  salary: string | null;
  /** Plain-text description snippet (HTML stripped, capped), when the source
   * exposes one — powers tech-stack fit matching. Null on boards that don't. */
  description: string | null;
  tags: string[];
  seniority: string | null;
  /** ISO timestamp of the source-reported publish date, when known. */
  postedAt: string | null;
};

export type SourceOutcome = { count: number; error?: string };

export type ScrapeSummary = {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  inserted: number;
  refreshed: number;
  pruned: number;
  sources: Record<string, SourceOutcome>;
};
