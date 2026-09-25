import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  groupProjectsByEngagement,
  orderProjectsByEngagement,
  projectEngagement,
  resolveProjectRef,
} from "@/lib/projects";
import type { ProjectEngagement } from "@/lib/types";

const project = (id: string, engagement?: ProjectEngagement, previous_slugs: string[] = []) => ({
  id,
  slug: id,
  engagement,
  previous_slugs,
});

describe("project engagement grouping", () => {
  it("puts own projects first and keeps the incoming order inside each group", () => {
    const list = [
      project("gym-plzen", "client"),
      project("dneskai", "own"),
      project("paris-claire", "client"),
      project("devshark"),
    ];
    const groups = groupProjectsByEngagement(list);
    expect(groups.own.map((item) => item.id)).toEqual(["dneskai", "devshark"]);
    expect(groups.client.map((item) => item.id)).toEqual(["gym-plzen", "paris-claire"]);
    expect(orderProjectsByEngagement(list).map((item) => item.id)).toEqual([
      "dneskai",
      "devshark",
      "gym-plzen",
      "paris-claire",
    ]);
  });

  it("treats rows written before the column existed as own", () => {
    expect(projectEngagement({})).toBe("own");
    expect(projectEngagement({ engagement: "client" })).toBe("client");
  });
});

describe("resolveProjectRef", () => {
  const list = [project("dneskai", "own", ["aifirst"]), project("devshark", "own", ["react-express-app"])];

  it("resolves the id or slug before an earlier slug", () => {
    expect(resolveProjectRef(list, "dneskai")?.id).toBe("dneskai");
    expect(resolveProjectRef(list, "aifirst")?.id).toBe("dneskai");
    expect(resolveProjectRef(list, "react-express-app")?.id).toBe("devshark");
    expect(resolveProjectRef(list, "quorum")).toBeUndefined();
  });

  it("lets a current slug win over another project's earlier slug", () => {
    const clash = [project("old-home", "own", ["reused"]), project("reused", "own")];
    expect(resolveProjectRef(clash, "reused")?.id).toBe("reused");
  });
});

describe("engagement and rename migration", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20260925090100_project_engagement_and_names.sql", import.meta.url),
    "utf8",
  );

  it("constrains engagement and marks the two freelance projects", () => {
    expect(sql).toMatch(/check \(engagement in \('own', 'client'\)\)/i);
    expect(sql).toMatch(/slug in \('gym-plzen', 'paris-claire'\)/i);
  });

  it("renames the three projects by slug and keeps the old slug resolvable", () => {
    expect(sql).toMatch(/\('aifirst', 'dneskai', 'DNESKAi'\)/);
    expect(sql).toMatch(/\('react-express-app', 'devshark', 'devShark'\)/);
    expect(sql).toMatch(/\('quorum', 'boardlessai', 'boardlessAI'\)/);
    expect(sql).toMatch(/array_append\(project\.previous_slugs, renamed\.old_slug\)/);
    expect(sql).not.toMatch(/repo_full_name\s*=/i);
  });
});
