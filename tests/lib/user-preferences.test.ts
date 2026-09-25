import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROJECT_WORKSPACE_TABS,
  normalizeHiddenProjectTabs,
} from "@/lib/project-workspace-tabs";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260723082424_sync_preferences_project_tabs.sql",
    import.meta.url,
  ),
  "utf8",
);

// The latest migration that defines the hidden_project_tabs check.
const tabCheckSql = readFileSync(
  new URL(
    "../../supabase/migrations/20260925090200_fix_hidden_project_tabs_check.sql",
    import.meta.url,
  ),
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
    expect(checkedTabs(tabCheckSql)).toEqual([...PROJECT_WORKSPACE_TABS]);
    expect(checkedTabs(tabCheckSql)).not.toContain("operations");
    // Rows holding a removed id are cleaned before the stricter check applies.
    expect(tabCheckSql.indexOf("update public.user_preferences")).toBeLessThan(
      tabCheckSql.indexOf("add constraint user_preferences_hidden_project_tabs_check"),
    );
  });
});
