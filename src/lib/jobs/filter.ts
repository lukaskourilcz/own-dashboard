import type { JobRole } from "./types";

// Pure classification helpers shared by every scraper source (and unit
// tested in isolation): which role bucket a job title falls into, and
// whether a free-text location is compatible with "remote from Europe".

// Titles that are clearly a different discipline, even when they contain a
// dev word ("QA Engineer", "Data Analyst", "Business Developer"…). Checked
// first so they can veto everything else. Czech variants included — the
// scraped boards are Czech-first.
const NEGATIVE =
  /\b(advocate|evangelist|qa|testers?|testing|tester(ka)?|data\s+(analyst|scientist)|analytik|analyst|embedded|hardware|hw|mobile|ios|android|salesforce|sap\b|business\s+develop|sales|marketing|recruit|designer|scrum|product\s+(manager|owner)|project\s+manager|support|helpdesk|account\s+(manager|executive)|copywriter|obchodn)/i;

const FULLSTACK = /full[\s-]*stack/i;

// "Frontend"/"front-end" plus the common framework-titled roles
// ("React Developer", "Vue.js vývojář"…).
const FRONTEND = /front[\s-]*end|\b(react|next\.?js|vue(?:\.js)?|angular|svelte(?:kit)?)\b/i;

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
    NEGATIVE.test(t) ||
    ((FOREIGN_LANG.test(t) || FOREIGN_SYMBOLIC.test(t) || /\bGo\b/.test(t)) &&
      !/typescript|javascript|react|node|full[ -]?stack/i.test(`${t} ${extra ?? ""}`))
  )
    return null;
  const wide = `${t} ${extra ?? ""}`;
  if (/\breact\s+native\b/i.test(t) && !/\breact(?:\.js|js)?\b|next\.?(?:js)/i.test(wide.replace(/\breact\s+native\b/gi, " "))) return null;
  if (FULLSTACK.test(wide)) return "fullstack";
  if (FRONTEND.test(wide)) return "frontend";
  if (/\b(ai|integration|automation|growth)\b/i.test(t) && DEV_WORD.test(t)) return "software";
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

/** Discovery stays broad: adjacent stacks and seniority are assessed in the
 * detail view, never silently discarded. This is not a hiring prediction. */
export function isCareerRelevant(job: CareerCandidate): boolean {
  const text = `${job.title} ${job.tags.join(" ")} ${job.description ?? ""}`;
  if (!matchRole(job.title, text)) return false;
  // React Native may be a secondary part of a web role. Remove those words
  // before checking for an independent React/Next.js web signal, so mobile-
  // only roles stay out while owner-selected mixed web/mobile roles survive.
  const webText = text.replace(/\breact\s+native\b/gi, " ");
  if (!/\b(react(?:\.js|js)?|next(?:\.js|js)|typescript|javascript|node(?:\.js)?|n8n|langchain|svelte)\b/i.test(webText)) return false;
  if (isOsloRelevant(job)) return true;
  if (isPrague(job.location)) return true;
  return job.remote && isCzechRemote(job.location);
}

export function isOslo(location: string | null | undefined): boolean {
  return /\b(oslo|fornebu|lysaker|høvik|hovik|sandvika|asker|lillestrøm|baerum|bærum)\b/i.test(location ?? "");
}

export function isNorwayRemote(location: string | null | undefined): boolean {
  const loc = location ?? "";
  if (/(?:except|excluding|not in)\s+(?:norway|norge)/i.test(loc)) return false;
  if (/\b(?:US|UK|Germany|France|Poland|Spain|Czechia|Canada|Australia|EU)[ -]only\b|only (?:in|within) (?:the )?(?:US|UK|Germany|France|EU)\b/i.test(loc)) return false;
  // Norway is in the EEA, not the EU. EU-only is deliberately insufficient.
  return /\b(norway|norge|europe|EEA|EMEA|worldwide|anywhere|global)\b/i.test(loc);
}

export function isOsloRelevant(job: Pick<CareerCandidate, "location" | "remote">): boolean {
  return isOslo(job.location) || (job.remote && isNorwayRemote(job.location));
}

/** Explicit snapshot evidence takes precedence. Unknown legacy snapshots retain
 * the remote-only-source/text fallback; geography alone establishes nothing. */
export function snapshotRemote(job: { location: string | null; source: string | null; remote?: boolean | null }): boolean {
  if (typeof job.remote === "boolean") return job.remote;
  return ["remotive", "remoteok", "jobicy", "weworkremotely"].includes(job.source ?? "") || /remote/i.test(job.location ?? "");
}

export function isOsloSnapshot(job: { location: string | null; source: string | null; remote?: boolean | null }): boolean {
  return isOsloRelevant({ location: job.location, remote: snapshotRemote(job) });
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
  if (/\b(senior|sr\.?|staff|principal|lead|architect)\b/i.test(text)) return "senior";
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
