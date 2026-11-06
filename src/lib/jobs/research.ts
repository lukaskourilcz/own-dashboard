import { CZECH_JOBS, CZECH_RESEARCHED_ON } from "./czech-research";

/** Public-source research only. Personal letters live in owner-only Supabase
 * rows, never in this public repository. Dates are observations, not promises
 * that an employer will keep a vacancy open. */
export const RESEARCHED_ON = CZECH_RESEARCHED_ON;
export const STRONG_MATCH = 75;
/** Research older than this leaves the priority view for rechecking. */
export const RESEARCH_TTL_DAYS = 35;

export type Localized = { cs: string; en: string };
export type ResearchSource =
  | "LinkedIn"
  | "StartupJobs"
  | "Jobs.cz"
  | "Prace.cz"
  | "Cocuma"
  | "JobStack"
  | "Welcome to the Jungle"
  | "Employer"
  | "Other";

export type ResearchJob = {
  id: string;
  company: string;
  title: string;
  url: string;
  /** Other links to the same vacancy (aggregator copies, LinkedIn mirror). */
  aliases: string[];
  source: ResearchSource;
  location: string;
  arrangement: string;
  stack: string[];
  /** Stack /40, experience /25, domain /15, location /10, language /10. */
  points: [number, number, number, number, number];
  summary: Localized;
  evidence: Localized;
  gaps: Localized;
  stretch?: boolean;
  blocker?: boolean;
  salary?: string;
  deadline?: string;
  postedLabel?: string;
  needsRecheck?: boolean;
};

export const RESEARCH_JOBS: ResearchJob[] = CZECH_JOBS;

const MAX_POINTS = [40, 25, 15, 10, 10] as const;

export function researchScore(job: ResearchJob): number {
  const total = job.points.reduce(
    (sum, point, i) => sum + Math.max(0, Math.min(point, MAX_POINTS[i])),
    0,
  );
  // A missing working language caps harder than any other unresolved
  // mandatory requirement (degree, clearance, on-site in another city).
  return job.blocker ? Math.min(total, job.points[4] === 0 ? 49 : 59) : total;
}

export function canonicalJobUrl(value: string | null | undefined): string {
  try {
    const u = new URL(value ?? "");
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return value ?? "";
  }
}

export function researchForUrl(
  url: string | null | undefined,
): ResearchJob | undefined {
  const key = canonicalJobUrl(url);
  if (!key) return undefined;
  return RESEARCH_JOBS.find((job) =>
    [job.url, ...job.aliases].some((value) => canonicalJobUrl(value) === key),
  );
}

export function careerPositionKey(url: string | null | undefined): string {
  return researchForUrl(url)?.id ?? canonicalJobUrl(url);
}

export function researchIsStale(job: ResearchJob, now = new Date()): boolean {
  return (
    !!job.needsRecheck ||
    now.getTime() - Date.parse(RESEARCHED_ON) > RESEARCH_TTL_DAYS * 86400000 ||
    (!!job.deadline && now.toISOString().slice(0, 10) > job.deadline)
  );
}

/** B2B/IČO and fixed-term contracts are common in Czech IT. They are shown
 * under their own filter rather than mixed into full-time priorities. */
export function isContractRole(job: Pick<ResearchJob, "arrangement">): boolean {
  return /\b(b2b|contract|contractor|freelance|part-time|ičo|ico|živnost)/i.test(
    job.arrangement,
  );
}

export function isRemoteRole(job: Pick<ResearchJob, "location" | "arrangement">): boolean {
  return /remote|na dálku/i.test(`${job.location} ${job.arrangement}`);
}

export function isAiRole(job: Pick<ResearchJob, "title" | "stack">): boolean {
  return /\bai\b|llm|langchain|n8n|genai|agent/i.test(
    `${job.title} ${job.stack.join(" ")}`,
  );
}

export function isPriorityRole(job: ResearchJob, now = new Date()): boolean {
  return (
    researchScore(job) >= STRONG_MATCH &&
    !job.blocker &&
    !researchIsStale(job, now)
  );
}
