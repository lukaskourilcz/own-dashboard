import type { Project } from "@/lib/types";

/**
 * The code-level registry of the projects the owner works on every day.
 *
 * The GitHub sync only materializes repositories on the saved allow-list, so a
 * repository created after that list was saved (phone-app) never reached the
 * Projects table. This registry is the second, deterministic source: every
 * unambiguous entry is materialized as a `projects` row bound by `portfolio_key`,
 * whether or not GitHub is connected. Conflicting identities leave owned rows
 * untouched. Venture subsections (Design Lab, GoVIRAL) become child rows of
 * their repository project.
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
    // The repository is private and the product unannounced, so its
    // description lives only in the owner's own `projects.summary` row, not in
    // this public source file. NEEDED.md asks the owner whether the entry may
    // stay here at all.
    summary: {
      en: "Private product in development.",
      cs: "Soukromý produkt ve vývoji.",
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
const REGISTRY_ORDER = new Map(PORTFOLIO.map((entry, index) => [entry.key, index]));
const BY_REPO = new Map(
  PORTFOLIO.filter((entry) => entry.repo).map((entry) => [entry.repo!.toLowerCase(), entry]),
);

type RepoIdentity = Pick<Project, "repo_full_name" | "previous_repo_full_names" | "parent_id">;

/** Current and earlier repository names of a top-level project, lowercased. */
function repoNames(project: RepoIdentity): string[] {
  if (project.parent_id) return [];
  return [...new Set([project.repo_full_name, ...(project.previous_repo_full_names ?? [])]
    .map(name => name?.trim().toLowerCase())
    .filter((name): name is string => !!name))];
}

export function portfolioEntry(key: string | null | undefined): PortfolioEntry | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/**
 * Registry entry for a project row: by key first, then, for a top-level row,
 * by its unique current or historical repository identity. A future/unknown
 * explicit key stays unknown; conflicting historical names imply no entry.
 */
export function portfolioEntryFor(
  project: Pick<Project, "portfolio_key" | "repo_full_name" | "parent_id"> & Partial<Pick<Project, "previous_repo_full_names">>,
): PortfolioEntry | undefined {
  if (project.portfolio_key) return portfolioEntry(project.portfolio_key);
  if (project.parent_id) return undefined;
  const current = project.repo_full_name?.trim().toLowerCase();
  const byCurrent = current ? BY_REPO.get(current) : undefined;
  if (byCurrent) return byCurrent;
  const history = new Set(repoNames(project).flatMap(name => {
    const entry = BY_REPO.get(name); return entry ? [entry] : [];
  }));
  return history.size === 1 ? history.values().next().value : undefined;
}

/**
 * The summary a project shows: its own, else its registry entry's. A public
 * preview never falls back to the registry, so the guest tour shows only what
 * its invented fixtures say and never the owner's portfolio descriptions.
 */
export function projectSummary(
  project: Pick<Project, "summary" | "portfolio_key" | "repo_full_name" | "parent_id"> & Partial<Pick<Project, "previous_repo_full_names">>,
  lang: "en" | "cs",
  { preview = false }: { preview?: boolean } = {},
): string | undefined {
  if (project.summary) return project.summary;
  if (preview) return undefined;
  return portfolioEntryFor(project)?.summary[lang];
}

/** A project the registry knows: one of the daily projects or a venture subsection. */
export function isPortfolioProject(
  project: Pick<Project, "portfolio_key" | "repo_full_name" | "parent_id"> & Partial<Pick<Project, "previous_repo_full_names">>,
): boolean {
  return portfolioEntryFor(project) !== undefined;
}

/** Group projects by registry category, registry order first, then any other project. */
export function groupPortfolio(projects: Project[]): { category: PortfolioCategory | "other"; projects: Project[] }[] {
  const byId = new Set(projects.map((project) => project.id));
  const groups = new Map<PortfolioCategory | "other", Project[]>();
  const push = (category: PortfolioCategory | "other", project: Project) => {
    const list = groups.get(category);
    if (list) list.push(project);
    else groups.set(category, [project]);
  };
  // Classify once per row, not repeatedly inside the sort comparator.
  const ordered = projects.map(project => {
    const entry = portfolioEntryFor(project);
    return { project, entry, order: REGISTRY_ORDER.get(entry?.key ?? "") ?? Number.MAX_SAFE_INTEGER };
  }).sort((a, b) => a.order - b.order || a.project.sort_order - b.project.sort_order || a.project.created_at.localeCompare(b.project.created_at));
  for (const { project, entry } of ordered) {
    if (project.parent_id && byId.has(project.parent_id)) continue;
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
      const ia = REGISTRY_ORDER.get(a.portfolio_key ?? "") ?? Number.MAX_SAFE_INTEGER;
      const ib = REGISTRY_ORDER.get(b.portfolio_key ?? "") ?? Number.MAX_SAFE_INTEGER;
      return ia - ib || a.sort_order - b.sort_order;
    });
}

