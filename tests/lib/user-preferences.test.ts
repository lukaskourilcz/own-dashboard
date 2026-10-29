import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DNESKAI_PROJECT_TABS,
  PROJECT_TAB_IDS,
  PROJECT_WORKSPACE_TABS,
  isDneskaiProjectTab,
  normalizeHiddenProjectTabs,
  projectTabFromQuery,
} from "@/lib/project-workspace-tabs";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260723082424_sync_preferences_project_tabs.sql",
    import.meta.url,
  ),
  "utf8",
);

// The latest migration that defines the hidden_project_tabs check: every
// migration that adds a workspace tab has to recreate it.
const migrationsDir = new URL("../../supabase/migrations/", import.meta.url);
const tabCheckMigrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .filter((file) =>
    /add constraint user_preferences_hidden_project_tabs_check/i.test(
      readFileSync(new URL(file, migrationsDir), "utf8"),
    ),
  );
const latestTabCheck = tabCheckMigrations[tabCheckMigrations.length - 1]!;
const tabCheckSql = readFileSync(new URL(latestTabCheck, migrationsDir), "utf8");
// The migration that first dropped the removed "operations" id from stored rows.
const tabCleanupSql = readFileSync(
  new URL("20260925090200_fix_hidden_project_tabs_check.sql", migrationsDir),
  "utf8",
);

function checkedTabs(source: string): string[] {
  const constraint = source.match(
    /add constraint user_preferences_hidden_project_tabs_check[\s\S]+?array\[([\s\S]+?)\]::text\[\]/i,
  );
  return [...(constraint?.[1] ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

describe("synchronized user preferences", () => {
  it("normalizes project tab visibility to canonical tabs", () => {
    expect(
      normalizeHiddenProjectTabs([
        "activity",
        "communication",
        "activity",
        "unknown",
        42,
      ]),
    ).toEqual(["activity", "communication"]);
    expect(PROJECT_WORKSPACE_TABS).toContain("knowledge");
  });

  it("keeps the DNESKAi tabs hideable and drops unknown DNESKAi-like ids", () => {
    expect(
      normalizeHiddenProjectTabs([
        "dneskai-review",
        "dneskai-calendar",
        "dneskai-published",
        "dneskai-costs",
        "dneskai-review",
        "dneskai-unknown",
        "DNESKAI-COSTS",
        "sources",
      ]),
    ).toEqual([
      "dneskai-review",
      "dneskai-calendar",
      "dneskai-published",
      "dneskai-costs",
      "sources",
    ]);
    expect(normalizeHiddenProjectTabs("dneskai-review")).toEqual([]);
    expect(PROJECT_TAB_IDS).toEqual([
      ...PROJECT_WORKSPACE_TABS,
      ...DNESKAI_PROJECT_TABS,
    ]);
    expect(DNESKAI_PROJECT_TABS.every(isDneskaiProjectTab)).toBe(true);
    expect(PROJECT_WORKSPACE_TABS.some(isDneskaiProjectTab)).toBe(false);
  });

  it("keeps the preferences row own-only and available to authenticated users", () => {
    expect(sql).toMatch(/user_preferences enable row level security/i);
    expect(sql).toMatch(
      /for update to authenticated[\s\S]+using \(\(select auth\.uid\(\)\) = user_id\)[\s\S]+with check \(\(select auth\.uid\(\)\) = user_id\)/i,
    );
    expect(sql).toMatch(
      /grant select, insert, update on public\.user_preferences to authenticated/i,
    );
  });

  it("constrains hidden project tabs to exactly the workspace tabs", () => {
    expect(latestTabCheck).toBe("20261021124712_dneskai_hideable_project_tabs.sql");
    expect(checkedTabs(tabCheckSql)).toEqual([...PROJECT_TAB_IDS]);
    expect(checkedTabs(tabCheckSql)).not.toContain("operations");
    expect(checkedTabs(tabCheckSql)).toContain("competition");
    // Rows holding a removed id are cleaned before the stricter check applies.
    expect(tabCleanupSql.indexOf("update public.user_preferences")).toBeLessThan(
      tabCleanupSql.indexOf("add constraint user_preferences_hidden_project_tabs_check"),
    );
  });
});

it("seeds one canonical project tab without accepting ambiguous URL values", () => {
  expect(projectTabFromQuery("repository")).toBe("repository");
  expect(projectTabFromQuery("dneskai-review")).toBe("dneskai-review");
  for (const value of [undefined, null, ["repository", "overview"], "unknown", " repository", "repository\n"]) expect(projectTabFromQuery(value)).toBe("");
});
