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

/** A prompt's links in order, as editor drafts. Missing links are skipped. */
export function promptLinkDrafts(
  promptId: string,
  promptLinks: readonly PromptLink[],
  links: readonly AiLink[],
): PromptLinkDraft[] {
  const known = new Set(links.map((link) => link.id));
  return promptLinks
    .filter((row) => row.prompt_id === promptId && known.has(row.ai_link_id))
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .map((row) => ({ ai_link_id: row.ai_link_id, note: row.note }));
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

/**
 * The writes that make a prompt's stored links equal the editor's list:
 * rows to delete, and rows to upsert with their new note and position.
 */
export function planPromptLinkSync(
  promptId: string,
  existing: readonly PromptLink[],
  desired: readonly PromptLinkDraft[],
): { removeIds: string[]; upserts: { ai_link_id: string; note: string; sort_order: number }[] } {
  const current = existing.filter((row) => row.prompt_id === promptId);
  const wanted = new Map(desired.map((draft, index) => [draft.ai_link_id, { ...draft, sort_order: index }]));
  const removeIds = current.filter((row) => !wanted.has(row.ai_link_id)).map((row) => row.id);
  const upserts = [...wanted.values()].filter((draft) => {
    const row = current.find((item) => item.ai_link_id === draft.ai_link_id);
    return !row || row.note !== draft.note.trim() || row.sort_order !== draft.sort_order;
  }).map((draft) => ({ ai_link_id: draft.ai_link_id, note: draft.note.trim(), sort_order: draft.sort_order }));
  return { removeIds, upserts };
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
