import { describe, expect, it } from "vitest";
import { buildNeededRows } from "@/lib/needed-sync";
import { cronSeedsForProject } from "@/lib/project-cron-seeds";
import {
  findProjectForTask,
  planRepositorySync,
  projectRepoNames,
  repositoryIdentityUpdate,
  taskBelongsToProject,
  unresolvedRepositoryProjects,
} from "@/lib/project-match";
import type { GithubRepo } from "@/lib/github";
import type { Todo } from "@/lib/types";

type TestProject = {
  id: string;
  slug: string;
  repo_full_name: string | null;
  repo_id?: number | null;
  previous_repo_full_names?: string[];
};

const dneskai: TestProject = {
  id: "proj-dneskai",
  slug: "dneskai",
  repo_full_name: "lukaskourilcz/aifirst",
  repo_id: 101,
  previous_repo_full_names: [],
};

const task = (overrides: Partial<Todo>): Pick<Todo, "project_id" | "repo_id" | "repo_full_name"> => ({
  project_id: null,
  repo_id: null,
  repo_full_name: null,
  ...overrides,
});

describe("taskBelongsToProject", () => {
  it("prefers an explicit project id", () => {
    expect(taskBelongsToProject(task({ project_id: "proj-dneskai" }), dneskai)).toBe(true);
    expect(
      taskBelongsToProject(
        task({ project_id: "other", repo_full_name: "lukaskourilcz/aifirst" }),
        dneskai,
      ),
    ).toBe(false);
  });

  it("matches the repository id, the current name and any previous name", () => {
    const renamed = {
      ...dneskai,
      repo_full_name: "lukaskourilcz/DNESKAi",
      previous_repo_full_names: ["lukaskourilcz/aifirst"],
    };
    expect(taskBelongsToProject(task({ repo_id: "101", repo_full_name: "someone/else" }), renamed)).toBe(true);
    expect(taskBelongsToProject(task({ repo_full_name: "LUKASKOURILCZ/dneskai" }), renamed)).toBe(true);
    expect(taskBelongsToProject(task({ repo_full_name: "lukaskourilcz/aifirst" }), renamed)).toBe(true);
    expect(taskBelongsToProject(task({ repo_full_name: "lukaskourilcz/quorum" }), renamed)).toBe(false);
    expect(taskBelongsToProject(task({}), renamed)).toBe(false);
  });

  it("finds the owning project from a list", () => {
    const projects = [dneskai, { id: "proj-devshark", slug: "devshark", repo_full_name: "lukaskourilcz/react-express-app", repo_id: 102 }];
    expect(findProjectForTask(task({ repo_id: "102" }), projects)?.id).toBe("proj-devshark");
    expect(findProjectForTask(task({ project_id: "missing" }), projects)).toBeUndefined();
  });

  it("keeps NEEDED.md tasks attached after a rename through the repository id", () => {
    const repo: GithubRepo = {
      id: 101,
      name: "DNESKAi",
      full_name: "lukaskourilcz/DNESKAi",
      owner: "lukaskourilcz",
      description: null,
      private: false,
      fork: false,
      archived: false,
      html_url: "https://github.com/lukaskourilcz/DNESKAi",
      default_branch: "main",
      language: "TypeScript",
      stargazers_count: 0,
      pushed_at: null,
      updated_at: null,
    };
    const [row] = buildNeededRows("u1", repo, "- [ ] **Ship it** — now.", null, "2026-09-25T10:00:00Z");
    expect(row?.repo_id).toBe("101");
    // The project still carries the pre-rename name, yet the id matches.
    expect(taskBelongsToProject(row!, dneskai)).toBe(true);
  });
});

