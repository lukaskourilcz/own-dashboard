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
