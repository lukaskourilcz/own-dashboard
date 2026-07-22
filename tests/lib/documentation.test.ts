import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const rootDocuments = ["README.md", "DOCS.md", "AGENTS.md", "CLAUDE.md", "NEEDED.md"];
const documentationRoots = ["docs", ".claude/agents", ".claude/commands", ".claude/skills"];

function markdownFiles(path: string): string[] {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) return [];
  if (!statSync(absolutePath).isDirectory()) return extname(absolutePath) === ".md" ? [absolutePath] : [];

  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) =>
    markdownFiles(join(path, entry.name)),
  );
}

function localDestinations(markdown: string): string[] {
  return Array.from(markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g), ([, rawDestination]) => {
    const trimmed = rawDestination.trim();
    const destination = trimmed.startsWith("<")
      ? trimmed.slice(1, trimmed.indexOf(">"))
      : trimmed.split(/\s+["']/)[0];
    return destination.split("#", 1)[0].split("?", 1)[0];
  }).filter(
    (destination) =>
      destination &&
      !destination.startsWith("#") &&
      !destination.startsWith("/") &&
      !/^[a-z][a-z\d+.-]*:/i.test(destination),
  );
}

describe("project documentation", () => {
  it("keeps every local Markdown link resolvable", () => {
    const files = [...rootDocuments.flatMap(markdownFiles), ...documentationRoots.flatMap(markdownFiles)];
    const brokenLinks = files.flatMap((file) =>
      localDestinations(readFileSync(file, "utf8")).flatMap((destination) => {
        const resolved = resolve(dirname(file), decodeURIComponent(destination));
        return existsSync(resolved) ? [] : [`${file.slice(repositoryRoot.length + 1)} -> ${destination}`];
      }),
    );

    expect(brokenLinks).toEqual([]);
  });
});
