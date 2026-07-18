import { isEuropeFriendly, matchRole } from "./filter";
import type { ScrapedJob } from "./types";

/**
 * One module per job board, each normalizing into `ScrapedJob`. Every
 * source is best-effort: `fetchAllSources` isolates failures so one broken
 * board never takes the daily scrape down. The parsing helpers are pure
 * and exported for unit tests; only the `fetch*` functions touch the
 * network.
 *
 * Shapes were verified against the live endpoints (July 2026):
 * - startupjobs.cz  JSON  GET /api/offers?page=N (20/page, paginator.max)
 * - jobs.cz         HTML  GET /prace/?q[]=<term>  (SearchResultCard articles)
 * - prace.cz        HTML  GET /nabidky/?q=<term>  (advert-link job cards)
 * - remoteok.com    JSON  GET /api                (first element = legal note)
 * - remotive.com    JSON  GET /api/remote-jobs?category=software-dev
 * - arbeitnow.com   JSON  GET /api/job-board-api
 * - jobicy.com      JSON  GET /api/v2/remote-jobs?geo=europe
 * - weworkremotely  RSS   GET /categories/remote-programming-jobs.rss
 */

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
const API_UA = "own-dashboard-jobs (personal job tracker)";

const FETCH_TIMEOUT_MS = 12_000;

async function getText(
  url: string,
  ua: string = API_UA,
): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": ua, accept: "*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.text();
}

async function getJson<T>(url: string, ua: string = API_UA): Promise<T> {
  const text = await getText(url, ua);
  return JSON.parse(text) as T;
}

/** Minimal HTML entity decode for scraped text (named + numeric forms). */
export function unescapeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function clean(s: string | null | undefined): string | null {
  const t = s == null ? "" : unescapeHtml(s).replace(/\s+/g, " ").trim();
  return t ? t : null;
}

/** Longest description snippet we keep — enough for tech-stack matching
 * without bloating the row (matching only needs the keyword surface). */
const DESC_CAP = 1500;

/**
 * Turn a source's HTML/description blob into a capped plain-text snippet:
 * drop script/style, replace tags with spaces, decode entities, collapse
 * whitespace, and truncate. Returns null when nothing usable remains.
 */
