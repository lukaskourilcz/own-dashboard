import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MAX_DETECTED_REPOSITORIES } from "@/lib/stack-detection";
import { detectProjectStacks, type GitHubFetch, type StackProject } from "@/lib/stack-detection-server";

const ABOUT = `# Demo

## Tech stack

- **Next.js and TypeScript** — the web app

## Third-party libraries

- **Supabase** — database and auth
`;

/** A GitHub stand-in: `files` maps "owner/repo/path" to a body or a status. */
function github(files: Record<string, string | number>, visible: Record<string, number> = {}): { fetcher: GitHubFetch; calls: string[] } {
  const calls: string[] = [];
  const fetcher: GitHubFetch = async (path, init) => {
    calls.push(path);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const contents = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(path);
    if (contents) {
      const value = files[`${contents[1]}/${contents[2]}`];
      if (typeof value === "string") return new Response(value, { status: 200 });
      return new Response(null, { status: value ?? 404 });
    }
    const repo = /^\/repos\/([^/]+\/[^/]+)$/.exec(path);
    return new Response(null, { status: repo ? visible[repo[1]!] ?? 200 : 500 });
  };
  return { fetcher, calls };
}

const project = (id: string, repo: string | null, parent: string | null = null): StackProject => ({
  id,
  name: id,
  repo_full_name: repo,
  parent_id: parent,
});

describe("detectProjectStacks", () => {
  it("reads about-project.md, falls back to package.json and reports every project", async () => {
    const { fetcher } = github({
      "me/dashboard/about-project.md": ABOUT,
      "me/reader/about-project.md": "# Reader\n\n## Tech stack\n\n- **Reader:** Next.js and React\n",
      "me/reader/package.json": JSON.stringify({ dependencies: { next: "16", react: "19" }, devDependencies: { vitest: "4" } }),
      "me/empty/about-project.md": "# Nothing listed\n",
      "me/private/about-project.md": 404,
      "me/private/package.json": 404,
      "me/gone/about-project.md": 404,
      "me/gone/package.json": 404,
      "me/flaky/about-project.md": 502,
    }, { "me/private": 404, "me/gone": 200 });
    const result = await detectProjectStacks(
      [
        project("dashboard", "me/dashboard"),
        project("reader", "me/reader"),
        project("empty", "me/empty"),
        project("private", "me/private"),
        project("gone", "me/gone"),
        project("flaky", "me/flaky"),
        project("venture", null, "dashboard"),
        project("client", null),
      ],
      fetcher,
      "2026-09-26T10:00:00Z",
    );
    expect(result.connected).toBe(true);
    expect(result.checkedAt).toBe("2026-09-26T10:00:00Z");
    expect(result.projects.map((status) => [status.projectId, status.status, status.source, status.toolCount])).toEqual([
      ["dashboard", "ok", "about-project", 3],
      ["reader", "ok", "package-json", 2],
      ["empty", "empty", "about-project", 0],
      ["private", "unreadable", null, 0],
      ["gone", "not-found", null, 0],
      ["flaky", "error", null, 0],
      ["venture", "inherited", null, 0],
      ["client", "no-repository", null, 0],
    ]);
    expect(result.projects.find((status) => status.projectId === "venture")?.parentName).toBe("dashboard");
    expect(result.tools.map((tool) => [tool.name, tool.projects.map((usage) => usage.id)])).toEqual([
      ["next", ["reader"]],
      ["Next.js", ["dashboard"]],
      ["react", ["reader"]],
      ["Supabase", ["dashboard"]],
      ["TypeScript", ["dashboard"]],
    ]);
  });

  it("reports a disconnected GitHub account without partial results", async () => {
    const { fetcher } = github({ "me/dashboard/about-project.md": 401 });
    const result = await detectProjectStacks([project("dashboard", "me/dashboard")], fetcher);
    expect(result).toMatchObject({ connected: false, projects: [], tools: [] });
  });

  it("bounds the fan-out and marks the rest as skipped", async () => {
    const projects = Array.from({ length: MAX_DETECTED_REPOSITORIES + 2 }, (_, index) => project(`p${index}`, `me/repo${index}`));
    const files = Object.fromEntries(projects.map((item) => [`${item.repo_full_name}/about-project.md`, ABOUT]));
    const { fetcher, calls } = github(files);
    const result = await detectProjectStacks(projects, fetcher);
    expect(calls).toHaveLength(MAX_DETECTED_REPOSITORIES);
    expect(result.projects.filter((status) => status.status === "skipped")).toHaveLength(2);
    expect(result.tools.find((tool) => tool.key === "supabase")?.projects).toHaveLength(MAX_DETECTED_REPOSITORIES);
  });

  it("never asks GitHub about a malformed repository name", async () => {
    const { fetcher, calls } = github({});
    const result = await detectProjectStacks([project("odd", "not a repo")], fetcher);
    expect(calls).toEqual([]);
    expect(result.projects[0]?.status).toBe("unreadable");
  });
});
