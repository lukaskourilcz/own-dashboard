#!/usr/bin/env node
/**
 * One-off backfill of `project_links` from the deprecated free-text
 * `ai_links.project_relevance` ({ repository, reason }).
 *
 * Each repository value is resolved to a project by repository name
 * (current, previous or without the owner), slug or display name; the reason
 * becomes the relation note with role "uses". Existing relations are left
 * untouched and unresolved repositories are listed, never guessed.
 *
 * Dry run by default. Pass --apply to write. Run it after
 * scripts/backfill-project-repo-ids.mjs so renamed repositories resolve.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   DASHBOARD_OWNER_ID=<auth user uuid> \
 *     node scripts/backfill-project-links.mjs [--apply]
 *
 * The service-role key bypasses RLS, so the script only reads and writes rows
 * owned by DASHBOARD_OWNER_ID. Never commit the keys.
 */
import { createClient } from "@supabase/supabase-js";
import { planProjectLinkBackfill } from "./lib/project-relevance.mjs";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.env.DASHBOARD_OWNER_ID;

if (!url || !serviceKey || !ownerId) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DASHBOARD_OWNER_ID.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function load(table, columns) {
  const { data, error } = await supabase.from(table).select(columns).eq("user_id", ownerId);
  if (error) {
    console.error(`${table}: ${error.message}`);
    process.exit(1);
  }
  return data ?? [];
}

const [links, projects, existing] = await Promise.all([
  load("ai_links", "id, title, project_relevance"),
  load("projects", "id, name, slug, previous_slugs, repo_full_name, previous_repo_full_names"),
  load("project_links", "project_id, ai_link_id, sort_order"),
]);

const { rows, unresolved } = planProjectLinkBackfill(links, projects, existing);
const projectName = new Map(projects.map((project) => [project.id, project.name]));
const linkTitle = new Map(links.map((link) => [link.id, link.title]));
for (const row of rows) {
  console.log(`${apply ? "write" : "plan "} ${projectName.get(row.project_id)} ← ${linkTitle.get(row.ai_link_id)}${row.note ? `: ${row.note}` : ""}`);
}
for (const item of unresolved) {
  console.log(`skip  ${item.link}: no project matches "${item.repository}"`);
}

if (apply && rows.length > 0) {
  const { error } = await supabase
    .from("project_links")
    .upsert(rows.map((row) => ({ ...row, user_id: ownerId })), {
      onConflict: "project_id,ai_link_id",
      ignoreDuplicates: true,
    });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
}

console.log(
  apply
    ? `Inserted up to ${rows.length} relation(s); ${unresolved.length} unresolved.`
    : `Dry run: ${rows.length} relation(s) to insert, ${unresolved.length} unresolved. Re-run with --apply to write.`,
);
