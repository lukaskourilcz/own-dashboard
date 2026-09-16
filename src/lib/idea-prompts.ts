import { projectForRepository } from "@/lib/link-references";
import type { AiLink, Project } from "@/lib/types";

/**
 * Turn an Idea from the library into a ready-to-paste prompt.
 *
 * Deterministic on purpose: the app has no LLM-backed feature and this one
 * stays that way. The prompt is assembled from the idea's own fields, so it
 * never says more than the idea record does; placeholders use [square
 * brackets] like the curated prompts.
 */
export type IdeaPromptDraft = {
  ideaId: string;
  name: string;
  description: string;
  body: string;
  /** The first relevance entry that resolves to a project, when any does. */
  project: Project | null;
};

const MAX_NAME = 120;

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function lines(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

export function ideaPromptDraft(idea: AiLink, projects: readonly Project[]): IdeaPromptDraft {
  const relevance = idea.project_relevance ?? [];
  const resolved = relevance
    .map((entry) => ({ entry, project: projectForRepository(entry.repository, projects) }))
    .filter((item): item is { entry: { repository: string; reason: string }; project: Project } => item.project !== null);
  const project = resolved[0]?.project ?? null;
  const sources = (idea.source_urls ?? []).filter((url) => /^https?:\/\//i.test(url));
  const targets = resolved.length
    ? resolved.map(({ entry, project: target }) => `${target.name}: ${entry.reason}`)
    : relevance.map((entry) => `${entry.repository}: ${entry.reason}`);

  const body = [
    `Implement this idea${project ? ` in the ${project.name} repository${project.repo_full_name ? ` (${project.repo_full_name})` : ""}` : ""}.`,
    "",
    `Idea: ${idea.title.trim()}`,
    "",
    "What it is:",
    (idea.description ?? "").trim() || "[describe the idea]",
    "",
    ...(targets.length ? ["Why it fits:", lines(targets), ""] : []),
    ...(idea.rating_rationale ? ["Expected value:", idea.rating_rationale.trim(), ""] : []),
    ...(idea.pricing_evidence ? ["Cost evidence:", idea.pricing_evidence.trim(), ""] : []),
    ...(sources.length ? ["Sources to read first:", lines(sources), ""] : []),
    "Before writing code:",
    lines([
      "read the repository's CLAUDE.md, AGENTS.md and the documents they point to, and keep every documented product invariant",
      "check whether the idea, or part of it, already exists in the code; report what exists before changing anything",
      "reuse existing components, tokens, loaders and helpers instead of creating parallel ones",
    ]),
    "",
    "Deliver:",
    lines([
      "the smallest coherent change that makes the idea real, with tests for new logic",
      "EN and CS copy of equal quality where the change has user-facing text",
      "the repository's own validation commands run and reported with real results",
      "a short summary of what shipped, what was left out and why, and the manual steps the owner still has to take",
    ]),
    "",
    "Constraints: [add scope limits, budget or deadlines here]",
  ].join("\n");

  return {
    ideaId: idea.id,
    name: clip(idea.title, MAX_NAME),
    description: clip(idea.rating_rationale ?? idea.description ?? "", 160),
    body,
    project,
  };
}

/** Drafts for every idea in the library that has no prompt of the same name yet. */
export function ideaPromptDrafts(
  links: readonly AiLink[],
  projects: readonly Project[],
  existingPromptNames: readonly string[],
): IdeaPromptDraft[] {
  const taken = new Set(existingPromptNames.map((name) => name.trim().toLowerCase()));
  return links
    .filter((link) => link.record_type === "idea")
    .map((idea) => ideaPromptDraft(idea, projects))
    .filter((draft) => !taken.has(draft.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
}
