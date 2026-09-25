# Professional restructure migration guide

## Before deployment

1. Back up the Supabase database or create a point-in-time recovery marker on a paid project.
2. From the current production UI, download any desired personal exports.
3. Deploy application code and migrations in one coordinated release; do not expose the new shell against an unmigrated database.

The Career Saved release adds `saved_job_positions` with own-only RLS, then seeds the eight owner-selected September positions only when the installation has exactly one authenticated owner. The seed aborts instead of writing when more than one account exists.
4. Confirm `auth.users`, the historic OwnDashboard tables, and the latest `user_preferences` table exist.

## Apply

Run the migrations in timestamp order with the linked Supabase project:

```bash
npx supabase db push --linked
```

The first migration is additive. The second is destructive only after it creates and fills `legacy_personal_archives` in the same database transaction used by the migration runner. The third adds the own-scoped atomic Inbox routing RPC. The fourth adds subscription classification, project communication history, development URLs, and the VPS agent task queue. The fifth adds professional daily-focus snapshots, GLOBAL task enforcement, synchronized UI preferences, and owner-scoped Career deletion tombstones. The sixth adds synchronized project-workspace tab visibility, reinstates explicit authenticated preference grants and own-only RLS policies, and resolves imported tasks to active projects by repository for the daily focus.

## Verify

Check that `organizations`, `client_opportunities`, `inbox_items`, `notifications`, `weekly_reviews`, `project_communications`, `agent_tasks`, `daily_focus_sets`, `daily_focus_items`, and `legacy_personal_archives` exist; `streaks`, `streak_logs`, `books`, `book_pages`, `daily_pulse`, `couples`, `couple_invites`, and `sharing_prefs` do not.

Confirm all new tables have RLS enabled and own-only policies for `authenticated`. Confirm `important_dates` has `project_id` and `organization_id`, but no `couple_id`. Confirm `projects` has `revenue_currency` and that conversion preserves an opportunity's currency. Confirm `route_inbox_item(uuid, text)` is executable by `authenticated`, uses `SECURITY INVOKER`, and is not granted to `anon`.

Sign in as two separate users and verify neither can read or attach relationships to the other's organization/project/opportunity. As the first user, convert an opportunity both with a selected organization and with a new organization name; verify each project/opportunity/organization link and the `won` status. Route an Inbox item successfully, repeat the request to verify idempotency, and force a destination failure to verify neither the destination nor Inbox status changes. Verify the second user cannot route the first user's item. Force an opportunity-conversion failure in a disposable database and verify the transaction leaves no partial project or organization.

Create project communication and agent task rows as user A, then verify user B cannot select, update, delete, or relate to either. With the service role, call `claim_agent_task` concurrently and verify only one caller receives a queued row. Confirm `anon` and `authenticated` cannot execute that RPC. Verify the claim/report HTTP flow rejects missing/wrong tokens, another agent name, a non-running task, and a task outside `DASHBOARD_OWNER_ID`.

Create a GLOBAL task and verify its importance is forced to 6 and its project is cleared. Call `create_daily_focus_set(false)` twice and verify the same set is returned; call it with `true` and verify a new generation is created with no more than seven owner tasks from active projects. Include a NEEDED.md task without `project_id` whose repository matches an active project and verify it is eligible; verify unassigned manual and inactive-project tasks are not. Complete all seven and verify the current date is marked complete. Change language, theme, navigation order, task density, CV links, hidden project tabs, and active projects, then sign in on another device and verify they hydrate from the database. Delete a Career listing and verify it remains absent after a scrape refresh.

## Rollback strategy

Application rollback and data rollback are separate:

- Before the cleanup migration, the previous application can be redeployed directly.
- After cleanup, redeploying the previous application is not sufficient because its tables are gone.
- To restore the old product, recreate the retired schema from the historic base, then import each user's JSON from `legacy_personal_archives`. Preserve original UUIDs and restore parents before children (couples → books/streaks → book pages/logs). Reapply the old RLS only after verifying the import.

The archive is intentionally retained by the new product. Do not drop it until every user has had an export window and the product owner has approved permanent deletion.

## Fresh install

