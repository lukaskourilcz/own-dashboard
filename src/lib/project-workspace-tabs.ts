export const PROJECT_WORKSPACE_TABS = [
  "overview",
  "tasks",
  "activity",
  "communication",
  "repository",
  "operations",
  "finance",
  "knowledge",
] as const;

export type ProjectWorkspaceTab = (typeof PROJECT_WORKSPACE_TABS)[number];

const PROJECT_WORKSPACE_TAB_SET = new Set<string>(PROJECT_WORKSPACE_TABS);

export function normalizeHiddenProjectTabs(value: unknown): ProjectWorkspaceTab[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (item): item is ProjectWorkspaceTab =>
          typeof item === "string" && PROJECT_WORKSPACE_TAB_SET.has(item),
      ),
    ),
  );
}
