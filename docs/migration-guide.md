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
and confirm neither happens. Leave the cron un-run past three of its own
scheduled intervals and confirm the list badge reads Not reporting and the
project health explains it.

With `UPTIME_KUMA_WEBHOOK_TOKEN` and `DASHBOARD_OWNER_ID` set, POST a Kuma down
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

Twenty-three files are newer than anything production holds and none of them is applied: `20261022000000` through
`20261023130300`. Apply them with the CLI, which records each file's own version:

```bash
npx supabase link --project-ref gcctapykhrdyxikieemn
npx supabase migration list --linked      # local and remote columns agree up to 20261021125123
npx supabase db push --linked --dry-run   # lists exactly the twenty-three files, in filename order
npx supabase db push --linked
npx supabase migration list --linked      # both columns agree
```

Do not apply them through the Supabase MCP `apply_migration` tool: it records the apply time as the version, which
recreates the mismatch, and it holds the retention file's `delete` for a confirmation. `20261022141613` needs
`20261022021835` first, and `20261023130300` needs `20261023100100`; filename order does both. The relevance-first
selection (`20261022180000`), the majority category (`20261022160000`) and the unknown-cost scope (`20261022171000`)
take effect with the push itself and need no switch. The next daily tick then records no `retention` error.

After the push, set the server-only switches in Vercel Production and redeploy. Each one is off until its text is
exactly `true`; the full table with defaults is in [marketing scheduling](marketing-scheduling.md#switches).

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

## DNESKAi research preparation, 22 October 2026 (unapplied)

`20261022013957_dneskai_apify_research.sql` adds the separate private research ledger, atomic service-only reserve/mark/spent RPCs, and own-only public metric reads. It preserves all pipeline and staging ledgers. No cron or live route starts research. See [research operations](dneskai-apify-research.md).

This migration has only been replayed in isolated PGlite tests. Apply it with the others through [Applying the prepared migrations](#applying-the-prepared-migrations).

## Richer brief evidence, 22 October 2026 (unapplied)

`20261022020702_dneskai_richer_brief_evidence.sql` adds bounded article prose to the owner-scoped media collection and a fenced service-only setter. Alt and figcaption metadata stay in the immutable image plan. `20261022020759_dneskai_brief_v2_compatibility.sql` accepts both brief document versions without rewriting stored briefs or changing grants.

Both migrations are local preparation. Apply them with the others through [Applying the prepared migrations](#applying-the-prepared-migrations). The app defaults to the existing media columns and brief/1 writer. After both migrations have been reconciled and applied, set server-only `DNESKAI_RICH_EVIDENCE_ENABLED=true` and redeploy to enable article prose and brief/2. Both document versions remain readable. No collection switch, paid ceiling or staging ledger changes.

### Prepared: lapsed brief reports

`20261022021835_dneskai_release_lapsed_reports.sql` replaces the future skip path. A lapsed pending/ready brief with no job, no matching job request or revision, and no other active brief releases its selected reports back to classified `new` candidates. Ordinary freshness and ranking still apply. Covered, queued, generated and non-lapsed briefs retain their reports. The skipped brief and its source history stay intact. This migration runs no historic cleanup and remains unapplied; see [Applying the prepared migrations](#applying-the-prepared-migrations).

## Publication re-queue, 22 October 2026 (unapplied)

`20261022110000_marketing_requeue_unpublished_publication.sql` adds `marketing_requeue_publication(p_publication)` for the signed-in owner (audit finding approval-04). It accepts a publication in `reconciliation`, or a claim whose lease expired, only when it has no numeric container ID, no media ID, no URL and no `publish-intent`: such a row never reached `media_publish`. It sets the publication back to `queued` (`error_code='owner-requeued'`, container and lease cleared) and the revision back to `approved`, leaving `approved_at`, `approved_hash` and the content untouched, and records a `requeued` event. Every other row is refused with `publication may be published`, `publication not stranded` or `approval changed`.

The deployed code needs nothing from this migration: container retries use the existing `marketing_checkpoint_publication`, and the route and panel stay off until `MARKETING_PUBLICATION_REQUEUE_ENABLED=true`. A missing function answers `publication-requeue-unavailable`. Replayed only in PGlite (`tests/lib/marketing-requeue-database.test.ts`). Apply it with the other prepared migrations through [Applying the prepared migrations](#applying-the-prepared-migrations).

### Prepared: owner recovery actions

`20261022141512_dneskai_owner_recovery.sql` adds two owner-only security-definer functions, executable by `authenticated` and scoped by `auth.uid()`. `marketing_dneskai_release_candidate` returns one held report with text, published within 30 days, to the open queue (status `new`, classification cleared, authored fields unchanged); Jev reviews it again in a later nightly batch under the existing limits. `marketing_dneskai_reslot_brief` reopens a brief that lapsed (`brief-slot-passed`, `brief-target-date-passed`, `brief-slot-unavailable`) before any source head, calendar entry, job or revision existed. It takes a rebuilt brief with the same member hash, one of the four daily slots today or tomorrow at least 30 minutes ahead, no later expiry than the original and a lead report still inside the selection window. The brief becomes `pending` (`owner-reslot`, or `account-unavailable` without a verified account) and the scheduler admits it through the ordinary path.

`20261022141613_dneskai_release_lapsed_brief.sql` adds `marketing_dneskai_release_brief`, the owner-triggered form of the lapse release in `20261022021835`, for briefs that lapsed before it took effect. It raises an error and changes nothing when `20261022021835` is absent.

Both stay unapplied. The deployed app never calls these functions while `DNESKAI_OWNER_RECOVERY_ENABLED` and `DNESKAI_LAPSED_RELEASE_ENABLED` are unset; the ⋯ menu's Topic recovery panel (Obnova témat) then shows reslot and release as unavailable with a reason. After an approved application, set the matching server-only variable and redeploy. The owner `retry` action uses only the existing `marketing_dneskai_prepare_brief` and needs no migration.

### Prepared: event category by majority (SEL-10)

`20261022160000_dneskai_event_majority_category.sql` replaces `marketing_dneskai_finish` with a version that reads an optional `category` on each `p_events` entry. The collector sends the category most eligible reports of the event carry, tier-0/1 sources breaking ties (`dneskaiEventCategory`). The function uses it only when at least one eligible member of that event carries it; otherwise it keeps the lead report's category, as before. The lead report, each report's 48 h / 30 d window, the one-event-per-category rule and the briefs' validity rules are unchanged; `tool` and `ai-project` remain separate categories. It stays unapplied. The deployed function ignores the extra key, so the code needs no switch and changes nothing until an approved application.

### Prepared: unknown collection cost scoped to its day (owner decision 17)

`20261022171000_dneskai_collection_unresolved_scope.sql` narrows one guard in `marketing_dneskai_claim_stage`. A paid stage was refused while any stage the owner ever reserved had no cost, or a cost above its reservation, so one unknown Apify cost from the October staging pilot blocked paid collection on every later night. The guard now checks only the stages of the run being claimed and of the other runs with the same Prague date. An unknown cost tonight still stops tonight's paid work on every project. No row changes: the old reservation keeps its $0.04 and its missing cost, and still counts in its own day's $0.25 total. The per-stage $0.04 and $0.003 reservations and the $0.25 daily ceiling are unchanged.

Like `20261021122330`, the file rewrites only that guard inside the current function body, raises an error if it does not find the guard exactly once, and does nothing on a second run. Replayed only in PGlite (`tests/lib/marketing-dneskai-unresolved-scope-database.test.ts`). The collector code already holds a run only for its own unresolved stages, so it needs no switch; the deployed function keeps the old, stricter guard until the migration is applied. Apply it with the other prepared migrations through [Applying the prepared migrations](#applying-the-prepared-migrations).

### Prepared: story selection v2 (owner decisions 11-13)

`20261022180000_dneskai_relevance_first_selection.sql` replaces `marketing_dneskai_finish` with the body of `20261022160000` and changes only the ranking. The day's events are picked by relevance, and at most one of them may be outside news (`ai-news`, `tech-news`): `tool`, `ai-project` and `marketing` share that one slot, so a weak ai-project item no longer pushes out a strong news story. The 0.85 floor, the 48 h / 30 d windows, grouping, coverage, the limit of four events, member selection and briefs are unchanged. Rank 1 is the most relevant event. It must apply after `20261022160000`; filename order does that.

`20261022180100_dneskai_held_requeue.sql` adds `requeued_at` to `marketing_dneskai_candidates` and the service-only `marketing_dneskai_requeue_held(p_owner, p_run, p_fence)`. Under the run's fence, while the run is running, today in Prague and before its Jev stages are planned, it opens at most 16 reports that Jev held for review (`collection-review-*`) less than 48 hours ago, with text, published within 30 days and never re-queued before, most relevant first. The release rules match `marketing_dneskai_release_candidate`. Jev then reviews them in that night's batches under the existing stage and $0.25 daily limits: at most two extra batches, $0.006. `requeued_at` is never cleared, so a report gets one second chance; a retried tick of the same run re-queues nothing.

Both stay unapplied and were replayed only in PGlite (`tests/lib/marketing-dneskai-selection-v2-database.test.ts`). The selection rule changes as soon as `20261022180000` is applied; no switch gates it. The collector calls `marketing_dneskai_requeue_held`, and the Topic recovery panel explains the relevance-first rule, only with the server-only `DNESKAI_SELECTION_V2_ENABLED=true`; set it after both are applied and redeploy. A missing function while the switch is on leaves the night as it was.

### Prepared: regenerate with a note (owner decision 8)

`20261022190000_dneskai_regenerate_with_note.sql` replaces `marketing_finish_job` with the body of `20261021124706` plus one step. When the finished job's request names `generation.replacesRevisionId`, and that revision is the owner's, of the same brand, still `review` or `returned` and has no claimed, published or uncertain publication, the new revision is saved through `marketing_save_revision` with it as the replaced revision: the old version becomes `superseded` and a queued publication of it is cancelled, as for an owner edit. A version the owner approved meanwhile keeps its approval; the new draft is saved beside it. Without the key the function behaves as before. Nothing here approves; the new revision is ready and in review.

It stays unapplied. The app sends `replacesRevisionId` only from the Lab's „Regenerate with a note“, which the server refuses with `regenerate-unavailable` until `DNESKAI_REGENERATE_ENABLED=true`. Apply it with the other prepared migrations through [Applying the prepared migrations](#applying-the-prepared-migrations), then set the switch and redeploy. Replayed only in PGlite (`tests/lib/marketing-dneskai-regenerate-database.test.ts`).

### Prepared: DNESKAi topics (#150, plan A1)

`20261023100000_dneskai_topics.sql` adds `marketing_dneskai_topics`. A topic (námět) is a working title the owner approves or rejects before the pipeline pays for enrichment, pictures or generation. Each row has a kind (`news`, `education`), a source kind (`feed`, `instagram`, `library`, `manual`) with a source reference unique per owner, the Czech title, an optional summary, an optional one-word keyword in Latin letters, an optional verdict (`fact`, `hype`, `unclear`), evidence as a JSON object, a status (`proposed`, `approved`, `rejected`, `expired`, `enriching`, `briefed`, `generated`), the Prague date it was proposed for, the approval time and an optional brief. The owner reads own rows through RLS and writes nothing directly; the pipeline writes with `service_role`. The project must belong to the row's owner (the collection ownership trigger).

Three security-definer functions, executable by `authenticated` and scoped by `auth.uid()`, carry the owner's actions. `marketing_dneskai_topic_decide` approves a proposed topic, rejects a proposed or approved one, and restores a rejected or expired one to proposed. `marketing_dneskai_topic_edit` changes the title and keyword until enrichment starts. `marketing_dneskai_topic_create` adds a manual topic from an https URL, a title or both; the same URL (or, without one, the same title) cannot be added twice. None of them writes a brief, admits a job or spends money.

It stays unapplied. Scouting, titling and topic briefs propose and consume topics, each behind its own switch. The app reads the table and calls the functions only with the server-only `DNESKAI_TOPICS_ENABLED=true`; without it `GET` and `POST /api/marketing/dneskai/topics` answer 404. Apply it with the other prepared migrations through [Applying the prepared migrations](#applying-the-prepared-migrations), then set the switch and redeploy. Replayed only in PGlite (`tests/lib/marketing-dneskai-topics-database.test.ts`).

### Prepared: topic spend ledger (#152, plan A3)

`20261023100100_dneskai_topic_spend.sql` adds `marketing_private.dneskai_topic_spend` and three service-only functions. `marketing_reserve_dneskai_topic_spend` reserves one paid topic call before it starts: a reel transcript (`transcript`) against its own ceiling (`MARKETING_DNESKAI_TRANSCRIPT_DAILY_USD`, $0.50 by default) and transcript spend of the last 24 hours, or a topic model call (`classify` for FACT or HYPE, `title` for titling) against the $1 DNESKAi generation ceiling and everything generation and topics spent in 24 hours. A refused call reserves nothing. `marketing_settle_dneskai_topic_spend` records the measured cost once. A row counts at its settled cost, or at its reservation while unsettled. The file also replaces `marketing_dneskai_generation_spent` with the body of `20261021124651` plus the topic model calls, so generation jobs and topic calls never pass the ceiling together, and Errors and costs (Chyby a náklady, in the ⋯ menu) shows the combined figure.

It stays unapplied. The app reserves here only with `DNESKAI_FACT_OR_HYPE_ENABLED=true` or `DNESKAI_TITLING_ENABLED=true`; `20261023130300` adds the `tiktok` kind. Apply it with the other prepared migrations through [Applying the prepared migrations](#applying-the-prepared-migrations), then set the switch and redeploy. Replayed only in PGlite (`tests/lib/marketing-dneskai-topic-spend-database.test.ts`).
## DNESKAi sources table, 23 October 2026 (unapplied)

`20261023110000_dneskai_sources_table.sql` (#174) adds `marketing_dneskai_sources`: one row per source the nightly
collection and the scouting step read, with its `source_id` (the id stages, source states and candidates carry), kind,
topic (`news` or `education`), Instagram handle or https URL, name, tier, Prague weekdays, item cap and the enabled
switch. Reads are own-only; the owner writes only through `marketing_dneskai_sources_seed` (the registry file, sent
once while the owner has no row), `marketing_dneskai_source_save` (add, or change everything except the address) and
`marketing_dneskai_source_remove`, all security definer, executable by `authenticated` and scoped by `auth.uid()`.
At most 120 sources per project. When a source was last read, how many items it brought and its last error stay in
`marketing_dneskai_source_states`.

Replayed only in PGlite (`tests/lib/dneskai-sources-database.test.ts`). Apply it with the other prepared files
(`npx supabase db push --linked`). Until `DNESKAI_SOURCES_TABLE_ENABLED=true`, Zdroje shows the registry file
read-only and the pipeline reads the file.

### Prepared: topic briefs (#155, plan A6)

`20261023100200_dneskai_topic_briefs.sql` adds `marketing_dneskai_briefs.topic_id` (unique where set) and replaces the rank check: ranks 1 to 4 stay the night's selection, and only a row with a topic may use 5 to 16. An education topic that came from a collected report gets its own brief row in that report's run, with the report as its one member, so `marketing_dneskai_prepare_brief`, `marketing_dneskai_admit_brief`, the source head, the calendar entry and `marketing_enqueue_job` apply unchanged. A news topic uses the brief row its event already has. A link-library or hand-added topic (#210) has no collected report: the app reads its URL through Jina Reader and stores it as one `owner-link` report in the latest finished run, then takes the education path. No function changes.

It stays unapplied. The app writes topic briefs only with `DNESKAI_TOPIC_BRIEFS_ENABLED=true`; without the switch nothing writes them, and the brief step ignores any row that has a topic. Apply it with the other prepared migrations through [Applying the prepared migrations](#applying-the-prepared-migrations), then set the switch and redeploy. Replayed only in PGlite (`tests/lib/dneskai-topic-bridge-database.test.ts`).


### Prepared: daily mix (#156, plan A7)

`20261023100300_dneskai_daily_mix.sql` adds `marketing_dneskai_daily_mix`, one row per owner and project: `news_per_day` and `education_per_day` (0 to 4, default 1 each) and `slots`, the active publishing times (any of 08:00, 12:30, 17:00 and 20:00, default 08:00 and 17:00). Every post needs its own time (`news_per_day + education_per_day <= cardinality(slots)`). The owner reads, inserts and updates only their own row, and the project must be theirs. No row means the default. The four times stay one list (`DNESKAI_BRIEF_SLOTS`, and the same four in `marketing_dneskai_reslot_brief`); the mix only switches some off.

It stays unapplied. The app reads and writes the row only with `DNESKAI_DAILY_MIX_ENABLED=true`. Apply it with the other prepared migrations through [Applying the prepared migrations](#applying-the-prepared-migrations), then set the switch and redeploy. Replayed only in PGlite (`tests/lib/marketing-dneskai-daily-mix-database.test.ts`).
## DNESKAi comment replies, 23 October 2026 (unapplied)

`20261023120000_dneskai_comment_replies.sql` (#160) prepares the comment watcher. `marketing_instagram_comment_replies` holds one row per keyword comment that got a reply: Instagram's comment id (unique, so a comment never gets a second private reply), the media id, the publication, the matched keyword, the private reply's status (`claimed`, `sent`, `failed`, `uncertain`) and time, the public reply's status and comment id, and an error code. It stores no commenter username, user id or comment text. `marketing_instagram_comment_checks` keeps one row per watched publication: the cursor of an unfinished pass, that pass's counts, the counts of the last finished pass and the last check time. Both are own-read; only `service_role` writes, and a trigger refuses a row whose publication belongs to another owner. `marketing_accounts` gains `engagement_enabled` (off), `engagement_blocked_code` and `engagement_blocked_at`.

Nothing reads these until `DNESKAI_ENGAGEMENT_ENABLED=true`; set it only after the push, because the scheduler, the accounts read and the switch route then query the new columns.

## DNESKAi Reel bucket, 23 October 2026 (unapplied)

`20261023130000_dneskai_reel_bucket.sql` creates the private `marketing-reels` bucket: MP4 only, 64 MiB per file,
with the same owner-prefix read policy and restrictive browser guards as `marketing-assets`. The render route
(`/api/marketing/dneskai/render-reel`, #163) writes one immutable object per reel key under
`<owner>/marketing/dneskai/reels/<reelKey>.mp4` with the service role and hands Instagram a seven-day signed URL.
No table, function or existing policy changes.

Replayed only in PGlite (`tests/lib/dneskai-reel-bucket.test.ts`). Apply it with the CLI like the other prepared
files (`npx supabase db push --linked`); the route answers 404 until `MARKETING_DNESKAI_REELS_ENABLED=true`, and with
the switch on but the bucket missing it answers 503 `reel-bucket-required`.

## DNESKAi audio library, 23 October 2026 (unapplied)

`20261023130100_dneskai_audio_tracks.sql` (#164) adds `marketing_audio_tracks` and the private `marketing-audio`
bucket (20 MiB per file; MP3, M4A/AAC, WAV and Ogg). A row holds the title, artist, source
(`meta-sound-collection`, `pixabay`, `original` or `instagram-library`), the licence note, the page the file came
from, the stored file or the Instagram audio id, the duration, up to five mood tags and the enabled switch. Checks:
a stored track has a file under `marketing-audio/<owner>/<id>.<ext>` and a source URL; an Instagram library track has
an id and no file. The owner reads only their own rows and files; every write goes through
`/api/marketing/dneskai/audio` with the service role. The browser uploads the file to a signed upload URL for one
exact path, then the route checks the stored file before it records the row.

Replayed only in PGlite (`tests/lib/dneskai-audio-database.test.ts`). Apply it with the other prepared files
(`npx supabase db push --linked`). The route and Zdroje → Hudba stay hidden until `MARKETING_DNESKAI_REELS_ENABLED=true`.

## DNESKAi trending audio, 23 October 2026 (unapplied)

`20261023130200_dneskai_audio_trends.sql` (#167) adds `marketing_audio_trends`: one row per owner and Instagram audio
id with title, artist, type (`music` or `original_sound`), length, an https cover thumbnail, the first and last day it
trended, the number of days, and two signals: `niche_count` (how many reels of the tracked education profiles used it) and `tiktok` (the sound also rises on TikTok CZ, set by `DNESKAI_TIKTOK_TRENDS_ENABLED`). Meta's temporary preview link is not
stored. The owner reads only their own rows; the daily tick writes them with the service role. Replayed only in
PGlite (`tests/lib/dneskai-audio-trends-database.test.ts`). Apply it with the other prepared files
(`npx supabase db push --linked`); the daily step and the screens stay off until `DNESKAI_AUDIO_TRENDS_ENABLED=true`.

## TikTok sound chart spend, 23 October 2026 (unapplied)

`20261023130300_dneskai_tiktok_spend.sql` (#167) adds the kind `tiktok` to `marketing_private.dneskai_topic_spend`
(20261023100100) and replaces `marketing_reserve_dneskai_topic_spend` with the same body plus that kind: a chart run is
checked against its own spend under its own lock, like a transcript, so it never takes room from generation or
transcripts. `marketing_dneskai_tiktok_runs` lists the last runs and `marketing_dneskai_tiktok_bind` writes a run's
Apify ids onto its reservation once. All three functions are service-only. It needs `20261023100100` first; filename
order does that. Replayed only in PGlite (`tests/lib/dneskai-tiktok-spend-database.test.ts`). Nothing reserves or
runs until `DNESKAI_TIKTOK_TRENDS_ENABLED=true` and the owner has approved the spend (NEEDED.md).
