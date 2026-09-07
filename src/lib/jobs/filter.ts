import type { JobRole } from "./types";

// Pure classification helpers shared by every scraper source (and unit
// tested in isolation): which role bucket a job title falls into, and
// whether a free-text location is compatible with "remote from Europe".

// Titles that are clearly a different discipline, even when they contain a
// dev word ("QA Engineer", "Data Analyst", "Business Developer"…). Checked
// first so they can veto everything else. Czech variants included — the
// scraped boards are Czech-first.
const NEGATIVE =
  /\b(platform|reliability|infrastructure|architect|advocate|evangelist|qa|testers?|testing|tester(ka)?|devops|sre|data\s+(engineer|analyst|scientist)|analytik|analyst|security|embedded|hardware|hw|mobile|ios|android|salesforce|sap\b|business\s+develop|sales|marketing|recruit|designer|scrum|product\s+(manager|owner)|project\s+manager|support|helpdesk|consultant|konzultant|account\s+(manager|executive)|copywriter|obchodn)/i;

const FULLSTACK = /full[\s-]*stack/i;

// "Frontend"/"front-end" plus the common framework-titled roles
// ("React Developer", "Vue.js vývojář"…).
const FRONTEND = /front[\s-]*end|\b(react|next\.?js)\b/i;

// Generic software-engineering titles: a dev word together with either
// "software"/"web" or a backend-ish tech hint.
const DEV_WORD =
  /\b(engineer|engineering|developer|dev|programmer|inženýr|inzenyr|vývojář(ka)?|vyvojar(ka)?|programátor(ka)?|programator(ka)?)\b/i;
// Generic engineering signals (no specific language) + the JS/web ecosystem.
// Foreign-language hints are deliberately NOT here — they're vetoed below.
const TECH_HINT =
  /\b(software|web|javascript|typescript|node(\.?js)?|backend|back[\s-]*end|api)\b/i;

// Languages/stacks outside the tracked JS/TS/web skill set. A title dominated
// by one of these (Python, C++, C#, PHP, Go, Java, Ruby, …) is not relevant.
// c++/c#/.net carry non-word chars, so they're matched separately below.
const FOREIGN_LANG =
  /\b(python|django|flask|fastapi|php|laravel|symfony|drupal|wordpress|ruby|rails|golang|rust|scala|kotlin|swift|elixir|erlang|perl|haskell|clojure|groovy|dotnet|java)\b(?!script)/i;
