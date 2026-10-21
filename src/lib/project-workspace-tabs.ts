export const PROJECT_WORKSPACE_TABS = [
  "overview",
  "tasks",
  "activity",
  "communication",
  "repository",
  "finance",
  "competition",
  "knowledge",
  "sources",
  "scaling",
  "monetization",
] as const;

export type ProjectWorkspaceTab = (typeof PROJECT_WORKSPACE_TABS)[number];

/** The DNESKAi workspace tabs (#119). Only the DNESKAi project shows them. */
export const DNESKAI_PROJECT_TABS = [
  "dneskai-review",
  "dneskai-calendar",
  "dneskai-published",
  "dneskai-costs",
] as const;

export type DneskaiProjectTab = (typeof DNESKAI_PROJECT_TABS)[number];

/**
 * Every id a project workspace tab can have, and so every id
 * user_preferences.hidden_project_tabs may store. The database check
 * user_preferences_hidden_project_tabs_check lists exactly these, in this order.
 */
export const PROJECT_TAB_IDS = [
  ...PROJECT_WORKSPACE_TABS,
  ...DNESKAI_PROJECT_TABS,
] as const;

export type ProjectTabId = (typeof PROJECT_TAB_IDS)[number];

const PROJECT_TAB_ID_SET = new Set<string>(PROJECT_TAB_IDS);
const DNESKAI_PROJECT_TAB_SET = new Set<string>(DNESKAI_PROJECT_TABS);

export function isDneskaiProjectTab(value: string): value is DneskaiProjectTab {
  return DNESKAI_PROJECT_TAB_SET.has(value);
}

export function normalizeHiddenProjectTabs(value: unknown): ProjectTabId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (item): item is ProjectTabId =>
          typeof item === "string" && PROJECT_TAB_ID_SET.has(item),
      ),
    ),
  );
}
