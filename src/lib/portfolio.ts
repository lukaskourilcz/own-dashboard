import type { Project } from "@/lib/types";

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
 * Every entry is the owner's own product (`engagement = 'own'`). Whether a
 * project is client work is `projects.engagement` alone; the registry never
 * writes it, and never renames a row or changes its slug. The names and slugs
 * below are used only when a missing row is created.
 *
 * Category order is the order Competition lists its project groups in.
 */
export type PortfolioCategory = "internal" | "products" | "boardless";

export type PortfolioEntry = {
  /** Stable key stored in `projects.portfolio_key`. Never renamed. */
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
  },
  {
    key: "aifirst",
    name: "DNESKAi",
    repo: "lukaskourilcz/aifirst",
    category: "products",
    slug: "dneskai",
    summary: {
      en: "Czech daily briefing about the AI and technology stories that mattered. Static Next.js reader fed by the boardlessAI editorial pipeline.",
      cs: "Český denní přehled toho podstatného z AI a technologií. Statická Next.js čtečka plněná redakční linkou boardlessAI.",
    },
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
  },
  {
    key: "react-express-app",
    name: "devShark",
    repo: "lukaskourilcz/react-express-app",
    category: "products",
    slug: "devshark",
    summary: {
      en: "Free English developer-learning product: coding tasks graded server-side, with authored hints that end in documentation links.",
      cs: "Bezplatný anglický produkt pro výuku vývojářů: programovací úlohy hodnocené na serveru a ručně psané nápovědy s odkazy do dokumentace.",
    },
    url: "https://devshark.app",
  },
  {
    key: "quorum",
    name: "boardlessAI",
    repo: "lukaskourilcz/quorum",
    category: "boardless",
    slug: "boardlessai",
    summary: {
      en: "Autonomous AI council (VIZE, FORGE, PULSE, AUDIT) that runs a venture portfolio in git under a hard monthly operating cap.",
      cs: "Autonomní AI rada (VIZE, FORGE, PULSE, AUDIT), která v gitu řídí portfolio ventures pod pevným měsíčním provozním stropem.",
    },
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
  },
];

const BY_KEY = new Map(PORTFOLIO.map((entry) => [entry.key, entry]));
const BY_REPO = new Map(
  PORTFOLIO.filter((entry) => entry.repo).map((entry) => [entry.repo!.toLowerCase(), entry]),
);

type RepoIdentity = Pick<Project, "repo_full_name" | "previous_repo_full_names" | "parent_id">;

/** Current and earlier repository names of a top-level project, lowercased. */
function repoNames(project: RepoIdentity): string[] {
  if (project.parent_id) return [];
  return [project.repo_full_name, ...(project.previous_repo_full_names ?? [])]
    .filter((name): name is string => !!name)
    .map((name) => name.toLowerCase());
}

export function portfolioEntry(key: string | null | undefined): PortfolioEntry | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/**
 * Registry entry for a project row: by key first, then, for a top-level row,
 * by its current or an earlier repository name, so a renamed repository keeps
 * its entry.
 */
export function portfolioEntryFor(
  project: Pick<Project, "portfolio_key" | "repo_full_name" | "parent_id"> & Partial<Pick<Project, "previous_repo_full_names">>,
): PortfolioEntry | undefined {
  const byKey = portfolioEntry(project.portfolio_key);
  if (byKey) return byKey;
  for (const name of repoNames(project)) {
    const entry = BY_REPO.get(name);
    if (entry) return entry;
  }
  return undefined;
}

/** A project the registry knows: one of the daily projects or a venture subsection. */
export function isPortfolioProject(
  project: Pick<Project, "portfolio_key" | "repo_full_name" | "parent_id"> & Partial<Pick<Project, "previous_repo_full_names">>,
): boolean {
  return portfolioEntryFor(project) !== undefined;
}

/** Group projects by registry category, registry order first, then any other project. */
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
    if (project.parent_id && byId.has(project.parent_id)) continue; // listed under its parent
    const entry = portfolioEntryFor(project);
    push(entry?.category ?? "other", project);
  }
  const order: (PortfolioCategory | "other")[] = [...PORTFOLIO_CATEGORY_ORDER, "other"];
  return order.filter((category) => groups.has(category)).map((category) => ({ category, projects: groups.get(category)! }));
}

/** The subsections of a project, in registry order. */
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
  | { kind: "update"; project: Project; patch: Pick<Partial<Project>, "portfolio_key" | "parent_id"> };

/**
 * What the registry sync has to write so every entry has exactly one row with
 * the right key and parent. Pure, so the Projects panel can run it in an
 * effect and tests can check it never touches a row that is already correct.
 * It writes `portfolio_key` and `parent_id` only; a row's name, slug and
 * engagement belong to the owner. Subsections whose parent does not exist yet
 * are planned on the next pass.
 */
export function planPortfolioSync(projects: Project[]): PortfolioPlanStep[] {
  const steps: PortfolioPlanStep[] = [];
  const byKey = new Map<string, Project>();
  for (const project of projects) if (project.portfolio_key) byKey.set(project.portfolio_key, project);
  const findByRepo = (repo: string) =>
    projects.find((project) => repoNames(project).includes(repo.toLowerCase()));
  const rowFor = (entry: PortfolioEntry) =>
    byKey.get(entry.key) ?? (entry.repo ? findByRepo(entry.repo) : undefined);

  for (const entry of PORTFOLIO) {
    const parentEntry = entry.parentKey ? portfolioEntry(entry.parentKey) : undefined;
    const parent = parentEntry ? rowFor(parentEntry) : undefined;
    if (entry.parentKey && !parent) continue;
    const existing = rowFor(entry);
    if (!existing) {
      steps.push({ kind: "insert", entry, parentId: parent?.id ?? null });
      continue;
    }
    const patch: Pick<Partial<Project>, "portfolio_key" | "parent_id"> = {};
    if (existing.portfolio_key !== entry.key) patch.portfolio_key = entry.key;
    if (parent && existing.parent_id !== parent.id) patch.parent_id = parent.id;
    if (Object.keys(patch).length > 0) steps.push({ kind: "update", project: existing, patch });
  }
  return steps;
}
