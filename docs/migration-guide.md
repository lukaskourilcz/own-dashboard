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

Every file from `20260721165419` on carries the version production recorded for it, with one exception: the connector recorded the six kickoff files `20260925090000`–`20260925090500` under the time they were applied, `20260925141127`–`20260925141231`. The 2026-09-16 files were renamed on merge to the versions production recorded (`20260916094243`–`20260916195556`), so they need no repair. Nine rows from 2026-06-07 predate the repository and have no files; `supabase/schema.sql` stands in for them. Against a local copy of that history, `db push --dry-run` names exactly those fifteen versions and stops. After the kickoff rows get their file versions and the nine early rows are removed (backed up first), the dry run lists only the four 2026-09-25 integration migrations, `db push` applies them, and a second dry run reports the database up to date.

Do not re-run a single migration by hand. Most are one-shot: a second run stops at its first bare `create table`, `create policy` or `create function`. The idempotent ones are not safe out of order either. Re-running `20260723082424_sync_preferences_project_tabs.sql` on a current database reinstalls the older `create_daily_focus_set` without the repository-id match from `20260925090000`, and re-running `20260915210805_link_ideas_and_relevance.sql` restores the superseded comment on `ai_links.project_relevance`.

## Local validation

Validate against an isolated Postgres database with `ON_ERROR_STOP=1`, following [Fresh install](#fresh-install). Never validate destructive migrations against a personal development database containing irreplaceable rows, and never against production.

## Freelance directory and proposal tracking — 2026-09-11

Apply `20260911102058_freelance_opportunities.sql`, `20260911103455_freelance_metrics.sql` and `20260911104131_freelance_resources.sql` before deploying the freelance UI. These additive migrations create the owner-scoped platform directory, optional opportunity fields, immutable client-readable transition history, full-cohort metrics RPC and an HTTPS resource-folder link. Existing opportunities and conversion RPCs are preserved. Profile research and account-specific texts are private runtime data and are not migration seeds.

The metrics function uses the authenticated owner and optional platform filter, independently of the bounded opportunity list; actual dates determine submission/reply counts. The trigger has a fixed search path and writes history without granting authenticated clients direct event mutation. Verify a second user sees neither records nor history, cannot attach another owner's platform, and cannot call event-writing functions directly. A rolled-back date/status change should produce one corresponding history event.

Application rollback can deploy the previous version while retaining the additive schema and private drafts; do not drop populated tables merely to roll back the UI.

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
that `GET /api/crons/registry` returns `monitored` as a boolean and never the
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

