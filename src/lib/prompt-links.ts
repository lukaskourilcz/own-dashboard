import type { ComposerLink } from "@/lib/prompt-composer";
import type { AiCategory, AiLink, ProjectLink, PromptLink } from "@/lib/types";

/** A prompt's link in the editor: which library link and why to open it. */
export type PromptLinkDraft = { ai_link_id: string; note: string };

function categoryNames(categories: readonly AiCategory[]): Map<string, string> {
  return new Map(categories.map((category) => [category.id, category.name]));
}

function toComposerLink(
  link: AiLink,
  note: string,
  names: Map<string, string>,
): ComposerLink {
  return {
    id: link.id,
    title: link.title,
    url: link.url,
    note,
    category: link.category_id ? names.get(link.category_id) ?? null : null,
  };
}

/** The complete stored list for editing, including unavailable resources.
 * Omitting an off-page/missing resource here would silently delete its link.
 */
export function promptLinkDraftsForEdit(promptId: string, promptLinks: readonly PromptLink[]): PromptLinkDraft[] {
  return promptLinks.filter(row => row.prompt_id === promptId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .map(row => ({ ai_link_id: row.ai_link_id, note: row.note }));
}

/** A prompt's resolvable links for composing clipboard text. */
export function promptLinkDrafts(
  promptId: string,
  promptLinks: readonly PromptLink[],
  links: readonly AiLink[],
): PromptLinkDraft[] {
  const known = new Set(links.map((link) => link.id));
  return promptLinkDraftsForEdit(promptId, promptLinks).filter(row => known.has(row.ai_link_id));
}

/** The prompt's own links for the copy composer. */
export function promptComposerLinks(
  promptId: string,
  promptLinks: readonly PromptLink[],
  links: readonly AiLink[],
  categories: readonly AiCategory[],
): ComposerLink[] {
  const byId = new Map(links.map((link) => [link.id, link]));
  const names = categoryNames(categories);
  return promptLinkDrafts(promptId, promptLinks, links).flatMap((draft) => {
    const link = byId.get(draft.ai_link_id);
    return link ? [toComposerLink(link, draft.note, names)] : [];
  });
}

/** A project's links (project_links) for the copy composer. */
export function projectComposerLinks(
  projectId: string,
  projectLinks: readonly ProjectLink[],
  links: readonly AiLink[],
  categories: readonly AiCategory[],
): ComposerLink[] {
  const byId = new Map(links.map((link) => [link.id, link]));
  const names = categoryNames(categories);
  return projectLinks
    .filter((row) => row.project_id === projectId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .flatMap((row) => {
      const link = byId.get(row.ai_link_id);
      return link ? [toComposerLink(link, row.note, names)] : [];
    });
}

/** Library links in the given categories, for pre-selecting the picker. */
export function suggestedLinkIds(
  links: readonly AiLink[],
  categories: readonly AiCategory[],
  matches: (categoryName: string) => boolean,
  exclude: ReadonlySet<string>,
  limit = 10,
): string[] {
  const names = categoryNames(categories);
  return links
    .filter((link) => (link.record_type ?? "link") === "link" && !exclude.has(link.id))
    .filter((link) => {
      const name = link.category_id ? names.get(link.category_id) : undefined;
      return name ? matches(name) : false;
    })
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((link) => link.id);
}
