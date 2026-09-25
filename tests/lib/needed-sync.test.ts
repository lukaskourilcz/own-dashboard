import { describe, it, expect } from "vitest";
import {
  buildNeededRows,
  diffNeededTodos,
  dueDateFromGenerated,
  neededKey,
  removeFinishedFromNeeded,
  scanNeededRepos,
  TASK_TIMER_DAYS,
  type NeededCommit,
} from "@/lib/needed-sync";
import type { NeededFileResult } from "@/lib/needed";
import type { GithubRepo } from "@/lib/github";
import type { Todo } from "@/lib/types";

const repo = {
  id: 42,
  name: "own-dashboard",
  full_name: "me/own-dashboard",
  owner: "me",
  html_url: "https://github.com/me/own-dashboard",
} as GithubRepo;

const NEEDED = ["# NEEDED", "", "- [ ] First task", "- [ ] Second task"].join(
  "\n",
);

function todo(overrides: Partial<Todo>): Todo {
  return {
    id: "x",
    user_id: "u",
    title: "t",
    done: false,
    due_date: null,
    category: null,
    created_at: "",
    source: null,
    repo_id: null,
    repo_full_name: null,
    repo_owner: null,
    repo_name: null,
    repo_url: null,
    needed_raw: null,
    generated_at: null,
    importance: null,
    ...overrides,
  };
}

describe("dueDateFromGenerated", () => {
  it("adds the 7-day timer and returns a date-only string", () => {
    expect(dueDateFromGenerated("2026-01-01T10:00:00.000Z")).toBe("2026-01-08");
    expect(TASK_TIMER_DAYS).toBe(7);
  });
});

describe("buildNeededRows", () => {
  it("builds a rich card row per open item with repo context + timer", () => {
    const rows = buildNeededRows(
      "u",
      repo,
      NEEDED,
      repo.html_url,
      "2026-01-01T00:00:00.000Z",
    );
    expect(rows).toHaveLength(2);
    const [first] = rows;
    expect(first).toMatchObject({
      user_id: "u",
      title: "First task",
      category: "own-dashboard",
      done: false,
      source: "github",
      repo_id: "42",
      repo_full_name: "me/own-dashboard",
      repo_owner: "me",
      repo_name: "own-dashboard",
      repo_url: "https://github.com/me/own-dashboard",
      needed_raw: "- [ ] First task",
      generated_at: "2026-01-01T00:00:00.000Z",
      due_date: "2026-01-08",
    });
  });
});

describe("diffNeededTodos", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const fresh = buildNeededRows("u", repo, NEEDED, repo.html_url, now);

  it("inserts items that aren't yet todos", () => {
    const { toInsert, toDeleteIds } = diffNeededTodos(
      new Set(["42"]),
      fresh,
      [],
    );
    expect(toInsert).toHaveLength(2);
    expect(toDeleteIds).toEqual([]);
  });

  it("skips items already present (matched by source line)", () => {
    const existing = [
      todo({
        id: "a",
        source: "github",
        repo_id: "42",
        needed_raw: "- [ ] First task",
        title: "First task",
      }),
    ];
    const { toInsert, toDeleteIds } = diffNeededTodos(
      new Set(["42"]),
      fresh,
      existing,
    );
    expect(toInsert.map((r) => r.title)).toEqual(["Second task"]);
    expect(toDeleteIds).toEqual([]);
  });

  it("deletes an open github task whose source line vanished", () => {
    const existing = [
      todo({
        id: "stale",
        source: "github",
        repo_id: "42",
        needed_raw: "- [ ] Removed task",
        title: "Removed task",
      }),
    ];
    const { toDeleteIds } = diffNeededTodos(new Set(["42"]), fresh, existing);
    expect(toDeleteIds).toEqual(["stale"]);
  });

  it("never deletes finished tasks or tasks from unscanned repos", () => {
    const existing = [
      todo({
        id: "done",
        done: true,
        source: "github",
        repo_id: "42",
        needed_raw: "- [ ] Removed task",
        title: "Removed task",
      }),
      todo({
        id: "other-repo",
        source: "github",
        repo_id: "99",
        needed_raw: "- [ ] Some task",
        title: "Some task",
      }),
    ];
    const { toDeleteIds } = diffNeededTodos(new Set(["42"]), fresh, existing);
    expect(toDeleteIds).toEqual([]);
  });

  it("leaves manual tasks alone", () => {
    const existing = [todo({ id: "m", source: null, title: "Manual" })];
    const { toDeleteIds } = diffNeededTodos(new Set(["42"]), fresh, existing);
    expect(toDeleteIds).toEqual([]);
  });
});

describe("neededKey", () => {
  it("keys on the source line, falling back to the title", () => {
    expect(neededKey("42", "- [ ] A", "A")).toBe("42::- [ ] A");
    expect(neededKey("42", null, "A Title")).toBe("42::a title");
  });
});