export function htmlToText(html: string | null | undefined, cap = DESC_CAP): string | null {
  if (!html) return null;
  const text = unescapeHtml(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > cap ? text.slice(0, cap).trimEnd() : text;
}

/**
 * Drop tracking query params — keeps upsert URLs stable across scrapes.
 * Relative links resolve against `base` (some prace.cz cards link
 * company-page paths instead of absolute URLs).
 */
function stripQuery(url: string, base?: string): string {
  try {
    const u = new URL(url, base);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/* ======================================================================== *
 * startupjobs.cz — public JSON API used by their own SPA.                  *
 * ======================================================================== */

type StartupJobsItem = {
  id: number | string;
  name?: string;
  company?: string;
  url?: string;
  locations?: string;
  isRemote?: boolean;
  salary?: unknown;
  areaNames?: string[];
  mainAreaName?: string;
  seniorities?: string[];
};

type StartupJobsPage = {
  resultSet?: StartupJobsItem[];
  paginator?: { current?: number; max?: number };
};

/** Render startupjobs' salary field (null | string | {from,to,currency}). */
export function startupJobsSalary(salary: unknown): string | null {
  if (!salary) return null;
  if (typeof salary === "string") return clean(salary);
  if (typeof salary === "object") {
    const o = salary as Record<string, unknown>;
    const nums = [o.from ?? o.min, o.to ?? o.max].filter(
      (v): v is number => typeof v === "number" && v > 0,
    );
    if (nums.length === 0) return null;
    const cur = typeof o.currency === "string" ? ` ${o.currency}` : "";
    return `${nums.map((n) => n.toLocaleString("cs-CZ")).join(" – ")}${cur}`;
  }
  return null;
}

export function normalizeStartupJobsItem(
  item: StartupJobsItem,
): ScrapedJob | null {
  const title = clean(item.name);
  if (!title || item.id == null) return null;
  // Only remote-capable offers qualify; Czech board ⇒ European by location.
  if (item.isRemote !== true) return null;
  const areas = [item.mainAreaName, ...(item.areaNames ?? [])]
    .filter(Boolean)
    .join(" ");
  const role = matchRole(title, areas);
  if (!role) return null;
  return {
    source: "startupjobs",
    externalId: String(item.id),
    title,
    company: clean(item.company),
    url: item.url?.startsWith("http")
      ? item.url
      : `https://www.startupjobs.cz${item.url ?? `/nabidka/${item.id}`}`,
    location: clean(item.locations) ?? "Czechia",
    remote: true,
    role,
    salary: startupJobsSalary(item.salary),
    description: null, // list endpoint carries no body; title+tags drive fit
    tags: (item.areaNames ?? []).map((a) => a.trim()).filter(Boolean),
    seniority: clean((item.seniorities ?? []).join(", ")),
    postedAt: null,
  };
}

const STARTUPJOBS_MAX_PAGES = 30;

async function fetchStartupJobs(): Promise<ScrapedJob[]> {
  const first = await getJson<StartupJobsPage>(
    "https://www.startupjobs.cz/api/offers",
  );
  const pages = Math.min(first.paginator?.max ?? 1, STARTUPJOBS_MAX_PAGES);
  const items: StartupJobsItem[] = [...(first.resultSet ?? [])];
  // Fetch the remaining pages in small parallel batches to stay polite.
  const BATCH = 6;
  for (let start = 2; start <= pages; start += BATCH) {
    const nums = [];
    for (let p = start; p < start + BATCH && p <= pages; p++) nums.push(p);
    const results = await Promise.allSettled(
      nums.map((p) =>
        getJson<StartupJobsPage>(
          `https://www.startupjobs.cz/api/offers?page=${p}`,
        ),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") items.push(...(r.value.resultSet ?? []));
    }
  }
  return items
    .map(normalizeStartupJobsItem)
    .filter((j): j is ScrapedJob => j !== null);
}

/* ======================================================================== *
 * jobs.cz + prace.cz — server-rendered HTML (both AlmaCareer/LMC boards).  *
 * Neither exposes a remote-work URL filter, so the remote requirement is  *
 * pushed into the full-text query itself: "<role> remote" / "<role> z     *
 * domova" AND-matches ads that mention remote work anywhere in the text.  *
 * ======================================================================== */

// Query terms: tracked roles × remote markers (English + Czech).
const CZ_ROLE_TERMS = [
  "frontend",
  "fullstack",
  "full stack",
  "software engineer",
  "vývojář",
];
const CZ_REMOTE_MARKERS = ["remote", "z domova"];

function czQueries(): string[] {
  return CZ_ROLE_TERMS.flatMap((role) =>
    CZ_REMOTE_MARKERS.map((marker) => `${role} ${marker}`),
  );
}

const CZECH_MONTHS: Record<string, number> = {
  ledna: 1,
  února: 2,
  unora: 2,
  března: 3,
  brezna: 3,
  dubna: 4,
  května: 5,
  kvetna: 5,
  června: 6,
  cervna: 6,
  července: 7,
  cervence: 7,
  srpna: 8,
  září: 9,
  zari: 9,
  října: 10,
  rijna: 10,
  listopadu: 11,
  prosince: 12,
};

/**
 * Parse jobs.cz-style posting dates ("19. června", "dnes", "včera") into an
 * ISO timestamp. A day-month in the future rolls back a year (the boards
 * only show past dates). Unknown text → null.
 */
export function parseCzechDate(text: string, now: Date = new Date()): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const midnightUtc = (y: number, m: number, d: number) =>
    new Date(Date.UTC(y, m - 1, d)).toISOString();
  if (t.includes("dnes")) {
    return midnightUtc(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  }
  if (t.includes("včera") || t.includes("vcera")) {
    const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return midnightUtc(y.getUTCFullYear(), y.getUTCMonth() + 1, y.getUTCDate());
  }
  const m = t.match(/(\d{1,2})\.\s*([a-záéěíóúůýžščřď]+)/i);
  if (!m) return null;
  const month = CZECH_MONTHS[m[2]];
  if (!month) return null;
  const day = Number(m[1]);
  let year = now.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  if (candidate > now.getTime()) year -= 1;
  return midnightUtc(year, month, day);
}

/** Parse the SearchResultCard articles out of a jobs.cz result page. */
export function parseJobsCzCards(
  html: string,
  now: Date = new Date(),
): ScrapedJob[] {
  const jobs: ScrapedJob[] = [];
  const cards = html.match(
    /<article[^>]*class="[^"]*SearchResultCard[^"]*"[\s\S]*?<\/article>/g,
  );
  for (const card of cards ?? []) {
    const id = card.match(/data-jobad-id="(\d+)"/)?.[1];
    const title = clean(card.match(/data-test-ad-title="([^"]*)"/)?.[1]);
    const href =
      card.match(/<a[^>]*href="([^"]+)"[^>]*SearchResultCard__titleLink/)?.[1] ??
      card.match(/SearchResultCard__titleLink[^>]*href="([^"]+)"/)?.[1];
    if (!id || !title || !href) continue;
    const role = matchRole(title);
    if (!role) continue;

    const company = clean(card.match(/<img[^>]*alt="([^"]+)"/)?.[1]);
    const footerItems = [
      ...card.matchAll(
        /SearchResultCard__footerItem"\s*>\s*(?:<svg[\s\S]*?<\/svg>)?\s*([^<]+)/g,
      ),
    ]
      .map((m) => clean(m[1]))
      .filter((s): s is string => s !== null);
    const salary = footerItems.find((s) => /kč|eur|€/i.test(s)) ?? null;
    const location =
      footerItems.find((s) => s !== salary) ?? null;
    const status = clean(
      card.match(/SearchResultCard__status[^>]*>\s*([^<]+)/)?.[1],
    );

    jobs.push({
      source: "jobscz",
      externalId: id,
      title,
      company,
      url: stripQuery(unescapeHtml(href)),
      location,
      // The search query itself carried the remote marker, so every match
      // advertises remote work somewhere in the ad.
      remote: true,
      role,
      salary,
      description: null, // result cards carry no body text
      tags: [],
      seniority: null,
      postedAt: status ? parseCzechDate(status, now) : null,
    });
  }
  return jobs;
}

async function fetchJobsCz(): Promise<ScrapedJob[]> {
  const byId = new Map<string, ScrapedJob>();
  const results = await Promise.allSettled(
    czQueries().map((q) =>
      getText(
        `https://www.jobs.cz/prace/?q%5B%5D=${encodeURIComponent(q)}`,
        BROWSER_UA,
      ),
    ),
  );
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const job of parseJobsCzCards(r.value)) byId.set(job.externalId, job);
  }
  return [...byId.values()];
}