export type PortfolioPlanStep =
  | { kind: "insert"; entry: PortfolioEntry; parentId: string | null }
  | { kind: "update"; project: Project; patch: Pick<Partial<Project>, "portfolio_key" | "parent_id"> };

/** Resolve identity for the whole registry before planning writes. Existing
 * keys win, then unique current names, then unique history. A row can claim
 * only one entry; ambiguous or already-bound aliases are not new projects. */
function portfolioRows(projects: readonly Project[]) {
  const keyed = new Map<string, Project[]>();
  const add = (map: Map<string, Project[]>, key: string, project: Project) => {
    const rows = map.get(key); if (rows) rows.push(project); else map.set(key, [project]);
  };
  const claimed = new Set<string>(), resolved = new Map<string, Project>(), blocked = new Set<string>();
  for (const project of projects) {
    if (project.portfolio_key) { add(keyed, project.portfolio_key, project); claimed.add(project.id); }
  }
  for (const [key, candidates] of keyed) {
    if (candidates.length === 1) resolved.set(key, candidates[0]); else blocked.add(key);
  }
  // Most passes already have every key. Parent repairs need no name/history scan.
  if (PORTFOLIO.every(entry => resolved.has(entry.key) || blocked.has(entry.key))) return { resolved, blocked };
  const current = new Map<string, Project[]>(), history = new Map<string, Project[]>();
  for (const project of projects) {
    if (project.parent_id) continue;
    const name = project.repo_full_name?.trim().toLowerCase(), entry = name ? BY_REPO.get(name) : undefined;
    if (entry) add(current, entry.key, project);
    const previousKeys = new Set<string>();
    for (const previous of project.previous_repo_full_names ?? []) {
      const entry = previous ? BY_REPO.get(previous.trim().toLowerCase()) : undefined;
      if (entry) previousKeys.add(entry.key);
    }
    for (const key of previousKeys) add(history, key, project);
  }
  const eligible = (project: Project) => !project.portfolio_key && !claimed.has(project.id);
  // Resolve current names globally before a historical alias can claim one.
  for (const entry of PORTFOLIO) {
    if (resolved.has(entry.key) || blocked.has(entry.key) || !entry.repo) continue;
    const candidates = current.get(entry.key) ?? [];
    if (candidates.length === 1 && eligible(candidates[0])) { resolved.set(entry.key, candidates[0]); claimed.add(candidates[0].id); }
    else if (candidates.length) blocked.add(entry.key);
  }
  const aliases = new Map<string, Project>(), aliasClaims = new Map<string, number>();
  for (const entry of PORTFOLIO) {
    if (resolved.has(entry.key) || blocked.has(entry.key) || !entry.repo) continue;
    const candidates = history.get(entry.key) ?? [];
    if (candidates.length === 1 && eligible(candidates[0])) {
      aliases.set(entry.key, candidates[0]); aliasClaims.set(candidates[0].id, (aliasClaims.get(candidates[0].id) ?? 0) + 1);
    } else if (candidates.length) blocked.add(entry.key);
  }
  for (const [key, project] of aliases) {
    if (aliasClaims.get(project.id) === 1) resolved.set(key, project); else blocked.add(key);
  }
  return { resolved, blocked };
}

/** Plan only unambiguous registry writes. Owner names/slugs/engagement stay
 * intact. A subsection waits for an existing resolved parent; a known or
 * unknown existing key is never replaced through a repository-name fallback. */
export function planPortfolioSync(projects: Project[]): PortfolioPlanStep[] {
  const steps: PortfolioPlanStep[] = [];
  const { resolved, blocked } = portfolioRows(projects);

  for (const entry of PORTFOLIO) {
    const parentEntry = entry.parentKey ? portfolioEntry(entry.parentKey) : undefined;
    const parent = parentEntry ? resolved.get(parentEntry.key) : undefined;
    if (entry.parentKey && !parent) continue;
    const existing = resolved.get(entry.key);
    if (!existing) {
      if (blocked.has(entry.key)) continue;
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
