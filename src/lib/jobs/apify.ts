import "server-only";
import { isCareerRelevant, matchRole } from "./filter";
import { isJobUrl } from "./availability";
import type { ScrapedJob } from "./types";

/** Import only a completed, recent saved task. Never starts a paid Actor run. */
export async function fetchApifyTask(taskId: string): Promise<ScrapedJob[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not configured");
  const get = async (path: string) => {
    const r = await fetch(`https://api.apify.com/v2/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Apify responded ${r.status}`);
    return r.json();
  };
  const { data: run } = await get(
    `actor-tasks/${encodeURIComponent(taskId)}/runs/last?status=SUCCEEDED`,
  );
  const finished = Date.parse(run?.finishedAt);
  if (
    run?.status !== "SUCCEEDED" ||
    !Number.isFinite(finished) ||
    Date.now() - finished > 24 * 60 * 60 * 1000 ||
    !/^[a-zA-Z0-9]+$/.test(run.defaultDatasetId ?? "")
  )
    throw new Error("No successful task run in the past 24 hours");
  const rows = await get(
    `datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=1000`,
  );
  if (!Array.isArray(rows)) throw new Error("Invalid Apify dataset");
  return rows
    .map((row: Record<string, unknown>) =>
      normalizeApifyJob(row, taskId, run.finishedAt),
    )
    .filter((j): j is ScrapedJob => j !== null);
}

export function normalizeApifyJob(
  row: Record<string, unknown>,
  taskId: string,
  observedAt: string,
): ScrapedJob | null {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (
    row.isActive === false ||
    row.isExpired === true ||
    /closed|expired/i.test(s(row.jobState || row.status))
  )
    return null;
  const title = s(row.title || row.jobTitle || row.positionName);
  const description = s(
    row.descriptionText || row.description || row.jobDescription,
  )
    .replace(/<[^>]+>/g, " ")
    .slice(0, 12000);
  const role = matchRole(title, description);
  const url = s(row.url || row.jobUrl || row.link);
  if (!role || !isJobUrl(url)) return null;
  const companyValue = row.companyName || row.company;
  const company =
    typeof companyValue === "object" && companyValue
      ? s((companyValue as Record<string, unknown>).name)
      : s(companyValue);
  const job: ScrapedJob = {
    source: `apify-${taskId}`,
    externalId: s(row.id || row.jobId) || url,
    title,
    company: company || null,
    url,
    location: s(row.location || row.jobLocation) || null,
    remote:
      row.isRemote === true ||
      row.remote === true ||
      /remote/i.test(s(row.workplaceType)),
    role,
    salary: s(row.salary) || null,
    description,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((v): v is string => typeof v === "string")
      : [],
    seniority: s(row.seniorityLevel || row.seniority) || null,
    postedAt: s(row.postedAt || row.publishedAt) || null,
    observedAt,
  };
  return isCareerRelevant(job) ? job : null;
}

export function apifyTaskIds(): string[] {
  return (process.env.APIFY_JOB_TASK_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-zA-Z0-9~_-]+$/.test(s))
    .slice(0, 5);
}