/** Parse the JobCard articles out of a prace.cz result page. */
export function parsePraceCzCards(html: string): ScrapedJob[] {
  const jobs: ScrapedJob[] = [];
  const cards = html.match(
    /<article id="advert-[^"]+"[\s\S]*?<\/article>/g,
  );
  for (const card of cards ?? []) {
    const id = card.match(/<article id="advert-([^"]+)"/)?.[1];
    const link = card.match(
      /data-testid="advert-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    );
    // The card contains the same advert-link twice (wrapper + title); the
    // title one has plain text content.
    const titleLink = card.match(
      /data-testid="job-card-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/,
    );
    const href = titleLink?.[1] ?? link?.[1];
    const title = clean(titleLink?.[2]);
    if (!id || !title || !href) continue;
    const role = matchRole(title);
    if (!role) continue;

    const field = (label: string) =>
      clean(
        card.match(
          new RegExp(
            `accessibility-hidden">${label}(?:<!-- -->)?:<\\/span><span[^>]*>([^<]+)`,
          ),
        )?.[1],
      );
    const location = field("Lokalita");
    const company = field("Název firmy");
    const salary =
      field("Mzda") ??
      field("Plat") ??
      clean(card.match(/>([^<]*\d[^<]*Kč[^<]*)</)?.[1]);

    jobs.push({
      source: "pracecz",
      externalId: id,
      title,
      company,
      url: stripQuery(unescapeHtml(href), "https://www.prace.cz"),
      location,
      remote: true,
      role,
      salary,
      description: null, // result cards carry no body text
      tags: [],
      seniority: null,
      postedAt: null,
    });
  }
  return jobs;
}

async function fetchPraceCz(): Promise<ScrapedJob[]> {
  const byId = new Map<string, ScrapedJob>();
  const results = await Promise.allSettled(
    czQueries().map((q) =>
      getText(
        `https://www.prace.cz/nabidky/?q=${encodeURIComponent(q)}`,
        BROWSER_UA,
      ),
    ),
  );
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const job of parsePraceCzCards(r.value)) byId.set(job.externalId, job);
  }
  return [...byId.values()];
}

/* ======================================================================== *
 * remoteok.com — public JSON API. First array element is a legal notice   *
 * (attribution: we store and link the original remoteok.com URL).         *
 * ======================================================================== */

type RemoteOkItem = {
  id?: string | number;
  slug?: string;
  position?: string;
  company?: string;
  location?: string;
  tags?: string[];
  url?: string;
  apply_url?: string;
  date?: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
};

