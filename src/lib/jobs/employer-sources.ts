import { isCareerRelevant, matchRole } from "./filter";
import type { ScrapedJob } from "./types";

// Public employer APIs. Each employer is isolated so failures remain visible.
export const EMPLOYER_BOARDS = [
  { id: "ashby-rossum", provider: "ashby", slug: "rossum.ai", name: "Rossum" },
  {
    id: "lever-outreach",
    provider: "lever",
    slug: "outreach",
    name: "Outreach",
  },
  { id: "ashby-apify", provider: "ashby", slug: "apify", name: "Apify" },
] as const;
type Board = {
  id: string;
  provider: "ashby" | "lever" | "greenhouse";
  slug: string;
  name: string;
};
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
const plain = (v: unknown) =>
  str(v)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 12000);

export function normalizeEmployerJob(
  row: Row,
  board: { id: string; name: string },
): ScrapedJob | null {
  if (row.isListed === false) return null;
  const title = str(row.title || row.text);
  const categories = obj(row.categories);
  const location =
    str(obj(row.location).name) ||
    str(row.location) ||
    str(categories.location);
  const description = plain(
    row.descriptionPlain || row.description || row.content,
  );
  const role = matchRole(title, description);
  const url = str(row.jobUrl || row.hostedUrl || row.absolute_url);
  const externalId =
    str(row.id) ||
    (typeof row.id === "number" ? String(row.id) : url.split("/").pop());
  if (!role || !url || !externalId) return null;
  const job: ScrapedJob = {
    source: board.id,
    externalId,
    title,
    company: board.name,
    url,
    location: location || null,
    remote:
      row.isRemote === true ||
      /remote/i.test(str(row.workplaceType) || location),
    role,
    salary: str(obj(row.compensation).compensationTierSummary) || null,
    description,
    tags: [],
    seniority: str(categories.level) || null,
    postedAt: str(row.publishedAt) || null,
  };
  return isCareerRelevant(job) ? job : null;
}

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Employer feed responded ${r.status}`);
  return r.json();
}

export async function fetchEmployerBoard(board: Board): Promise<ScrapedJob[]> {
  let rows: unknown[] = [];
  if (board.provider === "ashby") {
    const data = obj(
      await json(
        `https://api.ashbyhq.com/posting-api/job-board/${board.slug}?includeCompensation=true`,
      ),
    );
    if (!Array.isArray(data.jobs)) throw new Error("Invalid Ashby feed");
    rows = data.jobs;
  } else if (board.provider === "greenhouse") {
    const data = obj(
      await json(
        `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=true`,
      ),
    );
    if (!Array.isArray(data.jobs)) throw new Error("Invalid Greenhouse feed");
    rows = data.jobs;
  } else {
    for (let skip = 0; skip < 500; skip += 100) {
      const page = await json(
        `https://api.lever.co/v0/postings/${board.slug}?mode=json&limit=100&skip=${skip}`,
      );
      if (!Array.isArray(page)) throw new Error("Invalid Lever feed");
      rows.push(...page);
      if (page.length < 100) break;
      if (skip === 400)
        throw new Error("Employer feed exceeded the pagination limit");
    }
  }
  return rows
    .map((r) => normalizeEmployerJob(obj(r), board))
    .filter((j): j is ScrapedJob => j !== null);
}
