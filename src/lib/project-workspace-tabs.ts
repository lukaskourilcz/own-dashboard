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

/**
 * The four tabs the DNESKAi workspace strip shows, in order (#169). Review opens
 * by default. Sources is a general tab id that no other project shows.
 * `dneskai-costs` keeps its id (the database check lists it) but left the strip:
 * Errors and costs opens from the overflow menu.
 */
export const DNESKAI_WORKSPACE_TAB_ORDER = [
  "dneskai-review",
  "dneskai-calendar",
  "dneskai-published",
  "sources",
] as const satisfies readonly ProjectTabId[];

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

/** Only a single canonical URL selection seeds server and client rendering. */
export function projectTabFromQuery(value: unknown): ProjectTabId | "" {
  return typeof value === "string" && PROJECT_TAB_ID_SET.has(value) ? value as ProjectTabId : "";
}
