import type { JobRole } from "./types";

// Pure classification helpers shared by every scraper source (and unit
// tested in isolation): which role bucket a job title falls into, and
// whether a free-text location is compatible with "remote from Europe".

// Titles that are clearly a different discipline, even when they contain a
// dev word ("QA Engineer", "Data Analyst", "Business Developer"…). Checked
// first so they can veto everything else. Czech variants included — the
// scraped boards are Czech-first.
const NEGATIVE =
  /\b(qa|testers?|testing|tester(ka)?|devops|sre|data\s+(engineer|analyst|scientist)|analytik|analyst|security|embedded|hardware|hw|mobile|ios|android|salesforce|sap\b|business\s+develop|sales|marketing|recruit|designer|scrum|product\s+(manager|owner)|project\s+manager|support|helpdesk|consultant|konzultant|account\s+(manager|executive)|copywriter|obchodn)/i;

const FULLSTACK = /full[\s-]*stack/i;

// "Frontend"/"front-end" plus the common framework-titled roles
// ("React Developer", "Vue.js vývojář"…).
const FRONTEND = /front[\s-]*end|\b(react|vue|angular|svelte|next\.?js)\b/i;

// Generic software-engineering titles: a dev word together with either
// "software"/"web" or a backend-ish tech hint.
const DEV_WORD =
  /\b(engineer|engineering|developer|dev|programmer|inženýr|inzenyr|vývojář(ka)?|vyvojar(ka)?|programátor(ka)?|programator(ka)?)\b/i;
const TECH_HINT =
  /\b(software|web|javascript|typescript|node(\.?js)?|python|java|golang|go|php|\.net|dotnet|c#|c\+\+|ruby|kotlin|rust|scala|elixir|backend|back[\s-]*end|api)\b/i;

/**
 * Classify a job title into one of the tracked role buckets, or null when
 * it isn't a frontend/fullstack/software-engineering role. `extra` widens
 * the haystack (e.g. a source's category names) without letting it veto
 * the title.
 */
export function matchRole(title: string, extra?: string): JobRole | null {
  const t = title.trim();
  if (!t) return null;
  if (NEGATIVE.test(t)) return null;

  const haystacks = extra ? [t, `${t} ${extra}`] : [t];
  for (const hay of haystacks) {
    if (FULLSTACK.test(hay)) return "fullstack";
    if (FRONTEND.test(hay)) return "frontend";
    if (DEV_WORD.test(hay) && TECH_HINT.test(hay)) return "software";
  }
  return null;
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
