import type { JobListing, JobRole } from "@/lib/types";

/**
 * Fit scoring for job listings — compares Lukáš's real tech stack (mirrored
 * from the nxt-portfolio "stack" section) against each posting's text so the
 * Jobs panel can rank openings by where he has the biggest chance.
 *
 * Pure and dependency-free: it takes a listing's already-scraped fields
 * (title + tags + seniority + description snippet) and returns a match
 * breakdown. No I/O, no React — unit-tested in isolation.
 */

/** One technology Lukáš knows. `weight` is its scoring signal (higher =
 * more differentiating); generic universals (git, html) sit low, niche
 * differentiators (React, TypeScript, Node) sit high. */
export type StackSkill = {
  name: string;
  weight: number;
  group: string;
  /** Alias spellings as they appear in postings; compiled to one matcher. */
  aliases: string[];
};

/** A tech a posting asks for that Lukáš does NOT have — a gap. */
export type GapTech = {
  name: string;
  aliases: string[];
};

/** The result of comparing one listing to the stack. */
export type JobMatch = {
  /** 0–100 coverage of the posting's detected stack, or null when the
   * posting names no recognizable technology (can't be scored). */
  score: number | null;
  level: "strong" | "good" | "partial" | "weak" | "unknown";
  /** Skills Lukáš has that the posting mentions, strongest first. */
  matched: StackSkill[];
  /** Technologies the posting wants that Lukáš is missing. */
  missing: string[];
  /** Σ weight of matched skills — the secondary sort key (breadth of fit). */
  matchedWeight: number;
};

/** Frontend & fullstack are the roles Lukáš actually applies to, so they
 * always sort ahead of generic "software" in the default "best fit" order. */
export const ROLE_PRIORITY: Record<JobRole, number> = {
  frontend: 0,
  fullstack: 0,
  software: 1,
};

// Each gap tech contributes this much "uncovered" weight — tuned so a
// couple of unknown technologies visibly dent an otherwise strong match
// without a single niche gap tanking the score.
const MISSING_WEIGHT = 2;

// Score thresholds → level label (drives the badge colour).
const STRONG = 75;
const GOOD = 50;
const PARTIAL = 25;

/**
 * Lukáš's stack. Weights: 3 = headline differentiator, 2 = strong, 1 =
 * supporting/generic. Deliberately omits git/github/gitlab (every job uses
 * them — matching them would inflate every score meaninglessly).
 */
