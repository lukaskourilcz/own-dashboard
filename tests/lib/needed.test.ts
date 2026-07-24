import { describe, it, expect } from "vitest";
import { parseNeeded, removeNeededLine } from "@/lib/needed";
import type { GithubRepo } from "@/lib/github";

const repo = {
  id: 42,
  name: "own-dashboard",
  full_name: "me/own-dashboard",
  owner: "me",
  html_url: "https://github.com/me/own-dashboard",
} as GithubRepo;

describe("parseNeeded", () => {
  it("extracts bullet and task-list items, skipping done ones", () => {
    const md = [
      "# NEEDED",
      "",
      "Some intro prose that is not a task.",
      "- Set the PostHog key",
      "* Create the tugedr flag",
      "1. Wire the FX host",
      "- [ ] Open task",
      "- [x] Already done",
      "- [X] Also done",
      "",
    ].join("\n");
    const items = parseNeeded(md, repo, repo.html_url);
    expect(items.map((i) => i.text)).toEqual([
      "Set the PostHog key",
      "Create the tugedr flag",
      "Wire the FX host",
      "Open task",
    ]);
    expect(items[0].repoId).toBe("42");
    expect(items[0].owner).toBe("me");
    expect(items[0].raw).toBe("- Set the PostHog key");
  });

  it("returns nothing for a file with no list items", () => {
    expect(parseNeeded("# Title\n\nJust prose.\n", repo, null)).toEqual([]);
  });

  it("keeps duplicate lines addressable via distinct keys", () => {
    const items = parseNeeded("- ping\n- ping\n", repo, null);
    expect(items).toHaveLength(2);
    expect(items[0].key).not.toBe(items[1].key);
  });

  it("parses an [imp:N] marker and strips it from the title", () => {
    const items = parseNeeded(
      "- [ ] **Enable analytics** — see who visits. `[imp:2]`\n- No marker here\n",
      repo,
      null,
    );
    expect(items[0].importance).toBe(2);
    expect(items[0].text).toBe("**Enable analytics** — see who visits.");
    expect(items[1].importance).toBeNull();
    expect(items[1].text).toBe("No marker here");
  });

  it("accepts the marker without backticks and anywhere on the line", () => {
    const items = parseNeeded("- [imp:5] Ship the fix\n", repo, null);
    expect(items[0].importance).toBe(5);
    expect(items[0].text).toBe("Ship the fix");
  });

  it("reads an [imp:N] marker off an indented continuation line", () => {
    const items = parseNeeded(
      "- [ ] **Do the thing** — a long description that\n" +
        "  wraps onto a second line. `[imp:4]`\n" +
        "- [ ] Next task\n",
      repo,
      null,
    );
    expect(items[0].importance).toBe(4);
    // needed_raw stays the item's own line so completion-removal still works.
    expect(items[0].raw).toBe("- [ ] **Do the thing** — a long description that");
    expect(items[1].importance).toBeNull();
  });

  it("does not pull a marker across a blank line or the next item", () => {
    const items = parseNeeded(
      "- [ ] First\n\n  stray `[imp:3]`\n- [ ] Second `[imp:2]`\n",
      repo,
      null,
    );
    expect(items[0].importance).toBeNull();
    expect(items[1].importance).toBe(2);
  });

  it("parses the [owner:me|ai] marker and strips it from the title", () => {
    const items = parseNeeded(
      "- [ ] **Add a key** — do it. `[imp:3]` `[owner:me]`\n" +
        "- [ ] **Split the bundle** `[owner:ai]`\n" +
        "- [ ] No owner marker\n",
      repo,
      null,
    );
    expect(items[0].assignee).toBe("me");
    expect(items[0].text).toBe("**Add a key** — do it.");
    expect(items[1].assignee).toBe("ai");
    expect(items[2].assignee).toBeNull();
  });

  it("reads the owner marker off a continuation line too", () => {
    const items = parseNeeded(
      "- [ ] **Wrapped task** — a long line that\n  keeps going. `[imp:2]` `[owner:ai]`\n",
      repo,
      null,
    );
    expect(items[0].importance).toBe(2);
    expect(items[0].assignee).toBe("ai");
  });

  it("parses a [time:N] marker (minutes/hours) and strips it", () => {
    const items = parseNeeded(
      "- [ ] Quick fix `[time:15m]`\n" +
        "- [ ] Bigger job `[time:2h]`\n" +
        "- [ ] Mixed `[time:1h30m]`\n" +
        "- [ ] Bare `[time:45]`\n" +
        "- [ ] No time here\n",
      repo,
      null,
    );
    expect(items.map((i) => i.estimatedMinutes)).toEqual([15, 120, 90, 45, null]);
    expect(items[0].text).toBe("Quick fix");
  });

  it("parses a [kind:…] marker, validates it, and strips it", () => {
    const items = parseNeeded(
      "- [ ] Add a secret `[kind:setup]`\n" +
        "- [ ] Choose a name `[kind:decision]`\n" +
        "- [ ] Unknown kind `[kind:banana]`\n",
      repo,
      null,
    );
    expect(items[0].kind).toBe("setup");
    expect(items[0].text).toBe("Add a secret");
    expect(items[1].kind).toBe("decision");
    // An unrecognised kind stays null (only the five valid kinds are matched).
    expect(items[2].kind).toBeNull();
  });

  it("reads time and kind off a continuation line", () => {
    const items = parseNeeded(
      "- [ ] **Wrapped** — long line that\n  wraps. `[time:30m]` `[kind:deploy]`\n",
      repo,
      null,
    );
    expect(items[0].estimatedMinutes).toBe(30);
    expect(items[0].kind).toBe("deploy");
    expect(items[0].raw).toBe("- [ ] **Wrapped** — long line that");
  });
});

describe("removeNeededLine", () => {
  it("removes the first exact match and reports it", () => {
    const content = "- a\n- b\n- c\n";
    const { next, removed } = removeNeededLine(content, "- b");
    expect(removed).toBe(true);
    expect(next).toBe("- a\n- c\n");
  });

  it("removes only the first of duplicate lines", () => {
    const { next } = removeNeededLine("- x\n- x\n", "- x");
    expect(next).toBe("- x\n");
  });

  it("is a no-op when the line is already gone", () => {
    const { next, removed } = removeNeededLine("- a\n", "- missing");
    expect(removed).toBe(false);
    expect(next).toBe("- a\n");
  });

  it("round-trips with parseNeeded: checking an item drops it from the parse", () => {
    const md = "- keep me\n- remove me\n";
    const item = parseNeeded(md, repo, null).find((i) => i.text === "remove me")!;
    const { next } = removeNeededLine(md, item.raw);
    expect(parseNeeded(next, repo, null).map((i) => i.text)).toEqual(["keep me"]);
  });
});
