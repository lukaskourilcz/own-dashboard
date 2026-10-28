# Professional restructure migration guide

## Before deployment

1. Back up the Supabase database or create a point-in-time recovery marker on a paid project.
2. From the current production UI, download any desired personal exports.
3. Deploy application code and migrations in one coordinated release; do not expose the new shell against an unmigrated database.
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

Create project communication and agent task rows as user A, then verify user B cannot select, update, delete, or relate to either. With the service role, call `claim_agent_task` concurrently and verify only one caller receives a queued row. Confirm `anon` and `authenticated` cannot execute that RPC. The Agents routes that consumed the queue were removed in `5d32e6b`; the table and RPC remain unused.

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

This procedure was run on 2026-09-25 against PostgreSQL 16 with a local Supabase stand-in: two fresh databases installed all 23 migrations then on `main` with exit 0 through psql, and a third through `npx supabase db push --db-url` (CLI 2.118.0, append `?sslmode=disable` for a local server without TLS). All three produced the same `public` schema. After the 2026-09-16 branch was merged the same day, the 36 migrations installed with exit 0 both ways, and the two `public` schema dumps were identical.

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

### The production history

Every file from `20260721165419` on carries the version production recorded for it, with one exception: the connector recorded the six kickoff files `20260925090000`–`20260925090500` under the time they were applied, `20260925141127`–`20260925141231`. The 2026-09-16 files were renamed on merge to the versions production recorded (`20260916094243`–`20260916195556`), so they need no repair. Nine rows from 2026-06-07 predate the repository and have no files; `supabase/schema.sql` stands in for them. Against a local copy of that history, `db push --dry-run` names exactly those fifteen versions and stops. After the kickoff rows get their file versions and the nine early rows are removed (backed up first), the dry run lists exactly five files: the four 2026-09-25 integration migrations `20260925200000`–`20260925200300` and `20260925210000_restrict_purge_old_cron_runs.sql`. `db push` applies them in that order, and a second dry run reports the database up to date.

Do not re-run a single migration by hand. Most are one-shot: a second run stops at its first bare `create table`, `create policy` or `create function`. The idempotent ones are not safe out of order either. Re-running `20260723082424_sync_preferences_project_tabs.sql` on a current database reinstalls the older `create_daily_focus_set` without the repository-id match from `20260925090000`, and re-running `20260915210805_link_ideas_and_relevance.sql` restores the superseded comment on `ai_links.project_relevance`.

## Local validation

