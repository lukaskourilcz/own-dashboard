import type { Prompt } from "@/lib/types";

/**
 * The kinds of job a prompt does, in the fixed order the Prompts page shows
 * them. `other` collects everything else and is always last.
 */
export const PROMPT_KINDS = [
  "design",
  "audit",
  "competition",
  "ux-ui",
  "analysis",
  "documentation",
  "new-project",
  "seo",
  "marketing",
  "other",
] as const;

export type PromptKind = (typeof PROMPT_KINDS)[number];

export function isPromptKind(value: unknown): value is PromptKind {
  return typeof value === "string" && (PROMPT_KINDS as readonly string[]).includes(value);
}

/** A prompt's kind; rows written before the column existed are `other`. */
export function promptKind(prompt: Pick<Prompt, "kind">): PromptKind {
  return isPromptKind(prompt.kind) ? prompt.kind : "other";
}

/**
 * Words that identify library categories relevant to each kind. Category
 * names are the owner's own, in English or Czech, so the match is by whole
 * word after lowercasing and removing diacritics (see `categoryMatchesKind`).
 */
export const PROMPT_KIND_CATEGORY_WORDS: Record<PromptKind, readonly string[]> = {
  design: ["design", "ui", "fonts", "font", "typography", "color", "colors", "icons", "icon", "illustration", "images", "graphics", "grafika", "barvy", "ikony", "pisma"],
  audit: ["security", "performance", "accessibility", "a11y", "testing", "quality", "audit", "monitoring", "bezpecnost", "vykon", "pristupnost", "testovani"],
  competition: ["competition", "competitors", "market", "research", "ideas", "inspiration", "konkurence", "trh", "inspirace", "napady"],
  "ux-ui": ["ux", "ui", "design", "accessibility", "a11y", "usability", "prototyping", "pristupnost"],
  analysis: ["analytics", "analysis", "data", "metrics", "performance", "research", "monitoring", "analytika", "analyza", "metriky"],
  documentation: ["documentation", "docs", "writing", "diagrams", "dokumentace", "psani"],
  "new-project": ["ideas", "starter", "starters", "boilerplate", "templates", "hosting", "infrastructure", "database", "napady", "sablony"],
  seo: ["seo", "search", "indexing", "vyhledavani"],
  marketing: ["marketing", "social", "seo", "growth", "email", "newsletter", "ads", "socialni", "reklama"],
  other: [],
};

function words(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Whether a library category name fits the given words (any whole word). */
export function categoryMatchesWords(categoryName: string | null | undefined, list: readonly string[]): boolean {
  if (!categoryName || list.length === 0) return false;
  const wanted = new Set(list.flatMap(words));
  return words(categoryName).some((word) => wanted.has(word));
}

/** Whether a library category belongs to the kind of job. */
export function categoryMatchesKind(categoryName: string | null | undefined, kind: PromptKind): boolean {
  return categoryMatchesWords(categoryName, PROMPT_KIND_CATEGORY_WORDS[kind]);
}

/** Prompts grouped by kind in the fixed order; empty kinds are left out. */
export function groupPromptsByKind<T extends Pick<Prompt, "kind">>(
  prompts: readonly T[],
): { kind: PromptKind; prompts: T[] }[] {
  return PROMPT_KINDS.map((kind) => ({
    kind,
    prompts: prompts.filter((prompt) => promptKind(prompt) === kind),
  })).filter((group) => group.prompts.length > 0);
}
