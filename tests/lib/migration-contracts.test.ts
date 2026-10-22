import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TIP_GROUPS } from "@/lib/ig-tips";

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

  it("list every version production recorded through 2026-10-21, and nothing older that production lacks", () => {
    // Production's supabase_migrations.schema_migrations from 20261013 on, read on 2026-10-22. A
    // missing version makes `supabase db push` refuse; an extra older one would be pushed out of order.
    const production = [
      "20261013193104", "20261013193105", "20261013193106", "20261013193107", "20261013193108", "20261013193131",
      "20261013193132", "20261013193134", "20261013193136", "20261015234547", "20261021122104", "20261021122220",
      "20261021122330", "20261021122453", "20261021122551", "20261021123547", "20261021124058", "20261021124144",
      "20261021124400", "20261021124438", "20261021124628", "20261021124651", "20261021124706", "20261021124712",
      "20261021125123",
    ];
    const versions = migrationFiles.map((file) => file.slice(0, 14));
    expect(versions.filter((version) => version >= "20261013" && version <= "20261021999999")).toEqual(production);
  });

  it("leave the scheduler retention to its own pending file", () => {
    const applied = ["20261021124400_marketing_scheduler.sql", "20261021124438_marketing_scheduler_functions.sql", "20261021124628_marketing_scheduler_cron.sql"];
    for (const file of applied) expect(code(file), file).not.toMatch(/prune/);
    const retention = code("20261022000000_marketing_scheduler_retention.sql");
    expect(retention).toMatch(/create or replace function public\.marketing_scheduler_prune_ticks/);
    expect(retention).toMatch(/cron\.schedule\('marketing-cron-history-prune'/);
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

describe("IG TIPS migration", () => {
  const sql = code("20260926140000_ig_tips.sql");

  it("adds only two nullable ai_links columns and their checks", () => {
    expect(sql).toMatch(/add column if not exists tip_group text,/);
    expect(sql).toMatch(/add column if not exists tip_summary text;/);
    expect(sql).not.toMatch(/not null/i);
    expect(sql).not.toMatch(/\b(update|insert|delete)\s/i);
    expect(sql).not.toMatch(/create (table|policy|function)|grant |alter policy/i);
    expect(sql).toMatch(/char_length\(tip_summary\) <= 2000/);
  });

  it("allows exactly the groups the IG TIPS page shows", () => {
    const listed = /tip_group in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const groups = [...listed.matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
    expect(groups).toEqual([...TIP_GROUPS]);
  });
});

describe("SECURITY DEFINER functions", () => {
  // Supabase's default privileges grant EXECUTE on every new function in
  // public directly to anon, authenticated and service_role. A revoke from
  // PUBLIC alone leaves those grants, which is how purge_old_cron_runs() stayed
  // callable by anyone until 20260925210000.
  const definers = migrationFiles.flatMap((file) =>
    [...code(file).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\bas\s+\$/gi)]
      .filter((match) => /\bsecurity\s+definer\b/i.test(match[2]))
      .map((match) => ({ file, name: match[1] })),
  );

  it("are found in the migrations", () => {
    expect(definers.map((d) => d.name)).toEqual(
      expect.arrayContaining(["purge_old_cron_runs", "audit_freelance_opportunity"]),
    );
  });

  it("are revoked from anon and authenticated by the same or a later migration", () => {
    for (const { file, name } of definers) {
      const revoked = new Set<string>();
      for (const later of migrationFiles.filter((other) => other >= file)) {
        const revokes = code(later).matchAll(
          new RegExp(`revoke\\s+(?:all|execute)\\s+on\\s+function\\s+public\\.${name}\\b[^;]*?\\bfrom\\b([^;]*);`, "gi"),
        );
        for (const revoke of revokes) {
          for (const role of revoke[1].split(",")) revoked.add(role.trim().toLowerCase());
        }
      }
      expect([...revoked], `${name} (${file})`).toEqual(
        expect.arrayContaining(["anon", "authenticated"]),
      );
    }
  });
});

describe("2026-10-23 DNESKAi Reels migrations (#163)", () => {
  it("keep the reel bucket private and MP4-only, documented as unapplied", () => {
    const sql = code("20261023130000_dneskai_reel_bucket.sql");
    expect(sql).toMatch(/values\('marketing-reels','marketing-reels',false,67108864,array\['video\/mp4'\]\)/);
    expect(sql).not.toMatch(/public=true/);
    expect(sql.match(/as restrictive/g)).toHaveLength(5);
    expect(guide).toMatch(/20261023130000_dneskai_reel_bucket\.sql[\s\S]*unapplied|DNESKAi Reel bucket, 23 October 2026 \(unapplied\)/);
  });

  it("keep the audio library own-only with service-role writes (#164)", () => {
    const sql = code("20261023130100_dneskai_audio_tracks.sql");
    expect(sql).toMatch(/values\('marketing-audio','marketing-audio',false,20971520,/);
    expect(sql).toMatch(/revoke all on public\.marketing_audio_tracks from public,anon,authenticated/);
    expect(sql).toMatch(/grant select on public\.marketing_audio_tracks to authenticated/);
    expect(sql).not.toMatch(/grant (insert|update|delete|all) on public\.marketing_audio_tracks to authenticated/);
    expect(guide).toMatch(/DNESKAi audio library, 23 October 2026 \(unapplied\)/);
  });
});