export function normalizeRemoteOkItem(item: RemoteOkItem): ScrapedJob | null {
  const title = clean(item.position);
  if (!title || item.id == null) return null;
  // RemoteOK is remote-by-definition; a blank location means unrestricted.
  if (!isEuropeFriendly(item.location, { emptyOk: true })) return null;
  // Title-only role match: RemoteOK tags are broad/noisy ("dev", "digital
  // nomad") and would rescue clearly non-engineering titles.
  const role = matchRole(title);
  if (!role) return null;
  const nums = [item.salary_min, item.salary_max].filter(
    (v): v is number => typeof v === "number" && v > 0,
  );
  return {
    source: "remoteok",
    externalId: String(item.id),
    title,
    company: clean(item.company),
    url: item.url ?? `https://remoteok.com/remote-jobs/${item.slug ?? item.id}`,
    location: clean(item.location) ?? "Worldwide",
    remote: true,
    role,
    salary: nums.length
      ? nums.map((n) => `$${Math.round(n / 1000)}k`).join(" – ")
      : null,
    description: htmlToText(item.description),
    tags: (item.tags ?? []).slice(0, 8),
    seniority: null,
    postedAt: item.date ?? null,
  };
}

async function fetchRemoteOk(): Promise<ScrapedJob[]> {
  const items = await getJson<RemoteOkItem[]>("https://remoteok.com/api");
  return items
    .filter((i) => i && i.id != null)
    .map(normalizeRemoteOkItem)
    .filter((j): j is ScrapedJob => j !== null);
}

/* ======================================================================== *
 * remotive.com — public JSON API, software-dev category.                   *
 * ======================================================================== */

type RemotiveJob = {
  id?: number | string;
  url?: string;
  title?: string;
  company_name?: string;
  tags?: string[];
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
};

export function normalizeRemotiveItem(job: RemotiveJob): ScrapedJob | null {
  const title = clean(job.title);
  if (!title || job.id == null || !job.url) return null;
  if (!isEuropeFriendly(job.candidate_required_location)) return null;
  const role = matchRole(title, (job.tags ?? []).join(" "));
  if (!role) return null;
  return {
    source: "remotive",
    externalId: String(job.id),
    title,
    company: clean(job.company_name),
    url: job.url,
    location: clean(job.candidate_required_location),
    remote: true,
    role,
    salary: clean(job.salary),
    description: htmlToText(job.description),
    tags: (job.tags ?? []).slice(0, 8),
    seniority: null,
    postedAt: job.publication_date ?? null,
  };
}

async function fetchRemotive(): Promise<ScrapedJob[]> {
  const data = await getJson<{ jobs?: RemotiveJob[] }>(
    "https://remotive.com/api/remote-jobs?category=software-dev",
  );
  return (data.jobs ?? [])
    .map(normalizeRemotiveItem)
    .filter((j): j is ScrapedJob => j !== null);
}

/* ======================================================================== *
 * arbeitnow.com — public JSON API; German/EU board, so location is        *
 * European by construction. Only `remote: true` rows qualify.             *
 * ======================================================================== */

type ArbeitnowJob = {
  slug?: string;
  company_name?: string;
  title?: string;
  remote?: boolean;
  url?: string;
  description?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
};

export function normalizeArbeitnowItem(job: ArbeitnowJob): ScrapedJob | null {
  const title = clean(job.title);
  if (!title || !job.slug || !job.url) return null;
  if (job.remote !== true) return null;
  const role = matchRole(title, (job.tags ?? []).join(" "));
  if (!role) return null;
  return {
    source: "arbeitnow",
    externalId: job.slug,
    title,
    company: clean(job.company_name),
    url: job.url,
    location: clean(job.location) ?? "Germany / EU",
    remote: true,
    role,
    salary: null,
    description: htmlToText(job.description),
    tags: (job.tags ?? []).slice(0, 8),
    seniority: null,
    postedAt:
      typeof job.created_at === "number"
        ? new Date(job.created_at * 1000).toISOString()
        : null,
  };
}

async function fetchArbeitnow(): Promise<ScrapedJob[]> {
  const data = await getJson<{ data?: ArbeitnowJob[] }>(
    "https://www.arbeitnow.com/api/job-board-api",
  );
  return (data.data ?? [])
    .map(normalizeArbeitnowItem)
    .filter((j): j is ScrapedJob => j !== null);
}

/* ======================================================================== *
 * jobicy.com — public JSON API with a server-side Europe geo filter.       *
 * ======================================================================== */

