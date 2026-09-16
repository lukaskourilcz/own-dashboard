import { describe, expect, it } from "vitest";
import {
  KNOWN_WORKS,
  PORTFOLIO,
  childProjects,
  groupPortfolio,
  linkMatchesProject,
  planPortfolioSync,
  planWorksSync,
  portfolioEntryFor,
  projectLinks,
} from "@/lib/portfolio";
import type { AiLink, Project } from "@/lib/types";

function project(overrides: Partial<Project>): Project {
  return {
    id: overrides.id ?? overrides.slug ?? "p",
    user_id: "u",
    name: overrides.name ?? overrides.slug ?? "p",
    slug: overrides.slug ?? "p",
    repo_full_name: null,
    url: null,
    notes: "",
    color: null,
    sort_order: 0,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function link(overrides: Partial<AiLink>): AiLink {
  return {
    id: overrides.id ?? "l",
    user_id: "u",
    category_id: null,
    title: overrides.title ?? "Link",
    url: "https://example.com",
    description: null,
    pricing: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("portfolio registry", () => {
  it("has unique keys, slugs and a parent for every subsection", () => {
    const keys = new Set(PORTFOLIO.map((entry) => entry.key));
    expect(keys.size).toBe(PORTFOLIO.length);
    expect(new Set(PORTFOLIO.map((entry) => entry.slug)).size).toBe(PORTFOLIO.length);
    for (const entry of PORTFOLIO) {
      if (entry.parentKey) expect(keys.has(entry.parentKey), entry.key).toBe(true);
      else expect(entry.repo, entry.key).toMatch(/^lukaskourilcz\//);
    }
  });

  it("covers the seven daily projects including phone-app and the quorum ventures", () => {
    expect(PORTFOLIO.map((entry) => entry.key)).toEqual([
      "own-dashboard", "aifirst", "phone-app", "react-express-app", "quorum", "quorum-design-lab", "quorum-goviral",
    ]);
    expect(KNOWN_WORKS.map((work) => work.slug)).toEqual(["gym-plzen", "paris-claire", "umyjemefasadu"]);
  });

  it("plans inserts for missing entries and updates for rows that lack the key", () => {
    const rows = [
      project({ id: "a", slug: "aifirst", repo_full_name: "lukaskourilcz/aifirst" }),
      project({ id: "q", slug: "quorum", repo_full_name: "lukaskourilcz/quorum", portfolio_key: "quorum", scope: "project" }),
    ];
    const steps = planPortfolioSync(rows);
    const updates = steps.filter((step) => step.kind === "update");
    const inserts = steps.filter((step) => step.kind === "insert");
    expect(updates).toHaveLength(1);
    expect(updates[0].kind === "update" && updates[0].patch).toEqual({ portfolio_key: "aifirst" });
    expect(inserts.map((step) => step.kind === "insert" && step.entry.key)).toEqual([
      "own-dashboard", "phone-app", "react-express-app", "quorum-design-lab", "quorum-goviral",
    ]);
    const designLab = inserts.find((step) => step.kind === "insert" && step.entry.key === "quorum-design-lab");
    expect(designLab?.kind === "insert" && designLab.parentId).toBe("q");
  });

  it("waits for a parent before planning its subsections", () => {
    const steps = planPortfolioSync([]);
    expect(steps.every((step) => step.kind === "insert" && !step.entry.parentKey)).toBe(true);
  });

  it("does nothing when every row is already correct", () => {
    const rows = PORTFOLIO.map((entry, index) =>
      project({ id: entry.key, slug: entry.slug, repo_full_name: entry.repo, portfolio_key: entry.key, scope: "project", parent_id: entry.parentKey ?? null, sort_order: index }),
    );
    expect(planPortfolioSync(rows)).toEqual([]);
  });

  it("moves a known client repository into the work scope", () => {
    const rows = [project({ id: "g", slug: "gym-plzen", repo_full_name: "lukaskourilcz/gym-plzen", scope: "project" })];
    const steps = planWorksSync(rows);
    expect(steps.filter((step) => step.kind === "update")).toHaveLength(1);
    expect(steps.filter((step) => step.kind === "insert").map((step) => step.kind === "insert" && step.entry.slug)).toEqual(["paris-claire", "umyjemefasadu"]);
  });

  it("matches links by short repository name, key or alias", () => {
    const dashboard = project({ id: "d", slug: "own-dashboard", repo_full_name: "lukaskourilcz/own-dashboard", portfolio_key: "own-dashboard" });
    const designLab = project({ id: "dl", slug: "design-lab", portfolio_key: "quorum-design-lab", parent_id: "q" });
    const byRepo = link({ id: "1", project_relevance: [{ repository: "own-dashboard", reason: "x" }], usefulness_rating: 3 });
    const byAlias = link({ id: "2", project_relevance: [{ repository: "carousel-studio", reason: "y" }], usefulness_rating: 5 });
    const byFull = link({ id: "3", project_relevance: [{ repository: "lukaskourilcz/own-dashboard", reason: "z" }], usefulness_rating: 4 });
    expect(linkMatchesProject(byRepo, dashboard)).toBe(true);
    expect(linkMatchesProject(byAlias, dashboard)).toBe(false);
    expect(linkMatchesProject(byAlias, designLab)).toBe(true);
    expect(projectLinks([byRepo, byAlias, byFull], dashboard).map((item) => item.id)).toEqual(["3", "1"]);
  });

  it("groups registry projects by category and keeps others last", () => {
    const rows = [
      project({ id: "x", slug: "mma-files", repo_full_name: "lukaskourilcz/mma-files", sort_order: 0 }),
      project({ id: "q", slug: "quorum", repo_full_name: "lukaskourilcz/quorum", portfolio_key: "quorum", sort_order: 5 }),
      project({ id: "d", slug: "own-dashboard", portfolio_key: "own-dashboard", sort_order: 9 }),
      project({ id: "dl", slug: "design-lab", portfolio_key: "quorum-design-lab", parent_id: "q", sort_order: 6 }),
    ];
    const groups = groupPortfolio(rows);
    expect(groups.map((group) => group.category)).toEqual(["internal", "boardless", "other"]);
    expect(groups[1].projects.map((item) => item.id)).toEqual(["q"]);
    expect(childProjects(rows, "q").map((item) => item.id)).toEqual(["dl"]);
    expect(portfolioEntryFor(rows[0])).toBeUndefined();
  });
});
