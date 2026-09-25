import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationsDir = new URL("../../supabase/migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
const read = (file: string) => readFileSync(new URL(file, migrationsDir), "utf8");
const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const guide = readFileSync(new URL("../../docs/migration-guide.md", import.meta.url), "utf8");

/** SQL without `--` comments, so a contract never matches its own explanation. */
const code = (file: string) => read(file).replace(/--[^\n]*/g, "");

describe("migration files", () => {
  it("carry unique fourteen-digit versions", () => {
    const versions = migrationFiles.map((file) => file.slice(0, 14));
    for (const file of migrationFiles) expect(file, file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("are all listed in the README, in the order they run", () => {
    const listed = [...readme.matchAll(/^\d+\. `(\d{14}_[a-z0-9_]+\.sql)`/gm)].map((match) => match[1]);
    expect(listed).toEqual(migrationFiles);
  });

  it("from the freelance set on each have an entry in the migration guide", () => {
    for (const file of migrationFiles.filter((name) => name >= "20260911102058")) {
      expect(guide.includes(file), file).toBe(true);
    }
  });

  it("keep the 2026-09-16 files under the versions production recorded", () => {
    // Applied to production before the code reached main; a different version
    // would make `supabase db push` treat them as pending or missing.
    expect(migrationFiles.filter((file) => file.startsWith("202609161") || file.startsWith("202609160"))).toEqual([
      "20260916094243_portfolio_works_competition_finance.sql",
      "20260916125652_organization_registry_verification.sql",
      "20260916125708_subscription_amount_confirmation.sql",
      "20260916125718_invoice_payment_matching.sql",
      "20260916125742_transaction_rules.sql",
      "20260916135326_cron_heartbeats.sql",
      "20260916141348_job_application_contacts.sql",
      "20260916141837_bank_provider_abstraction.sql",
      "20260916195556_link_project_references.sql",
    ]);
  });
});

describe("2026-09-25 integration migrations", () => {
  it("check a project's parent against the row being written", () => {
    const sql = code("20260925200000_fix_project_parent_policies.sql");
    expect(sql.match(/create policy "projects (insert|update) own"/g)).toHaveLength(2);
    // The 2026-09-16 form: unqualified parent_id binds to the inner row.
    expect(sql).not.toMatch(/parent\.id = parent_id/);
    expect(sql.match(/parent\.id = projects\.parent_id/g)).toHaveLength(2);
    expect(sql).toMatch(/parent_id <> id/);
    expect(sql.match(/o\.id = projects\.organization_id/g)).toHaveLength(2);
  });

  it("drop projects.scope and nothing else", () => {
    const sql = code("20260925200100_project_engagement_replaces_scope.sql");
    expect(sql).toMatch(/alter table public\.projects drop column if exists scope;/);
    expect(sql).not.toMatch(/update public\.projects/i);
    expect(sql.match(/drop /gi)).toHaveLength(1);
  });

  it("refuse to drop the link references while they hold data", () => {
    const sql = code("20260925200300_drop_link_project_references.sql");
    const guard = sql.indexOf("raise exception");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(sql.indexOf("drop table if exists public.ai_link_projects"));
    expect(guard).toBeLessThan(sql.indexOf("drop column if exists video_url"));
    expect(sql).toMatch(/to_regclass\('public\.ai_link_projects'\)/);
  });
});
