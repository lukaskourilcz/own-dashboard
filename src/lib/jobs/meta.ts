// Client-safe display metadata for the Jobs section — kept apart from
// sources.ts so the panel never bundles the scraper code.

/** Human labels keyed by scraper source id. */
export const JOB_SOURCE_LABELS: Record<string, string> = {
  startupjobs: "StartupJobs.cz",
  jobscz: "Jobs.cz",
  pracecz: "Prace.cz",
  remoteok: "Remote OK",
  remotive: "Remotive",
  arbeitnow: "Arbeitnow",
  jobicy: "Jobicy",
  weworkremotely: "We Work Remotely",
};

export function jobSourceLabel(source: string): string {
  return JOB_SOURCE_LABELS[source] ?? source;
}
