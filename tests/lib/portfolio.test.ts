import { describe, expect, it } from "vitest";
import {
  PORTFOLIO,
  childProjects,
  groupPortfolio,
  isPortfolioProject,
  planPortfolioSync,
  portfolioEntryFor,
  projectSummary,
} from "@/lib/portfolio";
import type { Project } from "@/lib/types";

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

  it("covers the daily projects under their current names, with stable keys", () => {
    expect(PORTFOLIO.map((entry) => entry.key)).toEqual([
      "own-dashboard", "aifirst", "phone-app", "react-express-app", "quorum", "quorum-design-lab", "quorum-goviral",
    ]);
    // #76 renamed three projects; the registry creates missing rows under the
    // new names and never renames an existing one.
    expect(PORTFOLIO.map((entry) => entry.slug)).toEqual([
      "own-dashboard", "dneskai", "phone-app", "devshark", "boardlessai", "design-lab", "goviral",
    ]);
    expect(PORTFOLIO.find((entry) => entry.key === "react-express-app")?.name).toBe("devShark");
  });

  it("plans inserts for missing entries and key updates for rows that lack one", () => {
    const rows = [
      project({ id: "a", slug: "dneskai", repo_full_name: "lukaskourilcz/aifirst" }),
      project({ id: "q", slug: "boardlessai", repo_full_name: "lukaskourilcz/quorum", portfolio_key: "quorum" }),
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

  it("finds a renamed repository by its earlier name instead of inserting a duplicate", () => {
    const rows = [
      project({
        id: "d",
        slug: "dneskai",
        repo_full_name: "lukaskourilcz/dneskai",
        previous_repo_full_names: ["lukaskourilcz/aifirst"],
      }),
    ];
    const steps = planPortfolioSync(rows);
    expect(steps.some((step) => step.kind === "insert" && step.entry.key === "aifirst")).toBe(false);
    expect(steps.find((step) => step.kind === "update")).toEqual({
      kind: "update",
      project: rows[0],
      patch: { portfolio_key: "aifirst" },
    });
    expect(portfolioEntryFor(rows[0])?.key).toBe("aifirst");
  });

  it("waits for a parent before planning its subsections", () => {
    const steps = planPortfolioSync([]);
    expect(steps.every((step) => step.kind === "insert" && !step.entry.parentKey)).toBe(true);
  });

  it("does nothing when every row is already correct, whatever its name, slug or engagement", () => {
    const ids = new Map(PORTFOLIO.map((entry) => [entry.key, `id-${entry.key}`]));
    const rows = PORTFOLIO.map((entry, index) =>
      project({
        id: ids.get(entry.key),
        // Owner-chosen names and slugs differ from the registry on purpose.
        name: `${entry.name} renamed`,
        slug: `${entry.slug}-x`,
        engagement: "own",
        repo_full_name: entry.repo,
        portfolio_key: entry.key,
        parent_id: entry.parentKey ? ids.get(entry.parentKey) : null,
        sort_order: index,
      }),
    );
    expect(planPortfolioSync(rows)).toEqual([]);
  });

  it("writes only the registry key and the parent, never a name, slug or engagement", () => {
    const rows = [
      project({ id: "q", slug: "boardlessai", repo_full_name: "lukaskourilcz/quorum", portfolio_key: "quorum" }),
      project({ id: "dl", slug: "lab", name: "Lab", portfolio_key: "quorum-design-lab", parent_id: null, engagement: "client" }),
    ];
    for (const step of planPortfolioSync(rows)) {
      if (step.kind !== "update") continue;
      expect(Object.keys(step.patch).every((key) => key === "portfolio_key" || key === "parent_id")).toBe(true);
    }
    expect(planPortfolioSync(rows).find((step) => step.kind === "update" && step.project.id === "dl")).toMatchObject({
      patch: { parent_id: "q" },
    });
  });

  it("groups registry projects by category and keeps others last", () => {
    const rows = [
      project({ id: "x", slug: "mma-files", repo_full_name: "lukaskourilcz/mma-files", sort_order: 0 }),
      project({ id: "q", slug: "boardlessai", repo_full_name: "lukaskourilcz/quorum", portfolio_key: "quorum", sort_order: 5 }),
      project({ id: "d", slug: "own-dashboard", portfolio_key: "own-dashboard", sort_order: 9 }),
      project({ id: "dl", slug: "design-lab", portfolio_key: "quorum-design-lab", parent_id: "q", sort_order: 6 }),
    ];
    const groups = groupPortfolio(rows);
    expect(groups.map((group) => group.category)).toEqual(["internal", "boardless", "other"]);
    expect(groups[1].projects.map((item) => item.id)).toEqual(["q"]);
    expect(childProjects(rows, "q").map((item) => item.id)).toEqual(["dl"]);
    expect(portfolioEntryFor(rows[0])).toBeUndefined();
    expect(isPortfolioProject(rows[0])).toBe(false);
    expect(isPortfolioProject(rows[3])).toBe(true);
  });
});


describe("registry identity conflicts", () => {
  const updates = (rows: Project[]) => planPortfolioSync(rows).filter(step => step.kind === "update");
  const inserts = (rows: Project[]) => planPortfolioSync(rows).filter(step => step.kind === "insert");
  it("resolves a current identity before an earlier alias regardless of registry order", () => {
    const row = project({ id: "legacy", repo_full_name: "lukaskourilcz/quorum", previous_repo_full_names: ["lukaskourilcz/own-dashboard"] });
    expect(updates([row])).toEqual([{ kind: "update", project: row, patch: { portfolio_key: "quorum" } }]);
    expect(inserts([row]).some(step => step.entry.key === "own-dashboard")).toBe(false);
    const saved = { ...row, portfolio_key: "quorum" };
    expect(updates([saved])).toEqual([]); expect(inserts([saved]).some(step => step.entry.key === "own-dashboard")).toBe(false);
  });
  it("preserves an explicit known or future key when another registry name reuses its repository name", () => {
    for (const key of ["own-dashboard", "future-product"]) {
      const row = project({ id: "bound", portfolio_key: key, repo_full_name: "lukaskourilcz/quorum" });
      expect(updates([row])).toEqual([]);
      expect(inserts([row]).some(step => step.entry.key === "quorum" || step.entry.parentKey === "quorum")).toBe(false);
      expect(row.portfolio_key).toBe(key);
    }
  });
  it("refuses duplicate current identities instead of choosing a row or creating another", () => {
    const rows = [project({ id: "first", slug: "first", repo_full_name: "lukaskourilcz/aifirst" }), project({ id: "second", slug: "second", repo_full_name: "LUKASKOURILCZ/AIFIRST" })];
    expect(updates(rows)).toEqual([]); expect(inserts(rows).some(step => step.entry.key === "aifirst")).toBe(false);
  });
  it("refuses ambiguous historical rows and one row claiming several historical identities", () => {
    const cases = [
      [project({ id: "first", slug: "first", previous_repo_full_names: ["lukaskourilcz/aifirst"] }), project({ id: "second", slug: "second", previous_repo_full_names: ["lukaskourilcz/aifirst"] })],
      [project({ id: "many", previous_repo_full_names: ["lukaskourilcz/aifirst", "lukaskourilcz/own-dashboard"] })],
    ];
    for (const rows of cases) {
      expect(updates(rows)).toEqual([]); expect(inserts(rows).some(step => step.entry.key === "aifirst")).toBe(false);
    }
    expect(inserts(cases[1]).some(step => step.entry.key === "own-dashboard")).toBe(false);
  });
  it("keeps current-name priority over a competing historical row and normalizes legacy whitespace", () => {
    const current = project({ id: "current", repo_full_name: " LUKASKOURILCZ/AIFIRST " });
    const old = project({ id: "old", previous_repo_full_names: ["lukaskourilcz/aifirst"] });
    expect(updates([old, current])).toEqual([{ kind: "update", project: current, patch: { portfolio_key: "aifirst" } }]);
    expect(portfolioEntryFor(current)?.key).toBe("aifirst");
    const history = project({ id: "history", previous_repo_full_names: [" LUKASKOURILCZ/AIFIRST ", "lukaskourilcz/aifirst"] });
    expect(updates([history])).toEqual([{ kind: "update", project: history, patch: { portfolio_key: "aifirst" } }]);
  });
  it("does not mutate owner rows or their history while resolving a plan", () => {
    const row = project({ id: "frozen", name: "Owner name", slug: "owner-slug", engagement: "client", repo_full_name: "lukaskourilcz/quorum", previous_repo_full_names: ["lukaskourilcz/own-dashboard"] });
    Object.freeze(row.previous_repo_full_names); Object.freeze(row);
    expect(() => planPortfolioSync([row])).not.toThrow(); expect(row).toMatchObject({ name: "Owner name", slug: "owner-slug", engagement: "client" }); expect(row.portfolio_key).toBeUndefined();
  });
});


it("does not invent registry descriptions or categories for conflicting history or an unknown explicit key", () => {
  for (const row of [
    project({ portfolio_key: "future-product", repo_full_name: "lukaskourilcz/quorum" }),
    project({ previous_repo_full_names: ["lukaskourilcz/aifirst", "lukaskourilcz/own-dashboard"] }),
  ]) {
    expect(portfolioEntryFor(row)).toBeUndefined(); expect(projectSummary(row, "en")).toBeUndefined();
    expect(groupPortfolio([row])[0].category).toBe("other"); expect(projectSummary({ ...row, summary: "Owner description" }, "cs")).toBe("Owner description");
  }
  const current = project({ repo_full_name: "lukaskourilcz/quorum", previous_repo_full_names: ["lukaskourilcz/own-dashboard"] });
  expect(portfolioEntryFor(current)?.key).toBe("quorum"); expect(projectSummary(current, "en", { preview: true })).toBeUndefined();
});
