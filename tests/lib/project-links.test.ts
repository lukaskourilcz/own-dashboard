import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLinkExport, linkExportMarkdown, shapeLinkExport } from "@/lib/link-export";
import {
  chipOverflow,
  linkIdsForProject,
  linksForProject,
  nextProjectLinkOrder,
  projectsUsingLink,
} from "@/lib/project-links";
import type { AiLink, ProjectLink } from "@/lib/types";
// Plain-JS planner shared with scripts/backfill-project-links.mjs.
import { planProjectLinkBackfill, resolveRelevanceProject } from "../../scripts/lib/project-relevance.mjs";

const TS = "2026-09-25T10:00:00Z";
const link = (id: string, title = id): AiLink => ({
  id, title, url: `https://example.com/${id}`, user_id: "owner", category_id: null,
  description: null, pricing: "free", created_at: TS, updated_at: TS,
});
const relation = (id: string, project_id: string, ai_link_id: string, sort_order = 0, role: ProjectLink["role"] = "uses", note = ""): ProjectLink => ({
  id, user_id: "owner", project_id, ai_link_id, role, note, sort_order, created_at: TS, updated_at: TS,
});
const projects = [
  { id: "p-dneskai", name: "DNESKAi", slug: "dneskai", previous_slugs: ["aifirst"], repo_full_name: "lukaskourilcz/aifirst", previous_repo_full_names: [] as string[] },
  { id: "p-devshark", name: "devShark", slug: "devshark", previous_slugs: ["react-express-app"], repo_full_name: "lukaskourilcz/devShark", previous_repo_full_names: ["lukaskourilcz/react-express-app"] },
];

describe("project links", () => {
  const relations = [
    relation("r1", "p-dneskai", "vercel", 1, "tool", "Hosts the site"),
    relation("r2", "p-dneskai", "search-console", 0),
    relation("r3", "p-devshark", "vercel", 0, "tool"),
    relation("r4", "p-dneskai", "deleted-link", 2),
  ];
  const links = [link("vercel", "Vercel"), link("search-console", "Search Console")];

  it("lists a project's links in its own order and skips missing links", () => {
    expect(linksForProject("p-dneskai", relations, links).map((entry) => entry.link.title)).toEqual([
      "Search Console",
      "Vercel",
    ]);
    expect(linkIdsForProject("p-dneskai", relations)).toEqual(new Set(["vercel", "search-console", "deleted-link"]));
    expect(nextProjectLinkOrder("p-dneskai", relations)).toBe(3);
    expect(nextProjectLinkOrder("p-new", relations)).toBe(0);
  });

  it("names the projects that use a link and caps the chips at three", () => {
    expect(projectsUsingLink("vercel", relations, projects).map((usage) => usage.project.name)).toEqual([
      "devShark",
      "DNESKAi",
    ]);
    expect(chipOverflow(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], hidden: 2 });
    expect(chipOverflow(["a"])).toEqual({ shown: ["a"], hidden: 0 });
  });

  it("exports the relations in the detailed JSON shape as version 3", () => {
    const data = buildLinkExport(links, [], "all", "", { relations: { projectLinks: relations, projects } });
    expect(data.version).toBe(3);
    const vercel = data.items.find((item) => item.title === "Vercel");
    expect(vercel?.usedBy).toEqual([
      { project: "devShark", slug: "devshark", role: "tool", note: "" },
      { project: "DNESKAi", slug: "dneskai", role: "tool", note: "Hosts the site" },
    ]);
    expect(shapeLinkExport(data, "detailed")).toBe(data);
    expect(linkExportMarkdown(data)).toContain("- DNESKAi (tool): Hosts the site");
    expect(JSON.stringify(data)).not.toContain("owner");
    expect(buildLinkExport(links, [], "all").items[0]?.usedBy).toEqual([]);
  });
});

describe("project_relevance backfill", () => {
  it("resolves repository text by name, previous name, bare name, slug or display name", () => {
    expect(resolveRelevanceProject("lukaskourilcz/aifirst", projects)?.id).toBe("p-dneskai");
    expect(resolveRelevanceProject("react-express-app", projects)?.id).toBe("p-devshark");
    expect(resolveRelevanceProject("DNESKAi", projects)?.id).toBe("p-dneskai");
    expect(resolveRelevanceProject("aifirst", projects)?.id).toBe("p-dneskai");
    expect(resolveRelevanceProject("quorum", projects)).toBeNull();
  });

  it("plans one uses row per resolved pair with the reason as note", () => {
    const plan = planProjectLinkBackfill(
      [
        { id: "vercel", title: "Vercel", project_relevance: [
          { repository: "aifirst", reason: "Hosts the magazine" },
          { repository: "lukaskourilcz/react-express-app", reason: "Hosts the client" },
          { repository: "aifirst", reason: "Duplicate" },
          { repository: "quorum", reason: "Not a project here" },
        ] },
        { id: "figma", title: "Figma", project_relevance: [{ repository: "devShark", reason: "" }] },
      ],
      projects,
      [{ project_id: "p-devshark", ai_link_id: "vercel", sort_order: 4 }],
    );
    expect(plan.rows).toEqual([
      { project_id: "p-dneskai", ai_link_id: "vercel", role: "uses", note: "Hosts the magazine", sort_order: 0 },
      { project_id: "p-devshark", ai_link_id: "figma", role: "uses", note: "", sort_order: 5 },
    ]);
    expect(plan.unresolved).toEqual([{ link: "Vercel", repository: "quorum" }]);
  });
});

describe("project_links migration", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260925090300_project_links.sql", import.meta.url), "utf8");

  it("is own-only with ownership checks on both parents and cascades", () => {
    expect(sql).toMatch(/project_id uuid not null references public\.projects\(id\) on delete cascade/);
    expect(sql).toMatch(/ai_link_id uuid not null references public\.ai_links\(id\) on delete cascade/);
    expect(sql).toMatch(/unique \(project_id, ai_link_id\)/);
    expect(sql).toMatch(/role in \('uses', 'reference', 'tool'\)/);
    expect(sql).toMatch(/project_links enable row level security/);
    expect(sql.match(/from public\.projects p where p\.id = project_id and p\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(2);
    expect(sql.match(/from public\.ai_links l where l\.id = ai_link_id and l\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/to anon/);
  });
});