const FOREIGN_SYMBOLIC =
  /(^|[^a-z0-9+#.])(c\+\+|c#|\.net|asp\.net|f#|objective-c)/i;

// Role classification stays broad enough to fetch a description. The final
// eligibility gate below is mandatory at ingestion and display boundaries.
export function matchRole(title: string, extra?: string): JobRole | null {
  const t = title.trim();
  if (
    !t ||
    /\bGo\b/.test(t) ||
    (/back[ -]?end/i.test(t) && !/full[ -]?stack|front[ -]?end/i.test(t)) ||
    NEGATIVE.test(t) ||
    FOREIGN_LANG.test(t) ||
    FOREIGN_SYMBOLIC.test(t) ||
    /\b(angular|vue(?:js)?|svelte|react\s+native|staff|principal|director|head\s+of)\b/i.test(
      t,
    )
  )
    return null;
  const wide = `${t} ${extra ?? ""}`;
  if (FULLSTACK.test(wide)) return "fullstack";
  if (FRONTEND.test(wide)) return "frontend";
  if (DEV_WORD.test(wide) && TECH_HINT.test(wide)) return "software";
  return null;
}

export function isPrague(location: string | null | undefined): boolean {
  return /\b(prague|praha|prag)\b/i.test(location ?? "");
}

export type CareerCandidate = {
  title: string;
  tags: string[];
  description: string | null;
  location: string | null;
  remote: boolean;
  seniority?: string | null;
};

/** Conservative personal search: React web + Prague or remote from Czechia.
 * Mixed off-stack requirements are excluded rather than promoted by JS keywords.
 * This measures evidence of relevance, never probability of getting hired.
 */
export function isCareerRelevant(job: CareerCandidate): boolean {
  const text = `${job.title} ${job.tags.join(" ")} ${job.description ?? ""}`;
  if (!matchRole(job.title, text)) return false;
  if (!/\b(react(?:\.js|js)?|next(?:\.js|js))\b/i.test(text)) return false;
  if (/\b(angular|vue(?:\.js|js)?|svelte|react\s+native)\b/i.test(text))
    return false;
  if (
    job.tags.some((tag) => /^go$/i.test(tag)) ||
    /\bGo\s+(?:backend|programming|developer|engineer)\b|\b(?:and|with|using)\s+Go\b/.test(
      text,
    )
  )
    return false;
  if (FOREIGN_LANG.test(text) || FOREIGN_SYMBOLIC.test(text)) return false;
  if (/\b(staff|principal|director|head\s+of)\b/i.test(job.seniority ?? ""))
    return false;
  // Explicit mandatory long experience is a stretch, not a credible daily lead.
  if (
    /\b(?:minimum|at least|required|alespoň|minimálně)\s+(?:[6-9]|\d{2})\+?\s*(?:years|let)/i.test(
      text,
    )
  )
    return false;
  if (isPrague(job.location)) return true;
  return job.remote && isCzechRemote(job.location);
}

export function isCzechRemote(location: string | null | undefined): boolean {
  const loc = location ?? "";
  if (/(?:except|excluding|not in)\s+(?:Czech|Česk)/i.test(loc)) return false;
  if (
    /\b(?:US|UK|Germany|France|Poland|Spain|Canada|Australia)[ -]only\b|only (?:in|within) (?:the )?(?:US|UK|Germany|France)/i.test(
      loc,
    )
  )
    return false;
  return /\b(czech(?:ia)?|europe|european union|EU|EMEA|worldwide|anywhere|global)\b|česk/i.test(
    loc,
  );
}

export function careerSeniority(
  job: Pick<CareerCandidate, "title" | "seniority">,
): "junior" | "medior" | "senior" | "unspecified" {
  const text = `${job.title} ${job.seniority ?? ""}`;
  if (/\b(senior|sr\.?)\b/i.test(text)) return "senior";
  if (/\b(junior|jr\.?|entry)\b/i.test(text)) return "junior";
  if (/\b(medior|mid(?:dle)?(?:-level)?)\b/i.test(text)) return "medior";
  return "unspecified";
}

// Explicit Europe signals: the region itself, EU/EMEA, timezone phrasing,
// and individual European countries (English + a few native spellings that
// show up on the boards). "česk…" is matched outside the \b group — JS word
// boundaries are ASCII-only, so \b never fires next to "č".
const EUROPE =
  /\b(europe|european|emea|eu\b|cet|cest|uk|united\s+kingdom|england|scotland|ireland|germany|deutschland|austria|switzerland|france|spain|portugal|italy|netherlands|belgium|luxembourg|denmark|sweden|norway|finland|iceland|poland|polska|czech(ia)?|cesk\w*|slovak\w*|slovensk\w*|hungary|romania|bulgaria|greece|croatia|slovenia|serbia|estonia|latvia|lithuania|ukraine|malta|cyprus)\b|česk/i;

// Regions that are explicitly NOT reachable from Europe. Only consulted
// when no Europe signal matched, so "Europe or US" still passes.
const NON_EUROPE =
  /\b(usa?|u\.s\.?a?\.?|united\s+states|north\s+america|america(s)?|canada|latam|latin\s+america|brazil|mexico|asia|apac|india|china|japan|australia|new\s+zealand|africa|middle\s+east)\b/i;

// "Open to anyone" phrasings — acceptable when nothing narrower is stated.
const GLOBAL_OK = /\b(worldwide|anywhere|global|international|remote)\b/i;

/**
 * Whether a location string is compatible with working remotely from
 * Europe. Explicit Europe mentions win; explicit other-region-only
 * restrictions lose; "worldwide"-style phrasings pass; anything unknown
 * fails closed. `emptyOk` lets remote-first boards (where a blank location
 * conventionally means unrestricted) treat missing text as worldwide.
 */
export function isEuropeFriendly(
  location: string | null | undefined,
  opts?: { emptyOk?: boolean },
): boolean {
  const loc = (location ?? "").trim();
  if (!loc) return opts?.emptyOk ?? false;
  if (EUROPE.test(loc)) return true;
  if (NON_EUROPE.test(loc)) return false;
  return GLOBAL_OK.test(loc);
}