export const MY_STACK: StackSkill[] = [
  // languages
  { name: "TypeScript", weight: 3, group: "languages", aliases: ["typescript", "ts"] },
  { name: "JavaScript", weight: 2, group: "languages", aliases: ["javascript", "js", "es6", "ecmascript"] },
  { name: "HTML5", weight: 1, group: "languages", aliases: ["html5", "html"] },
  { name: "CSS3", weight: 1, group: "languages", aliases: ["css3", "css"] },
  // frameworks & ui
  { name: "React", weight: 3, group: "frameworks & ui", aliases: ["react", "reactjs", "react.js"] },
  { name: "Next.js", weight: 3, group: "frameworks & ui", aliases: ["next.js", "nextjs"] },
  { name: "Astro", weight: 2, group: "frameworks & ui", aliases: ["astro"] },
  { name: "TailwindCSS", weight: 2, group: "frameworks & ui", aliases: ["tailwind", "tailwindcss"] },
  { name: "TanStack", weight: 2, group: "frameworks & ui", aliases: ["tanstack", "react query", "react-query"] },
  { name: "shadcn/ui", weight: 1, group: "frameworks & ui", aliases: ["shadcn"] },
  { name: "MUI", weight: 1, group: "frameworks & ui", aliases: ["mui", "material ui", "material-ui"] },
  { name: "Bootstrap", weight: 1, group: "frameworks & ui", aliases: ["bootstrap"] },
  { name: "Motion", weight: 1, group: "frameworks & ui", aliases: ["framer motion", "framer-motion"] },
  // backend & realtime
  { name: "Node.js", weight: 3, group: "backend & realtime", aliases: ["node.js", "nodejs", "node"] },
  { name: "Express.js", weight: 2, group: "backend & realtime", aliases: ["express", "express.js"] },
  { name: "Ably", weight: 1, group: "backend & realtime", aliases: ["ably"] },
  // data & auth
  { name: "PostgreSQL", weight: 2, group: "data & auth", aliases: ["postgresql", "postgres", "psql"] },
  { name: "MongoDB", weight: 2, group: "data & auth", aliases: ["mongodb", "mongo"] },
  { name: "Prisma", weight: 2, group: "data & auth", aliases: ["prisma"] },
  { name: "MySQL", weight: 1, group: "data & auth", aliases: ["mysql"] },
  { name: "Drizzle", weight: 1, group: "data & auth", aliases: ["drizzle"] },
  { name: "Payload CMS", weight: 1, group: "data & auth", aliases: ["payload cms", "payloadcms"] },
  { name: "Better Auth", weight: 1, group: "data & auth", aliases: ["better auth", "better-auth"] },
  { name: "Auth0", weight: 1, group: "data & auth", aliases: ["auth0"] },
  // tooling
  { name: "Docker", weight: 2, group: "tooling", aliases: ["docker"] },
  { name: "Google Cloud", weight: 2, group: "tooling", aliases: ["google cloud", "gcp"] },
  { name: "Vite", weight: 1, group: "tooling", aliases: ["vite"] },
  { name: "Postman", weight: 1, group: "tooling", aliases: ["postman"] },
  { name: "Figma", weight: 1, group: "tooling", aliases: ["figma"] },
  // testing & validation
  { name: "Jest", weight: 2, group: "testing & validation", aliases: ["jest"] },
  { name: "Playwright", weight: 2, group: "testing & validation", aliases: ["playwright"] },
  { name: "Zod", weight: 1, group: "testing & validation", aliases: ["zod"] },
  { name: "React Hook Form", weight: 1, group: "testing & validation", aliases: ["react hook form"] },
  { name: "Mocha", weight: 1, group: "testing & validation", aliases: ["mocha"] },
  { name: "Vitest", weight: 1, group: "testing & validation", aliases: ["vitest"] },
  // ai
  { name: "Anthropic SDK", weight: 1, group: "ai", aliases: ["anthropic"] },
  { name: "Vercel AI SDK", weight: 1, group: "ai", aliases: ["vercel ai"] },
  { name: "Claude Code", weight: 1, group: "ai", aliases: ["claude code", "claude"] },
];

/**
 * Common technologies Lukáš does NOT have. Detecting these in a posting
 * surfaces the gaps that make a role a worse fit (and feeds the
 * "learn next" insight).
 */
export const GAP_TECHS: GapTech[] = [
  { name: "Vue", aliases: ["vue", "vuejs", "vue.js"] },
  { name: "Angular", aliases: ["angular"] },
  { name: "Svelte", aliases: ["svelte", "sveltekit"] },
  { name: "Redux", aliases: ["redux"] },
  { name: "GraphQL", aliases: ["graphql"] },
  { name: "Java", aliases: ["java"] },
  { name: "Python", aliases: ["python", "django", "flask"] },
  { name: "PHP", aliases: ["php", "laravel", "symfony"] },
  { name: "Ruby", aliases: ["ruby", "rails", "ruby on rails"] },
  { name: "Go", aliases: ["golang"] },
  { name: "C#", aliases: ["c#", ".net", "dotnet"] },
  { name: "C++", aliases: ["c++"] },
  { name: "Kotlin", aliases: ["kotlin"] },
  { name: "Rust", aliases: ["rust"] },
  { name: "Swift", aliases: ["swift"] },
  { name: "Scala", aliases: ["scala"] },
  { name: "Elixir", aliases: ["elixir"] },
  { name: "AWS", aliases: ["aws", "amazon web services"] },
  { name: "Azure", aliases: ["azure"] },
  { name: "Kubernetes", aliases: ["kubernetes", "k8s"] },
  { name: "Terraform", aliases: ["terraform"] },
  { name: "Redis", aliases: ["redis"] },
  { name: "Kafka", aliases: ["kafka"] },
  { name: "Spring", aliases: ["spring boot", "spring"] },
  { name: "Sass", aliases: ["sass", "scss"] },
  { name: "Webpack", aliases: ["webpack"] },
];