describe("repository identity", () => {
  it("lists current and previous names once, lowercased", () => {
    expect(
      projectRepoNames({
        id: "p",
        repo_full_name: "Owner/New",
        previous_repo_full_names: ["owner/old", "OWNER/new"],
      }),
    ).toEqual(["owner/new", "owner/old"]);
  });

  it("records the old name when an id match carries a new name", () => {
    expect(
      repositoryIdentityUpdate(dneskai, { id: 101, full_name: "lukaskourilcz/DNESKAi" }),
    ).toEqual({
      repo_full_name: "lukaskourilcz/DNESKAi",
      previous_repo_full_names: ["lukaskourilcz/aifirst"],
    });
    expect(repositoryIdentityUpdate(dneskai, { id: 101, full_name: "lukaskourilcz/aifirst" })).toBeNull();
    // A casing-only change updates the name without a "previous" entry.
    expect(
      repositoryIdentityUpdate(dneskai, { id: 101, full_name: "lukaskourilcz/AIfirst" }),
    ).toEqual({ repo_full_name: "lukaskourilcz/AIfirst" });
  });
});

describe("planRepositorySync", () => {
  it("updates the existing project on a rename instead of creating a duplicate", () => {
    const plan = planRepositorySync(
      [{ id: 101, full_name: "lukaskourilcz/DNESKAi" }],
      [dneskai],
    );
    expect(plan.missing).toEqual([]);
    expect(plan.linked.map((entry) => entry.project.id)).toEqual(["proj-dneskai"]);
    expect(plan.updates).toEqual([
      {
        project: dneskai,
        repo: { id: 101, full_name: "lukaskourilcz/DNESKAi" },
        update: {
          repo_full_name: "lukaskourilcz/DNESKAi",
          previous_repo_full_names: ["lukaskourilcz/aifirst"],
        },
      },
    ]);
  });

  it("self-heals a missing id by name and only creates projects for new repositories", () => {
    const legacy = { id: "proj-devshark", slug: "devshark", repo_full_name: "lukaskourilcz/react-express-app", repo_id: null };
    const plan = planRepositorySync(
      [
        { id: 102, full_name: "lukaskourilcz/React-Express-App" },
        { id: 103, full_name: "lukaskourilcz/brand-new" },
      ],
      [legacy],
    );
    expect(plan.updates.map((entry) => entry.update)).toEqual([{ repo_id: 102 }]);
    expect(plan.missing).toEqual([{ id: 103, full_name: "lukaskourilcz/brand-new" }]);
  });

  it("never duplicates a name that another repository id already owns", () => {
    const plan = planRepositorySync(
      [{ id: 999, full_name: "lukaskourilcz/aifirst" }],
      [dneskai],
    );
    expect(plan.missing).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  it("flags name-only projects the rename lookup should resolve before creating", () => {
    const stale = { id: "proj-boardless", slug: "boardlessai", repo_full_name: "lukaskourilcz/quorum", repo_id: null };
    const plan = planRepositorySync([{ id: 104, full_name: "lukaskourilcz/boardlessAI" }], [stale]);
    expect(plan.missing).toEqual([{ id: 104, full_name: "lukaskourilcz/boardlessAI" }]);
    const unresolved = unresolvedRepositoryProjects(plan, [stale]);
    expect(unresolved.map((project) => project.id)).toEqual(["proj-boardless"]);

    // The lookup of the old name returns the renamed repository.
    const update = repositoryIdentityUpdate(stale, { id: 104, full_name: "lukaskourilcz/boardlessAI" });
    const healed = { ...stale, ...update };
    const replanned = planRepositorySync([{ id: 104, full_name: "lukaskourilcz/boardlessAI" }], [healed]);
    expect(replanned.missing).toEqual([]);
    expect(replanned.updates).toEqual([]);
    expect(healed.previous_repo_full_names).toEqual(["lukaskourilcz/quorum"]);
  });
});

describe("cron seeds", () => {
  it("are keyed by the project slug, not the repository name", () => {
    expect(cronSeedsForProject({ slug: "dneskai" }).length).toBeGreaterThan(0);
    // A project still on its pre-rename slug keeps the seeds through previous_slugs.
    expect(cronSeedsForProject({ slug: "other", previous_slugs: ["dneskai"] }).length).toBeGreaterThan(0);
    expect(cronSeedsForProject({ slug: "lukaskourilcz/aifirst" })).toEqual([]);
  });
});
