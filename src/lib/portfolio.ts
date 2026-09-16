import type { AiLink, Project, ProjectScope } from "@/lib/types";

/**
 * The code-level registry of the projects the owner works on every day.
 *
 * The GitHub sync only materializes repositories on the saved allow-list, so a
 * repository created after that list was saved (phone-app) never reached the
 * Projects table. This registry is the second, deterministic source: every
 * entry is materialized as a `projects` row bound by `portfolio_key`, whether
 * or not GitHub is connected, and venture subsections (Design Lab, GoVIRAL)
 * become child rows of their repository project.
 *
 * Category order is the order the Projects table renders its groups in.
 */
export type PortfolioCategory = "internal" | "products" | "boardless";

export type PortfolioEntry = {
  key: string;
  name: string;
  /** GitHub `owner/name`; null for a subsection that lives inside its parent repository. */
  repo: string | null;
  /** Key of the owning entry for a subsection. */
  parentKey?: string;
  category: PortfolioCategory;
  slug: string;
  summary: { en: string; cs: string };
  url?: string;
  /** Alternative identifiers used in `ai_links.project_relevance[].repository`. */
  aliases: string[];
};

export const PORTFOLIO_CATEGORY_ORDER: PortfolioCategory[] = ["internal", "products", "boardless"];

export const PORTFOLIO: PortfolioEntry[] = [
  {
    key: "own-dashboard",
    name: "OwnDashboard",
    repo: "lukaskourilcz/own-dashboard",
    category: "internal",
    slug: "own-dashboard",
    summary: {
      en: "Bilingual own-only operating system for one freelance engineer: projects, clients, career, invoices, money, planning and knowledge.",
      cs: "Dvojjazyčný osobní operační systém pro jednoho freelance vývojáře: projekty, klienti, kariéra, faktury, peníze, plánování a znalosti.",
    },
    aliases: ["own-dashboard", "owndashboard"],
  },
  {
    key: "aifirst",
    name: "DNESKAi",
    repo: "lukaskourilcz/aifirst",
    category: "products",
    slug: "aifirst",
    summary: {
      en: "Czech daily briefing about the AI and technology stories that mattered. Static Next.js reader fed by the BoardlessAI editorial pipeline.",
      cs: "Český denní přehled toho podstatného z AI a technologií. Statická Next.js čtečka plněná redakční linkou BoardlessAI.",
    },
    aliases: ["aifirst", "dneskai", "caught-up"],
  },
  {
    key: "phone-app",
    name: "LINKA",
    repo: "lukaskourilcz/phone-app",
    category: "products",
    slug: "phone-app",
    summary: {
      en: "Czech 18+ companion platform with fictional AI personas: chat with memory, voice notes, calls, photos, relationship levels and memberships.",
      cs: "Česká 18+ platforma s fiktivními AI společnicemi: chat s pamětí, hlasovky, hovory, fotky, vztahové úrovně a členství.",
    },
    aliases: ["phone-app", "linka"],
  },
  {
    key: "react-express-app",
    name: "StudyShark + devShark",
    repo: "lukaskourilcz/react-express-app",
    category: "products",
    slug: "react-express-app",
    summary: {
      en: "Free bilingual learning products: StudyShark quiz subjects with XP, streaks and Shark Cards, and devShark coding tasks graded server-side.",
      cs: "Bezplatné dvojjazyčné výukové produkty: kvízové předměty StudyShark s XP, sériemi a Shark Cards a devShark s programovacími úlohami hodnocenými na serveru.",
    },
    url: "https://devshark.app",
    aliases: ["react-express-app", "studyshark", "devshark"],
  },
  {
    key: "quorum",
    name: "BoardlessAI",
    repo: "lukaskourilcz/quorum",
    category: "boardless",
    slug: "quorum",
    summary: {
      en: "Autonomous AI council (VIZE, FORGE, PULSE, AUDIT) that runs a venture portfolio in git under a hard monthly operating cap.",
      cs: "Autonomní AI rada (VIZE, FORGE, PULSE, AUDIT), která v gitu řídí portfolio ventures pod pevným měsíčním provozním stropem.",
    },
    aliases: ["quorum", "boardlessai", "boardless"],
  },
  {
    key: "quorum-design-lab",
    name: "Design Lab",
    repo: null,
    parentKey: "quorum",
    category: "boardless",
    slug: "design-lab",
    summary: {
      en: "Deterministic carousel and cover renderer with a checked library of original, reusable layouts for the portfolio magazines.",
      cs: "Deterministický renderer karuselů a coverů s prověřenou knihovnou originálních, znovupoužitelných layoutů pro magazíny portfolia.",
    },
    aliases: ["quorum-design-lab", "design-lab", "designlab", "carousel-studio"],
  },
  {
    key: "quorum-goviral",
    name: "GoVIRAL",
    repo: null,
    parentKey: "quorum",
    category: "boardless",
    slug: "goviral",
    summary: {
      en: "Weekly trend brief and a rated inventory of marketing plays for every venture, scouted on a strict zero-ad budget.",
      cs: "Týdenní trendový brief a hodnocený inventář marketingových tahů pro každý venture, sledovaný s nulovým reklamním rozpočtem.",
    },
    aliases: ["quorum-goviral", "goviral", "go-viral"],
  },
];