type JobicyJob = {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobGeo?: string;
  jobIndustry?: string[];
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  annualSalaryMin?: number | string;
  annualSalaryMax?: number | string;
  salaryCurrency?: string;
};

export function normalizeJobicyItem(job: JobicyJob): ScrapedJob | null {
  const title = clean(job.jobTitle);
  if (!title || job.id == null || !job.url) return null;
  const role = matchRole(title, (job.jobIndustry ?? []).join(" "));
  if (!role) return null;
  const nums = [job.annualSalaryMin, job.annualSalaryMax]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  return {
    source: "jobicy",
    externalId: String(job.id),
    title,
    company: clean(job.companyName),
    url: job.url,
    // The ?geo=europe query pre-filters; jobGeo "Anywhere" also qualifies.
    location: clean(job.jobGeo) ?? "Europe",
    remote: true,
    role,
    salary: nums.length
      ? `${nums.map((n) => n.toLocaleString("en-US")).join(" – ")}${
          job.salaryCurrency ? ` ${job.salaryCurrency}` : ""
        }`
      : null,
    description: htmlToText(job.jobDescription ?? job.jobExcerpt),
    tags: (job.jobIndustry ?? []).map(unescapeHtml).slice(0, 8),
    seniority: clean(job.jobLevel),
    postedAt: job.pubDate ?? null,
  };
}

async function fetchJobicy(): Promise<ScrapedJob[]> {
  const data = await getJson<{ jobs?: JobicyJob[] }>(
    "https://jobicy.com/api/v2/remote-jobs?geo=europe&count=100",
  );
  return (data.jobs ?? [])
    .map(normalizeJobicyItem)
    .filter((j): j is ScrapedJob => j !== null);
}

/* ======================================================================== *
 * weworkremotely.com — RSS feed of the programming category.               *
 * ======================================================================== */

function rssTag(item: string, tag: string): string | null {
  const m = item.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  if (!m) return null;
  return clean(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

/** Parse the <item> entries out of a We Work Remotely RSS feed. */
export function parseWwrItems(xml: string): ScrapedJob[] {
  const jobs: ScrapedJob[] = [];
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const rawTitle = rssTag(item, "title");
    const link = rssTag(item, "link");
    const region = rssTag(item, "region");
    if (!rawTitle || !link) continue;
    if (!isEuropeFriendly(region, { emptyOk: true })) continue;
    // Titles come as "Company: Job Title".
    const sep = rawTitle.indexOf(": ");
    const company = sep > 0 ? rawTitle.slice(0, sep) : null;
    const title = sep > 0 ? rawTitle.slice(sep + 2) : rawTitle;
    // Title-only: the feed-wide category ("Full-Stack Programming") would
    // otherwise rescue every non-engineering title in the feed.
    const role = matchRole(title);
    if (!role) continue;
    const pubDate = rssTag(item, "pubDate");
    const parsedDate = pubDate ? new Date(pubDate) : null;
    jobs.push({
      source: "weworkremotely",
      externalId:
        rssTag(item, "guid") ?? link.split("/").filter(Boolean).pop() ?? link,
      title,
      company,
      url: link,
      location: region ?? "Anywhere",
      remote: true,
      role,
      salary: null,
      description: htmlToText(rssTag(item, "description")),
      tags: [],
      seniority: null,
      postedAt:
        parsedDate && !Number.isNaN(parsedDate.getTime())
          ? parsedDate.toISOString()
          : null,
    });
  }
  return jobs;
}

async function fetchWeWorkRemotely(): Promise<ScrapedJob[]> {
  const xml = await getText(
    "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  );
  return parseWwrItems(xml);
}

/* ======================================================================== */

export type JobSource = {
  id: string;
  label: string;
  fetch: () => Promise<ScrapedJob[]>;
};

export const JOB_SOURCES: JobSource[] = [
  { id: "startupjobs", label: "StartupJobs.cz", fetch: fetchStartupJobs },
  { id: "jobscz", label: "Jobs.cz", fetch: fetchJobsCz },
  { id: "pracecz", label: "Prace.cz", fetch: fetchPraceCz },
  { id: "remoteok", label: "Remote OK", fetch: fetchRemoteOk },
  { id: "remotive", label: "Remotive", fetch: fetchRemotive },
  { id: "arbeitnow", label: "Arbeitnow", fetch: fetchArbeitnow },
  { id: "jobicy", label: "Jobicy", fetch: fetchJobicy },
  { id: "weworkremotely", label: "We Work Remotely", fetch: fetchWeWorkRemotely },
];
