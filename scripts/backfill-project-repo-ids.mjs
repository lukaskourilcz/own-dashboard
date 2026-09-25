#!/usr/bin/env node
/**
 * One-off backfill of `projects.repo_id` from the GitHub API.
 *
 * For every project that has a `repo_full_name` but no `repo_id`, this asks
 * GitHub for the repository by name. GitHub redirects a renamed repository's
 * old name, so the lookup also works after a rename; when the current name
 * differs, `repo_full_name` is updated and the old name is appended to
 * `previous_repo_full_names`. Nothing else on the project changes.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… GITHUB_TOKEN=… \
 *   DASHBOARD_OWNER_ID=<auth user uuid> \
 *     node scripts/backfill-project-repo-ids.mjs [--apply]
 *
 * The service-role key bypasses RLS, so the script only touches rows owned by
 * DASHBOARD_OWNER_ID. Run it from your own machine; never commit the keys.
 */
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const githubToken = process.env.GITHUB_TOKEN;
const ownerId = process.env.DASHBOARD_OWNER_ID;

if (!url || !serviceKey || !githubToken || !ownerId) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_TOKEN and DASHBOARD_OWNER_ID.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function lookup(fullName) {
  const response = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${response.status} for ${fullName}`);
  const json = await response.json();
  return { id: json.id, full_name: json.full_name };
}

const { data: projects, error } = await supabase
  .from("projects")
  .select("id, name, slug, repo_full_name, repo_id, previous_repo_full_names")
  .eq("user_id", ownerId)
  .not("repo_full_name", "is", null)
  .is("repo_id", null);
if (error) {
  console.error(error.message);
  process.exit(1);
}

let changed = 0;
for (const project of projects ?? []) {
  const repo = await lookup(project.repo_full_name);
  if (!repo) {
    console.log(`skip  ${project.slug}: ${project.repo_full_name} not found on GitHub`);
    continue;
  }
  const update = { repo_id: repo.id };
  if (repo.full_name !== project.repo_full_name) {
    update.repo_full_name = repo.full_name;
    const previous = project.previous_repo_full_names ?? [];
    const old = project.repo_full_name.toLowerCase();
    if (old !== repo.full_name.toLowerCase() && !previous.some((name) => name.toLowerCase() === old)) {
      update.previous_repo_full_names = [...previous, project.repo_full_name];
    }
  }
  console.log(`${apply ? "write" : "plan "} ${project.slug}: ${JSON.stringify(update)}`);
  if (!apply) continue;
  const { error: updateError } = await supabase
    .from("projects")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", project.id)
    .eq("user_id", ownerId);
  if (updateError) {
    console.error(`fail  ${project.slug}: ${updateError.message}`);
    process.exitCode = 1;
    continue;
  }
  changed += 1;
}

console.log(
  apply
    ? `Updated ${changed} of ${projects?.length ?? 0} project(s).`
    : `Dry run: ${projects?.length ?? 0} project(s) without repo_id. Re-run with --apply to write.`,
);
