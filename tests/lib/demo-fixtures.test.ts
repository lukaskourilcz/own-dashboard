import { describe, expect, it } from "vitest";
import { projects } from "@/lib/demo/fixtures";
import { portfolioEntryFor, projectSummary } from "@/lib/portfolio";

// /guest serves these fixtures to anyone, indexed. They may name the owner's
// public repositories, never a private one, and never show registry text.
describe("demo fixtures behind the public tour", () => {
  it("gives every project its own summary, so the tour never reads the registry", () => {
    for (const project of projects) {
      expect(project.summary, project.name).toBeTruthy();
      expect(projectSummary(project, "en", { preview: true })).toBe(project.summary);
      expect(projectSummary(project, "cs", { preview: true })).toBe(project.summary);
    }
  });

  it("does not list the private phone-app repository or its registry entry", () => {
    for (const project of projects) {
      expect(project.portfolio_key ?? null, project.name).not.toBe("phone-app");
      expect(project.repo_full_name ?? "", project.name).not.toContain("phone-app");
      expect(portfolioEntryFor(project)?.key, project.name).not.toBe("phone-app");
    }
  });

  it("falls back to the registry outside the preview only", () => {
    const bare = { summary: undefined, portfolio_key: "aifirst", repo_full_name: null, parent_id: null };
    expect(projectSummary(bare, "en", { preview: true })).toBeUndefined();
    expect(projectSummary(bare, "en")).toMatch(/AI and technology/);
  });
});