// The Tasks panel's Refresh and "Delete from NEEDED.md" paths, driven through
// the same helpers the panel calls, against a fake GitHub.
describe("Tasks refresh across NEEDED.md locations", () => {
  const repoOf = (id: number, name: string) =>
    ({
      id,
      name,
      full_name: `me/${name}`,
      owner: "me",
      html_url: `https://github.com/me/${name}`,
    }) as GithubRepo;
  const rootRepo = repoOf(1, "react-express-app");
  const docsRepo = repoOf(2, "quorum");
  const goneRepo = repoOf(3, "archived-notes");
  const flakyRepo = repoOf(4, "flaky");

  const files: Record<string, NeededFileResult> = {
    "react-express-app": {
      kind: "ok",
      path: "NEEDED.md",
      content: "- [ ] Root task `[imp:3]`",
      htmlUrl: null,
    },
    quorum: {
      kind: "ok",
      path: "docs/NEEDED.md",
      content: "- [ ] Kept quorum task\n- [ ] New quorum task `[owner:ai]`",
      htmlUrl: null,
    },
    "archived-notes": { kind: "not-found" },
    flaky: { kind: "error" },
  };
  const load = async (_owner: string, repo: string) => files[repo];

  const imported = (repo: GithubRepo, id: string, raw: string, done = false) =>
    todo({
      id,
      done,
      source: "github",
      repo_id: String(repo.id),
      repo_owner: "me",
      repo_name: repo.name,
      needed_raw: raw,
      title: raw.replace("- [ ] ", ""),
    });

  it("imports a docs/NEEDED.md list and keeps tasks whose file is missing", async () => {
    const scan = await scanNeededRepos(
      "u",
      [rootRepo, docsRepo, goneRepo, flakyRepo],
      "2026-09-25T00:00:00.000Z",
      load,
    );
    expect([...scan.scanned].sort()).toEqual(["1", "2"]);
    expect(scan.missing).toEqual(["me/archived-notes"]);
    expect(scan.freshRows.map((r) => r.needed_raw)).toEqual([
      "- [ ] Root task `[imp:3]`",
      "- [ ] Kept quorum task",
      "- [ ] New quorum task `[owner:ai]`",
    ]);

    const existing = [
      imported(docsRepo, "q-kept", "- [ ] Kept quorum task"),
      imported(docsRepo, "q-stale", "- [ ] Quorum task that was removed"),
      imported(goneRepo, "gone-open", "- [ ] Task in a file that 404s"),
      imported(flakyRepo, "flaky-open", "- [ ] Task behind a 500"),
    ];
    const { toInsert, toDeleteIds } = diffNeededTodos(
      scan.scanned,
      scan.freshRows,
      existing,
    );
    // Only the quorum line that left docs/NEEDED.md goes; the 404 and the
    // transient error cost nothing.
    expect(toDeleteIds).toEqual(["q-stale"]);
    expect(toInsert.map((r) => r.needed_raw)).toEqual([
      "- [ ] Root task `[imp:3]`",
      "- [ ] New quorum task `[owner:ai]`",
    ]);
  });

  it("aborts the scan when GitHub is disconnected", async () => {
    await expect(
      scanNeededRepos("u", [rootRepo], "2026-09-25T00:00:00.000Z", async () => ({
        kind: "disconnected",
      })),
    ).rejects.toThrow("disconnected");
  });

  it("commits finished-task removals to the path the file was found at", async () => {
    const commits: Parameters<NeededCommit>[0][] = [];
    const commit: NeededCommit = async (input) => {
      commits.push(input);
      return { ok: true, result: {} as never };
    };
    const cleared = await removeFinishedFromNeeded(
      [
        imported(docsRepo, "q-done", "- [ ] Kept quorum task", true),
        imported(docsRepo, "q-open", "- [ ] New quorum task `[owner:ai]`"),
        imported(goneRepo, "gone-done", "- [ ] Task in a file that 404s", true),
        imported(flakyRepo, "flaky-done", "- [ ] Task behind a 500", true),
      ],
      commit,
      load,
    );
    expect(commits).toEqual([
      {
        owner: "me",
        repo: "quorum",
        path: "docs/NEEDED.md",
        content: "- [ ] New quorum task `[owner:ai]`",
        count: 1,
      },
    ]);
    // Open tasks are never cleared; a missing or unreadable file keeps its rows.
    expect(cleared).toEqual(["q-done"]);
  });

  it("keeps the rows when the commit fails", async () => {
    const cleared = await removeFinishedFromNeeded(
      [imported(rootRepo, "r-done", "- [ ] Root task `[imp:3]`", true)],
      async () => ({ ok: false, status: 409, error: "conflict" }),
      load,
    );
    expect(cleared).toEqual([]);
  });

  it("clears rows whose line is already gone without committing", async () => {
    const commit = async () => {
      throw new Error("should not commit");
    };
    const cleared = await removeFinishedFromNeeded(
      [imported(rootRepo, "r-old", "- [ ] Already removed upstream", true)],
      commit,
      load,
    );
    expect(cleared).toEqual(["r-old"]);
  });
});
