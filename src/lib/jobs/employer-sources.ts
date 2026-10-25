import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { boundedResponseText } from "@/lib/bounded-response";
import { isJobUrl } from "./availability";
import { isCareerRelevant, matchRole } from "./filter";
import type { ScrapedJob } from "./types";

// Public employer APIs. Each employer is isolated so failures remain visible.
export const EMPLOYER_BOARDS = [
  { id: "ashby-sanity", provider: "ashby", slug: "sanity", name: "Sanity" },
  { id: "ashby-enode", provider: "ashby", slug: "Enode", name: "Enode" },
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
    .replace(/<[^>]*(?:>|$)/g, tag => tag.endsWith(">") ? " " : tag)
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 12000);

const optionalText = (maximum: number) => z.string().max(maximum).nullable().optional();
const EmployerRow = z.object({
  id: z.union([z.string().min(1).max(2048), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).optional(),
  title: optionalText(300), text: optionalText(300),
  jobUrl: optionalText(2048), hostedUrl: optionalText(2048), absolute_url: optionalText(2048),
  location: z.union([z.string().max(500), z.object({ name: optionalText(500) })]).nullable().optional(),
  secondaryLocations: z.array(z.object({ location: optionalText(500) })).max(50).optional(),
  categories: z.object({ location: optionalText(500), level: optionalText(200) }).nullable().optional(),
  descriptionPlain: optionalText(100_000), description: optionalText(100_000),
  descriptionHtml: optionalText(100_000), content: optionalText(100_000),
  compensation: z.object({ compensationTierSummary: optionalText(500) }).nullable().optional(),
  isListed: z.boolean().optional(), isRemote: z.boolean().optional(),
  workplaceType: optionalText(200), publishedAt: optionalText(100),
}).refine(row => {
  const url = row.jobUrl || row.hostedUrl || row.absolute_url || "";
  return !!(row.title || row.text)?.trim() && isJobUrl(url)
    && (row.id !== undefined || new URL(url).pathname.split("/").some(Boolean));
}).refine(row => {
  const primary = typeof row.location === "string" ? row.location : row.location?.name || row.categories?.location;
  return [primary, ...(row.secondaryLocations ?? []).map(value => value.location)].filter(Boolean).join(" / ").length <= 500;
});
const BoardSchema = z.object({
  id: z.string().min(1).max(140).regex(/^[A-Za-z0-9][A-Za-z0-9~_-]*$/),
  provider: z.enum(["ashby", "lever", "greenhouse"]),
  slug: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/), name: z.string().min(1).max(500),
});

export function normalizeEmployerJob(row: Row, board: { id: string; name: string }): ScrapedJob | null {
  const parsed = EmployerRow.safeParse(row);
  return parsed.success ? normalizeRow(parsed.data, board) : null;
}

function normalizeRow(
  row: Row,
  board: { id: string; name: string },
): ScrapedJob | null {
  if (row.isListed === false) return null;
  const title = str(row.title || row.text);
  const categories = obj(row.categories);
  const primaryLocation =
    str(obj(row.location).name) ||
    str(row.location) ||
    str(categories.location);
  const secondary = Array.isArray(row.secondaryLocations)
    ? row.secondaryLocations.map(value => str(obj(value).location)).filter(Boolean) : [];
  const location = [primaryLocation, ...secondary].filter(Boolean).join(" / ");
  const description = plain(
    row.descriptionPlain || row.description || row.descriptionHtml || row.content,
  );
  const role = matchRole(title, description);
  const url = str(row.jobUrl || row.hostedUrl || row.absolute_url);
  const externalId =
    str(row.id) ||
    (typeof row.id === "number" ? String(row.id) : new URL(url).pathname.split("/").filter(Boolean).pop());
  if (!role || !url || !externalId) return null;
  const job: ScrapedJob = {
    source: board.id,
    externalId,
    title,
    company: board.name,
    url,
    location: location || null,
    // Ashby's isRemote includes Hybrid. Both registered providers expose a
    // workplaceType; only explicit Remote establishes fully remote work.
    remote: str(row.workplaceType).trim().toLowerCase() === "remote",
    role,
    salary: str(obj(row.compensation).compensationTierSummary) || null,
    description,
    tags: [],
    seniority: str(categories.level) || null,
    postedAt: z.iso.datetime({ offset: true }).safeParse(row.publishedAt).success ? str(row.publishedAt) : null,
  };
  return isCareerRelevant(job) ? job : null;
}

/** Public discovery GETs only. The whole board shares one byte/time budget;
 * pagination cannot start another request after cancellation or expiry. */
export async function fetchEmployerBoard(input: Board, parent?: AbortSignal): Promise<ScrapedJob[]> {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(25_000), ...(parent ? [parent] : [])]);
  let consumed = 0;
  async function json(url: string): Promise<unknown> {
    signal.throwIfAborted();
    if (consumed >= 8 * 1024 * 1024) throw new Error("Employer feed unavailable");
    const requestLife = new AbortController();
    const requestSignal = AbortSignal.any([signal, requestLife.signal, AbortSignal.timeout(10_000)]);
    let response: Response | undefined;
    const discard = () => { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined); };
    try {
      const pending = fetch(url, { cache: "no-store", credentials: "omit", redirect: "error", signal: requestSignal })
        .then(value => { response = value; if (requestSignal.aborted) discard(); return value; });
      const result = await awaitWithSignal(pending, requestSignal);
      requestSignal.throwIfAborted();
      if (!result.ok) throw new Error("Employer feed unavailable");
      const text = await boundedResponseText(result, 8 * 1024 * 1024 - consumed, requestSignal);
      requestSignal.throwIfAborted();
      consumed += new TextEncoder().encode(text).byteLength;
      return JSON.parse(text);
    } finally { requestLife.abort(); discard(); }
  }
  try {
    signal.throwIfAborted();
    // Parse into fresh primitives before any await: a mutable caller cannot
    // redirect later pages or change their normalized source identity.
    const board = BoardSchema.parse(input);
    let rows: z.infer<typeof EmployerRow>[] = [];
    const slug = encodeURIComponent(board.slug);
    if (board.provider === "ashby" || board.provider === "greenhouse") {
      const url = board.provider === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`
        : `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
      const data = z.object({ jobs: z.array(EmployerRow).max(1000) }).parse(await json(url));
      rows = data.jobs;
    } else {
      for (let skip = 0; skip < 500; skip += 100) {
        signal.throwIfAborted();
        const page = z.array(EmployerRow).max(100).parse(await json(
          `https://api.lever.co/v0/postings/${slug}?mode=json&limit=100&skip=${skip}`,
        ));
        rows.push(...page);
        if (page.length < 100) break;
        if (skip === 400) throw new Error("Employer feed exceeded the pagination limit");
      }
    }
    signal.throwIfAborted();
    return rows.map(row => normalizeRow(row, board)).filter((job): job is ScrapedJob => job !== null);
  } catch {
    if (parent?.aborted) throw new DOMException("Request aborted", "AbortError");
    throw new Error("Employer feed unavailable");
  } finally { lifetime.abort(); }
}
