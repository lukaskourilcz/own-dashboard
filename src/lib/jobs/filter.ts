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
// Generic engineering signals (no specific language) + the JS/web ecosystem.
// Foreign-language hints are deliberately NOT here — they're vetoed below.
const TECH_HINT =
  /\b(software|web|javascript|typescript|node(\.?js)?|backend|back[\s-]*end|api)\b/i;

// Languages/stacks outside the tracked JS/TS/web skill set. A title dominated
// by one of these (Python, C++, C#, PHP, Go, Java, Ruby, …) is not relevant.
// c++/c#/.net carry non-word chars, so they're matched separately below.
const FOREIGN_LANG =
  /\b(python|django|flask|fastapi|php|laravel|symfony|drupal|wordpress|ruby|rails|golang|go|rust|scala|kotlin|swift|elixir|erlang|perl|haskell|clojure|groovy|dotnet|java)\b(?!script)/i;
const FOREIGN_SYMBOLIC = /(^|[^a-z0-9+#.])(c\+\+|c#|\.net|asp\.net|f#|objective-c)/i;

// Signals that the posting IS in the tracked ecosystem — presence of any of
// these spares a role from the foreign-language veto (e.g. "React + Python").
const USER_SIGNAL =
  /front[\s-]*end|full[\s-]*stack|next\.?js|node\.?js|react\.?js|\b(javascript|js|typescript|ts|react|reactjs|node|nodejs|express|vue|vuejs|angular|svelte|sveltekit|remix|astro|tailwind|web)\b/i;

/** True when a posting's primary language is outside the tracked skill set and
 * there's no JS/web signal to redeem it. */
function isForeignPrimary(hay: string): boolean {
  const foreign = FOREIGN_LANG.test(hay) || FOREIGN_SYMBOLIC.test(hay);
  return foreign && !USER_SIGNAL.test(hay);
}

/**
 * Classify a job title into one of the tracked role buckets, or null when it
 * isn't a frontend/fullstack/software-engineering role in the JS/TS/web
 * ecosystem. `extra` widens the haystack (e.g. a source's category names or
 * tags) — it can rescue an ambiguous title into a role and can carry the
 * foreign-language signal that vetoes an irrelevant one.
 */
export function matchRole(title: string, extra?: string): JobRole | null {
  const t = title.trim();
  if (!t) return null;
  if (NEGATIVE.test(t)) return null;

  const wide = extra ? `${t} ${extra}` : t;
  // Drop foreign-language roles (Python/C++/C#/PHP/Go/Java/…) unless the
  // posting also shows a JS/web signal — keeps the list to the real skill set.
  if (isForeignPrimary(wide)) return null;

  const haystacks = extra ? [t, wide] : [t];
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