/** Build a boundary-aware matcher for a set of aliases. Treats letters,
 * digits and `+ #` as "word" chars so "react" never fires inside "reactive",
 * while dotted names ("node.js", ".net") match via their own alias and a
 * trailing period ("PostgreSQL.") never blocks a match. Multi-word aliases
 * allow a space or hyphen between words. */
function buildMatcher(aliases: string[]): RegExp {
  const body = aliases
    .map((a) => a.trim().toLowerCase())
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .map((a) => a.replace(/\s+/g, "[\\s-]+"))
    .join("|");
  return new RegExp(`(?<![a-z0-9+#])(?:${body})(?![a-z0-9+#])`, "i");
}

const MY_MATCHERS = MY_STACK.map((s) => ({ skill: s, re: buildMatcher(s.aliases) }));
const GAP_MATCHERS = GAP_TECHS.map((g) => ({ tech: g, re: buildMatcher(g.aliases) }));

/** The searchable text for a listing: title + tags + seniority + the
 * scraped description snippet, lowercased. */
export function listingHaystack(listing: JobListing): string {
  return [
    listing.title,
    listing.tags.join(" "),
    listing.seniority ?? "",
    listing.description ?? "",
  ]
    .join(" \n ")
    .toLowerCase();
}

/**
 * Compare one listing to the stack. Score is weighted coverage of the
 * posting's *detected* technology: matchedWeight / (matchedWeight +
 * gaps×MISSING_WEIGHT). A posting naming no known tech scores null.
 */
export function matchListing(listing: JobListing): JobMatch {
  const hay = listingHaystack(listing);

  const matched = MY_MATCHERS.filter(({ re }) => re.test(hay)).map((m) => m.skill);
  const missing = GAP_MATCHERS.filter(({ re }) => re.test(hay)).map((m) => m.tech.name);

  if (matched.length === 0 && missing.length === 0) {
    return { score: null, level: "unknown", matched: [], missing: [], matchedWeight: 0 };
  }

  matched.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  const matchedWeight = matched.reduce((n, s) => n + s.weight, 0);
  const missingWeight = missing.length * MISSING_WEIGHT;
  const denom = matchedWeight + missingWeight;
  const score = denom === 0 ? null : Math.round((matchedWeight / denom) * 100);

  return {
    score,
    level: fitLevel(score),
    matched,
    missing,
    matchedWeight,
  };
}

export function fitLevel(score: number | null): JobMatch["level"] {
  if (score === null) return "unknown";
  if (score >= STRONG) return "strong";
  if (score >= GOOD) return "good";
  if (score >= PARTIAL) return "partial";
  return "weak";
}

/**
 * Default "best fit" comparator. Priority order:
 *   1. shortlisted pinned to the top (caller supplies the flag)
 *   2. frontend/fullstack ahead of software (the roles Lukáš applies to)
 *   3. higher score first (null scores last)
 *   4. broader match (matchedWeight) first
 *   5. newest first
 */
export function compareByFit(
  a: { listing: JobListing; match: JobMatch; shortlisted: boolean },
  b: { listing: JobListing; match: JobMatch; shortlisted: boolean },
): number {
  if (a.shortlisted !== b.shortlisted) return a.shortlisted ? -1 : 1;

  const rp = ROLE_PRIORITY[a.listing.role] - ROLE_PRIORITY[b.listing.role];
  if (rp !== 0) return rp;

  const sa = a.match.score ?? -1;
  const sb = b.match.score ?? -1;
  if (sa !== sb) return sb - sa;

  if (a.match.matchedWeight !== b.match.matchedWeight) {
    return b.match.matchedWeight - a.match.matchedWeight;
  }
  return b.listing.first_seen_at.localeCompare(a.listing.first_seen_at);
}