/** Client repositories the Works section seeds so the owner can start from the known engagements. */
export const KNOWN_WORKS: { repo: string; name: string; slug: string }[] = [
  { repo: "lukaskourilcz/gym-plzen", name: "gym-plzen", slug: "gym-plzen" },
  { repo: "lukaskourilcz/paris-claire", name: "paris-claire", slug: "paris-claire" },
  { repo: "lukaskourilcz/umyjemefasadu", name: "umyjemefasadu", slug: "umyjemefasadu" },
];

const BY_KEY = new Map(PORTFOLIO.map((entry) => [entry.key, entry]));
const BY_REPO = new Map(
  PORTFOLIO.filter((entry) => entry.repo).map((entry) => [entry.repo!.toLowerCase(), entry]),
);

export function portfolioEntry(key: string | null | undefined): PortfolioEntry | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/** Registry entry for a project row: by key first, then by repository for top-level entries. */
export function portfolioEntryFor(project: Pick<Project, "portfolio_key" | "repo_full_name" | "parent_id">): PortfolioEntry | undefined {
  const byKey = portfolioEntry(project.portfolio_key);
  if (byKey) return byKey;
  if (project.parent_id || !project.repo_full_name) return undefined;
  return BY_REPO.get(project.repo_full_name.toLowerCase());
}

export function projectScope(project: Pick<Project, "scope">): ProjectScope {
  return project.scope ?? "project";
}

export function isPortfolioProject(project: Pick<Project, "portfolio_key" | "repo_full_name" | "parent_id" | "scope">): boolean {
  return projectScope(project) === "project" && portfolioEntryFor(project) !== undefined;
}

/** Short repository name (`own-dashboard` for `lukaskourilcz/own-dashboard`). */
export function repoShortName(repoFullName: string | null | undefined): string | null {
  if (!repoFullName) return null;
  const parts = repoFullName.split("/");
  return (parts[parts.length - 1] ?? repoFullName).toLowerCase();
}

/**
 * Identifiers a link's `project_relevance[].repository` may use to point at this
 * project. Research records historically used the short repository name.
 */
export function projectRelevanceKeys(project: Pick<Project, "portfolio_key" | "repo_full_name" | "parent_id" | "slug" | "name">): Set<string> {
  const keys = new Set<string>();
  const entry = portfolioEntryFor(project);
  if (entry) for (const alias of [entry.key, ...entry.aliases]) keys.add(alias.toLowerCase());
  if (project.repo_full_name) {
    keys.add(project.repo_full_name.toLowerCase());
    const short = repoShortName(project.repo_full_name);
    if (short) keys.add(short);
  }
  keys.add(project.slug.toLowerCase());
  return keys;
}

export function linkMatchesProject(link: AiLink, project: Pick<Project, "portfolio_key" | "repo_full_name" | "parent_id" | "slug" | "name">): boolean {
  const relevance = link.project_relevance ?? [];
  if (relevance.length === 0) return false;
  const keys = projectRelevanceKeys(project);
  return relevance.some((item) => keys.has(item.repository.trim().toLowerCase()));
}

/** Links and ideas relevant to a project, best usefulness score first. */
export function projectLinks(links: AiLink[], project: Pick<Project, "portfolio_key" | "repo_full_name" | "parent_id" | "slug" | "name">): AiLink[] {
  return links
    .filter((link) => linkMatchesProject(link, project))
    .sort((a, b) =>
      (b.usefulness_rating ?? 0) - (a.usefulness_rating ?? 0)
      || a.title.localeCompare(b.title),
    );
}