`supabase/schema.sql` is the historic baseline: the schema the first migration was written against. It still contains the retired personal tables, because `20260721165421_remove_legacy_personal_scope.sql` archives and drops them with a bare `drop table`, and it is the only file that creates `projects`, `crons`, `job_applications`, `bank_connections` and the other tables the first migration alters. The migrations cannot run without it.

`npx supabase db reset` does not work here. It needs Docker and a local stack, and it applies only `supabase/migrations`, never the baseline, so the first migration stops with `relation "public.projects" does not exist`. The repository has no `supabase/config.toml` for that stack either.

1. Start from an empty Supabase project, or, for local validation, an isolated Postgres database that has stand-ins for the Supabase `auth` schema (`auth.users`, `auth.uid()`) and the `anon`, `authenticated` and `service_role` roles.
2. Run the baseline once:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
   ```

3. Create the one owner account in Supabase Auth: sign in to the app once, or add the user in the Supabase dashboard. `20260908063200_seed_owner_saved_positions.sql` raises `Expected one OwnDashboard owner; refusing to seed saved positions` unless `auth.users` holds exactly one row.
4. Apply every migration in timestamp order. The Supabase CLI records each version in `supabase_migrations.schema_migrations`, so a later `db push` knows what already ran:

   ```bash
   npx supabase db push --db-url "$DATABASE_URL"
   ```

   Plain psql gives the same schema without the history table, which is enough for a throwaway validation database:

   ```bash
   for f in supabase/migrations/*.sql; do
     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "failed: $f"; break; }
   done
   ```

This procedure was run on 2026-09-25 against PostgreSQL 16 with a local Supabase stand-in: two fresh databases installed all 23 migrations with exit 0 through psql, and a third through `npx supabase db push --db-url` (CLI 2.118.0, append `?sslmode=disable` for a local server without TLS). All three produced the same `public` schema.

Never copy a migration's objects back into `supabase/schema.sql`. A copied block runs before the migrations it depends on and collides with the migration that owns it; the copy of `saved_job_positions` made every fresh install stop at that migration's first `create policy`.

## Existing install

Never re-run `supabase/schema.sql` on an existing database. Link the project and let the CLI apply only what its history lacks:

```bash
npx supabase link --project-ref <project-ref>
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

`db push` refuses to run when the remote history holds versions that `supabase/migrations` does not. Compare the two columns of `migration list` first; `NEEDED.md` lists the known mismatches on the production project and the `migration repair` commands that align them.

Do not re-run a single migration by hand. Most are one-shot: a second run stops at its first bare `create table`, `create policy` or `create function`. The idempotent ones are not safe out of order either. Re-running `20260723082424_sync_preferences_project_tabs.sql` on a current database reinstalls the older `create_daily_focus_set` without the repository-id match from `20260925090000`, and re-running `20260915210805_link_ideas_and_relevance.sql` restores the superseded comment on `ai_links.project_relevance`.

## Local validation

Validate against an isolated Postgres database with `ON_ERROR_STOP=1`, following [Fresh install](#fresh-install). Never validate destructive migrations against a personal development database containing irreplaceable rows, and never against production.

## Freelance directory and proposal tracking — 2026-09-11

Apply `20260911102058_freelance_opportunities.sql`, `20260911103455_freelance_metrics.sql` and `20260911104131_freelance_resources.sql` before deploying the freelance UI. These additive migrations create the owner-scoped platform directory, optional opportunity fields, immutable client-readable transition history, full-cohort metrics RPC and an HTTPS resource-folder link. Existing opportunities and conversion RPCs are preserved. Profile research and account-specific texts are private runtime data and are not migration seeds.

The metrics function uses the authenticated owner and optional platform filter, independently of the bounded opportunity list; actual dates determine submission/reply counts. The trigger has a fixed search path and writes history without granting authenticated clients direct event mutation. Verify a second user sees neither records nor history, cannot attach another owner's platform, and cannot call event-writing functions directly. A rolled-back date/status change should produce one corresponding history event.

Application rollback can deploy the previous version while retaining the additive schema and private drafts; do not drop populated tables merely to roll back the UI.

## Repository identity for projects — 2026-09-25

Apply `20260925090000_project_repository_identity.sql`. It adds `projects.repo_id bigint` with a unique partial index per owner, `projects.previous_repo_full_names text[]`, and replaces `create_daily_focus_set` so an imported task resolves to its project by explicit `project_id`, then by repository id, then by the current or any previous repository name. The function stays `SECURITY INVOKER`, keeps `search_path = ''` and is executable by `authenticated` only.

After applying, fill the ids with `node scripts/backfill-project-repo-ids.mjs --apply` (see [external setup §9](external-setup.md#renaming-a-project-repository)) or by opening Projects with GitHub connected. Verify that a second owner cannot read or update the new columns on the first owner's projects, and that renaming a repository in a disposable account updates the existing project instead of adding one.

## Own and freelance projects, DNESKAi / devShark / boardlessAI — 2026-09-25

Apply `20260925090100_project_engagement_and_names.sql`. It adds `projects.engagement` (`own` or `client`, default `own`) and `projects.previous_slugs text[]`, marks the projects with slugs `gym-plzen` and `paris-claire` as `client`, and renames three rows per owner: `aifirst` → `DNESKAi`/`dneskai`, `react-express-app` → `devShark`/`devshark`, `quorum` → `boardlessAI`/`boardlessai`. The old slug is appended to `previous_slugs`, so `/projects/aifirst` redirects to `/projects/dneskai` and `GET /api/crons/registry?project=aifirst` keeps answering. A rename is skipped when the owner already has a project with the new slug. `repo_full_name` is not changed; the id-based auto-sync writes it when the GitHub repositories are renamed.

Verify that Projects shows the own group, one "Freelance — hired" divider and the two client projects last, and that the project form saves the engagement.

## Project workspace tab visibility check — 2026-09-25

Apply `20260925090200_fix_hidden_project_tabs_check.sql`. The earlier check on `user_preferences.hidden_project_tabs` still allowed the removed `operations` tab and rejected `scaling` and `monetization`, so hiding either of those in Settings failed to save. The migration removes ids that are no longer tabs from existing rows, then recreates the check with exactly the tabs in `src/lib/project-workspace-tabs.ts`. Verify by hiding Scaling and Monetization in Settings and reloading on another device.

## Project links — 2026-09-25

Apply `20260925090300_project_links.sql`. It creates `project_links (project_id, ai_link_id, role, note, sort_order)` with a unique pair per project and link, cascading deletes from both parents, and own-only RLS whose insert and update checks require that both the project and the link belong to the caller. It also marks `ai_links.project_relevance` as deprecated in its column comment.

Then copy the old free-text relevance: `node scripts/backfill-project-links.mjs` (dry run) and `--apply` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `DASHBOARD_OWNER_ID`. Run the repository-id backfill first so renamed repositories resolve. Verify that a second user can neither read the rows nor attach their link to the first user's project, and that deleting a link or a project leaves no relation behind.

## Prompt kinds and prompt links — 2026-09-25

Apply `20260925090400_prompt_kinds_and_links.sql`. It adds `prompts.kind` (`design`, `audit`, `competition`, `ux-ui`, `analysis`, `documentation`, `new-project`, `seo`, `marketing` or `other`; existing rows become `other`) and creates `prompt_links (prompt_id, ai_link_id, note, sort_order)` with a unique pair, cascading deletes from both parents and own-only RLS that checks both the prompt and the link belong to the caller. Existing prompts keep their text, visibility and default project; assign kinds and links in the editor. The Prompts, Knowledge and Projects exports now include `prompt_links` and `project_links`. Nothing in this feature calls a model.

## Tools — 2026-09-25

Apply `20260925090500_tools.sql`. It creates `tools (ai_link_id, name, what_it_does, status, subscription_id)` with one row per owner and library link, statuses `in_use`, `trial` and `retired`, a cascading delete from the link, `on delete set null` from the subscription, and own-only RLS that checks the link and any subscription belong to the caller. How a tool helps each project is stored as a `project_links` row with role `tool`, so apply the project links migration first. The Knowledge export includes `tools`. Verify that a second user cannot attach the first user's subscription or link to a tool.