Validate against an isolated Postgres database with `ON_ERROR_STOP=1`, following [Fresh install](#fresh-install). Never validate destructive migrations against a personal development database containing irreplaceable rows, and never against production.

## Prompts, tasks and cron runs — 2026-07-23/24

`20260723120000_prompts_description.sql` adds `prompts.description`. `20260724090000_task_time_and_kind.sql` adds `todos.estimated_minutes` and `todos.task_kind` (`setup`, `deploy`, `legal`, `content` or `decision`), which the NEEDED.md import fills from the `[time:]` and `[kind:]` markers. `20260724100000_prompts_visibility.sql` adds `prompts.is_public`, which separates the owner's prompts from the curated ones. `20260724110000_cron_runs.sql` adds the own-only `cron_runs` log behind the Home cron panels and `purge_old_cron_runs()`, which deletes runs older than 14 days. The migration schedules that purge only when `pg_cron` is installed.

## Saved Career positions — 2026-09-08

Apply `20260908062146_add_saved_job_positions.sql`, then `20260908063200_seed_owner_saved_positions.sql`. The first adds `saved_job_positions` with own-only RLS. The second seeds the eight owner-selected September positions only when `auth.users` holds exactly one account and raises an exception otherwise.

## Career directory and application pipeline — 2026-09-11

Apply `20260911080040_career_directory_and_application_pipeline.sql`. [Career pipeline](career-pipeline.md) lists its tables, RPCs and checks.

## Freelance directory and proposal tracking — 2026-09-11

Apply `20260911102058_freelance_opportunities.sql`, `20260911103455_freelance_metrics.sql` and `20260911104131_freelance_resources.sql` before deploying the freelance UI. These additive migrations create the owner-scoped platform directory, optional opportunity fields, immutable client-readable transition history, full-cohort metrics RPC and an HTTPS resource-folder link. Existing opportunities and conversion RPCs are preserved. Profile research and account-specific texts are private runtime data and are not migration seeds.

The metrics function uses the authenticated owner and optional platform filter, independently of the bounded opportunity list; actual dates determine submission/reply counts. The trigger has a fixed search path and writes history without granting authenticated clients direct event mutation. Verify a second user sees neither records nor history, cannot attach another owner's platform, and cannot call event-writing functions directly. A rolled-back date/status change should produce one corresponding history event.

Application rollback can deploy the previous version while retaining the additive schema and private drafts; do not drop populated tables merely to roll back the UI.

## Link ideas and relevance — 2026-09-15

Apply `20260915210805_link_ideas_and_relevance.sql`. [Links and IG TIPS](links-and-ideas.md) describes the new columns and the category check on inserts and updates.

## Portfolio, Competition and development finance — 2026-09-16

`20260916094243_portfolio_works_competition_finance.sql` adds `projects.scope`, `projects.parent_id` and `projects.portfolio_key` (a partial unique index per owner on the key), subscription lifecycle columns (`started_on`, `ended_on`, `plan`, `vendor_url`, `notes`) and the `quarterly` billing cycle, `subscription_allocations` and `competitors` with own-only RLS and ownership checks on every referenced row, and `transactions.subscription_id` checked by the transaction insert and update policies. It recreates the `projects` insert and update policies with a parent ownership check; that check compared the parent with itself and rejected every row with a parent, which `20260925200000_fix_project_parent_policies.sql` corrects. `projects.scope` was later replaced by `projects.engagement` and dropped by `20260925200100_project_engagement_replaces_scope.sql`.

Verify that a second user can neither read nor attach the first user's subscription or project to an allocation or a competitor, and that a transaction cannot reference another user's subscription.

## Organization registry verification — 2026-09-16

`20260916125652_organization_registry_verification.sql` adds six nullable or defaulted columns to `organizations`: when the row was filled from ARES, the cached VIES verdict (`unchecked`, `valid`, `invalid` or `unavailable`), when it was obtained, the normalized VAT id it belongs to, and the registered name and address VIES returned. Columns only; the four own-only `organizations` policies cover them. Verify by filling a client from a real IČO and checking its DIČ in Clients.

## Subscription amount confirmation — 2026-09-16

`20260916125708_subscription_amount_confirmation.sql` adds `subscriptions.amount_confirmed_on`, the date the owner last compared the amount, currency and billing cycle with the vendor invoice. Nothing is backfilled; the application clears the date when any of the three changes. Verify by confirming one subscription, then changing its amount and seeing the confirmation disappear.

## Invoice payment matching — 2026-09-16

Apply `20260916125718_invoice_payment_matching.sql` before deploying the
unmatched-payments card or enabling the `/api/cron/payment-match` schedule.
Until it runs, every matching write fails on a missing column.

It is additive and adds no table, policy, grant or function: three columns on
`public.transactions` — `variable_symbol` (digits only, at most ten, constrained
by a check), `matched_at` and `match_source` (`auto` or `manual`) — plus a
partial index for the unmatched-income scan and one for the invoice→payment
lookup. `transactions.invoice_id` and the insert/update policies that verify the
referenced invoice's owner already exist, so no relationship check changes.

### Verify

Confirm the three columns exist, that `variable_symbol` rejects a non-numeric
value and that `match_source` rejects anything but `auto` or `manual`. Confirm
both partial indexes are present and that the four own-only `transactions`
policies are unchanged.

Sign in as two users. Attempt to link user A's payment to user B's invoice
through `POST /api/money/payment-match` with `mode: "link"`: the route resolves
neither record for the caller and answers 404, and the transactions update
policy would reject the write regardless.

Issue an invoice, add an incoming transaction quoting its variable symbol for
the exact amount, and run the matcher. The invoice becomes `paid` with `paid_on`
equal to the payment's `occurred_on`, not today. Run it again: nothing changes,
because the payment now carries `invoice_id`. Add a second payment with the same
symbol and confirm it stays in the unmatched list as a duplicate rather than
paying the invoice twice. Repeat with a payment three crowns short and with one
in another currency, and confirm both stay unmatched with their own reason.

### Rollback

Application rollback can deploy the previous version while keeping the columns;
nothing older reads them, and the links already written stay valid because
`invoice_id` predates this feature. Remove the `/api/cron/payment-match` entry
from `vercel.json` to stop the unattended runs without touching the schema.

## Transaction rules — 2026-09-16

Apply `20260916125742_transaction_rules.sql` before deploying the Money rule
editor. It is additive: it creates `transaction_rules` (owner-authored `conditions`
and `actions` as jsonb, a `pre`/`default`/`post` stage, a sort order, an enabled
flag and an `updated_at` trigger) with own-only RLS, explicit `authenticated`
grants and four CRUD policies, then copies every `transaction_category_rules`
row in as one `note contains …` rule. The legacy table is not dropped — it stays
in the financial export and is the rollback path.

### Verify

Confirm `transaction_rules` exists, RLS is on and all four policies target
`authenticated`. Confirm the backfill produced exactly one rule per legacy row,
with `conditions` as a single `note` / `contains` entry and `actions` carrying
that row's category. Re-running the migration must not duplicate them.

Sign in as two users and verify neither can select, insert, update or delete the
other's rules. Save a rule whose action names a project or subscription
belonging to the other user, then apply it: the id is dropped before the write
by `src/lib/transaction-rules.ts`, and even if it were not, the `transactions`
insert/update policies from `20260916094243_portfolio_works_competition_finance.sql`
reject the relationship.

Write a deliberately malformed rule directly in SQL — an unknown `field`, a
`regex` value that cannot compile, `actions` set to a JSON array — and confirm
the Money card still renders and reports the row as unreadable instead of
failing. Then check the three write paths agree: run a bank sync, import a CSV
statement, and press "Apply to matching transactions", and confirm the same
transaction is filed the same way by all three.

### Rollback

Application rollback can deploy the previous version while keeping the new
table; the old code reads `transaction_category_rules`, whose rows were never
modified. Do not drop `transaction_rules` to roll back the UI — the owner's rules
are not recoverable from the legacy table, which only holds keyword matches.

## Cron heartbeats — 2026-09-16

Apply `20260916135326_cron_heartbeats.sql` before deploying the heartbeat state
in the cron list or the `/api/webhooks/uptime-kuma` receiver. Until it runs, the
cron form's save fails on a missing column and the run log's success stamp is a
no-op.

It is additive: `heartbeat_url` (`text not null default ''`) and
`last_success_at` (`timestamptz`) on `public.crons`, plus two partial indexes —
one over the monitored rows, one over `(user_id, endpoint)` for resolving a run
to its cron. No policy, grant or function changes; the four own-only `crons`
policies already cover both columns.

### Verify

Confirm both columns exist and that an existing cron reads `heartbeat_url = ''`
and `last_success_at = null`, which is the unmonitored state the UI reports.
Save a push URL from the cron form and confirm it round-trips.

Sign in as two users. Confirm user A cannot read or update user B's cron, and
that `GET /api/crons/registry` (with the `CRON_REGISTRY_TOKEN` bearer token)
returns `monitored` as a boolean and never the
URL itself — the push URL is a credential.

POST a success to `/api/crons/log` with the cron's `cron_id`, and confirm
`last_success_at` moves and the stored URL receives one request. POST a failure
and confirm neither happens. Leave the cron without a recorded success past three of its estimated longest
usual gaps and confirm the list badge reads Not reporting and the
project health explains it.

For the current receiver, apply migration 134 below too. With `UPTIME_KUMA_WEBHOOK_TOKEN` and `DASHBOARD_OWNER_ID` set, POST a Kuma down
body to `/api/webhooks/uptime-kuma`: one notification appears, a repeat while it
is open adds none, and an up event dismisses it and posts one recovery. Without
the token the route answers 503, and with a wrong one 403.

### Rollback

Deploy the previous application version and keep the columns; nothing older
reads them. Clearing a `heartbeat_url` stops that cron's pings without a schema
change, and unsetting `UPTIME_KUMA_WEBHOOK_TOKEN` turns the receiver off.

## Job application contacts — 2026-09-16

`20260916141348_job_application_contacts.sql` adds `contact_name` and
`contact_email` to `public.job_applications`. Columns only: no table, no
policy, no grant and no function. The four own-only `job_applications` policies
already cover new columns, so RLS is unchanged and the progress RPC keeps its
existing six-argument signature.

Both columns are nullable and checked, not verified: the name is bounded to
200 trimmed characters and the address only has to look like one. Nothing in
the application ever sends mail to either value.

### Verify

Confirm both columns exist and accept `null`. Insert a contact name of 201
characters and an address without an `@` and confirm each check rejects it.
Open Career → Applied → any card → **Response / follow-up**, fill the two
contact fields, save, and confirm the values come back on the card after a
reload. Sign in as a second account and confirm it cannot select or update the
first account's application.

Before the migration runs, PostgREST omits both keys, and the dialog says the
fields need the migration instead of offering inputs that cannot save. That is
the intended degraded state, so it is worth seeing once on an unmigrated copy.

### Rollback

Deploy the previous application version and keep the columns; the old code
never selects them by name. Dropping the two columns discards any contact
already entered — the notes field does not receive a copy.

## Bank provider abstraction — 2026-09-16

Apply `20260916141837_bank_provider_abstraction.sql` before deploying the
provider registry. Until it runs, `/api/bank/connect`, `/api/bank/credentials`
and every sync write fail on a missing column or a missing table.

It is additive. `bank_connections.requisition_id` and `institution_id` lose their
NOT NULL (a token provider has neither), and the table gains `provider_ref`,
`consent_expires_at`, `last_error` and `sync_cursor`. `provider_ref` is
backfilled from `requisition_id`, and the GoCardless path keeps writing both, so
existing connections behave exactly as before. A check constraint pins `provider`
to the three registered ids, which is the same guard
`src/lib/bank/registry.ts` applies in the application.

The new `public.bank_provider_credentials` table holds a per-user provider
secret — today the Fio API token. It mirrors the `github_tokens` boundary: RLS
enabled, no policy at all, every grant revoked from `anon` and `authenticated`,
`service_role` only.

### Verify

Confirm the four new columns exist and that every pre-existing GoCardless row has
`provider = 'gocardless'` and a `provider_ref` equal to its `requisition_id`.
Insert a row with `provider = 'nordigen'` directly in SQL and confirm the check
constraint rejects it.

Sign in and run a sync. An existing GoCardless connection must still import the
same transactions and must not re-insert anything it already holds — the dedupe
keys did not change and GoCardless account refs stay unprefixed.

Store a Fio token from Finances → Connect bank → Fio banka. Confirm
`GET /api/bank/credentials` answers `{"stored":{"fio":true}}` and never the
value, that `GET /api/integrations/status` reports the provider rows as booleans
only, and that the new connection's imported rows carry `fio:`-prefixed
`external_id`s. Sign in as a second user and confirm neither user can select
anything from `bank_provider_credentials` with their own session.

Press the per-connection sync button on one bank and confirm only that bank is
pulled. Set `consent_expires_at` into the past on a linked row and run
`/api/cron/bank-sync`: the row must come back `expired` before any pull happens.

### Rollback

Deploy the previous application version and keep the columns; the old code reads
`requisition_id` and ignores the rest. Do not restore the NOT NULL constraints
while any non-GoCardless connection exists. Dropping
`bank_provider_credentials` deletes the stored Fio token, which then has to be
pasted again.

## Link-project references (superseded) — 2026-09-16

`20260916195556_link_project_references.sql` comes from the archived `claude/busy-carson-lc5ise` line. It creates `ai_link_projects` (one row per library link and project, status `planned` or `used`) and `projects.video_url`. Production applied it, but its application code never reached `main`, which shipped the same relation as `project_links` (#78). The file is kept so the repository matches the production history; `20260925200300_drop_link_project_references.sql` removes both objects again.

## Repository identity for projects — 2026-09-25

Apply `20260925090000_project_repository_identity.sql`. It adds `projects.repo_id bigint` with a unique partial index per owner, `projects.previous_repo_full_names text[]`, and replaces `create_daily_focus_set` so an imported task resolves to its project by explicit `project_id`, then by repository id, then by the current or any previous repository name. The function stays `SECURITY INVOKER`, keeps `search_path = ''` and is executable by `authenticated` only.

After applying, fill the ids with `node scripts/backfill-project-repo-ids.mjs --apply` (see [external setup §10](external-setup.md#renaming-a-project-repository)) or by opening Projects with GitHub connected. Verify that a second owner cannot read or update the new columns on the first owner's projects, and that renaming a repository in a disposable account updates the existing project instead of adding one.

## Own and freelance projects, DNESKAi / devShark / boardlessAI — 2026-09-25

Apply `20260925090100_project_engagement_and_names.sql`. It adds `projects.engagement` (`own` or `client`, default `own`) and `projects.previous_slugs text[]`, marks the projects with slugs `gym-plzen` and `paris-claire` as `client`, and renames three rows per owner: `aifirst` → `DNESKAi`/`dneskai`, `react-express-app` → `devShark`/`devshark`, `quorum` → `boardlessAI`/`boardlessai`. The old slug is appended to `previous_slugs`, so `/projects/aifirst` redirects to `/projects/dneskai` and `GET /api/crons/registry?project=aifirst` keeps answering. A rename is skipped when the owner already has a project with the new slug. `repo_full_name` is not changed; the id-based auto-sync writes it when the GitHub repositories are renamed.

Verify that Projects shows the own group, one "Freelance" divider and the two client projects last, and that the project form saves the engagement.

## Project workspace tab visibility check — 2026-09-25

Apply `20260925090200_fix_hidden_project_tabs_check.sql`. The earlier check on `user_preferences.hidden_project_tabs` still allowed the removed `operations` tab and rejected `scaling` and `monetization`, so hiding either of those in Settings failed to save. The migration removes ids that are no longer tabs from existing rows, then recreates the check with exactly the tabs in `src/lib/project-workspace-tabs.ts`. Verify by hiding Scaling and Monetization in Settings and reloading on another device.

## Project links — 2026-09-25

Apply `20260925090300_project_links.sql`. It creates `project_links (project_id, ai_link_id, role, note, sort_order)` with a unique pair per project and link, cascading deletes from both parents, and own-only RLS whose insert and update checks require that both the project and the link belong to the caller. It also marks `ai_links.project_relevance` as deprecated in its column comment.

Then copy the old free-text relevance: `node scripts/backfill-project-links.mjs` (dry run) and `--apply` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `DASHBOARD_OWNER_ID`. Run the repository-id backfill first so renamed repositories resolve. Verify that a second user can neither read the rows nor attach their link to the first user's project, and that deleting a link or a project leaves no relation behind.

## Prompt kinds and prompt links — 2026-09-25

Apply `20260925090400_prompt_kinds_and_links.sql`. It adds `prompts.kind` (`design`, `audit`, `competition`, `ux-ui`, `analysis`, `documentation`, `new-project`, `seo`, `marketing` or `other`; existing rows become `other`) and creates `prompt_links (prompt_id, ai_link_id, note, sort_order)` with a unique pair, cascading deletes from both parents and own-only RLS that checks both the prompt and the link belong to the caller. Existing prompts keep their text, visibility and default project; assign kinds and links in the editor. The Prompts, Knowledge and Projects exports now include `prompt_links` and `project_links`. Nothing in this feature calls a model.

## Tools — 2026-09-25

Apply `20260925090500_tools.sql`. It creates `tools (ai_link_id, name, what_it_does, status, subscription_id)` with one row per owner and library link, statuses `in_use`, `trial` and `retired`, a cascading delete from the link, `on delete set null` from the subscription, and own-only RLS that checks the link and any subscription belong to the caller. How a tool helps each project is stored as a `project_links` row with role `tool`, so apply the project links migration first. The Knowledge export includes `tools`. Verify that a second user cannot attach the first user's subscription or link to a tool.

## Integrating the 2026-09-16 branch — 2026-09-25

The 2026-09-16 migrations above were applied to production before their code reached `main`. Their files carry the versions production recorded, so `db push` sees them as applied. Four migrations reconcile them with the 2026-09-25 kickoff. Each one is idempotent, passes the [fresh install](#fresh-install), and was applied twice to a local copy whose `projects`, `user_preferences` and `ai_link_projects` columns, constraints, indexes, policies and grants match production's catalog line for line and whose 50 project rows carry production's scope, engagement, key and parent values.

### Project parent policies

Apply `20260925200000_fix_project_parent_policies.sql`. The `projects` insert and update policies from `20260916094243` compared `parent.id = parent_id` inside a subquery over `projects parent`, so the unqualified `parent_id` bound to the inner row and Postgres stored `parent.id = parent.parent_id`: a project had to be its own parent. Every insert or update of a row with a `parent_id` failed, including an edit of Design Lab or GoVIRAL. The migration recreates both policies with `projects.parent_id` and nothing else changed. Verify as the owner through RLS: renaming Design Lab and inserting a child under boardlessAI succeed; attaching a child to another owner's project, moving Design Lab under it, or making a project its own parent is rejected; another owner's rows stay invisible.

### One field for own and client projects

Apply `20260925200100_project_engagement_replaces_scope.sql` after the application code that reads `engagement` only is deployed; the code before it never read `scope` either, so the order is not critical. It drops `projects.scope` and its check. `engagement` (`own` or `client`, #76) is the one field that says whether a project is client work, and `portfolio_key` says whether it belongs to the daily portfolio. Before dropping, it prints a notice naming every project whose `scope` was `work` while `engagement` is `own`; on production that is `umyjemefasadu`, which the kickoff left as the owner's own project. Switch it to Client in the project form if that is wrong.

### Competition tab visibility

Apply `20260925200200_project_competition_tab.sql`. It recreates the `user_preferences.hidden_project_tabs` check with the ten workspace tabs, adding `competition`, so hiding the Competition tab in Settings saves. Existing values all satisfy it.

### Removing the unused link references

Apply `20260925200300_drop_link_project_references.sql`. It drops `ai_link_projects` and `projects.video_url` from `20260916195556`. It is guarded: when either holds data it raises `Refusing to drop the link-reference schema` and drops nothing. Production had no `ai_link_projects` row and no `video_url` value when it was written. Move any rows into `project_links` first if the guard fires. To undo the drop, recreate the empty table and column from the statements in `20260916195556_link_project_references.sql`; no data is lost, because the guard only lets the drop run when there is none.

## Cron-run purge grants — 2026-09-25

Apply `20260925210000_restrict_purge_old_cron_runs.sql` after the four integration migrations above. `20260724110000_cron_runs.sql` revoked `purge_old_cron_runs()` from `PUBLIC` only, and Supabase's default privileges had already granted `EXECUTE` on it directly to `anon`, `authenticated` and `service_role`. Because the function is `SECURITY DEFINER`, anyone could call `/rest/v1/rpc/purge_old_cron_runs` and delete cron runs older than 14 days as the owner; the security advisor reports it as lints 0028 and 0029. The migration revokes the function from `public`, `anon` and `authenticated` and grants it to `service_role`. The `pg_cron` job runs it as the owner and keeps working.

### Verify

`select proacl from pg_proc where oid = 'public.purge_old_cron_runs()'::regprocedure` returns `{postgres=X/postgres,service_role=X/postgres}`. As `anon` or `authenticated`, `select public.purge_old_cron_runs()` fails with `permission denied for function purge_old_cron_runs`; as `service_role` it deletes only runs older than 14 days. The security advisor no longer lists the function. Running the file twice changes nothing.

### Rollback

Nothing reads the function through the API, so there is nothing to roll back. To restore the old grants, `grant execute on function public.purge_old_cron_runs() to anon, authenticated;`, which reopens the advisor finding.

## IG TIPS — 2026-09-26

Apply `20260926140000_ig_tips.sql`. It adds two nullable columns to `ai_links`: `tip_group`, one of `content`, `formats`, `reach`, `growth`, `monetization`, `research`, `design`, `ai` and `operations` (null means ungrouped), and `tip_summary`, at most 2,000 characters. Each has a check. The migration writes no row and changes no table, policy, grant or function; the four own-only `ai_links` policies cover the new columns. Until a tip has a summary its card shows the stored description, and until it has a group it sits under Ungrouped, so the application works before the content arrives.

The groups and summaries of the owner's existing tips are data, not schema. They arrive as a separate file of `UPDATE` statements keyed by row id, applied after the migration and kept outside this repository like the research imports. `description` is left as it is: it stays the research notes behind each tip.

### Verify

`select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'ai_links' and column_name like 'tip\_%'` lists both columns as nullable. Setting `tip_group = 'other'` fails with `ai_links_tip_group_check`, and a 2,001-character summary fails with `ai_links_tip_summary_length_check`. A second owner still cannot read or update the first owner's tips. Running the file a second time changes nothing.

### Rollback

`alter table public.ai_links drop column if exists tip_summary, drop column if exists tip_group;` removes the groups and summaries. The tips keep their titles, URLs, descriptions, categories and project links.

## Marketing automation (review before production)

Apply only after the owner reviews the implementation and approves deployment. Do not use this migration list to activate publishing.

1. `20261013193104_marketing_control_surface.sql`: adds isolated owned campaign/calendar/source/history/account/revision/publication/event tables. Browser writes are revoked; bounded approval/decision functions authenticate `auth.uid()`. Service integration credentials bind one owner. All function grants explicitly revoke Supabase default anon/authenticated privileges before restoring intended access.
2. `20261013193105_marketing_durable_jobs.sql`: adds durable generation jobs, owner campaign/slot controls, replacement invalidation, exclusive leases and compare-and-set publisher checkpoints/receipts. Rebinding a slot retains its original plan, supersedes its old prepared revision and increments delivery identity; it approves no post.
3. `20261013193106_marketing_knowledge_import.sql`: adds evidence/procedure sidecars to canonical `ai_links`; retains IDs/relationships, hashes, source timestamps and exact consent-bound provider plans. Import/analysis/review runs through owner-scoped server operations.
4. `20261013193107_marketing_private_assets.sql`: provisions a private JPEG bucket capped at8 MiB, only owner-prefix reads, and restrictive browser write backstops. Service worker uses immutable upload keys and verifies stored hashes before signing.
5. `20261013193108_marketing_staging_pilot_guard.sql`: adds an immutable service-only owner pilot tuple and permanent generation reservations in a private schema. Optional enqueue/claim parameters retain normal behavior for owners without a pilot; a configured pilot reserves at most3 jobs at$0.25 each and checks its fence/deadline before every paid attempt. Removing/changing environment settings or deleting/failing a job cannot reset the quota. See [pilot guard](marketing-pilot-guard.md).
6. `20261013193131_marketing_offline_import.sql`: adds owner-readable import identities and service-only import functions. The original pilot window is checked before work and again after locks. Imported revisions retain an immutable review hold through caption edits; the migration enables no import or approval. See [offline import](marketing-offline-import.md).
7. `20261013193132_marketing_story_receipts.sql`: replaces the service-only publication receipt function. A genuine numeric Story acknowledgement can be recorded without a permanent URL when its single JPEG has the required geometry. Feed and Threads still require a URL; ambiguous outcomes remain subject to reconciliation without another publish request.
8. `20261013193134_marketing_dneskai_collection.sql`: adds owner-readable research runs, source cursors and candidates; service-only functions admit one run per project and Prague day and fence each tick. Paid reservations aggregate across the owner's projects, retain unknown costs and refuse new work under an existing generation pilot. At most four fresh, classified topics receive a tomorrow research date; these are unapproved topics, not articles or social revisions. The migration also adds the Sources workspace tab to the preference allowlist. Collection stays disabled until separately configured and authorized; it grants no approval, publication or extra pilot budget.
9. `20261013193136_dneskai_collection_pilot.sql`: adds explicit Preview-only collection authorization. A server-configured owner/project/window is persisted immutably, expires within48hours and permits one lifetime collection run with at most $0.24 reserved provider spend. It cannot adopt an existing normal run, reset old generation reservations, or fall back to normal paid collection when pilot settings disappear. It also fixes classification updates to allow derived status/reason fields while preserving the authored source. Applying the schema alone does not grant a pilot; its separately approved configuration must be supplied by the server.

Before applying, back up schema/data and verify a staging copy with own-only access and service-role credentials. No migration changes existing calendar content, approves templates/posts, connects accounts or enables schedules. Import both complete repository calendars as paused drafts; review counts and dated content before activation. Publishing flags and accounts remain disabled.

Rollback first disables per-brand/global publisher and n8n schedules. Retain approved revisions, assets, provider/media IDs and receipts for reconciliation. Archive a new campaign to restore calendar control; never drop evidence tables or blindly republish an ambiguous remote outcome. See [marketing orchestration](marketing-n8n.md), [knowledge](marketing-knowledge.md) and [offline flow proof](marketing-pipeline-verification.md).

## DNESKAi collection cursor and limits (2026-10-20)

`20261021122104_dneskai_collection_cursor_limits.sql` replaces four collection functions with their latest bodies plus three changes, and adds one function and one column. Applied migrations stay untouched.

- `marketing_dneskai_save_stage`: a stage saved as `partial` with `collection-source-item-cap` (the provider stopped only at its item cap) moves `marketing_dneskai_source_states.last_success_at` to its newest accepted item (`publishedAt`, or `fetchedAt` when undated), never past now. A complete read still moves it to the run start. Errors, invalid URLs, other partial results, held or over-budget results and empty results leave it unchanged.
- `marketing_dneskai_claim_stage`: Instagram stages take up to 10 items (was 7) and a Prague day up to 50 reserved Instagram items (was 35). The $0.04 stage reservation and the $0.25 daily ceiling are unchanged; 10 results at $2.30 per 1,000 cost $0.023.
- `marketing_dneskai_admit` and `marketing_dneskai_admit_pilot` no longer create 16 fixed `__jev:00..15` stages. The new service-role function `marketing_dneskai_plan_jev(owner, run, fence, count)` creates `ceil(new candidates / 8)` stages (0 to 16) once per run, after every source stage has settled, and records the count in the new nullable `marketing_dneskai_runs.jev_stage_count`. Runs admitted before the migration keep their 16 stages.
- The `reserved_items` check on `marketing_dneskai_stages` becomes `0..10`.

Verify on a staging copy with `tests/lib/marketing-dneskai-cursor-database.test.ts` (PGlite replay of all three collection migrations): two consecutive runs over the same feed, where the second reads only from the first run's cursor and inserts no duplicate. No schedule, flag or account changes. Rollback: redeploying the previous app keeps working against the new functions except that it never calls `marketing_dneskai_plan_jev`, so its runs get no Jev stages; reapply the 20261013193136 function bodies before rolling the app back.

## DNESKAi source media (2026-10-20)

`20261021122453_dneskai_source_media.sql` (#114) adds the private bucket `marketing-media` (JPEG, PNG and WebP, 32 MiB, owner-prefix reads, no browser writes; the same restrictive-guard pattern as `marketing-assets`, which is not changed) and three owner-readable tables: `marketing_media_assets` (one row per owner and sha256 with origin, position, size, MIME, storage path, credit, pHash, duplicate marker and `purged_at`), `marketing_media_asset_links` (each candidate that uses an asset) and `marketing_media_collections` (per-candidate plan, status and skipped positions). Links and collection rows reference `marketing_dneskai_candidates` and cascade with it; a trigger checks project and asset ownership even for service-role writes. Eight service-role functions do the work: `marketing_media_begin` (claims a selected candidate under a 120 s fence), `marketing_media_set_plan`, `marketing_media_record_asset` (new sha256 only after upload; pHash Hamming distance ≤ 6 to the canonical itself marks the smaller copy; groups stay flat and nearness is never chained), `marketing_media_finish`, `marketing_media_lookup`, `marketing_media_pending_candidates`, `marketing_media_claim_purge` and `marketing_media_unmark_purge`. No existing table, function or flag changes, and nothing is fetched until the scheduler calls the collector.

Verify after applying: the bucket row is private with the three MIME types and `33554432`; anon reads nothing from the three tables, the owner reads only their rows and cannot write; anon and authenticated cannot execute the eight functions. `tests/lib/marketing-dneskai-media-database.test.ts` runs these checks against the migration in PGlite. Rollback: stop calling the collector, then drop the three tables, the eight functions and the trigger function `marketing_media_ownership` and, after removing its objects, the bucket and its six `marketing_media_*` storage policies. Media docs: [DNESKAi source media](dneskai-source-media.md).

## Oslo Career preference (2026-10-16)

`20261015234547_oslo_career_preferences.sql` adds `user_preferences.show_czech_career` with `NOT NULL DEFAULT false`. The filename matches the version recorded in production. Existing own-only preference RLS and grants remain in force. Verify a new preference row is false, authenticated PATCH accepts only a boolean, and another owner cannot read or change it. Existing Czech saved positions, applications, sources and career links are retained behind the opt-in. Default refresh and availability checks skip Czech sources and unknown Apify task scopes. No cron or AI model calls were added.

Public role summaries and the employer directory ship in source. Personal English letters are prepared offline and stored only in owner-scoped `saved_job_positions`, outside Git. No existing letters are overwritten. App rollback may leave this additive column safely in place.

## Retired staging pilot ledgers (2026-10-20)

`20261021122330_scope_retired_pilot_ledgers.sql` changes five service-only functions for #113.
Before it, a generation or collection pilot row blocked the owner's ordinary job admission, collection
admission and paid collection for good, expired or not. Now each block holds only while that pilot window
is unexpired. No row is changed or removed: windows, the three $0.25 generation reservations, the lifetime
collection run and its reserved stages stay as they are. An expired tuple still raises `pilot outside window`,
a changed one `pilot configuration changed`, and ordinary admission refuses to return the retained pilot run.
The unknown-cost guard (`collection cost unresolved`) is unchanged. Function grants stay service-only.

- `marketing_private.check_generation_pilot`, `marketing_enqueue_job` and `marketing_claim_job` are defined
  only by `20261013193108` and are replaced whole. The two job wrappers now refuse a job the pilot reserved
  on the ordinary path (`pilot job retired`, on claim and on the enqueue duplicate path), so after expiry it
  cannot run without `marketing_check_pilot_attempt` and its $0.25 cap. The job and its reservation stay.
- `marketing_dneskai_admit` and `marketing_dneskai_claim_stage` are also redefined by #112's
  `20261021122104_dneskai_collection_cursor_limits.sql`, which sorts first. This migration does not restate
  them. It reads the current body with `pg_get_functiondef`, replaces exactly three pilot conditions and
  stops with `pilot predicate in … not found as expected` if a condition is missing or appears an
  unexpected number of times. A body that already has the scoped conditions is left alone, so a re-run is a
  no-op. The Instagram limits and Jev planning of whichever body came before are kept byte for byte;
  `tests/lib/marketing-retired-pilot-ledger-database.test.ts` checks that against the body each earlier
  migration left.

Apply in filename order. If `20261021122104` reaches a database after this migration, it restores the
unscoped conditions; apply this file again afterwards. The read-only check on 2026-10-20 found no pilot
ledger rows in production; they exist only in the Supabase branch `marketing-staging-20261013`. Verify
after applying: `pg_get_functiondef('marketing_private.check_generation_pilot(uuid,jsonb,boolean)'::regprocedure)`
contains `clock_timestamp()<config.expires_at`, `pg_get_functiondef('public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean)'::regprocedure)`
contains `generation_pilots where user_id=p_owner and clock_timestamp()<expires_at`,
`pg_get_functiondef('public.marketing_claim_job(uuid,uuid,uuid,jsonb)'::regprocedure)` contains
`pilot job retired`, and `has_function_privilege('authenticated','public.marketing_dneskai_admit(uuid,uuid,date,jsonb)','execute')`
is false. Rollback re-runs the latest earlier body of each function as `create or replace`: the three
whole functions from `20261013193108_marketing_staging_pilot_guard.sql`, and admit and claim_stage from
`20261021122104` when it is applied, otherwise from `20261013193136_dneskai_collection_pilot.sql`. No data
changes either way.

## Marketing account tokens (2026-10-20)

`20261021122220_marketing_account_tokens.sql` adds `marketing_account_tokens`: one current long-lived Meta access token per `marketing_accounts` row, with `expires_at`, `refreshed_at`, `scopes` and `login_mode`. RLS is enabled with no policy, and every table privilege is revoked from `anon`, `authenticated` and `service_role`, so no API client can select the token. Service-role functions verify an account together with its token (`marketing_verify_account`), store a refreshed token with a compare-and-set on `refreshed_at` (`marketing_store_account_token`), read it for the publisher (`marketing_read_account_token`) and list non-secret metadata (`marketing_account_token_metadata`). The owner reads only expiry, refresh time, scopes and login mode through `marketing_account_token_status()`. A trigger rejects a token row whose owner or login mode does not match its account. Both writing functions check the token, expiry, scopes (at most 20, `^[a-z_]{1,64}$`) and login mode before any row exists and refuse with value-free messages (`invalid token`, `token expired`, `invalid scopes`, `invalid login mode`), so a table constraint can never print the token in an error detail. Verification never enables publishing: a new account starts with `enabled=false` and a changed remote identity sets it back to false.

Verify after applying: the owner and another signed-in user both get `permission denied` when selecting from the table; `marketing_account_token_status()` returns only the owner's metadata; anon and authenticated cannot execute the service functions. `tests/lib/marketing-account-tokens-database.test.ts` runs these checks against the migration in PGlite.

Order: apply the migration before deploying the code that reads it. The application treats a failed token-store read as `credential-store-unavailable`, never as "no stored token", so code running without the migration holds every publish, preflight and reconciliation, the verify route answers `credential-store-unavailable` or `account-store-failed`, and `GET /api/marketing/accounts` returns 503, which the Instagram account panel shows as unavailable.

Rollback: roll the application back first, or together with the database, to a release without `marketing_account_tokens`; that release reads only the environment token. Then `drop table public.marketing_account_tokens cascade;` and drop the `marketing_account_token*` and `marketing_verify_account`, `marketing_store_account_token`, `marketing_read_account_token` functions. Dropping them under the current application does not fall back to the environment token: publishing and reconciliation hold with `credential-store-unavailable` and the panel shows the account as unavailable until the application is rolled back too. Setup: [external setup §11](external-setup.md#11-instagram-publishing-for-dneskai-121).

## Revision media identity (2026-10-20)

`20261021122551_marketing_revision_media_identity.sql` belongs to #118. The server now stores `content_hash` as
`revisionContentHash`: sha256 of the canonical revision without `assets[].url`. SQL never computed the hash and
still only compares stored values, so `marketing_save_revision`, `marketing_claim_due` and the publication fences
are unchanged.

- `marketing_revisions.render_report jsonb` (nullable) holds the last deck render: status, problems, render keys.
- `marketing_renew_revision_asset_urls(owner, revision, expected_hash, assets)` (service role only) replaces the
  stored assets with renewed ones when the revision is `review` or `approved`, `content_hash` equals the expected
  hash, the revision without URLs is identical (`marketing_private.revision_without_urls`), and every new URL is a
  signed `marketing-assets` URL for the same object path as before. It never touches `content_hash`,
  `approved_hash`, `status`, `ready` or the publication, and it creates no revision.
- `marketing_attach_revision_render(owner, revision, expected_hash, content, hash, ready, report)` (service role
  only) attaches rendered JPEGs once to an unready `review` revision with a deck and no assets. Only `assets` may
  differ from the stored revision. `ready=true` needs one asset per slide and a clean `rendered` report; a refused
  render keeps the content and hash and records the report.
- `marketing_approve_revision` is replaced whole with the body from `20261013193104` plus two holds: a blocking
  report (`render blocked`, via `marketing_private.render_report_blocks`) and a deck whose asset count differs from
  its slide count (`revision not ready`). Grants are restated: authenticated only.

Verify after applying: the two new functions and both private helpers are not executable by `anon` or
`authenticated`; renewing an approved revision leaves `approved_hash` and the queued publication as they were;
a renewal that changes a sha256, alt text, size, order, count or object path is refused.
`tests/lib/marketing-revision-media-database.test.ts` runs these checks against the migration in PGlite.

Order: apply the migration before deploying the code that calls the two functions. Code without the migration
cannot renew URLs in place or attach a deck render (`asset-url-renewal-refused`, `render-attach-failed`); legacy
edits and approvals keep working. Production holds no revisions (0 rows on 2026-10-20), so the hash change
invalidates no approval.

Rollback: roll the application back first, then re-run `marketing_approve_revision` from
`20261013193104_marketing_control_surface.sql`, drop `marketing_renew_revision_asset_urls`,
`marketing_attach_revision_render`, `marketing_private.revision_without_urls`,
`marketing_private.render_report_blocks` and the `render_report` column. A rolled-back release computes the hash
with URLs again, so a revision approved under this release would hold at the publisher as
`exact-approval-required` until it is edited and approved again.

## DNESKAi daily generation ceiling (2026-10-20)

`20261021124651_dneskai_daily_generation_budget.sql` belongs to #116. It adds no column and changes no existing
table or function.

- `marketing_private.dneskai_generation_spend`: one row per DNESKAi generation job that made a paid call, with the
  reserved maximum, the number of calls and when they were reserved. RLS on; only the service role reads and writes
  it. Rows are never deleted; the 24-hour window moves past them. The October pilot ledgers are untouched.
- `marketing_dneskai_generation_spent(owner, except_job)` (service role only): the DNESKAi generation spend of the
  last 24 hours. A job in `review`, or `failed` with a recorded `result.usage.estimatedCostUsd`, counts at that
  cost; any other reserved job counts at its full reservation.
- `marketing_reserve_dneskai_generation(owner, job, fence, reservation, ceiling)` (service role only): under an owner
  advisory lock and the job's live fence, admits the call when spent plus the reservation stays within the ceiling
  and records the reservation; a refused call records nothing. It refuses other brands and out-of-range figures.

Verify after applying: `anon` and `authenticated` cannot execute either function or read the ledger; four running
jobs at $0.25 fill a $1.00 ceiling and the fifth is refused; a finished job counts at its recorded cost.
`tests/lib/marketing-dneskai-generation-budget-database.test.ts` runs these checks against the migration in PGlite.

Order: apply the migration before deploying the code that calls it. Code without the migration refuses every paid
DNESKAi generation call with `dneskai-daily-generation-budget-unavailable`; devShark generation is unaffected.

Rollback: roll the application back first, then drop the two functions and the table. Dropping them under the
current application keeps DNESKAi generation refused, which is the safe direction.

## DNESKAi events and briefs (2026-10-20)

`20261021123547_dneskai_events_briefs.sql` belongs to #115 ([events and briefs](dneskai-briefs.md)).

- `marketing_dneskai_briefs` (owner read, service-role writes, the collection ownership trigger): one row per
  selected event and target day, unique per owner, project, `event_id` and `target_date`, with rank 1–4, category,
  up to eight member candidate ids, the lead candidate, `member_hash`, status `pending | ready | queued | skipped`,
  a code, the brief document (validated in TypeScript), the slot, the calendar entry and the job. A partial unique
  index keeps one brief per slot.
- `marketing_dneskai_finish` is dropped and recreated with a sixth argument `p_events jsonb default null` (the
  TypeScript grouping). Its body is the current one from `20261013193134` with the selection changed to at most
  four events, one per category first; a covered event's open reports become duplicates; every classified report
  of a chosen event is selected (at most eight); `selected_count` counts the day's briefs. Without `p_events` every
  candidate is its own event, which is the former selection. An event counts as covered when it holds a selected
  report, or a Jev duplicate whose link leaves the event and ends at a selected report or a DNESKAi revision; a Jev
  duplicate of a held, rejected or open report covers nothing.
- `marketing_private.dneskai_event_id` and `marketing_private.dneskai_member_hash` compute the same identities as
  `src/lib/marketing/dneskai-events.ts`. `marketing_private.dneskai_covering_id` follows a Jev `duplicateOf` link
  through duplicate reports (at most eight links) to the selected report or revision it ends at, or returns null.
- Service-role functions: `marketing_dneskai_prepare_brief`, `marketing_dneskai_skip_brief` (optionally marks the
  members `duplicate` with `collection-already-covered`), `marketing_dneskai_admit_brief` (ensures the active
  "DNESKAi daily" campaign, never taking over another active DNESKAi campaign, and one planned calendar entry bound
  to the brief's source head; when the brief's current entry version already has its job, it returns that job
  instead), `marketing_dneskai_brief_queued` and `marketing_dneskai_brief_source` (the refresh read with the current
  member hash).

Verify after applying: anon and authenticated cannot execute the new functions or the private helpers; the owner
reads only their brief rows and cannot write them; a five-argument `marketing_dneskai_finish` call still works.
`tests/lib/marketing-dneskai-briefs-database.test.ts` and `tests/lib/marketing-dneskai-briefs-flow-database.test.ts`
run these checks and one collection night end to end against every migration in PGlite.

Order: apply the migration before deploying the code. The new collector calls `marketing_dneskai_finish` with
`p_events`; the code deployed before it calls it without, which the default keeps working.

Rollback: roll the application back first, then drop the five brief functions, the two private helpers and
`marketing_dneskai_briefs`, and re-run `marketing_dneskai_finish` from `20261013193134_marketing_dneskai_collection.sql`
after dropping the six-argument version. Candidates selected as event members stay `selected`; nothing was published.

## Marketing scheduler (2026-10-20)

`20261021124400_marketing_scheduler.sql` and `20261021124628_marketing_scheduler_cron.sql` belong to #120 and
replace the n8n timers with Supabase pg_cron ([marketing scheduling](marketing-scheduling.md)).

- `marketing_ticks` (owner read, service-role write): one row per accepted tick, keyed by the tick id the caller
  sends, with `kind`, `started_at`, `finished_at`, `did` and `errors`.
- `marketing_scheduler_state` (owner read, service-role write): one lease per category (`holder`, `lease_until`),
  `next_allowed_at` for backoff and a small `state` object.
- Service-role functions: `marketing_scheduler_begin_tick` (false for a tick id seen before),
  `marketing_scheduler_finish_tick`, `marketing_scheduler_acquire` (`busy` or `backoff` when refused),
  `marketing_scheduler_release` (only by the current holder), `marketing_scheduler_save_state` (state under a
  live lease, used for the token mark) and `marketing_scheduler_prune_ticks`.
- The cron migration creates pg_cron (`pg_catalog`), pg_net and pgcrypto (`extensions`) when the engine offers
  them, adds `marketing_private.scheduler_signature` and the security-definer
  `marketing_private.scheduler_post(kind)`, and schedules `marketing-tick-minute` (`*/5 * * * *`) and
  `marketing-tick-daily` (`18 2 * * *`, between two minute ticks). `scheduler_post` reads `marketing_scheduler_url` and
  `marketing_scheduler_secret` from Vault and returns without sending anything while either is missing, so the
  migration needs no values. No API role may execute either private function.
- It also schedules `marketing-cron-history-prune` (`43 3 * * *`), which deletes `cron.job_run_details` rows older
  than 14 days of the three marketing jobs and of jobs that no longer exist. Supabase keeps `cron.log_run` on and
  nothing else prunes that table, so without the job the 290 runs a day would accumulate forever. Other jobs keep
  their history.

Verify after applying: `select jobname, schedule from cron.job where jobname like 'marketing-%'` lists three
jobs; `select marketing_private.scheduler_post('minute')` returns null before the Vault secrets exist; after they
exist a row appears in `marketing_ticks` within five minutes. `tests/lib/marketing-scheduler-database.test.ts`
runs both migrations in PGlite with stand-ins for Vault, pg_net and pg_cron.

Order: deploy the code with `MARKETING_SCHEDULER_SECRET` first, then apply both migrations, then create the two
Vault secrets on the Dashboard's Vault page ([turning it on](marketing-scheduling.md#turning-it-on); SQL only in
the form there that cannot fail). Ticks that arrive before the deploy answer 404 or 401 and change nothing.

Rollback: `select cron.unschedule('marketing-tick-minute'); select cron.unschedule('marketing-tick-daily');
select cron.unschedule('marketing-cron-history-prune');`, then drop the two private functions, the five
`marketing_scheduler_*` functions and both tables. The extensions may stay; other features can use them.

## Render report on generated DNESKAi revisions (2026-10-21)

`20261021124706_marketing_job_render_report.sql` replaces `marketing_finish_job` with the same body plus one step:
when the job result carries `renderReport`, the function writes it to `marketing_revisions.render_report` of the
revision it has just saved. The worker sends a report only for a DNESKAi deck it rendered, so devShark and legacy
jobs leave the column null as before. A report that fails the column check rolls the whole finish back, and the
job ends in reconciliation instead of review.

Verify after applying: `anon` and `authenticated` still cannot execute `marketing_finish_job`; a DNESKAi job that
finishes in review has a `render_report` with `status` `rendered`. `tests/lib/dneskai-dry-day.test.ts` checks the
second point against the migrations in PGlite.

Order: apply before deploying the code that sends the report. Old code with the new migration sends no report and
behaves as before; new code with the old function stores the report in `marketing_jobs.result` only.

Rollback: re-run `marketing_finish_job` from `20261013193105_marketing_durable_jobs.sql`. Stored reports stay; they
were written by this release and remain valid.

## Hideable DNESKAi project tabs (2026-10-21)

`20261021124712_dneskai_hideable_project_tabs.sql` recreates `user_preferences_hidden_project_tabs_check` with the
eleven tabs from `20261013193134_marketing_dneskai_collection.sql` followed by `dneskai-review`, `dneskai-calendar`,
`dneskai-published` and `dneskai-costs`. That is `PROJECT_TAB_IDS` in `src/lib/project-workspace-tabs.ts`, which
Settings, the workspace and `normalizeHiddenProjectTabs` share. It updates no row: every stored value satisfied the
previous check, and the new one only adds ids.

Verify after applying: `pg_get_constraintdef` of the check lists the fifteen ids; hiding Calendar under "Only in the
DNESKAi project" in Settings saves and stays hidden after a reload on another device.
`tests/lib/project-tabs-database.test.ts` runs the migration chain in PGlite and checks that the four ids save, that
an unknown id is rejected and that the migration applies again over stored rows.

Order: apply before deploying the code. New code against the old check fails to save any hidden-tab change once a
DNESKAi tab is hidden; the choice then stays on that device only. Old code with the new check drops the DNESKAi ids
when it reads them and never writes them.

Rollback: roll the application back first. Then remove the four ids from stored rows and re-run the two
`user_preferences_hidden_project_tabs_check` statements at the top of
`20261013193134_marketing_dneskai_collection.sql`:

```sql
update public.user_preferences
set hidden_project_tabs = array(
  select tab from unnest(hidden_project_tabs) as tab
  where tab <> all (array['dneskai-review','dneskai-calendar','dneskai-published','dneskai-costs']::text[])
)
where hidden_project_tabs && array['dneskai-review','dneskai-calendar','dneskai-published','dneskai-costs']::text[];
```

## Production apply of the DNESKAi social release (2026-10-21)

Migrations `20261021122104` through `20261021124712` (then named `20261020100000` through `20261021100000`) were
applied to production project `gcctapykhrdyxikieemn` on 21 October 2026 through the Supabase MCP `apply_migration`
tool, one call per file in filename order. The tool records the apply time as the version and holds any statement
that drops an object or deletes rows for a confirmation, which that session could not answer. Three files therefore
went in differently, and the repository now records them as production ran them (see the next section):

- The events and briefs release is three versions: `20261021123547` (table and identity helpers),
  `20261021124058` (`marketing_dneskai_finish`) and `20261021124144` (brief functions). Instead of
  `drop function public.marketing_dneskai_finish(uuid,uuid,uuid,text,text)`, the five-argument function was renamed to
  `marketing_dneskai_finish_retired_20261021` and every grant on it was revoked. The six-argument function is the
  only `marketing_dneskai_finish`, so callers with five arguments resolve to it as before. Rollback: drop the
  six-argument function and rename the retired one back.
- The scheduler is `20261021124400` (tables) and `20261021124438` (functions) without
  `marketing_scheduler_prune_ticks`, and `20261021124628` (cron) without the `marketing-cron-history-prune` job. Both
  are in the pending `20261022000000_marketing_scheduler_retention.sql`.
- `20261021125123_restrict_pg_net_browser_roles.sql` changed nothing: Supabase grants `net.http_post` to `PUBLIC` as
  `supabase_admin`, which the `postgres` role cannot revoke. The `net` schema is not exposed through the API.

A fingerprint of every function body, constraint, index, policy, trigger, grant, bucket and cron job these
migrations define matched the PGlite build of the repository exactly, apart from the two retention objects.

## Production history reconciled — 2026-10-22

Production's history and `supabase/migrations` list the same versions up to `20261021125123`. Nothing was written to
production; the repository followed production, as the 2026-09-16 files did:

- 20 files were renamed to the versions production recorded: the nine 2026-10-12/13 marketing files to
  `20261013193104`–`20261013193136`, and the eleven 2026-10-20/21 files to `20261021122104`–`20261021124712`.
- The events and briefs file was split into `20261021123547_dneskai_events_briefs.sql`,
  `20261021124058_dneskai_events_briefs_finish.sql` and `20261021124144_dneskai_events_briefs_functions.sql`, the
  scheduler file into `20261021124400_marketing_scheduler.sql` and `20261021124438_marketing_scheduler_functions.sql`,
  along the statements production recorded under each version. The rename above replaces the drop.
- `20261021125123_restrict_pg_net_browser_roles.sql` was added. It runs its two revokes only where a `net` schema
  exists, so PGlite and a fresh install without `pg_net` skip it.

Checked by read-only queries on 22 October 2026: every applied file's SQL, comments and whitespace aside, has the
same MD5 as the statements production stored under its version, except `20261015234547` and `20261021125123`, whose
statements are the same with different comments or a guard. `marketing_scheduler_prune_ticks` and the
`marketing-cron-history-prune` job are absent. `tests/lib/migration-contracts.test.ts` pins the production versions.

### Applying the prepared migrations

The 23 files from `20261022000000` through `20261023130300` were applied on 23 October 2026 under owner authorisation (see NEEDED.md). Do not repeat that completed rollout. Sixty prepared audit files follow, numbered 87–147 in the [current migration list](../README.md). The latest is `20261027212131_captured_marketing_account_verification.sql`. Check the linked project and apply this complete chain in filename order before deploying the implementation branch:

```bash
npx --yes supabase@2.122.0 migration list --linked --project-ref gcctapykhrdyxikieemn
npx --yes supabase@2.122.0 db push --linked --project-ref gcctapykhrdyxikieemn --skip-vault --dry-run  # expect 87–147
npx --yes supabase@2.122.0 db push --linked --project-ref gcctapykhrdyxikieemn --skip-vault
npx --yes supabase@2.122.0 migration list --linked --project-ref gcctapykhrdyxikieemn  # both columns agree
```

The pinned current CLI accepts an explicit project reference, so this isolated checkout needs no local link or copied database credential. `--skip-vault` preserves Vault configuration instead of resolving/updating its values. Authenticated CLI access currently waits on macOS Keychain; its documented no-Keychain mode confirms no fallback login. Restore that access without copying secrets to chat or files, then inspect the complete dry run before the authorized push. Local migration creation needs no hosted login.

Do not apply them through the Supabase MCP `apply_migration` tool: it records the apply time as the version, which
recreates the mismatch, and it holds the retention file's `delete` for a confirmation. `20261022141613` needs
`20261022021835` first, and `20261023130300` needs `20261023100100`; filename order does both. The relevance-first
selection (`20261022180000`), the majority category (`20261022160000`) and the unknown-cost scope (`20261022171000`)
take effect with the push itself and need no switch. The next daily tick then records no `retention` error.

The routine switch activation and deployment were completed on 23 October 2026; NEEDED.md records which optional spend and Facebook Login dependencies remain. The following table records prerequisites, not a request to enable every feature. A server switch is enabled only when its text is exactly `true`; defaults are in [marketing scheduling](marketing-scheduling.md#switches).

| Switch | Needs |
|---|---|
| `DNESKAI_RICH_EVIDENCE_ENABLED` | `20261022020702`, `20261022020759` |
| `DNESKAI_OWNER_RECOVERY_ENABLED` | `20261022141512` |
| `DNESKAI_LAPSED_RELEASE_ENABLED` | `20261022021835`, `20261022141613` |
| `MARKETING_PUBLICATION_REQUEUE_ENABLED` | `20261022110000` |
| `DNESKAI_SELECTION_V2_ENABLED` | `20261022180000`, `20261022180100` |
| `DNESKAI_REGENERATE_ENABLED` | `20261022190000` and `MARKETING_AI_CONSENT` |
| `DNESKAI_TOPICS_ENABLED` | `20261023100000` |
| `DNESKAI_SCOUTING_ENABLED` | the topics switch |
| `DNESKAI_FACT_OR_HYPE_ENABLED` | scouting, `20261023100100`, the Apify, paid and consent switches |
| `DNESKAI_TITLING_ENABLED` | the topics switch, `20261023100100` |
| `DNESKAI_TOPIC_BRIEFS_ENABLED` | the topics switch, `20261023100200` |
| `DNESKAI_DAILY_MIX_ENABLED` | the topics switch, `20261023100300` |
| `DNESKAI_SOURCES_TABLE_ENABLED` | `20261023110000` |
| `DNESKAI_ENGAGEMENT_ENABLED` | `20261023120000` and the comment scopes on the account |
| `MARKETING_DNESKAI_REELS_ENABLED` | `20261023130000`, `20261023130100` |
| `DNESKAI_AUDIO_TRENDS_ENABLED` | `20261023130200` and Facebook Login |
| `DNESKAI_TIKTOK_TRENDS_ENABLED` | `20261023130300`, the audio trends switch, the Apify, paid and consent switches, and the owner's spend decision |

`MARKETING_DNESKAI_APIFY_RESEARCH_ENABLED` stays off until the owner approves the research plan; the ledger
(`20261022013957`) spends nothing on its own.

## DNESKAi research preparation, 22 October 2026 (schema applied 23 October 2026)

`20261022013957_dneskai_apify_research.sql` adds the separate private research ledger, atomic service-only reserve/mark/spent RPCs, and own-only public metric reads. It preserves all pipeline and staging ledgers. No cron or live route starts research. See [research operations](dneskai-apify-research.md).

Applied on 23 October 2026. Local PGlite tests cover the ledger; the schema alone does not authorize research calls or spend.

## Richer brief evidence, 22 October 2026 (schema applied 23 October 2026)

`20261022020702_dneskai_richer_brief_evidence.sql` adds bounded article prose to the owner-scoped media collection and a fenced service-only setter. Alt and figcaption metadata stay in the immutable image plan. `20261022020759_dneskai_brief_v2_compatibility.sql` accepts both brief document versions without rewriting stored briefs or changing grants.

Both migrations were applied on 23 October 2026. Article prose and the brief/2 writer require server-only `DNESKAI_RICH_EVIDENCE_ENABLED=true`; without it the app uses the existing media columns and brief/1 writer. Both document versions remain readable. No collection switch, paid ceiling or staging ledger changes.

### Applied 23 October 2026: lapsed brief reports

`20261022021835_dneskai_release_lapsed_reports.sql` replaces the future skip path. A lapsed pending/ready brief with no job, no matching job request or revision, and no other active brief releases its selected reports back to classified `new` candidates. Ordinary freshness and ranking still apply. Covered, queued, generated and non-lapsed briefs retain their reports. The skipped brief and its source history stay intact. Applied on 23 October 2026; the migration runs no historic cleanup.

## Publication re-queue, 22 October 2026 (schema applied 23 October 2026)

`20261022110000_marketing_requeue_unpublished_publication.sql` adds `marketing_requeue_publication(p_publication)` for the signed-in owner (audit finding approval-04). It accepts a publication in `reconciliation`, or a claim whose lease expired, only when it has no numeric container ID, no media ID, no URL and no `publish-intent`: such a row never reached `media_publish`. It sets the publication back to `queued` (`error_code='owner-requeued'`, container and lease cleared) and the revision back to `approved`, leaving `approved_at`, `approved_hash` and the content untouched, and records a `requeued` event. Every other row is refused with `publication may be published`, `publication not stranded` or `approval changed`.

Applied on 23 October 2026. Container retries use the existing `marketing_checkpoint_publication`; the re-queue route and panel require `MARKETING_PUBLICATION_REQUEUE_ENABLED=true`. A missing function answers `publication-requeue-unavailable`. Local regression coverage: PGlite (`tests/lib/marketing-requeue-database.test.ts`).

### Applied 23 October 2026: owner recovery actions

`20261022141512_dneskai_owner_recovery.sql` adds two owner-only security-definer functions, executable by `authenticated` and scoped by `auth.uid()`. `marketing_dneskai_release_candidate` returns one held report with text, published within 30 days, to the open queue (status `new`, classification cleared, authored fields unchanged); Jev reviews it again in a later nightly batch under the existing limits. `marketing_dneskai_reslot_brief` reopens a brief that lapsed (`brief-slot-passed`, `brief-target-date-passed`, `brief-slot-unavailable`) before any source head, calendar entry, job or revision existed. It takes a rebuilt brief with the same member hash, one of the four daily slots today or tomorrow at least 30 minutes ahead, no later expiry than the original and a lead report still inside the selection window. The brief becomes `pending` (`owner-reslot`, or `account-unavailable` without a verified account) and the scheduler admits it through the ordinary path.

`20261022141613_dneskai_release_lapsed_brief.sql` adds `marketing_dneskai_release_brief`, the owner-triggered form of the lapse release in `20261022021835`, for briefs that lapsed before it took effect. It raises an error and changes nothing when `20261022021835` is absent.

Both migrations were applied on 23 October 2026. `DNESKAI_OWNER_RECOVERY_ENABLED` and `DNESKAI_LAPSED_RELEASE_ENABLED` gate the respective recovery functions; if unset, the ⋯ menu's Topic recovery panel (Obnova témat) shows reslot/release as unavailable with a reason. The owner `retry` action uses the existing `marketing_dneskai_prepare_brief`.

### Applied 23 October 2026: event category by majority (SEL-10)

`20261022160000_dneskai_event_majority_category.sql` replaces `marketing_dneskai_finish` with a version that reads an optional `category` on each `p_events` entry. The collector sends the category most eligible reports of the event carry, tier-0/1 sources breaking ties (`dneskaiEventCategory`). The function uses it only when at least one eligible member of that event carries it; otherwise it keeps the lead report's category, as before. The lead report, each report's 48 h / 30 d window, the one-event-per-category rule and the briefs' validity rules are unchanged; `tool` and `ai-project` remain separate categories. Applied on 23 October 2026; this selection behavior requires no switch.

### Applied 23 October 2026: unknown collection cost scoped to its day (owner decision 17)

`20261022171000_dneskai_collection_unresolved_scope.sql` narrows one guard in `marketing_dneskai_claim_stage`. A paid stage was refused while any stage the owner ever reserved had no cost, or a cost above its reservation, so one unknown Apify cost from the October staging pilot blocked paid collection on every later night. The guard now checks only the stages of the run being claimed and of the other runs with the same Prague date. An unknown cost tonight still stops tonight's paid work on every project. No row changes: the old reservation keeps its $0.04 and its missing cost, and still counts in its own day's $0.25 total. The per-stage $0.04 and $0.003 reservations and the $0.25 daily ceiling are unchanged.

Like `20261021122330`, the file rewrites only that guard inside the current function body, raises an error if it does not find the guard exactly once, and does nothing on a second run. Local regression coverage: PGlite (`tests/lib/marketing-dneskai-unresolved-scope-database.test.ts`). Applied on 23 October 2026; the collector and database guard both scope unresolved stages to the run/day. No switch is required.

### Applied 23 October 2026: story selection v2 (owner decisions 11-13)

`20261022180000_dneskai_relevance_first_selection.sql` replaces `marketing_dneskai_finish` with the body of `20261022160000` and changes only the ranking. The day's events are picked by relevance, and at most one of them may be outside news (`ai-news`, `tech-news`): `tool`, `ai-project` and `marketing` share that one slot, so a weak ai-project item no longer pushes out a strong news story. The 0.85 floor, the 48 h / 30 d windows, grouping, coverage, the limit of four events, member selection and briefs are unchanged. Rank 1 is the most relevant event. It must apply after `20261022160000`; filename order does that.

`20261022180100_dneskai_held_requeue.sql` adds `requeued_at` to `marketing_dneskai_candidates` and the service-only `marketing_dneskai_requeue_held(p_owner, p_run, p_fence)`. Under the run's fence, while the run is running, today in Prague and before its Jev stages are planned, it opens at most 16 reports that Jev held for review (`collection-review-*`) less than 48 hours ago, with text, published within 30 days and never re-queued before, most relevant first. The release rules match `marketing_dneskai_release_candidate`. Jev then reviews them in that night's batches under the existing stage and $0.25 daily limits: at most two extra batches, $0.006. `requeued_at` is never cleared, so a report gets one second chance; a retried tick of the same run re-queues nothing.

Both migrations were applied on 23 October 2026; local coverage is in `tests/lib/marketing-dneskai-selection-v2-database.test.ts`. The selection rule itself has no switch. The collector calls `marketing_dneskai_requeue_held`, and the Topic recovery panel explains the relevance-first rule, only with server-only `DNESKAI_SELECTION_V2_ENABLED=true`. A missing function while the switch is on leaves the night as it was.

### Applied 23 October 2026: regenerate with a note (owner decision 8)

`20261022190000_dneskai_regenerate_with_note.sql` replaces `marketing_finish_job` with the body of `20261021124706` plus one step. When the finished job's request names `generation.replacesRevisionId`, and that revision is the owner's, of the same brand, still `review` or `returned` and has no claimed, published or uncertain publication, the new revision is saved through `marketing_save_revision` with it as the replaced revision: the old version becomes `superseded` and a queued publication of it is cancelled, as for an owner edit. A version the owner approved meanwhile keeps its approval; the new draft is saved beside it. Without the key the function behaves as before. Nothing here approves; the new revision is ready and in review.

Applied on 23 October 2026. The app sends `replacesRevisionId` only from the Lab's „Regenerate with a note“, which the server refuses with `regenerate-unavailable` until `DNESKAI_REGENERATE_ENABLED=true`. Local regression coverage: PGlite (`tests/lib/marketing-dneskai-regenerate-database.test.ts`).

### Applied 23 October 2026: DNESKAi topics (#150, plan A1)

`20261023100000_dneskai_topics.sql` adds `marketing_dneskai_topics`. A topic (námět) is a working title the owner approves or rejects before the pipeline pays for enrichment, pictures or generation. Each row has a kind (`news`, `education`), a source kind (`feed`, `instagram`, `library`, `manual`) with a source reference unique per owner, the Czech title, an optional summary, an optional one-word keyword in Latin letters, an optional verdict (`fact`, `hype`, `unclear`), evidence as a JSON object, a status (`proposed`, `approved`, `rejected`, `expired`, `enriching`, `briefed`, `generated`), the Prague date it was proposed for, the approval time and an optional brief. The owner reads own rows through RLS and writes nothing directly; the pipeline writes with `service_role`. The project must belong to the row's owner (the collection ownership trigger).

Three security-definer functions, executable by `authenticated` and scoped by `auth.uid()`, carry the owner's actions. `marketing_dneskai_topic_decide` approves a proposed topic, rejects a proposed or approved one, and restores a rejected or expired one to proposed. `marketing_dneskai_topic_edit` changes the title and keyword until enrichment starts. `marketing_dneskai_topic_create` adds a manual topic from an https URL, a title or both; the same URL (or, without one, the same title) cannot be added twice. None of them writes a brief, admits a job or spends money.

Applied on 23 October 2026. Scouting, titling and topic briefs propose and consume topics, each behind its own switch. The app reads the table and calls the functions only with the server-only `DNESKAI_TOPICS_ENABLED=true`; without it `GET` and `POST /api/marketing/dneskai/topics` answer 404. Local regression coverage: PGlite (`tests/lib/marketing-dneskai-topics-database.test.ts`).

### Applied 23 October 2026: topic spend ledger (#152, plan A3)

`20261023100100_dneskai_topic_spend.sql` adds `marketing_private.dneskai_topic_spend` and three service-only functions. `marketing_reserve_dneskai_topic_spend` reserves one paid topic call before it starts: a reel transcript (`transcript`) against its own ceiling (`MARKETING_DNESKAI_TRANSCRIPT_DAILY_USD`, $0.50 by default) and transcript spend of the last 24 hours, or a topic model call (`classify` for FACT or HYPE, `title` for titling) against the $1 DNESKAi generation ceiling and everything generation and topics spent in 24 hours. A refused call reserves nothing. `marketing_settle_dneskai_topic_spend` records the measured cost once. A row counts at its settled cost, or at its reservation while unsettled. The file also replaces `marketing_dneskai_generation_spent` with the body of `20261021124651` plus the topic model calls, so generation jobs and topic calls never pass the ceiling together, and Errors and costs (Chyby a náklady, in the ⋯ menu) shows the combined figure.

Applied on 23 October 2026. The app reserves here only with `DNESKAI_FACT_OR_HYPE_ENABLED=true` or `DNESKAI_TITLING_ENABLED=true`; `20261023130300` adds the `tiktok` kind. Local regression coverage: PGlite (`tests/lib/marketing-dneskai-topic-spend-database.test.ts`).

## DNESKAi sources table, 23 October 2026 (schema applied 23 October 2026)

`20261023110000_dneskai_sources_table.sql` (#174) adds `marketing_dneskai_sources`: one row per source the nightly
collection and the scouting step read, with its `source_id` (the id stages, source states and candidates carry), kind,
topic (`news` or `education`), Instagram handle or https URL, name, tier, Prague weekdays, item cap and the enabled
switch. Reads are own-only; the owner writes only through `marketing_dneskai_sources_seed` (the registry file, sent
once while the owner has no row), `marketing_dneskai_source_save` (add, or change everything except the address) and
`marketing_dneskai_source_remove`, all security definer, executable by `authenticated` and scoped by `auth.uid()`.
At most 120 sources per project. When a source was last read, how many items it brought and its last error stay in
`marketing_dneskai_source_states`.

Local regression coverage: PGlite (`tests/lib/dneskai-sources-database.test.ts`). When `DNESKAI_SOURCES_TABLE_ENABLED` is off, Zdroje shows the registry file read-only and the pipeline reads the file.

### Applied 23 October 2026: topic briefs (#155, plan A6)

`20261023100200_dneskai_topic_briefs.sql` adds `marketing_dneskai_briefs.topic_id` (unique where set) and replaces the rank check: ranks 1 to 4 stay the night's selection, and only a row with a topic may use 5 to 16. An education topic that came from a collected report gets its own brief row in that report's run, with the report as its one member, so `marketing_dneskai_prepare_brief`, `marketing_dneskai_admit_brief`, the source head, the calendar entry and `marketing_enqueue_job` apply unchanged. A news topic uses the brief row its event already has. A link-library or hand-added topic (#210) has no collected report: the app reads its URL through Jina Reader and stores it as one `owner-link` report in the latest finished run, then takes the education path. No function changes.

Applied on 23 October 2026. The app writes topic briefs only with `DNESKAI_TOPIC_BRIEFS_ENABLED=true`; without the switch nothing writes them, and the brief step ignores any row that has a topic. Local regression coverage: PGlite (`tests/lib/dneskai-topic-bridge-database.test.ts`).


### Applied 23 October 2026: daily mix (#156, plan A7)

`20261023100300_dneskai_daily_mix.sql` adds `marketing_dneskai_daily_mix`, one row per owner and project: `news_per_day` and `education_per_day` (0 to 4, default 1 each) and `slots`, the active publishing times (any of 08:00, 12:30, 17:00 and 20:00, default 08:00 and 17:00). Every post needs its own time (`news_per_day + education_per_day <= cardinality(slots)`). The owner reads, inserts and updates only their own row, and the project must be theirs. No row means the default. The four times stay one list (`DNESKAI_BRIEF_SLOTS`, and the same four in `marketing_dneskai_reslot_brief`); the mix only switches some off.

Applied on 23 October 2026. The app reads and writes the row only with `DNESKAI_DAILY_MIX_ENABLED=true`. Local regression coverage: PGlite (`tests/lib/marketing-dneskai-daily-mix-database.test.ts`).

## DNESKAi comment replies, 23 October 2026 (schema applied 23 October 2026)

`20261023120000_dneskai_comment_replies.sql` (#160) prepares the comment watcher. `marketing_instagram_comment_replies` holds one row per keyword comment that got a reply: Instagram's comment id (unique, so a comment never gets a second private reply), the media id, the publication, the matched keyword, the private reply's status (`claimed`, `sent`, `failed`, `uncertain`) and time, the public reply's status and comment id, and an error code. It stores no commenter username, user id or comment text. `marketing_instagram_comment_checks` keeps one row per watched publication: the cursor of an unfinished pass, that pass's counts, the counts of the last finished pass and the last check time. Both are own-read; only `service_role` writes, and a trigger refuses a row whose publication belongs to another owner. `marketing_accounts` gains `engagement_enabled` (off by default), `engagement_blocked_code` and `engagement_blocked_at`.

The schema was applied on 23 October 2026. Reads require `DNESKAI_ENGAGEMENT_ENABLED=true`; the scheduler, account read and switch route then query these columns. Account reply activation remains separate from the server switch.

## DNESKAi Reel bucket, 23 October 2026 (schema applied 23 October 2026)

`20261023130000_dneskai_reel_bucket.sql` creates the private `marketing-reels` bucket: MP4 only, 64 MiB per file,
with the same owner-prefix read policy and restrictive browser guards as `marketing-assets`. The render route
(`/api/marketing/dneskai/render-reel`, #163) writes one immutable object per reel key under
`<owner>/marketing/dneskai/reels/<reelKey>.mp4` with the service role and hands Instagram a seven-day signed URL.
No table, function or existing policy changes.

Local regression coverage: PGlite (`tests/lib/dneskai-reel-bucket.test.ts`). The route answers 404 until `MARKETING_DNESKAI_REELS_ENABLED=true`, and with
the switch on but the bucket missing it answers 503 `reel-bucket-required`.

## DNESKAi audio library, 23 October 2026 (schema applied 23 October 2026)

`20261023130100_dneskai_audio_tracks.sql` (#164) adds `marketing_audio_tracks` and the private `marketing-audio`
bucket (20 MiB per file; MP3, M4A/AAC, WAV and Ogg). A row holds the title, artist, source
(`meta-sound-collection`, `pixabay`, `original` or `instagram-library`), the licence note, the page the file came
from, the stored file or the Instagram audio id, the duration, up to five mood tags and the enabled switch. Checks:
a stored track has a file under `marketing-audio/<owner>/<id>.<ext>` and a source URL; an Instagram library track has
an id and no file. The owner reads only their own rows and files; every write goes through
`/api/marketing/dneskai/audio` with the service role. The browser uploads the file to a signed upload URL for one
exact path, then the route checks the stored file before it records the row.

Local regression coverage: PGlite (`tests/lib/dneskai-audio-database.test.ts`). The route requires `MARKETING_DNESKAI_REELS_ENABLED=true`; direct Zdroje → Hudba shows a disabled state when off.

## DNESKAi trending audio, 23 October 2026 (schema applied 23 October 2026)

`20261023130200_dneskai_audio_trends.sql` (#167) adds `marketing_audio_trends`: one row per owner and Instagram audio
id with title, artist, type (`music` or `original_sound`), length, an https cover thumbnail, the first and last day it
trended, the number of days, and two signals: `niche_count` (how many reels of the tracked education profiles used it) and `tiktok` (the sound also rises on TikTok CZ, set by `DNESKAI_TIKTOK_TRENDS_ENABLED`). Meta's temporary preview link is not
stored. The owner reads only their own rows; the daily tick writes them with the service role. Local regression coverage: PGlite (`tests/lib/dneskai-audio-trends-database.test.ts`). The daily step and screens require `DNESKAI_AUDIO_TRENDS_ENABLED=true`.

## TikTok sound chart spend, 23 October 2026 (schema applied 23 October 2026)

`20261023130300_dneskai_tiktok_spend.sql` (#167) adds the kind `tiktok` to `marketing_private.dneskai_topic_spend`
(20261023100100) and replaces `marketing_reserve_dneskai_topic_spend` with the same body plus that kind: a chart run is
checked against its own spend under its own lock, like a transcript, so it never takes room from generation or
transcripts. `marketing_dneskai_tiktok_runs` lists the last runs and `marketing_dneskai_tiktok_bind` writes a run's
Apify ids onto its reservation once. All three functions are service-only. It needs `20261023100100` first; filename
order does that. Local regression coverage: PGlite (`tests/lib/dneskai-tiktok-spend-database.test.ts`). Nothing reserves or
runs until `DNESKAI_TIKTOK_TRENDS_ENABLED=true` and the owner has approved the spend (NEEDED.md).


## Complete DNESKAi engagement receipts, 23 October 2026 (prepared)

`20261023135551_dneskai_engagement_receipts.sql` adds `marketing_dneskai_engagement_receipts(uuid[],timestamptz,timestamptz)`. It is STABLE, security-invoker, uses an empty search path and `auth.uid()`, and grants execution only to authenticated sessions. Existing own-only table RLS remains authoritative. It returns one JSON aggregate with up to 60 selected publication receipts, a complete failure total separate from ten display buckets, and the last seven days of eligible publications independent of the selected page. Publication-event time takes precedence over schedule time. Commenter identities and messages are never returned.

Apply this additive migration before deploying `codex/dneskai-audit-implementation`. Until then the new read path reports engagement as unavailable when the function is missing. It was created with Supabase CLI 2.122.0 and replayed against all migrations in isolated PGlite, including 5013 reply rows, off-page publications, grants and owner isolation. Production has not been changed by this implementation task. See [implementation validation](reports/dneskai-audit-implementation-2026-10-23.md).

## App-wide ownership query review, 23 October 2026 (prepared)

`20261023164118_app_wide_rls_initplans.sql` wraps session identity evaluation in scalar subqueries in 73 existing policies across 28 tables. Policy roles, commands, ownership comparisons and related-record checks remain unchanged. Local catalog comparison verifies that normalization removes the entire difference; EXPLAIN verifies an InitPlan for project reads. No table grants or indexes change.

`20261023170010_project_parent_rls_lookup.sql` moves the project parent lookup behind `project_parent_is_owned(uuid)`, a STABLE security-invoker SQL function with an empty search path. This prevents recursive write-policy expansion in local PostgreSQL 18.6 without bypassing RLS or adding a security-definer function. Production PostgreSQL 17 accepted a read-only EXPLAIN of the old update; no production data was changed by that check. The helper grants execution only to authenticated sessions. Insert/update checks still require the current owner, an owned organization, an owned parent and a different parent id on update.

The upgrade test starts before these files, compares every public policy, then verifies owned and foreign reads/writes, parent attachment, self-parent rejection, anonymous exclusion and function grants. Apply in filename order together with the engagement aggregate before merging the audit branch. See [app-wide review](reports/app-wide-audit-2026-10-23/review.md) for rollout evidence; these two files remain unapplied until that report records the push.


## Complete Daily Focus garden — prepared 23 October 2026

`20261023175801_daily_focus_garden_summary.sql` adds `daily_focus_garden(date)`, a STABLE security-invoker aggregate over the owner’s full 49-day window. It returns at most one row per day, preferring any complete seven-task generation, then the highest completion count and latest generation. It replaces the API’s truncated 350-generation history read. Existing set/item indexes support the joins; no new index or browser grant is added. Only authenticated sessions can execute it, under existing RLS. Apply it before deploying the caller; a failed summary read preserves today’s tasks and shows history as unavailable. Local migrated-database tests cover more than 350 generations, window edges, ties and foreign-owner isolation.


## Career owner day — prepared 23 October 2026

`20261023183345_career_owner_day.sql` adds the authenticated, security-invoker `current_owner_day()` helper and changes only the future-date boundary in the two existing application/progress functions. It uses the caller’s own saved timezone, defaulting to Europe/Prague and recovering invalid legacy timezone names. Atomic writes, request idempotency, history and foreign-owner rejection remain unchanged. The matching form and seven-/thirty-date statistics use the same timezone. Four migrated-database cases cover Prague before UTC midnight, a west-of-UTC preference, invalid legacy values, idempotency and ownership. Apply before deploying the form’s timezone-aware default.


## Atomic invoice documents — prepared 23 October 2026

`20261023190841_invoice_document_transaction.sql` adds `save_invoice_document`, an authenticated-only, security-invoker function with an empty search path. Invoice headers and all lines commit in one transaction. Failed replacement inserts preserve the original header and lines. Client-generated request ids make an identical retry safe; changed create retries, stale versions and incomplete source item collections are rejected without overwriting data. Edits retain the issued supplier snapshot, status and payment metadata. Existing RLS checks still enforce both owner and related organization/project ownership. Quantity zero is preserved, negative prices remain available for discounts, and excess numeric precision is rejected instead of changing previewed amounts. No tax calculation is duplicated in SQL.

Apply before deploying the RPC caller. Five migrated-database cases cover rollback after line deletion, retry identity, zero quantity, stale/incomplete edits, precision loss and ownership. To roll back, deploy the previous client first; this additive function can remain safely installed. Never restore the previous three-request edit path while relying on atomic saves.


## Atomic Knowledge documents and bounded snapshots — prepared 23 October 2026

`20261023200938_atomic_knowledge_documents.sql` adds three authenticated-only, security-invoker functions with empty search paths. `save_prompt_document` commits a prompt and its complete resource list together, keeps existing link ids, and rejects stale/incomplete source versions and changed retries. A client request id makes an identical create/edit retry safe. `add_curated_prompts` compares all owned names inside a serialized transaction, skips repeated names and preserves custom prompts. The stored `is_public` field remains own-only provenance metadata; the interface calls it Curated.

`read_owned_collection` permits only eight fixed entity names. It returns a complete ordered JSON array in one statement snapshot, with owner filtering and existing RLS, bypassing the outer REST row cap without changing project-wide API limits. Bounds: transactions 20,000; invoices 10,000; invoice items 50,000; prompts 10,000; prompt links 20,000; project links 20,000; library links 10,000; categories 1,000. Every response is also bounded to 10 MiB of encoded JSON. A bound failure raises an error rather than returning a partial collection. It replaces the audit’s earlier multi-request financial reader. No tax arithmetic moves into SQL.

Apply before deploying these callers. Tests replay the entire migration chain and cover 1,201 complete financial records, all collection roles, storage rollback, related-owner rejection, retry identity, stale/incomplete editors, repeat-safe curated imports, row limits and encoded byte limits. Read-only Production counts and row-JSON size estimates were checked on 23 October; every affected collection fits these bounds. No records were changed. Roll back application callers first; these additive functions can remain installed safely. Retain the complete-read and atomic-write guarantees when replacing them.


## Atomic library category merge — 23 October audit (prepared)

`20261023210737_library_category_merge.sql` adds `merge_library_category(uuid,uuid,text,uuid[])`, an authenticated-only security-invoker function with an empty search path. The explicit owner action locks source/target categories in id order, checks source name and the complete expected resource ids, moves owned links and removes the source in one transaction. A null target means Uncategorized. A changed source or failed deletion rolls back the whole operation. It creates no table and changes no policy; anonymous/service execution is revoked.

Apply this eighth audit migration in filename order before deploying the Links editor. Local tests use the complete 94-file migration chain and cover foreign targets, stale/incomplete/duplicate membership, failure after the move, Uncategorized and function grants. Verify the live migration history and run `select prosecdef from pg_proc where oid='public.merge_library_category(uuid,uuid,text,uuid[])'::regprocedure` (must be false). No owner library category has been merged by these tests. Rollback is code rollback followed by dropping this function; never recreate a deleted owner category from invented metadata.


## Atomic invoice payment matching — 23 October audit (prepared)

`20261023212535_atomic_payment_matching.sql` adds three security-invoker functions with empty search paths. `payment_matching_snapshot(uuid,uuid,uuid)` returns a complete owner-scoped input snapshot (10,000 invoice headers, 50,000 lines, 20,000 eligible payments, 10 MiB encoded JSON); exceeding a bound fails instead of returning a partial ledger. Tax totals remain in the shared TypeScript invoice calculator. Optional payment/invoice ids narrow the manual read.

`settle_invoice_payments(uuid,jsonb)` locks records in consistent order and atomically settles at most 100 pairs. Header timestamps, line fingerprints and relevant payment fingerprints reject a changed source. Both rows must be owned, the invoice must be issued with bank payment, and the transaction must be unlinked income. The locked payment supplies `paid_on`. An already-confirmed identical pair is idempotent. Manual linking preserves the existing explicit owner override of automatic matching criteria. `payment_matching_owners()` discovers at most 50 distinct active owners without the invoice REST limit; only service-role execution is granted. Snapshot/settlement functions additionally enforce owner identity for authenticated callers and explicit owner scoping for service callers. No policy or table is widened.

Apply this ninth audit migration before deploying either the owner action or payment cron. Local migrated-database tests cover ownership, complete reads past 1,200 rows, rollback after the payment write, stale headers/lines/amounts, canonical dates, retries, grants and over-bound failure. Server tests verify at most one snapshot, one settlement RPC and one notification insert per eligible pass. No real invoice or payment has been settled by these tests. To roll back, revert the code before dropping these three functions; never rewrite historical financial rows as a rollback.


## Complete financial rule context — prepared 24 October 2026

`20261023221856_transaction_rule_context.sql` adds `transaction_rule_context(uuid default null)`, a STABLE security-invoker function with an empty search path and explicit authenticated/service grants. It returns the owner's complete rules plus project/subscription ids in one statement snapshot. Browser callers derive their authenticated owner; service callers must supply the verified connection owner explicitly. Existing own-only RLS and related-record policies remain unchanged.

The response refuses more than 1,000 rules, 10,000 project ids, 20,000 subscription ids or 4 MiB instead of returning a prefix. CSV and sync validate the returned context and refuse malformed rules. Apply before deploying these callers. Three migrated-database cases cover both owners, 1,201 projects/subscriptions per owner, explicit service scope, anonymous exclusion, invoker grants and count/byte bounds. The read schema reproduces from 96 migrations. The migration remains unapplied remotely.


## Confirmed bank/CSV transaction imports — prepared 24 October 2026

`20261023222504_confirmed_transaction_import.sql` adds `import_transaction_batch(jsonb,uuid default null)`. It keeps the existing `transactions_user_external_uq` partial unique index and uses its non-null predicate in `ON CONFLICT`; the unqualified PostgREST conflict target fails with `42P10` against the real migrated schema. Production index metadata confirms the same predicate. No index is added or removed.

Each invoker transaction accepts at most 250 rows/1 MiB, binds the authenticated or explicit service owner, permits only the eleven ingestion fields, validates amounts/dates/currencies and related ownership, and returns only inserted UUIDs. Existing rows are never overwritten. A later insert failure rolls back the whole batch. Bank sync advances its cursor only after confirmed batches, account writes and connection completion. An ambiguous/partial pass can be replayed by external id. Apply this eleventh audit migration before deployment; apply the complete prepared audit chain listed above. Current generated read types reproduce from that complete local chain.

## Atomic bank credentials — prepared, unapplied (24 October 2026)

`20261023233432_atomic_bank_credentials.sql` adds two invoker, service-only RPCs to the existing Fio storage boundary. `store_bank_token` validates an explicit owner/provider, serializes changes for that owner in the same transaction, creates or resets one connection and stores its credential atomically. Its response is a connection UUID. Repeated saves retain that UUID; ambiguous pre-existing connections are refused without cleanup. `forget_bank_token` removes that owner's Fio connection and credential together and returns a boolean. Imported financial records and other providers remain unchanged. No function returns credential contents, and anonymous/authenticated execution is explicitly revoked. Applying the migration creates no connection or credential.

The API still authenticates the owner and checks same-origin requests; request bounds, rate limits and receipt validation precede success. Failed presence reads report unavailable rather than inventing an absent token. Six real migrated-database cases and nine route cases pass, including rollback after a storage/removal failure, repeatable identity, owner/provider isolation, invalid input, privacy and role grants. The initial test setup omitted its required fixture clock and was corrected; it is not counted as a passing run. This was prepared as the twelfth audit migration; the current unapplied rollout is listed above. Apply all prepared files in order before merging the caller.

## Invoice payment state — prepared, unapplied (24 October 2026)

`20261024001739_invoice_payment_state.sql` adds the authenticated-only, security-invoker `set_invoice_payment_state` RPC. It derives the owner from Auth, locks the owned invoice before its linked transactions, checks the captured header version and commits the paid date/status and any payment releases together. Identical retries return the confirmed state without another write. A failed update rolls back every release; more than 1,000 linked payments is refused before writes. The response contains the saved header and released transaction ids. Imported amounts, invoice fields and other owners' records stay intact.

A separate invoker trigger clears `matched_at` and `match_source` whenever an existing invoice link becomes null, including the foreign key's unlink during an explicit invoice deletion. Applying the migration changes no existing record. The UI protects pending controls, requires versioned deletion receipts, restores failed detail deletion and reconciles invoice/transaction caches.

Seven real migrated-database cases cover atomic rollback, stale refusal, complete releases, repeat confirmation, deletion metadata, the link bound and grants. Fifty targeted invoice/matching/receipt cases pass; 18 desktop/mobile invoice browser cases and a six-case EN/CS final copy recheck pass. The initial database assertion sorted a text alias rather than the numeric amount; the initial browser assertion compared the app process's fixture clock with the test worker's clock. Corrected fixtures keep the behavioral checks. Read types reproduce from all 99 migrations. This thirteenth audit migration remains unapplied and must precede deployment.


## Atomic transaction-rule application — prepared, unapplied (24 October 2026)

`20261024004341_atomic_transaction_rule_application.sql` extends the complete rule context with a canonical rule version, adds the authenticated-only `transaction_rule_snapshot` and `apply_transaction_rule_plan` RPCs, and serializes direct rule writes with a per-owner transaction advisory lock. All functions use invoker rights and an empty search path; the trigger function has no direct browser/service execution grant. Existing records, rules, amounts and payment state are unchanged by the migration.

One consistent read returns at most 20,000 transactions and the complete context within 10 MiB. Apply accepts at most 20,000 metadata changes/4 MiB, locks owned parents and ledger rows in deterministic order, and checks the captured rule and row versions. Missing/stale targets, changed parents, suppressed writes or altered receipts roll back the whole plan. Only category, note, project and subscription metadata may change. The API also bounds request bytes, evaluation work and request duration; it returns no shortened count or partial success. The editor captures the rule version before confirmation and refreshes after conflicts.

Sixty targeted cases, including eleven real migrated-database cases, and sixteen EN/CS desktop/mobile rule-editor/CSV browser cases pass. Coverage includes a complete 1,201-row ledger, rollback, stale rule insert/update/delete, stale manual edits, ownership/grants, bounds, confirmed identities and conflict recovery. TypeScript and targeted ESLint pass. Read types reproduce from all 100 migrations. Apply all fourteen prepared audit files in order before deploying the callers.

The implementation follows the current [Supabase database-function security model](https://supabase.com/docs/guides/database/functions) and [PostgreSQL transaction advisory-lock behavior](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS); it does not hold a database lock across HTTP requests.


## Account-scoped bank imports — prepared, unapplied (24 October 2026)

`20261024010610_account_scoped_bank_imports.sql` adds service-only `import_bank_transaction_batch` and a shared invoker validator, and replaces the generic import function without changing its signature/grants. Bank imports store new identities as `bank:v2:<local-account-uuid>:<SHA-256 of provider id>`. The provider id is opaque; the internal `bank:v2:` source prefix is reserved and refused at the bank boundary. Existing same-account legacy rows are recognized without rewriting them or their owner edits. The generic function also recognizes scoped identities, so a previous-deployment bank writer does not insert a second legacy row after the new writer finishes. CSV identity generation is unchanged.

A per-owner transaction lock serializes imports, with owned parent locks before deterministically ordered source-row locks. Validation checks distinct parent sets in three ownership queries per validation instead of three lookups per row. All input dates are cast before legacy filtering. Every intended identity must exist in its source account; newly inserted source fields must match the submitted values. Missing/suppressed/altered writes, conflicting duplicate input or an account reassignment roll back the batch. Existing financial fields are never overwritten. There is no migration-time data write, key rewrite, new table or new index.

Thirty-seven targeted cases across four files pass, including eleven bank database cases on the full 101-migration chain. They cover reused provider ids across two accounts, legacy rows beyond 1,200 records, rolling-deployment replay, preserved owner edits, field validation, rollback, runtime receipts and role grants. Four EN/CS desktop/mobile CSV recovery browser cases, TypeScript and targeted ESLint pass. Nine read tables regenerate from 101 migrations. All fifteen prepared audit files remain unapplied and must precede the main merge. The canonical digest uses PostgreSQL’s built-in [SHA-256 binary-string function](https://www.postgresql.org/docs/17/functions-binarystring.html).


## OAuth refresh reservations — prepared, unapplied (24 October 2026)

`20261024022229_oauth_refresh_leases.sql` adds the private `oauth_refresh_leases` table and invoker, service-only `claim_oauth_refresh` / `complete_oauth_refresh` functions. Existing credential values stay unchanged on apply. Browser roles have no table or function access. The owner/provider primary key bounds lookup work; each verified owner is explicit.

A claim locks the credential briefly and reserves refresh for 60 seconds across transactions, rather than assuming a transaction lock survives a provider HTTP call. A concurrent claimant reports unavailable; it does not start another rotation. Completion checks the lease, its expiry and the full source-row version before atomically storing the confirmed token result and consuming the reservation. A newer login, disconnect, expired/replaced claim or failed/altered write cannot be overwritten by a late response. A confirmed provider-specific invalid-grant result removes only the reserved source grant. Transient/configuration errors retain it. Ambiguous provider failure retains the reservation until expiry; a crash after upstream rotation may still require reauthorization.

Routes share one owner/request token promise and one forced-refresh promise across their upstream fan-out. The provider fetcher enforces the fixed API origin and a 25-second asynchronous processing budget, with 12 seconds per actual HTTP request; caller cancellation is honored. Same-origin repository-rename reads are bounded to three redirects; writes use the canonical read path and are never replayed on a redirect. No credential is cached across requests. Provider TTL is retained, with one early-refresh skew; the Supabase session lifetime is never treated as a provider TTL.

Apply this sixteenth audit migration before deploying its callers. The local generated read schema reproduces from all 102 migrations. Tests use invented grants and isolated PostgreSQL only; this work has not read, refreshed or revoked any real grant. See the [GitHub refresh contract](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens) and [Google refresh flow](https://developers.google.com/identity/protocols/oauth2/web-server#offline).


## OAuth removal receipts — prepared, unapplied (24 October 2026)

`20261024024945_oauth_revocation_receipts.sql` adds the invoker, service-only `claim_oauth_revocation` / `complete_oauth_revocation` functions. They reuse the private reservation table and versioned completion from migration 102. A fresh or nonexpiring grant is reserved explicitly for removal; an active refresh/removal is refused. Completion cannot delete a newer login, use an expired/replaced reservation or silently accept a suppressed deletion. Applying the migration removes no existing grant.

The provider request and local removal have separate outcomes. A confirmed local delete can report `upstreamRevoked: false` after unavailable app credentials, a timeout or an upstream rejection. A failed local receipt is never a successful disconnect. Upstream revocation is not transactional with a concurrent provider login; an uncertain result needs reauthorization/status review rather than a claim that the provider preserved a newer grant. No credential is placed in a PostgREST filter URL. Six real database cases cover provider/owner boundaries, fresh/nonexpiring grants, refresh contention, newer login protection, timeout/replacement, suppressed deletion rollback and role grants.

Apply this seventeenth audit migration before its callers; the generated read schema reproduces from all 103 local migrations. Tests use invented credentials and isolated databases. No real account was disconnected or signed out.


## Repository record receipts — prepared, unapplied (24 October 2026)

`20261024034239_repository_record_receipts.sql` extends the existing complete owner-collection RPC to repository notes/links and tasks. The bounds are 10,000 repository notes/links, 20,000 tasks and 10 MiB per response. Server seeding and destination fetchers use the same contract. A publication reads a fresh complete note snapshot after saving drafts; a failed or capped read cannot become an empty successful publication.

`save_repository_note` checks the canonical captured record, locks its owned source briefly, saves only its body and confirms the retained fields. Identical retries avoid another write. `consume_repository_records` accepts at most 250 captured records/1 MiB per transaction and returns a complete partition of deleted/retained ids. Only unchanged owned versions qualify; task consumption additionally requires a finished GitHub task. Changed, reopened and newly inserted records stay. A suppressed deletion or altered saved row rolls back its transaction. Both functions use invoker rights, an empty search path and authenticated-only grants; no lock spans the GitHub request. Applying this migration writes no existing record.

The client splits larger consumption requests into bounded transactions, validates every partition receipt and reconciles after ambiguous failures. It does not claim a transaction across the upstream commit and local removal, or across several batches. Note creation retains one UUID across ambiguous retries; ordered autosaves keep unconfirmed text in memory, preserve failed drafts and guard navigation. They send captured records in request bodies, without private text in REST filter URLs.

Seventy-four targeted cases across ten files pass, including seven real migrated-database cases, version/receipt failure and draft-ordering checks. Four EN/CS desktop/mobile browser cases pass with keyboard recovery, a changed record during publication, six-width reflow and axe. TypeScript, targeted ESLint and read-schema generation from 104 migrations pass. Earlier builder-order/type errors were corrected; they are not passing evidence. All prepared audit files listed above remain unapplied and must precede the main merge. No real repository publication or owner record mutation ran during these checks.


## Atomic repository-task synchronization — prepared, unapplied (24 October 2026)

`20261024041457_repository_task_sync.sql` adds nullable `todos.needed_assignee` for owner metadata found on continuation lines and the authenticated-only, invoker `sync_repository_tasks` function. Existing rows retain the source-line fallback; applying this migration rewrites or deletes no existing task.

Both import controls use one transaction and an owner advisory lock. Requests accept up to 5,000 fresh rows, 20,000 captured stale candidates, 500 successfully scanned repository ids and 8 MiB combined JSON. Incoming fields, dates, owner and source are checked before changes. The function skips existing source identities and recognizes legacy imports by title when they lack a raw line. Refresh captures the complete task snapshot before repository reads; only unchanged, open, nonglobal GitHub tasks from scanned repositories can be removed. Edited/completed tasks, legacy sources and still-present lines remain. A suppressed removal, failed insert or altered receipt rolls back the transaction. The result includes inserted records and a complete deleted/retained partition; more than 20,000 resulting tasks or 10 MiB of response is refused.

Clients confirm inserted source fields and partition identities, retain failed action lists, report unreadable repositories and refresh the shared task/focus caches. Only the two new import paths share this reservation; reload older browser tabs after deployment. Fenced examples and explanatory bullets in a checkbox-based list are excluded from imports and check-off targets.

Seventy-four focused cases across six files pass, including nine real database cases against all 105 migrations. Eight EN/CS desktop/mobile repository cases pass with unavailable-source retry, malformed import receipts, conflict recovery, retained notes, keyboard use, six-width reflow and axe. TypeScript, targeted ESLint and read-schema generation pass. Initial component mount timing and hardcoded retry-label assumptions were corrected; interrupted/outdated browser runs are excluded. The prepared audit chain listed above remains unapplied and must precede the main merge. The shared bounded scan now addresses repository-read fan-out and cancellation separately; see findings 94–95 in the app-wide review. Finished-task removal loops remain a separate follow-up.

## Complete project collection snapshots (24 October 2026)

`20261024095216_complete_project_collections.sql` extends the existing `read_owned_collection` whitelist to `projects`, `project_costs` and `crons`. The authenticated catch-all and lazy client fetchers use the same complete statement snapshot. Each collection has a 20,000-row and 10 MiB JSON bound; an oversized read fails rather than silently omitting records. Existing collection cases, owner predicates, invoker RLS, empty search path and authenticated-only execution grants remain intact. No stored row changes.

The shared client reader disables automatic SDK retries, applies a 30-second deadline and accepts caller cancellation. Failed reads cannot replace confirmed records with an empty cache. The migration is prepared and unapplied; the complete prepared audit chain listed above must precede the implementation merge. Rollback restores the previous function from migration 105; roll back the new callers first.

Validation: 38 targeted cases across five files pass, including the real previous-reader upgrade, 1,201 rows per owner in each new collection, deterministic order, grants/ownership and row/byte refusal. TypeScript, targeted ESLint and schema generation from all 106 files pass. The complete unit suite passes 3,954 cases with one intentional skip. These local checks perform no production mutation.

## Atomic project ordering (24 October 2026)

`20261024101934_atomic_project_order.sql` adds `reorder_owned_projects(jsonb)`. One authenticated invoker transaction validates a complete owned active top-level engagement group, locks its rows in UUID order, checks captured versions and membership, and updates only changed positions. The receipt names only changed ids, owners, positions and new timestamps. Project text and other metadata are never included in the request or overwritten. A stale source, RLS-suppressed update or altered receipt rolls back the whole order.

The input bound is 20,000 rows/8 MiB, lock waits are limited to five seconds, and the client uses a 15-second deadline without automatic retries. After an ambiguous result, reload the canonical collection before trying again. The UI applies confirmed order/version fields only to still-matching cached rows and reconciles both success and failure. Own/client groups reorder independently; children remain with their parent. The function adds no index or stored-row rewrite. It has an empty search path and authenticated-only execution grants. Apply the complete prepared audit chain listed above in filename order before deploying the caller.

Sixteen focused client/database cases pass; the expanded project/navigation run passes 59 cases across seven files. Checks include ownership/role grants, missing owner claims, changed/incomplete groups, child/inactive/cross-group disguises, duplicate/malformed/overbound inputs, suppressed/altered writes, unrelated metadata retention and complete receipt validation. TypeScript, targeted ESLint and read-schema generation from 107 migrations pass. These are local migrated-database checks; the new file remains prepared/unapplied. Roll back the UI caller before removing the function.


## Daily Focus repository identity (audit migration 22)

`20261024113157_daily_focus_repository_identity.sql` replaces `create_daily_focus_set(boolean)` without changing tables, policies or existing generations. An explicit project binding wins, followed by a known repository ID across all owned projects, then a normalized legacy name only when at least one repository ID is unknown. Conflicting known IDs never fall back to names. Name ties follow stored project order, creation time and ID. Inactive bindings stay excluded unless the task is global. Client task groups use the same priority and canonical order after cache-only reorders. Inferred associations are not written into tasks.

The function retains owner-day selection, advisory locking, current-set reuse, global priority, seven-item limits, history snapshots, invoker RLS, an empty search path and authenticated-only grants. Applying the replacement does not regenerate a set; only a new day or an explicit regeneration uses its new matching. Six isolated upgrade/database cases pass, including unchanged history and source bindings, another owner, inactive/conflicting names, missing claims and role grants. The initial test omitted its owner claim and was corrected; that failed setup is excluded. All prepared audit files listed above remain unapplied. Reverting the function from migration 27 (`20260925090000_project_repository_identity.sql`) restores its former matching without rewriting stored generations; revert the client matching change with it.


## Confirmed project notes (audit migration 23)

`20261024120023_confirmed_project_notes.sql` adds `save_project_notes(uuid,text,text)` under invoker RLS with an empty search path, five-second lock waits and authenticated-only grants. It compares the captured note's SHA-256 fingerprint while allowing unrelated project metadata to change. A changed note returns an explicit conflict without writing. A matching desired note is a no-op retry. A normal save changes only notes and advances the timestamp by at least one millisecond beyond its locked source; suppressed or altered updates roll back. Existing rows are not rewritten by the migration. It uses PostgreSQL 17's [built-in binary hashing functions](https://www.postgresql.org/docs/17/functions-binarystring.html), with no extension or external service.

New UTF-8 text is bounded to 1 MiB. A source note as large as the existing 10 MiB collection bound can be shortened without resending it: the request includes only its 64-character fingerprint and the new note. The acknowledgement contains only identity, fingerprints and timestamps, stays under 500 bytes in the database checks and never echoes either document or project metadata. The client validates outcome/owner/hash/version relationships, uses a fifteen-second deadline without SDK retries and refuses to stamp a late receipt onto a changed cached project. It requests reconciliation only when the source version is unavailable in the cache. The operations editor uses this contract, protects immediate edits and pending writes, retains failed drafts and requires explicit replacement or reload after a conflict. A saved-note reload suppresses an older debounce and cannot discard edits made while waiting. Drafts remain in memory and never enter browser storage. If a refreshed collection no longer contains the managed project, its current editor stays mounted and read-only with an unavailable message. Pending/new note writes stop, and an unsaved exit still requires an explicit discard; keyboard selection keeps the text available to copy. The complete audit chain listed above remains prepared/unapplied.


Fifty focused client/database cases across four files, TypeScript, targeted ESLint and read-schema generation from 109 migrations pass. Initial RLS-error wording and native/fake-timer test assumptions were corrected; failed attempts are excluded. These checks use invented notes and isolated databases. No owner data was written. Roll back the editor caller before dropping `save_project_notes(uuid,text,text)`; no existing notes need a data rollback.


## Migration 110 — confirmed project classification controls

`20261024130626_confirmed_project_preferences.sql` adds `set_project_preferences(uuid,timestamptz,jsonb)` for the active and own/client controls. It accepts only the requested boolean/engagement fields (128-byte JSON bound), locks the owned project, compares its captured version and returns a conflict without writing when it changed. An already matching desired value is a no-op retry. A successful edit advances its timestamp and verifies that all unrequested fields, including notes and the other classification, stayed unchanged. No existing rows are rewritten by applying the migration.

The function uses invoker RLS, an empty search path, five-second lock waits and authenticated-only grants, following [Supabase's database function guidance](https://supabase.com/docs/guides/database/functions). Requests have a fifteen-second deadline and no automatic SDK retry. Receipts contain only identities, requested values, previous values and versions, under 500 bytes in the database checks. Client version comparisons retain PostgreSQL microseconds; different timezone formatting does not create a false version change.

Settings and Projects wait for confirmation, block repeat changes for that project and protect navigation while pending. The cache applies only confirmed fields to the exact source version; newer notes, other edits and removed projects remain intact. Conflicts and ambiguous results trigger a canonical read and a localized review message, without a false success or whole-record rollback. Apply the complete prepared audit chain listed above before deploying this caller. To roll back, revert the controls before dropping `set_project_preferences(uuid,timestamptz,jsonb)`; saved classification values do not need data rollback.


## Migration 111 — captured-source project detail saves

`20261024134706_confirmed_project_details.sql` adds `save_project_details(uuid,timestamptz,jsonb)` for eight explicit manual fields: name, slug, repository name/id, production/development URLs, own/client classification and organization. It checks input shape/length, HTTP(S)/credential/control rules and related organization ownership, then locks the owned row. A changed source version returns a narrow conflict without a write; already matching values are a no-op retry. Normal saves advance the version and verify all retained fields. Notes, ordering, active state, parent/registry binding and financial context stay unchanged. Applying the migration rewrites no stored rows.

Slug renames retain the old handle once. A rename with the same known repository id retains its earlier names; an unrelated or unverified relink clears repository aliases so old names cannot silently adopt another repository's tasks. Case-only changes do not add an alias. Source/retained histories are bounded to 500 values per array. New name/slug limits are 200/100 characters, repository names 201, URLs 2,000 and input JSON 16 KiB. Receipts contain only identity, versions, requested values and retained aliases, never note text; the total receipt bound is 1 MiB. Ordinary test receipts stay under 1,000 bytes even when a source note is 2 MiB.

The client verifies complete owner/value/history/version acknowledgements, retains microsecond precision, disables SDK retries and uses a fifteen-second deadline. Cache application requires the captured complete snapshot, preserves later notes/optimistic fields and never resurrects a missing row. Shared snapshot comparisons avoid serializing private note documents. A late receipt already represented by a newer complete cached version needs no additional read.

Seventy-nine focused cases across six files pass, including thirteen real database cases and fourteen client/history/version cases, plus the existing notes/classification recovery tests. TypeScript, targeted ESLint and offline generation from all 111 migrations pass. The function uses invoker RLS, an empty search path, five-second lock waits and authenticated-only grants. The manual edit form now uses this contract with guarded in-memory drafts, verified repository identities, conflict reload and abort/lifecycle protection. Creation and automatic synchronization remain separate work; deletion now has its own captured-version receipt checks (app-wide finding 136), and the edit contract does not make their legacy writes safe. Apply the complete prepared audit chain listed above before deploying the completed caller. Roll back its callers before dropping `save_project_details(uuid,timestamptz,jsonb)`; notes and existing history need no data rollback.


## Migration 112 — confirmed DNESKAi daily volume

`20261024170208_confirmed_dneskai_daily_mix.sql` adds `save_dneskai_daily_mix(uuid,timestamptz,jsonb)`. It uses invoker RLS, an empty search path, a five-second lock timeout and authenticated-only execution. It locks the owned project before reading or creating its mix, checks the captured exact timestamp and returns the persisted owner/project, source version and resulting settings. Identical retries are no-ops; a changed version returns a conflict without overwriting it. Input is at most 2 KiB, with exactly the three mix fields, distinct known times and capacity for every post. A suppressed or altered write rolls back rather than returning success. No row is rewritten when applying the migration.

The enabled reader distinguishes a confirmed absent row (the default) from an error or malformed row (unavailable). Scheduler news-topic and topic-brief steps therefore stop on unreadable settings instead of restoring posts the owner disabled. The owner GET returns 503 in that case. PUT uses the captured version and returns the validated database receipt, never a copy of submitted values as proof of storage. The browser bounds requests and responses, retains drafts across refresh/failure/disablement, guards pending exits and offers an explicit discard/reload for a changed version. The fake-backend `projectRecords=live` preview exercises source-list and daily-mix settings; other marketing actions retain their preview protection.

Eight isolated database cases, client/route/mounted recovery checks and the local full migration-chain generation verify this contract. Exact counts and rendered evidence are in app-wide finding 145. Apply the complete prepared audit chain listed above before deploying these callers. Roll back the callers before dropping `save_dneskai_daily_mix(uuid,timestamptz,jsonb)`; existing settings need no rollback.


Source catalog caller update (24 October 2026, app-wide finding 146): no additional migration is needed. With `DNESKAI_SOURCES_TABLE_ENABLED=true`, unavailable/malformed/incomplete reads fail instead of falling back to the registry. A successful empty catalog remains empty and cannot start a collection. The source-list GET no longer calls the existing seed function; removing all sources therefore survives later visits. Registry lookup cannot re-enable a removed/disabled source in an admitted run. History reads are restricted to current source IDs and verified with exact filtered counts. The older explicit seed function remains available as a separate owner operation; it is not an automatic page-read step. Existing rows and historical source states are unchanged.


## Migration 113 — captured source-setting receipts

`20261024174247_confirmed_dneskai_sources.sql` adds `change_dneskai_source(uuid,text,jsonb,jsonb)` for owner source settings. It accepts an exact nine-field captured source (or null for a new one) and the desired source for save. The function checks actor/project ownership, a 120-source cap, input size/shape, known kinds/topics, distinct weekdays and bounded names/addresses. Source kind/address stay immutable. A changed source returns a conflict without a write; matching values and an already-absent removal are no-op receipts. Input source objects are at most 8 KiB. Receipts contain owner/project/source identity and only source settings, with no history or unrelated records.

The RPC uses SECURITY DEFINER because authenticated deliberately has SELECT only on this table. It has an empty search path, a five-second lock timeout, explicit owner predicates on every lookup/write, and authenticated-only execution after revoking default grants. The private row encoder is invoker code with no application-role execution. Existing save/remove/explicit-seed functions remain compatible and take the same owned project lock before any source-row lock. This serializes source creation and its limit checks across both caller generations; it does not change which source rows currently exist.

Eight isolated database cases cover persisted receipts, no-op retries, stale saves/creates/removals, absent targets, immutable identity, foreign/missing owners, privileges, invalid input, suppressed/altered writes and the 120-source cap across legacy/new callers. Existing migrated collection/scouting tests also run through the compatible wrappers. The source-list POST and browser client now use the captured receipt contract with request/body bounds and refusal validation (app-wide finding 151). The editor now retains drafts through failed/disabled reads, guards repeated writes and pending exits, cancels late callbacks and explicitly reloads changed settings (app-wide finding 152). Full release and the migration rollout remain pending. Apply the complete prepared audit chain listed above before deploying the finished callers. To roll back, revert those callers first, then restore the three wrapper definitions from `20261023110000_dneskai_sources_table.sql` before removing the new function and its private encoder. No source data needs rollback.


## Migration 114 — complete weekly focus snapshot

`20261024220621_weekly_focus_snapshot.sql` adds the read-only `weekly_focus_snapshot(date)` function under invoker RLS, an empty search path and authenticated-only execution. It binds the current owner and a finite Monday, selects the latest generation for each of seven days before reading items, and returns at most seven sets / 49 ordered tasks. Empty latest sets remain real sets. Foreign owners and both week edges stay excluded. The existing owner/date/generation index supports selection; no new index, table or stored-row rewrite is needed.

Selected legacy text over 16,000 UTF-8 bytes is refused before JSON aggregation, and the complete result is capped at 512 KiB. The client additionally validates text lengths, owner/week/set/item identity, unique item ids, date and position order. Its single RPC uses a fifteen-second caller-cancellable budget with automatic retries disabled. Missing history stays unavailable, cached failures are marked stale, and explicit retry retains the review draft. Carry-forward navigation and completion require a confirmed history read; saving a draft stays available. Home's best-completed-generation garden is unchanged.

Ninety-one targeted library/component/database cases pass, including seven isolated migrated-database cases and actual SDK cancellation/failure checks. Four EN/CS desktop/mobile browser cases pass after the card-width regression, covering six widths, failure/retry, long unbroken content, complete card/content bounds, axe and no writes. TypeScript, targeted lint and offline read-type generation from all 114 files pass. Exact evidence and excluded diagnostics are in app-wide finding 166. Apply the prepared chain above before deploying the reader. Roll back its caller before dropping `weekly_focus_snapshot(date)`; no stored data needs rollback. Weekly editor save receipts and draft identity remain separate unfinished work.


## Migration 115 — captured weekly review saves

`20261024223552_confirmed_weekly_review.sql` adds `save_weekly_review(uuid,uuid,date,timestamptz,text,jsonb)` with invoker RLS, an empty search path, five-second lock waits and authenticated-only execution. It binds the expected owner, stable record id, Monday and exact source timestamp. An owner/week advisory lock protects absent-row creation before the row lock. A different source returns a nonwriting conflict; an already stored identical patch is a no-op retry. Automatic navigation preserves completion; only explicit Save Draft reopens it. Normal writes advance the version and verify the full persisted row. Suppressed/altered acknowledgements or an oversized response roll back.

Only known edited summary/item fields are accepted. Untouched legacy lists and unknown stored item keys remain intact. New input is capped at 256 KiB; the complete receipt at 512 KiB. Summary is at most 20,000 characters; objectives and each legacy list allow 100 entries of at most 2,000 characters. Objective ids are unique. Calendar input is limited to finite aggregate minutes and counts; focus counts stay within seven days / 49 tasks. No event body is accepted or stored. Applying the function rewrites no existing row and adds no table or index.

Forty-one client/database cases pass, including twelve isolated full-chain database checks, actual SDK one-request/no-retry/cancellation checks, precise version conflicts, retained legacy fields, ambiguous retries, completion modes, permissions, invalid and oversized input/results, suppressed/altered writes and guarded cache application. TypeScript, targeted ESLint and offline schema generation from 115 migrations pass. Initial direct test queries lost PostgreSQL microseconds in JavaScript dates; the final fixture uses PostgreSQL JSON serialization. A nested JSON subtraction needed explicit parentheses; valid fractional aggregate persistence now has its own regression. These diagnostics are excluded from passing evidence. The guarded editor now uses the contract, with captured in-memory drafts, confirmed step advancement, pending exit protection, explicit conflict reload and owner/week rollover refusal; see app-wide findings 167–168. Apply the prepared chain before deploying that completed caller. Roll back callers before dropping this function; no stored review data needs rollback.


Weekly caller verification (finding 168): 142 targeted cases across nine files pass, including twelve mounted save/lifecycle cases and four exact owner/week reload cases added to the SDK suite. Twelve EN/CS desktop/mobile browser cases pass with held/refused saves, guarded sidebar exits, selectable conflict text, explicit reload, six-width card bounds, axe and no direct table writes. A confirmed save applies only to its captured source, avoiding a second collection request when that cache application succeeds. Failed writes reconcile the exact parent review query without refetching focus history. An account/week change requires explicit discard and a full server reload to refresh the matching Calendar window. No live owner record or provider was used in these checks. Full release and production migration rollout remain pending.

## Migration 116 — confirmed task writes

`20261025000844_confirmed_task_writes.sql` adds `todos.updated_at` with a stable `now()` fast default and a monotonic microsecond update trigger. Existing text, repository context, GLOBAL priority and parent ownership stay intact. PostgreSQL's [non-volatile default behavior](https://www.postgresql.org/docs/17/sql-altertable.html) avoids a volatile-default heap rewrite; the isolated upgrade checks the catalog's missing-value marker and unchanged legacy fields. DDL and operation lock waits are bounded to five seconds.

`write_task(uuid,uuid,text,jsonb,jsonb)` is authenticated-only, security-invoker, with an empty search path. It binds the actor/owner, stable task id, action, complete captured row and version. Manual creates share the repository import's owner lock and respect the 20,000-task collection limit. New metadata is validated before writes, including explicit GLOBAL importance 6/no project and related-record ownership. A toggle changes only `done` and the version. A stale source returns a nonwriting conflict; an already committed matching toggle is acknowledged without another update. A changed-and-restored source version cannot replay a stale toggle. Confirmed absence is separate from confirmed deletion. Suppressed/altered writes and post-trigger changes roll back.

The new `dashboard_private.task_create_receipts` table stores only owner id, task id, canonical request hash and original creation time. Own-only RLS allows session select/insert, with no session update/delete or anonymous/service function access. The schema is not added to Data API exposure. Metadata remains after task deletion, preventing a lost-response retry from recreating a removed task; account deletion cascades it. A changed create payload cannot reuse an old receipt. The metadata insert and task insert are confirmed in the same transaction. Input values are capped at 8 KiB and captured source/response at 512 KiB. No existing task is deleted by applying this migration.

Sixty-seven contract/database/repository cases pass across four files, including 22 isolated real-database cases for the new contract, an upgrade, preserved metadata, private permissions, rollback, ABA conflicts, deleted-create retries, actual client validation of database receipts and the collection ceiling. The client has one fifteen-second caller-cancellable RPC, automatic retry disabled, an exact owner/id recovery reader and captured-row-only cache application. Targeted lint, TypeScript and offline read-type generation from all 116 migrations pass. The first database fixture omitted a required project slug; it was corrected before these passing checks. The Tasks UI now uses the captured creation, completion/deletion and repository lifecycle contracts; the later integration and native evidence is recorded in app-wide findings 176–185. Apply the prepared chain before deploying its caller. Roll back callers before removing the function; retain the version and private retry metadata while older requests can still arrive.


## Migration 117 — public DNESKAi slide policy

`20261025032227_dneskai_public_slide_policy.sql` adds a private, immutable, security-invoker JSON checker. It admits headline text only on the first slide, rejects sources slides and public picture credits, and checks other text against the slide type's placed fields. Its whitespace set matches JavaScript trim. It reads no table and exposes no new owner data. Execution is revoked from public/anonymous/authenticated roles and granted to the existing service role.

The existing owner-only approval function keeps its captured campaign, row lock, expected hash, source, verified-account and scheduling checks, and refuses a blocked deck before either first or repeated approval. The existing service-only due-claim function filters blocked legacy approvals before its limit and lock, so they cannot starve valid due posts. Ambiguous leases and reconciliation behavior stay unchanged. No existing revision, approval, publication, source or media object is rewritten or deleted. A legacy queued approval can be explicitly returned, cleaned in the editor, saved as a new revision and reviewed again.

Twelve isolated database cases include four legacy policy failures without row changes, valid/blocked due claims, matching Unicode whitespace, private permissions and the existing media identity/renewal rules. The app and final release checks remain in progress. Apply the complete prepared chain before deploying these callers; keep both old records and their provenance.


## Migration 118 — complete DNESKAi cost and tick aggregates

`20261025040638_complete_dneskai_cost_reads.sql` adds `marketing_dneskai_cost_totals(uuid,integer,timestamptz)`, a STABLE security-invoker function with an empty search path and authenticated-only execution. It derives the owner from the session, requires an owned project and bounds input to one through seven Prague days and a finite clock. Existing RLS stays authoritative. Its daily sums cover the full eligible range; running collection placeholders and malformed/missing costs remain unknown, and queued jobs do not count as billed usage. Measured and booked figures stay separate. The complete 24-hour tick counts are independent of the twenty meaningful diagnostic rows returned. No row, setting, admission limit or publication changes.

A partial owner/date/id index supports the actual DNESKAi job predicate. Local authenticated-RLS EXPLAIN selects it for 120 current jobs among 10,120 synthetic rows without disabling sequential scans. The caller replaces the capped tick query with this compact aggregate and reads only thirty failed/uncertain job details. It verifies owner, project, range, clock, daily sequence, diagnostic completeness and count consistency; an unavailable or mismatched response fails rather than becoming zero. The read requests share cancellation and a fifteen-second deadline with SDK retries disabled. Authentication errors refuse a cached user. The service-only budget ledger read remains a separate route operation.

Real migration/SDK/emulator cases verify beyond-cap totals, meaningful older ticks, the twenty-row detail bound, numeric unknowns, queued exclusion, Prague midnight/DST, foreign ownership, finite windows, grants and cancellation before work. The existing migrated dry-day integration also passes. Exact counts and the raw query plan are in app-wide finding 199. This follows [Supabase's invoker/function privilege guidance](https://supabase.com/docs/guides/database/functions); [REST row limits](https://supabase.com/docs/reference/javascript/select) must not determine aggregate truth. Apply the full prepared chain before deploying the caller. To roll back, revert the caller first, then drop this function and `marketing_jobs_dneskai_recent`; no owner-data rollback is needed.


## Migration 119 — complete organization reads and real row versions

`20261025091027_complete_organization_records.sql` validates finite organization update versions and adds a server-maintained monotonic BEFORE UPDATE trigger. Every permitted writer advances the prior version by at least one PostgreSQL microsecond, including same-clock writes and future stored versions; a client cannot forge an earlier version. Existing records are not rewritten. The constraint refuses an existing nonfinite version instead of inventing a repair. A 25 October read-only production preflight finds no nonfinite organization versions; no data or configuration changes.

The existing authenticated-only SECURITY INVOKER `read_owned_collection` whitelist gains organizations, ordered by name/id, with a 10,000-row and existing 10MiB complete-response limit. All previous collection contracts, own-only RLS and table grants remain. The trigger function has an empty search path and direct execution revoked from public/anon/authenticated/service roles; normal permitted row updates still invoke it. The migration uses a five-second DDL lock limit and restores it afterward. No provider or service-role authority is introduced.

Local tests cover unchanged-data upgrade, nonfinite-upgrade rollback, ordinary and same-clock writes, future versions, stale predicates, cross-owner refusal, more than the REST cap, row/byte refusal and function grants. Current server/shell callers adopt complete reads through migration 120’s captured-owner overload, and client controls confirm captured creation/update/delete receipts (app-wide findings 217–220). The production rollout remains pending; applying this schema alone does not deploy those callers. Generate the DNESKAi read port from the complete current local chain with `scripts/generate-dneskai-read-types.mjs`; do not edit its fingerprint manually. Apply the complete prepared chain in canonical order before the implementation branch is deployed. For rollback, revert dependent callers first, remove this trigger/constraint/function and restore the previous collection whitelist; no owner-data rollback is needed.


## Migration 120 — captured collection ownership, including empty results

`20261025094511_captured_collection_owner.sql` adds an authenticated-only SECURITY INVOKER overload `read_owned_collection(text,uuid)` with an empty search path. It compares the explicitly captured owner against the current authenticated session before calling the existing complete snapshot. A null/mismatched owner fails even when the other account has no rows. It changes no table, row, policy, collection whitelist or one-argument caller. Shared callers that supply an owner now send it to this overload; the organization readers also validate their complete record shape. Direct public/anonymous/service execution is revoked. Apply it after migration 119 and before these callers; rollback dependent callers before dropping this overload. No external service or production write is part of local verification.


## Migration 121 — complete competitor reads and maintained row versions

`20261025114445_complete_competitor_records.sql` validates finite competitor versions, maintains updated_at with a monotonic invoker BEFORE UPDATE trigger and adds competitors to the complete collection whitelist. Same-clock/future versions advance by a PostgreSQL microsecond and ignore forged earlier client timestamps. Existing research, related projects, own-only policies and grants stay unchanged. A nonfinite legacy version refuses and rolls back the migration instead of inventing a repair. A read-only production preflight finds no nonfinite competitor versions.

The complete snapshot orders by sort_order/created_at/id and refuses more than 10,000 rows or 10MiB returned JSON. Migration 120's captured-owner overload continues to guard it, including empty mismatched results. All earlier collection contracts remain. The new trigger has an empty search path and no direct public/anonymous/authenticated/service execution grant; normal permitted row writes still invoke it. Five-second DDL lock waits reset afterward. No index, data rewrite or provider authority is added.

Local upgrade, rollback, stale-write, same-clock/future, complete-read, row/byte, RLS/related-project and privilege checks cover this foundation. Finding 226 adopts the complete captured-owner reader in the route loader and owner-scoped shell cache, with strict 21-field validation, a 15-second deadline and explicit recovery. Findings 227–228 adopt strict returned receipts and captured-version editor/deletion controls on both browser surfaces. Targeted SDK/RLS, mounted and native checks pass; the consolidated release remains separate. Generate the read port from all 141 canonical files and apply the complete prepared chain before deploying dependent callers. Revert those callers before removing this trigger/function/constraint and restoring the previous whitelist; owner records need no rollback.


## Migration 122 — complete owned export snapshots

`20261025142409_complete_data_exports.sql` adds the authenticated-only `export_owned_records(text[],uuid)` function. Its captured owner must match auth.uid even for empty tables. The STABLE security-invoker function retains existing RLS, uses one statement snapshot, reads only forty-six explicitly permitted tables and projects reviewed column names. New columns do not automatically enter downloads. It orders each table by its existing primary key and rejects null, repeated or unknown tables. No record, policy, index or service-role privilege changes.

The function preflights at most 10,001 projected rows per table before JSON aggregation and refuses more than 10,000 rows or a total envelope above 10 MiB. This is a bounded complete download, not pagination, streaming or an unlimited account backup. Arbitrary user text/JSON remains owner content; a positive column list cannot inspect its meaning. Profiles retain the previous five exported fields; the archived personal scope remains an archive, never a query of removed source tables.

Twenty isolated migrated-database checks pass for complete 1,201-row reads, exact column contracts, ownership, permissions, invalid input, future-column exclusion and row/byte refusal. Finding 236 adopts the strict API snapshot reader and bounded download route. Finding 237 adopts the rendered Settings download and guest flow with matching controls, captured owner/cancellation and bounded file streams. Apply the complete 87–147 chain before deploying callers. To roll back, restore callers that do not use this RPC first, then drop only `public.export_owned_records(text[],uuid)`. Owner records need no rollback.


## Migration 123 — complete plan reads and maintained versions

`20261025170608_confirmed_plan_records.sql` validates finite plan updated_at values, maintains every permitted update with an invoker BEFORE UPDATE trigger and adds plans to the complete collection whitelist. Same-clock/future versions advance by a PostgreSQL microsecond; forged earlier client timestamps cannot move a version backwards. No existing title, note, recurrence, completion stamp, Calendar id, policy, grant or index is rewritten. A nonfinite legacy version refuses and rolls back the migration. The 25 October read-only production preflight finds zero nonfinite plan versions.

The STABLE snapshot retains invoker RLS and migration 120's captured-owner overload, including empty results. It orders by created_at/id descending and refuses more than 10,000 rows or 10MiB returned JSON instead of truncating. Earlier collection contracts remain unchanged. The trigger has an empty search path and no direct client/service execute grant. Five-second DDL lock waits reset afterward.

Eight isolated database cases pass for unchanged-data upgrade, nonfinite rollback, stale predicates, same-clock/future versions, 1,201-row completeness/order, captured/foreign owner checks, row/byte refusal and privileges. Finding 247 adopts complete captured reads and verifies strict mutation contracts; finding 250 adopts Goals/Home controls and captured optional Calendar phases. Preparing this file does not change deployed callers. Regenerate the read port from all 147 canonical files and apply all 61 prepared files (87–147) before deploying dependent callers. For rollback, revert those callers first, drop the trigger/function/constraint and restore the prior collection whitelist. Existing owner records need no rollback.


## Migration 124 — atomic TikTok Prague-day admission

`20261025184649_tiktok_prague_daily_admission.sql` replaces only the service-only invoker reservation function. Within its existing owner/TikTok transaction lock it captures one reservation instant, checks the complete local-day timestamp range and uses that same instant for the insert. A settled zero-cost run or an uncertain pending start still occupies its day. Local date + 1 handles Prague's 23-hour and 25-hour days. The independent rolling twenty-four-hour spend ceiling still applies, and transcript/model admissions keep their previous behavior. Existing rows, RLS and indexes do not change.

Twenty focused database cases across three files pass, including full 124-migration upgrade/rollback, calendar boundaries, unknown/zero costs, owner isolation and actual role permissions. Two real PostgreSQL 17.11 connections admit exactly one reservation under an otherwise sufficient $0.20 ceiling. A captured-bound local query plan uses the existing owner/kind/time index among 10,001 synthetic rows. The migration-124 read-port snapshot reflected its 124 files; the current port is regenerated from all 141 canonical files. These are local guarantees, not production latency or charge measurements. Apply the complete 87–147 chain before treating daily admission as deployed; the feature still needs its existing Facebook Login/owner-spend prerequisites. Rollback restores the previous function without deleting reservation history; keep optional TikTok starts disabled while its daily guard is absent.


## Migration 125 — monotonic Career discovery snapshots and protected cleanup

`20261025204635_career_monotonic_source_snapshots.sql` adds the private service-only `career_private.source_snapshots` observation/hash table and three invoker RPCs. `career_apply_source_snapshot` validates a maximum 1,000-row source snapshot, preserves newer/equal listing observations and first-seen history, refuses older source replays even after cache removal, and returns actual PostgreSQL 17 MERGE actions. A matching retry is a duplicate; a conflicting payload at the same observation is refused. Initial admission consults existing source history without rewriting it. The database allows at most one minute of distributed clock skew and one day of observation age; the Apify adapter separately refuses future provider completions. Only a nonempty complete curated snapshot can prove absence. Discovery feeds remain partial.

Short database mutations share one transaction lock without provider work inside it. Cleanup locks exact candidate rows with SKIP LOCKED, then rechecks committed deletion markers in a new statement. Version/URL proofs cannot remove a refreshed/repointed listing. All removal paths retain global rows needed by a permanent owner `job_user_state='deleted'` marker, avoiding FK cascade loss and later reappearance. Absence and forty-five-day retention each process at most 10,000 proven candidates; skipped/remaining rows stay for a later explicit check. The listing-reference index supports that anti-join and FK. No client gains access to the private watermark table or mutations; existing own-only policies and saved/application history stay unchanged.

The source orchestrator adopts strict receipts and original observation envelopes, including an empty filtered task, bounded waits, fixed diagnostics and no automatic retry. Candidate liveness reads admit only five oldest rows per partial source; legacy classification cleanup is an explicit 1,000-row maintenance window. Counts report confirmed actions, not an invented inserted split or a REST-capped deletion page. A failed or ambiguous job journal cannot announce success. The manual authenticated cron route remains unscheduled and only pings after a confirmed pass and recorded monitoring result.

The full 125-file local chain, unchanged-data upgrade/rollback, actual SDK/service grants, owner tombstones, version/URL conflicts and 1,201-row retention are tested. Two native PostgreSQL 17.11 connections reproduce marker loss in the first candidate implementation, then retain the marker after the row-lock fix; matching calls insert once and old/new concurrent observations keep the new title. Local 10,000-triage-row plans select the added index. These are local guarantees, not production latency or billing measurements. Apply the entire 87–147 chain before deploying callers. For rollback, first deploy a version that refuses manual Career refresh while dependent callers are reverted; do not restore the unsafe legacy deletion path. Retain source watermarks as recovery evidence and preserve all listings/private triage records. No existing owner row requires a data rollback.


## Migration 126 — complete captured Career reads and native workplace evidence

`20261025214416_complete_captured_career_reads.sql` adds authenticated-only `read_career_records(text,uuid)`. The stable security-invoker function verifies the original owner before empty or nonempty reads, keeps existing own-only private RLS and explicitly projects seven reviewed collections. A single statement snapshot excludes only that owner's permanent deleted-offer markers before the listing limit. Complete collections refuse overflow: 10,000 listings/saved positions/applications/templates, 20,000 triage markers, 50,000 application events and 10 MiB UTF-8 JSON per envelope. The scrape journal intentionally returns only its latest health record. These limits reject an incomplete result rather than silently returning a prefix.

A default-false `job_listings.native_remote_verified` column preserves legacy values. Reads establish fully remote work for native Ashby/Lever/Greenhouse sources only after a fresh strict service snapshot writes the workplace evidence; non-native remote-only feeds retain their contract. The replaced source RPC preserves migration 125's monotonic watermarks, service-only permissions, exact receipts, lock ordering and protected cleanup. Existing listing fields, private histories and source watermarks need no data rewrite.

The server and browser adopt strict owner-stamped receipts, captured cancellation and a fifteen-second read limit without hidden retries or extra auth requests. Career's six private collections remain on demand; the initial route reads health only. Home still requests its existing application-follow-up collection. Local migrated-database/actual SDK checks cover 1,201-row completeness, 501 newer deletion markers, owner isolation, empty-owner refusal, future-column exclusion, strict receipts, row/byte refusal, preserved-data upgrade/transaction rollback and exact execution grants. The read port is generated from all 141 canonical files. Apply the complete 87–147 chain before deploying these callers. For rollback, revert dependent callers first, restore migration 125's source function, then remove only this read function and metadata column; preserve all owner records. Findings 274–278 adopt complete browser list/board paging and captured availability checks with explicit recovery. Captured private editor/write controls remain under review.


## Migration 127 — private Career workplace evidence

`20261025233522_career_snapshot_remote_evidence.sql` adds nullable `remote` evidence to saved positions and applications. True, false and unknown remain distinct. Existing records stay null: a later public listing or broad Europe location cannot establish historical workplace evidence. New listing saves include the reviewed remote flag; conversion to an application copies the saved evidence inside the existing idempotent transaction, regardless of conflicting payload evidence. Direct applications accept Boolean/null evidence and refuse other JSON types before creating history. Own-only RLS and existing function signatures remain unchanged.

Complete captured Career reads project this field explicitly. Browser filters honor explicit onsite evidence before legacy remote-only-source/location fallback and keep a verified native Europe remote snapshot eligible for Norway. Oslo office positions remain eligible. The generated read port reflects all 140 canonical files. Local SDK/RLS, retry, source-removal and unchanged-data upgrade/transaction rollback checks verify the foundation; this is prepared code, not a production data change. Apply the complete 87–147 chain before deploying dependent callers. For rollback, revert callers and restore migration 126's reader plus the prior application function first; retain these nullable columns and all private history. Captured mutation/version controls remain separate work.


## Migration 128 — monotonic private Career versions

`20261025234711_career_private_record_versions.sql` validates finite `updated_at` values and adds one invoker, empty-search-path version trigger to saved positions, applications and letter templates. Every permitted update advances the prior version by at least one PostgreSQL microsecond, even within a fixed clock tick or when an existing version is ahead of the clock. The database ignores submitted replacement timestamps. Existing fields, records and ownership policies are unchanged. A nonfinite legacy version refuses the migration rather than rewriting history. The trigger function has no direct execution grant for API roles.

Local migrated-database/actual SDK cases cover same-clock stale predicates, future/backdated submitted timestamps, existing future versions, role execution, nonfinite insertion/refused upgrade and unchanged-data upgrade/transaction rollback. The generated read port reflects all 140 canonical files. These checks do not deploy the foundation or make legacy browser writes compare versions. Apply the complete 87–147 chain before deploying dependent captured-write callers. For rollback, revert those callers first, then drop these three triggers, their function and the three finite-version constraints; preserve all private records and their latest timestamps.


## Migration 129 — captured atomic Career discovery saves

`20261025235237_captured_career_listing_save.sql` adds authenticated-only invoker `capture_career_listing(uuid,uuid,uuid,timestamptz,text)`. It checks the captured owner before empty/nonempty reads and serializes short captures for that owner. A stable saved id recovers an uncertain attempt; an existing private snapshot at the exact URL is returned unchanged, including owner-edited titles and drafts. A reused id for another URL is refused. New captures require the exact public listing id, URL and microsecond version and no own deletion marker. They share the existing source-writer advisory guard, so a waiting capture rechecks the completed observation. Global listing UPDATE permission and a definer bypass are unnecessary. Lock waits are capped at five seconds. Explicit owner/request/created/row receipts exclude future columns and refuse a result above 10 MiB.

The browser captures owner/lifetime, listing fields and a stable request id before waiting. It validates returned identity and new-row defaults, uses one fifteen-second SDK attempt without retry or another auth request, and bounds cache cancellation separately at five seconds. Shared card/details pending admission prevents a same-frame repeat. An unconfirmed result retains its exact retry id; a definite source conflict offers an explicit refresh. Existing private rows and changed cache snapshots are not replaced by delayed callbacks. Leaving retires private UI effects; failed/confirmed actions restore focus only without a newer interaction. Manual URL saves and private editor/progress/template actions remain separate review work.

Local full-chain SDK/RLS tests cover private-history preservation, exact source versions/URLs, durable deletion intent, role grants, strict receipts, malformed input, bounded waits/results, cancellation and preserved-data upgrade/transaction rollback. Two native PostgreSQL 17.11 connections converge on one saved record and refuse an old version after a source lock wait; the native fixture has global listing SELECT without UPDATE permission. These are isolated guarantees, not production latency or billing measurements. Regenerate the read port from all 147 canonical files and apply the complete 87–147 chain before deploying callers. For rollback, disable the dependent discovery-save action before dropping this function; never restore the blind upsert over private drafts. Preserve every saved record.


## Migration 130 — captured triage and durable deletion intent

`20261026001926_captured_career_triage.sql` adds nullable `job_user_state.updated_at` without backfilling existing history. New records get a database timestamp; the shared private-version trigger advances every update by at least one PostgreSQL microsecond. A validated finite-version constraint refuses invalid legacy timestamps instead of rewriting them. The complete Career reader explicitly includes the new nullable field.

Authenticated-only invoker `apply_career_triage(uuid,jsonb)` captures the original owner, listing URL/version and expected private state/version. It serializes short owner operations with discovery capture, shares the existing source guard and applies at most 1,000 distinct changes atomically. A late conflict rolls the whole batch back. Already-confirmed desired states retain their identities/versions; clearing a missing shortlist confirms absence. A deleted marker can never become a shortlist or be cleared by this function. Lock waits have a five-second cap; input and explicit receipt envelopes refuse more than 10 MiB. Results accumulate as a PostgreSQL array before final JSON conversion. No new index, provider action or ownership policy is added.

A separate invoker table trigger protects deleted identity, owner, listing, state and creation history from old API writes and refuses listing-deletion cascades that would lose a permanent marker. It preserves the existing Auth-owner deletion cascade only when a nested operation has Auth SELECT permission and can establish that the parent owner is gone. Ordinary API writes perform no Auth-record query and gain no Auth permission or definer bypass. The trigger functions have no direct API execution grant. See Supabase's [Auth-trigger permission guidance](https://supabase.com/docs/guides/troubleshooting/dashboard-errors-when-managing-users-N1ls4A).

The client foundation captures nested inputs before waiting, validates exact complete receipts and changed-state timestamp advancement, makes one fifteen-second SDK call without hidden retry/auth and ignores cancellation or delayed cache overwrites. The caller retains a stable intent for an explicit retry. Finding 283 adopts captured browser confirmation, same-frame pending admission, retained selection/retry, guarded reload and keyboard recovery. Manual URL/private editors, application/progress and template controls remain separate work.

Full-chain isolated SDK/RLS cases cover stale and recreated shortlists, permanent intent, atomic rollback, the full 1,000-change bound, owner isolation, strict input/receipts, original scope, cancellation/deadline, future-column exclusion, permissions and unchanged-data upgrade/transaction rollback. Native PostgreSQL 17.11 proves concurrent stale clears, queued legacy deletion, raw listing cascades and preserved owner-deletion behavior; these are isolated guarantees, not production timing/billing results. Regenerate the read port from all 147 canonical files and apply the complete 87–147 chain before deploying dependent callers. For rollback, disable the dependent triage controls first, restore migration 129's reader and remove the new RPC; retain the permanent-marker guard and private history. Removing that guard would restore the reproduced data-loss path.


## Migration 131 — application/source lock order

`20261026163911_career_application_lock_order.sql` is prepared and unapplied. It preserves the legacy `record_job_application` signature and owned snapshot/event transaction. After the existing request/idempotency check, it acquires the same shared source guard used by captured Career work before locking a Saved row. Source cleanup uses the exclusive guard before its global-row/FK changes. This keeps a conversion from holding private state while waiting for the global FK target. Already-recorded retries still return before acquiring this guard. The function stays invoker with an empty search path and existing execution grants; each lock wait is limited to five seconds, not a claim of one total operation deadline.

Title validation now accepts 1–300 trimmed characters, matching the source/saved contract. It still refuses blank and oversized titles. There is no private data rewrite or table-field change. The eight-table DNESKAi read port is regenerated from all 141 canonical files; only its fingerprint changes.

Native PostgreSQL 17.11 reproduces the prior two-connection deadlock between actual conversion and version-confirmed source cleanup. With the fix, conversion waits before taking the private lock, both operations complete and one application/event retain the private letter/note after the public link is removed. The native fixture uses exact relevant tables/migrations plus a deterministic owner-day stand-in, not the complete chain. Full-chain PGlite/actual SDK cases separately cover title boundaries, conversion/retry, pruned sources, foreign ownership, grants, preserved-data upgrade and rollback. These are local guarantees, not production latency measurements. Apply the complete 87–147 chain before deployment. A 26 October count-only managed check still reports 86 applied files through `20261023130300`.

For rollback, stop dependent callers first and restore the prior function definition only as an emergency compatibility step; doing so restores the old lock-order failure and 200-character restriction. Preserve private applications, Saved records, events, request ids and snapshot columns. The next captured application/letter/browser lifecycle work remains separate.


## Migration 132 — captured Saved-to-application conversion

`20261026182155_captured_career_application.sql` is prepared and unapplied. The new `record_captured_job_application` authenticates the expected owner before inspecting input, requires the captured Saved version and converts only that exact row. Source metadata comes from the private Saved snapshot. Application insertion, the applied event and Saved removal share one transaction. The shared source guard precedes private locks; each lock wait is bounded at five seconds. The browser helper has a separate fifteen-second total lifetime and no hidden retry.

A nullable internal SHA-256 request fingerprint preserves exact original-intent retries without returning private input text. Legacy applications retain null fingerprints and cannot be mistaken for a confirmed new intent. A matching retry returns current application progress; it does not overwrite later notes or recreate removed event history. Explicit application/event projections exclude this internal field and future columns. Authenticated execution remains invoker with an empty search path and own-only RLS. Input is bounded at 256 KiB and the SQL receipt at 10 MiB; these are not a streamed SDK byte cap.

Full-chain actual SDK/RLS tests cover stale notes, title/field/URL/date bounds, UTF-8 fingerprint parity, six-digit timestamp equivalence, retries, newer progress, absent history, owner isolation, permissions, future-column exclusion and preserved-data upgrade/rollback. Native PostgreSQL 17.11 separately verifies source-cleanup lock order, refusal of the old Saved version, retained private work and conversion only after explicit fresh review. Its minimal fixture is not a full native replay. No production record is changed. Apply the full 87–147 chain before deploying callers. Revert dependent callers before removing the RPC; retain all private rows and original-intent fingerprints. Finding 292 adopts the captured browser dialog, draft save, retained conflict/retry and explicit reload controls. Other letter/progress/template controls remain separate work.


## Migration 133 — atomic captured application progress and contacts

`20261026195100_captured_career_progress.sql` is prepared and unapplied. The new `update_captured_job_application` validates the original owner, application id/version and a strict bounded seven-field patch. It locks the owned row, refuses a stale version and commits stage, response, follow-up, notes and contacts in one transaction. Only submitted fields change. Unchanged values produce no row rewrite or event. Stage and response/follow-up/note history retain their existing semantics; contact-only changes remain history-free. An event failure rolls the whole mutation back.

Positive row/event projections exclude internal fingerprints and future fields. The receipt binds the captured id/version and returns exactly the new events. Authenticated execution stays invoker, own-only and empty-search-path, with a five-second limit per lock wait. The client separately captures original input and cancellation, bounds the total operation to fifteen seconds, disables hidden retries and validates unchanged fields, exact patched values, monotonic versions and event details. The 256 KiB input and 10 MiB SQL receipt bounds are not a streamed SDK byte cap.

The isolated full-chain SDK/RLS/client checks reproduce and close old-stage overwrites of newer notes, verify atomic rollback, long untouched legacy notes, no-op identity, owner isolation, strict input/receipts, removed/foreign cache guards and populated-history upgrade/transaction rollback. No production data is changed. Regenerate the read port from all 147 files and apply the complete 87–147 chain before deploying callers. Finding 295 adopts captured list/board stage controls and the atomic response/contact editor, with retained drafts and explicit reload. Revert dependent callers before removing the new RPC; preserve all application history. The legacy progress RPC remains available during rollout.


## Migration 134 — atomic stable-monitor heartbeat events

`20261027022446_atomic_uptime_kuma_transitions.sql` is prepared and unapplied. It adds one service-only private state row per owner/monitor id, a partial open-alert lookup index and an invoker RPC with an empty search path. Public/anonymous/authenticated callers cannot execute it or read the private state. The existing notification own-only policies remain unchanged. A transaction-scoped identity reservation precedes the state read, including the first event; lock waits are limited to five seconds.

A new Down transition commits one notification and failed cron log together. Repeated same-status facts advance only the observation state; exact replays do not rewrite it. Older or equal-time contradictory facts cannot reopen a recovered monitor. A recovery resolves every matching stable-id open alert and creates one recovery notice only when an alert was open. Monitor renames and namesakes remain distinct. Legacy alerts keyed only by name remain untouched because their identity is unproven. State metadata remains after notification dismissal to reject stale replays. Rollback should revert dependent callers and retain this state/index, not discard that ordering history.

The route accepts the default Kuma envelope with a positive numeric `monitor.id`, explicit numeric status 0/1 and raw UTC heartbeat time; optional `heartbeat.monitorID` must agree. Test, pending, maintenance, malformed or unverifiable bodies remain ignored 200s. The authenticated input has a 64 KiB UTF-8 cap and one twenty-second cancellation/deadline across rate admission, body and persistence. Failed/unconfirmed writes return a fixed 503 separately from malformed input. The RPC has no hidden client retries. Only bounded monitor name/id/time/status are retained; vendor options and diagnostic messages are excluded. One configured receiver denotes one Kuma installation; changing installations requires reviewing monitor identities, not a name-based backfill.

Full-chain SDK/database cases verify owner isolation, exact grants/receipts, replay/stale/rename/duplicate-alert recovery, atomic failure rollback and unchanged historical data through upgrade/transaction rollback. Native PostgreSQL 17.11 uses two connections and the exact relevant migration/table definitions to verify first-event convergence and stale-event refusal after a recovery lock wait; that minimal native fixture is separate from the full-chain PGlite replay. No production monitor or owner record is used. Apply the complete 87–147 chain before deploying the receiver. The eight-table read port is regenerated from all 141 files, changing only its schema fingerprint.

Contract research (27 October 2026): the upstream [webhook provider](https://github.com/louislam/uptime-kuma/blob/master/server/notification-providers/webhook.js), [heartbeat serialization/status definitions](https://github.com/louislam/uptime-kuma/blob/master/server/model/heartbeat.js) and [monitor notification timestamps](https://github.com/louislam/uptime-kuma/blob/master/server/model/monitor.js). Supabase's [function privileges and invoker guidance](https://supabase.com/docs/guides/database/functions) inform the restricted RPC; current [changelog](https://supabase.com/changelog) review retains the separate TLS-cipher and PostgreSQL-upgrade preflight.


## Migration 135 — complete minimal niche-audio snapshot

`20261027030141_complete_dneskai_niche_audio_read.sql` is prepared and unapplied. The stable invoker RPC is restricted to the service role, confirms the owner/project relation and reads one statement snapshot for the captured seven-day interval and education source ids. Finite exact bounds, at most 120 unique source ids and a small future-clock allowance are required. Its partial owner/project/date/id index covers music-bearing candidates. It creates no candidate, source, licence, recommendation authority or paid work. Existing own-only policies remain intact.

The response contains only candidate id/time, source/external identity, plays and music ranking fields. Articles, captions, URLs, media, classification and unknown future fields never enter the response. At 10,001 matching rows or more than 10 MiB it refuses the snapshot instead of returning a prefix. The caller validates the exact owner/project/source/window receipt, unique ids, microsecond boundaries and every projected ranking field. Malformed relevant rows cause unavailable, not silent omission. Ranking still counts each sound/reel pair once and excludes original or muted sounds; missing optional labels remain unknown.

One fifteen-second caller lifetime covers source-catalog admission and the no-retry snapshot request. Invalid clocks and prior cancellation refuse work before the catalog; later cancellation stops the next phase and ignores uncooperative late results. Finding 313 repairs the audio route's optional-trend failure presentation; finding 314 repairs Meta observations. Finding 316 adds dated TikTok completion; finding 317 adds captured paid admission/binding; matching progress remains under review. Apply the complete 87–147 chain before deploying the new reader. Rollback reverts dependent callers before removing this read RPC/index; all stored candidates remain unchanged.

Local full-chain/actual SDK tests cover more than the former 500/REST prefix, 10,001-row refusal, byte limits, original/muted/dedup policy, owner/project/source/date isolation, positive projection, grants/RLS and populated-data upgrade/transaction rollback. A 1,201-Reel fixture with article text returns less than one tenth of the full-candidate payload. This is synthetic response-size evidence, not production latency, CPU or billing evidence. The eight-table read port is regenerated from all 141 canonical files.


## Migration 136 — atomic account-bound Meta audio observations

`20261027044222_atomic_dneskai_audio_observations.sql` is prepared and unapplied. Four nullable proof fields bind new observations to the owner’s verified DNESKAi Instagram account, remote id, exact six-digit verification time and captured observation clock. Legacy rows remain unchanged and unproven. The existing first/last/day count remains owner-level audio history, rather than a new account-specific streak. Paused publishing does not prevent free metadata reads.

The service-only invoker writer locks the exact account tuple before taking sound reservations in deterministic id order, including initially absent rows. The five-second lock bound is separate from the caller’s fifteen-second total lifetime. Newer observations win; delayed earlier observations cannot regress metadata or increment the same day twice. Exact replays do not rewrite the row; equal-time conflicting data, stale account proof, invalid dates and unconfirmed/suppressed/altered persistence cannot report success. A day change before admission skips the pass; a day change after admission rolls the batch back. A compatibility trigger refuses legacy metadata overwrites that would leave unchanged proof attached. Independent old TikTok fields do not grant new Meta proof.

The stable service-only recommendation reader projects at most fifty recent sounds joined to the currently verified account. It excludes legacy/null proof, stale account identities and future columns. Complete current niche evidence supplies its own counts; old `niche_count` and undated TikTok flags do not become current evidence. Finding 316 adds dated TikTok completion; finding 317 adds captured paid admission/binding; matching progress remains under review.

Both Graph reads and the write use one captured owner/account/day/configuration context and total deadline, bounded complete 256 KiB UTF-8 provider bodies, caller cancellation and no automatic SDK retry. No credential enters the persisted batch or receipt. The client accepts only exact positive owner/context/item receipts. `stored` counts confirmed input observations, including exact replays; superseded observations count zero. No provider or model request runs during verification.

Full-chain PGlite/actual SDK tests cover replay, stale days and microseconds, owner/account changes, old-writer refusal, atomic batch rollback, grants, positive projection, fifty-result bounds and populated-history upgrade/transaction rollback. Two native PostgreSQL 17.11 connections separately prove newer-first convergence and one-row/one-day first-observation convergence using exact relevant table definitions and migration 136. This minimal native fixture is not a full-chain replay. The eight-table read port regenerates from all 136 canonical files. Apply the complete 87–147 chain before deploying these callers. Revert dependent callers before removing the new RPCs; preserve the proof columns, compatibility guard and all historical rows rather than restoring the raced writer over proven records.

## Migration 137 — dated TikTok proof and confirmed completion

`20261027050940_dated_dneskai_tiktok_receipts.sql` is prepared and unapplied. It adds nullable dated TikTok/account proof to the existing audio table and a fingerprint/positive completion receipt to the existing private topic-spend ledger. It rewrites no legacy row and guesses neither old flags nor old settlements into current proof. A partial owner/source-day index supports recent TikTok reads. Existing own-only table policies and service-only private grants remain intact.

The service-only invoker progress reader projects the complete elapsed 72-hour window with a 1,000-record/2 MiB bound, rather than the old newest-five prefix. Future-clock rows remain visible to validation and cannot silently disappear before admission. The captured client validates owner, exact six-digit window, identities, duplicate bindings, cost/reservation consistency, complete row shape and cancellation. Both the finite window and the ceiling are explicit; this is not an unbounded historical scan.

The completion RPC confirms the exact owner/account/remote/verification/publishing-state tuple and owned reservation/ref/time before taking audio reservations in id order. It validates the pinned actor, bound run/dataset id, terminal status, source/start/finish clocks and a bounded unique match batch. The source day comes from the original reservation. Only the current/prior Prague source day can add dated availability. An older chart may complete its measured cost without adding fresh matches. Dated TikTok metadata stays separate from confirmed Meta metadata/history; exact retries reuse the original receipt and stale concurrent observations cannot replace newer proof. A day change, suppressed/altered match or final progress write rolls the transaction back. Completed identity/cost/proof fields are immutable. The rolling legacy-write guard covers base history protected by either Meta or TikTok proof, while allowing new confirmed Meta observations to add independent proof.

Measured costs round up to four decimal places, so a tiny known charge does not become a zero-cost call. Already-settled historical costs remain unchanged. Unmetered terminal runs remain unsettled/unprocessed with their full reservation counting; no match, invented zero, fallback settlement or new paid start follows that refusal. A terminal response newer than ten seconds remains pending until another tick, following the provider’s warning that immediate terminal costs can still be preliminary. This is a later poll, not a sleep or an extra request within the pass. [Apify run documentation](https://docs.apify.com/api/v2/actor-run-get).

The shared recommendation reader now also accepts dated current-account TikTok search proof, with its own source/observation date. Old booleans remain insufficient. Recent confirmed Meta metadata takes precedence, preserving its duration, artwork and owner-level history. A sound proven only by current Meta search has no confirmed Meta trend-day count. The fifty-recommendation policy and niche-only manual hints remain unchanged.

Caller cancellation and no-retry database transport remain inside the twelve-second total TikTok pass. Successful matching, dated proof and measured-cost progress now complete in one positive transaction; there is no unchecked Boolean update or separate settlement. Finding 317 subsequently adds captured paid admission/binding; worst-case matching progress remains a separate lead. These changes enable no switch, provider, model or publication. Apply the complete 87–147 chain before deployment. Revert dependent callers before restoring migration 136’s recommendation reader and removing the new functions/index; preserve dated proof, immutable receipts and all owner history rather than restoring blind writes over it.

Full-chain PGlite/actual SDK tests cover persistence, legacy preservation, cost precision/unknown metering, exact replay/conflict, source expiry, current account proof, day rollover, complete-window/DST bounds, positive projection, grants and transactional upgrade/rollback. Two native PostgreSQL 17.11 connections separately verify stale concurrent proof and exact concurrent completion replay using exact relevant stock tables and migrations 136–137; that minimal native fixture is separate from the full-chain replay. The eight-table read port regenerates from all 137 canonical files. These are isolated guarantees, not production latency, spending or rollout evidence.


## Migration 138 — captured TikTok paid admission and provider binding

`20261027061021_captured_dneskai_tiktok_admission.sql` is prepared and unapplied. It adds nullable admission/binding receipts to the existing private topic-spend ledger, leaving historical rows unchanged. The service-only invoker reservation wrapper locks the exact current verified account tuple, then reuses migration 124’s owner budget lock, Prague-day admission and rolling spend ceiling. It confirms the actual owned pending row and stores a positive receipt with the original account/clock/day, pinned actor, exact Czech-surging input, reservation, ceiling and prior spend before returning it. Invalid/stale tuples, a changed day and suppressed/altered persistence roll the reservation back.

The provider request uses the verified receipt’s exact actor/input and charge/item limits. The pinned actor is frozen at runtime. Neither a bare UUID nor an unscoped or foreign receipt can authorize a paid start. Refusal carries no spend id. The $0.10 reservation, daily ceiling parsing, 25-result scope, paid/consent/credential gates and twelve-second caller lifetime remain unchanged; no paid retry is introduced.

Binding records an already-started run against its original immutable admission, rather than requiring an account tuple that may have changed while the provider request was pending. It confirms the exact owner/reservation, pinned actor, run/dataset identity and sensible start clock, serializes duplicate bindings under the same owner lock and returns a stored positive receipt. Exact replays reuse that receipt; conflicting/reused provider ids refuse. Account re-verification can block new admission without losing a known original start. A refused/ambiguous binding retains the full pending reservation and cannot report durable success.

The final-row guards reject legacy Boolean binding and separate settlement over captured admissions. They run after all BEFORE triggers, including the existing completed-record guard, so a later trigger cannot change protected intent after validation. Atomic measured-cost completion from migration 137 remains supported. No credential, provider diagnostic, real account, paid call or publication is used during verification.

Full-chain PGlite/actual SDK checks cover account/owner/microsecond/day changes, wrong receipts, suppressed/altered writes, legacy callers, future trigger changes, duplicate identities, current admission through measured completion, role grants and preserved-history upgrade/transaction rollback. Two native PostgreSQL 17.11 connections separately prove one owner-day admission, exact concurrent binding replay and binding after re-verification, retaining the full unsettled reservation. The minimal native fixture uses exact relevant tables and budget functions; it is separate from the full 138-file replay. Eight read tables regenerate from all 138 canonical files. Apply the complete 87–147 chain before deploying these callers. Revert callers before removing the new functions; preserve immutable receipts and the guards rather than returning to unscoped success acknowledgements.

## Migration 139 — captured Music track toggle foundation

`20261027111657_captured_dneskai_audio_toggles.sql` is prepared and unapplied. It validates finite four-digit-year `updated_at` values and maintains a strictly increasing version on every permitted track update, including equal clocks and caller backdating. It rewrites no historical row. An unsupported existing version stops validation rather than silently inventing a replacement timestamp. Existing private Storage behavior, owner-only SELECT policy and service-only table writes remain unchanged.

The service-only invoker `toggle_owned_dneskai_audio_track(uuid,uuid,timestamptz,boolean)` locks the exact owned track, compares the captured full timestamp, and returns a positive saved/changed/absent intent receipt. A saved receipt confirms the requested state, a strictly newer version, unchanged unrelated metadata and the final persisted row after triggers. Suppressed/altered/later writes or removal roll the transaction back. A stale retry remains changed even when the current state matches its requested value; callers must read before a new action rather than guessing a lost receipt was saved.

Finding 324 adopts the API/browser contract: captured owner/full row version, strict receipt transport, independent pending-row reservations, pending exit protection and source-safe cache updates. Unconfirmed writes remain blocked until an explicit read; a normal positive receipt needs no extra read. Apply the complete 87–147 chain before deploying dependent callers. For rollback, revert those callers first, then remove this RPC and trigger/function/constraint; preserve all track rows and timestamps. Full-chain actual-SDK/RLS checks cover positive receipts, stale/foreign/absent intent, trigger rollback, execution grants, finite versions and unchanged-data/failed-upgrade rollback. Two native PostgreSQL 17.11 connections separately prove row-lock serialization and refusal of a competing stale/opposite toggle using the exact stock track table and migration 139. This is local evidence, not a production rollout or latency measurement.

A 27 October count-only production preflight reports ten tracks and zero unsupported versions, and still only 86 applied migrations through `20261023130300`. The complete 53-file audit chain remains unapplied; the preflight changes no row/configuration. At the foundation checkpoint, all 732 related tests pass across 35 files, with final TypeScript and targeted ESLint passing. Existing browser/API toggle adoption is still separate work.

## Migration 140 — positive owned audio object presence

`20261027141619_confirmed_dneskai_audio_object_presence.sql` adds a service-only, stable invoker read of one canonical owner/id/content-type object path in the existing private `marketing-audio` bucket. It returns only the captured selectors and `present`/`absent`; missing/public buckets refuse confirmation. It changes no records, storage policies or table grants, and never reads file bytes or credentials.

Finding 325 uses this proof only after a failed upload-confirmation download. Storage HTTP status or error prose cannot prove absence; an existing object, unavailable proof or malformed/foreign receipt remains unavailable. The read has a fifteen-second no-retry bound and honors original caller cancellation. Normal successful downloads make no additional request. Full-chain SDK/RLS, retained-object failure injection and populated-history upgrade/transaction rollback are verified locally; canonical rollout remains pending. Regenerate the eight-table read port from all 147 files and apply the complete 87–147 chain before deployment. For rollback, revert dependent callers before dropping only this function; preserve every object and track. Finding 326 adopts stable original owner/file/metadata sessions, captured prepare/create receipts and retained pending/recovery controls. A retry verifies the original create first and reuses the same path only after positive absence; signing explicitly refuses overwrite. Findings 327–328 add strict renderer/rotation metadata, bounded file streaming and retained audio-failure holds. The evaluated history index is deferred after a count-only managed preflight; no history-index migration is prepared. Broader Reel/storage/SDK-error and orphan-retention boundaries and final release remain separate work.


## Migration 141 — exact confirmed Reel records

`20261027175307_confirmed_dneskai_reel_records.sql` adds the service-only invoker `record_owned_dneskai_reel(uuid,uuid,text,text,uuid,text,bigint)`. The owner/revision/hash/key tuple is locked for atomic replay, and a shared revision-row lock confirms the current owned content hash. Identical retries return the original event; caption changes can record a new approved hash while retaining the same immutable MP4. Stale or contradictory records refuse confirmation. A post-trigger event read validates the final owner/revision/kind/payload/timestamps before returning the small positive receipt, so suppressed or altered writes roll back rather than reporting success.

Existing events, objects, tables, RLS policies and table grants stay intact. Only the service role receives function execution; anonymous/authenticated calls are denied. A 27 October read-only managed preflight confirms the existing service-role SELECT/UPDATE privileges required by row locks and SELECT/INSERT/UPDATE on events; no new table permission is granted. Production still reports 86 applied migrations. This file is prepared, not applied.

Finding 336 adopts one fifteen-second no-retry RPC under the original render lifetime, validates the exact persisted tuple and retains uncertainty without deleting media. This serializes record creation, not native encoding before the record exists. Regenerate the eight-table read port from all 147 files and apply the complete 87–147 chain before deploying dependent callers. For rollback, revert callers first, then drop only the new function; preserve every event and stored MP4. Earlier per-migration validation counts remain dated evidence; the current rollout prerequisite is all 61 prepared files.


## Migration 142 — confirmed private slide/Reel cache absence

`20261027184102_confirmed_dneskai_cache_object_presence.sql` adds a stable service-only invoker read with an empty search path. It confirms one canonical owner/kind/content-key path in the existing private slide or Reel bucket and returns only those selectors and `present`/`absent`. Missing/public buckets, invalid selectors and contradictory duplicate paths refuse confirmation. No object bytes, metadata, table grants, policies or stored records change.

Finding 338 invokes the proof only after a typed Storage missing-object candidate. The Storage error alone cannot authorize new rendering: present objects, unavailable reads and malformed/foreign receipts remain unavailable. Healthy cache hits make no additional RPC. Both cache consumers and the no-retry probe honor their original fifteen-second read lifetime. Exact private bucket proof also rejects unknown falsey privacy values. Full-chain actual-SDK/RLS, retained-object failure injection, populated-data upgrade and rollback are verified locally. The read port regenerates from all 142 canonical files. Apply all 61 prepared files, migrations 87–147, before deploying dependent callers. Rollback reverts callers before dropping only this function; preserve all cached media. This confirms absence, not a durable lock against concurrent renders.


## Migration 143 — one captured owner account snapshot

`20261027194255_confirmed_marketing_account_snapshot.sql` adds a stable invoker read with an empty search path. Only authenticated callers may execute it, and the captured owner must match auth.uid(). It reads the existing own-RLS account projection and the existing non-secret token-status RPC under one calling-query snapshot. The receipt contains only ownerId, accounts and token metadata. The existing two-brand/two-platform unique tuple and token primary key bound healthy results at four rows each; excessive/over-20,000-byte results refuse rather than return a prefix. No token value, record write, policy, index or table grant changes.

Finding 347 replaces two REST reads with one fifteen-second no-retry owner-bound RPC and strict exact receipt validation. Full-chain actual-SDK/RLS tests cover complete/empty/tokenless reads, roles, foreign owners, response bounds, populated-data upgrade and rollback. Two native PostgreSQL 17.11 work connections separately verify a consistent old pair while a concurrent writer commits, followed by the new pair on the next statement. That native fixture uses minimal relevant tables and an explicit metadata-RPC barrier, not the complete native chain. Existing managed privileges are confirmed read-only; production still has 86 applied migrations. Regenerate the eight-table read port from all 147 files and apply all 61 prepared files, migrations 87–147, before deploying dependent callers. For rollback, revert the reader first, then drop only this function; preserve all accounts, token metadata and credentials.


## Migration 144 — captured account-control foundation

`20261027195903_captured_marketing_account_switches.sql` adds a finite microsecond account updated_at version with a strictly advancing trigger, including equal-clock and caller-backdated/no-op updates. Existing business fields, tokens and table grants stay intact. Its service-only invoker RPC captures owner/id/full version/switch/state, takes the existing account lock before reading current non-secret token metadata, and refuses stale or ineligible enable requests. Disabling needs no metadata read. Engagement uses the established login-mode-specific watcher permissions and clears block fields only on confirmed enable.

The transaction rereads the persisted row after triggers and checks the exact requested fields, a newer version and all untouched fields, including future columns. Suppressed or altered writes roll back. Small saved/changed/absent/blocked receipts include only intent and version, never credentials or token metadata. Anonymous/authenticated execution is denied. Five-second lock waits use the credential writer's account-first order. Two native PostgreSQL 17.11 connections prove refresh-before-control eligibility recheck and stale opposite-toggle refusal; full-chain actual-SDK/RLS cases separately cover receipt identity, current gates, role denial, versions, trigger rollback, retained data and successful/failed upgrade rollback. These are local guarantees, not production latency or spend evidence.

Finding 348 prepares this transaction and finding 350 adopts captured route/browser controls, closing both reproduced stale-eligibility API writes. The private read includes versions through migration 145. Broader provider lifecycle and final release checks remain separate. Regenerate the eight-table read port from all 147 files and apply all 61 prepared files, migrations 87–147, before deployment after adoption and release checks. For rollback, disable dependent controls before removing the new RPC; retain the version trigger/constraint/column, all account rows and credentials rather than restoring uncaptured writes. A read-only managed preflight finds one account, the required existing privileges and still 86 applied migrations.


### 145. Versioned private marketing account snapshot

`20261027202033_versioned_marketing_account_snapshot.sql` replaces the existing stable owner snapshot with the same projection plus the account updated_at. It preserves its captured authenticated owner, own RLS, four-row/20,000-byte limits, credential exclusion and existing execution boundary. No account, credential, table privilege, policy or index changes. Finding 350 requires this exact microsecond version before enabling a browser control and confirms saved/changed/absent/blocked business receipts from migration 144. Normal confirmed saves patch only the captured cached version without another collection read; uncertainty/newer cache requires an explicit reload.

The generated eight-table read port uses all 147 canonical files. Apply the complete 61-file prepared chain, migrations 87–147, before deploying dependent callers. Rollback must first disable the dependent versioned controls; restore the prior reader only after reverting those callers. Preserve all account rows, monotonic versions and credentials. Local populated-data upgrade/rollback and full-chain role/SDK checks are recorded in finding 350; canonical managed rollout remains pending.


### 146. Captured marketing account verification

`20261027212131_captured_marketing_account_verification.sql` prepares a service-only security-invoker wrapper over the existing credential writer and reader. It captures account absence or exact owner/id/version plus a bounded private credential fingerprint. The tuple advisory lock, account UPDATE lock and credential access preserve the existing order. Changed, deleted, recreated, newly present or rotated state returns a small changed receipt before writing. A credential change is detected even if its public timestamps/scopes are identical. Neither credentials nor their fingerprint occur in receipts.

The original writer retains its newer-token rule and transaction. The wrapper then confirms the exact persisted identity, finite advancing account version, unchanged unrelated/future account fields and exact stored or retained token. Suppressed/altered writes and private failures roll back with fixed diagnostics. An unchanged identity preserves both switches; a changed remote identity disables publishing and replies. No index, RLS policy, table grant or existing record is changed by preparing/applying this function.

Finding 354 supplies full-chain SDK/role/upgrade/rollback checks and separate native PostgreSQL 17.11 lock evidence. Finding 355 adopts the captured caller and strict non-secret receipts, including actual concurrent-change and lost-acknowledgement regressions. Canonical rollout and consolidated release checks remain required. Regenerate the eight-table read port from all 147 canonical files and apply the complete 61-file chain, migrations 87–147, before deploying dependent callers. For rollback, disable/revert those callers before dropping only this wrapper. Preserve accounts, credentials, monotonic versions and the existing private writer/reader functions.


### 147. Captured marketing credential renewal

`20261028123118_captured_marketing_credential_renewal.sql` prepares a service-only security-invoker wrapper over the existing private token reader/writer. Renewal captures the owner, account id/full version and private credential fingerprint. Tuple advisory → account UPDATE → credential access preserves the existing lock order. Changed account identity/version, removal/recreation or rotated/introduced credentials return changed before writing, including replacements with identical public metadata. Neither credentials nor fingerprints enter receipts.

After the private writer, the transaction confirms the entire unchanged account and the exact persisted credential bytes, expiry, scopes, login mode and advancing refresh time. Suppressed or rewritten writes, account side effects and private errors roll back with fixed diagnostics. Renewal cannot shorten the captured expiry. Supported devShark Instagram and explicitly empty scope metadata retain the old writer's compatibility. No existing row, table grant, policy or index changes when the function is applied.

Finding 359 supplies full-chain SDK/role/upgrade/rollback and separate two-connection native PostgreSQL 17.11 lock evidence. Caller adoption remains required; the two original API race baselines remain outside that foundation evidence. Regenerate the eight-table read port from all 147 canonical files and apply the complete 61-file prepared chain, migrations 87–147, before deploying dependent callers. For rollback, disable/revert callers before dropping only the wrapper; preserve accounts, credential history, monotonic account versions and the existing private functions. The current managed read-only count remains 86 through `20261023130300`.
