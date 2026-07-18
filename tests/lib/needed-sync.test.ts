import { describe, it, expect } from "vitest";
import {
  buildNeededRows,
  diffNeededTodos,
  dueDateFromGenerated,
  neededKey,
  TASK_TIMER_DAYS,
} from "@/lib/needed-sync";
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
