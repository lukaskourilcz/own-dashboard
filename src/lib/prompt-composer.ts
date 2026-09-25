import { categoryMatchesKind, type PromptKind } from "@/lib/prompt-kinds";

/**
 * Builds the text the Prompts copy action puts on the clipboard: the prompt
 * body with project placeholders expanded, a Project block, and the links an
 * agent should open. Pure and deterministic — no model call, no network — so
 * the preview and the clipboard always match.
 */

export const PROMPT_PLACEHOLDERS = [
  "{{project.name}}",
  "{{project.repo}}",
  "{{project.url}}",
  "{{project.dev_url}}",
] as const;

export type ComposerProject = {
  name: string;
  repo_full_name: string | null;
  url: string | null;
  dev_url?: string | null;
};

export type ComposerLink = {
  /** Library link id; the same link appears once even if both lists hold it. */
  id: string;
  title: string;
  url: string;
  note: string;
  /** Library category name, used to match the prompt's kind. */
  category?: string | null;
};

/** Stand-in for a project value that is not set. */
export const MISSING_VALUE = "—";

/** Expand the four `{{project.*}}` placeholders. Without a project the body
 * is returned unchanged, placeholders included. */
export function expandPromptPlaceholders(body: string, project: ComposerProject | null): string {
  if (!project) return body;
  const values: Record<string, string> = {
    name: project.name,
    repo: project.repo_full_name || MISSING_VALUE,
    url: project.url || MISSING_VALUE,
    dev_url: project.dev_url || MISSING_VALUE,
  };
  return body.replace(/\{\{\s*project\.(name|repo|url|dev_url)\s*\}\}/g, (_match, key: string) => values[key] ?? MISSING_VALUE);
}

/**
 * The links to list: the prompt's own links first, then the project's links
 * whose category matches the prompt's kind — or all of the project's links
 * when the prompt has none of its own. Each link appears once.
 */
export function linksToConsult({
  kind,
  promptLinks,
  projectLinks,
}: {
  kind: PromptKind;
  promptLinks: readonly ComposerLink[];
  projectLinks: readonly ComposerLink[];
}): ComposerLink[] {
  const fromProject =
    promptLinks.length === 0
      ? projectLinks
      : projectLinks.filter((link) => categoryMatchesKind(link.category, kind));
  const seen = new Set<string>();
  const result: ComposerLink[] = [];
  for (const link of [...promptLinks, ...fromProject]) {
    if (seen.has(link.id)) continue;
    seen.add(link.id);
    result.push(link);
  }
  return result;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function composePromptCopy({
  body,
  kind,
  project,
  promptLinks,
  projectLinks = [],
}: {
  body: string;
  kind: PromptKind;
  project: ComposerProject | null;
  promptLinks: readonly ComposerLink[];
  /** The chosen project's links; ignored without a project. */
  projectLinks?: readonly ComposerLink[];
}): string {
  const sections = [expandPromptPlaceholders(body, project).trim()];
  if (project) {
    const details = [project.name, project.repo_full_name, project.url, project.dev_url]
      .map((value) => oneLine(value ?? ""))
      .filter(Boolean);
    sections.push(`## Project\n${details.join(", ")}`);
  }
  const links = linksToConsult({ kind, promptLinks, projectLinks: project ? projectLinks : [] });
  if (links.length > 0) {
    sections.push(
      `## Links to consult\n${links
        .map((link) => [oneLine(link.title), link.url.trim(), oneLine(link.note)].filter(Boolean).join(" — "))
        .map((line) => `- ${line}`)
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}