/** Group visible projects by registry category, registry order first, then any other active project. */
export function groupPortfolio(projects: Project[]): { category: PortfolioCategory | "other"; projects: Project[] }[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const groups = new Map<PortfolioCategory | "other", Project[]>();
  const push = (category: PortfolioCategory | "other", project: Project) => {
    const list = groups.get(category);
    if (list) list.push(project);
    else groups.set(category, [project]);
  };
  const registryOrder = new Map(PORTFOLIO.map((entry, index) => [entry.key, index]));
  const ordered = [...projects].sort((a, b) => {
    const ia = registryOrder.get(portfolioEntryFor(a)?.key ?? "") ?? Number.MAX_SAFE_INTEGER;
    const ib = registryOrder.get(portfolioEntryFor(b)?.key ?? "") ?? Number.MAX_SAFE_INTEGER;
    return ia - ib || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
  });
  for (const project of ordered) {
    if (project.parent_id && byId.has(project.parent_id)) continue; // rendered under its parent
    const entry = portfolioEntryFor(project);
    push(entry?.category ?? "other", project);
  }
  const order: (PortfolioCategory | "other")[] = [...PORTFOLIO_CATEGORY_ORDER, "other"];
  return order.filter((category) => groups.has(category)).map((category) => ({ category, projects: groups.get(category)! }));
}

export function childProjects(projects: Project[], parentId: string): Project[] {
  return projects
    .filter((project) => project.parent_id === parentId)
    .sort((a, b) => {
      const ia = PORTFOLIO.findIndex((entry) => entry.key === a.portfolio_key);
      const ib = PORTFOLIO.findIndex((entry) => entry.key === b.portfolio_key);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.sort_order - b.sort_order;
    });
}

export type PortfolioPlanStep =
  | { kind: "insert"; entry: PortfolioEntry; parentId: string | null }
  | { kind: "update"; project: Project; patch: Partial<Project> };

/**
 * What the registry sync has to write so every entry has exactly one row with
 * the right scope, key and parent. Pure, so the Projects panel can run it in an
 * effect and tests can check it never touches a row that is already correct.
 * Subsections whose parent does not exist yet are planned on the next pass.
 */
export function planPortfolioSync(projects: Project[]): PortfolioPlanStep[] {
  const steps: PortfolioPlanStep[] = [];
  const byKey = new Map<string, Project>();
  for (const project of projects) if (project.portfolio_key) byKey.set(project.portfolio_key, project);
  const findByRepo = (repo: string) => projects.find((project) => !project.parent_id && project.repo_full_name?.toLowerCase() === repo.toLowerCase());

  for (const entry of PORTFOLIO) {
    const parent = entry.parentKey ? byKey.get(entry.parentKey) ?? (portfolioEntry(entry.parentKey)?.repo ? findByRepo(portfolioEntry(entry.parentKey)!.repo!) : undefined) : undefined;
    if (entry.parentKey && !parent) continue;
    const existing = byKey.get(entry.key) ?? (entry.repo ? findByRepo(entry.repo) : undefined);
    if (!existing) {
      steps.push({ kind: "insert", entry, parentId: parent?.id ?? null });
      continue;
    }
    const patch: Partial<Project> = {};
    if (existing.portfolio_key !== entry.key) patch.portfolio_key = entry.key;
    if (projectScope(existing) !== "project") patch.scope = "project";
    if (entry.parentKey && existing.parent_id !== parent!.id) patch.parent_id = parent!.id;
    if (Object.keys(patch).length > 0) steps.push({ kind: "update", project: existing, patch });
  }
  return steps;
}

/** Client repositories that still need a Works row, plus existing rows that need the work scope. */
export function planWorksSync(projects: Project[]): PortfolioPlanStep[] {
  const steps: PortfolioPlanStep[] = [];
  for (const work of KNOWN_WORKS) {
    const existing = projects.find((project) => project.repo_full_name?.toLowerCase() === work.repo.toLowerCase());
    if (!existing) {
      steps.push({
        kind: "insert",
        entry: { key: `work:${work.slug}`, name: work.name, repo: work.repo, category: "products", slug: work.slug, summary: { en: "", cs: "" }, aliases: [] },
        parentId: null,
      });
    } else if (projectScope(existing) !== "work") {
      steps.push({ kind: "update", project: existing, patch: { scope: "work" } });
    }
  }
  return steps;
}
