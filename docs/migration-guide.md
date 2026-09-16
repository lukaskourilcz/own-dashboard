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

## Local validation

If Docker is available, run `npx supabase db reset`. Without Docker, execute `supabase/schema.sql` and all migrations against an isolated Postgres database with `ON_ERROR_STOP=1`. Never validate destructive migrations against a personal development database containing irreplaceable rows.
## Freelance directory and proposal tracking — 2026-09-11

Apply `20260911102058_freelance_opportunities.sql`, `20260911103455_freelance_metrics.sql` and `20260911104131_freelance_resources.sql` before deploying the freelance UI. These additive migrations create the owner-scoped platform directory, optional opportunity fields, immutable client-readable transition history, full-cohort metrics RPC and an HTTPS resource-folder link. Existing opportunities and conversion RPCs are preserved. Profile research and account-specific texts are private runtime data and are not migration seeds.

The metrics function uses the authenticated owner and optional platform filter, independently of the bounded opportunity list; actual dates determine submission/reply counts. The trigger has a fixed search path and writes history without granting authenticated clients direct event mutation. Verify a second user sees neither records nor history, cannot attach another owner's platform, and cannot call event-writing functions directly. A rolled-back date/status change should produce one corresponding history event.

Application rollback can deploy the previous version while retaining the additive schema and private drafts; do not drop populated tables merely to roll back the UI.

## Transaction rules — 2026-09-16

Apply `20260916160000_transaction_rules.sql` before deploying the Money rule
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
insert/update policies from `20260916120000_portfolio_works_competition_finance.sql`
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

## Invoice payment matching — 2026-09-17

Apply `20260917090000_invoice_payment_matching.sql` before deploying the
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

## Cron heartbeats — 2026-09-17

Apply `20260917150000_cron_heartbeats.sql` before deploying the heartbeat state
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

## Bank provider abstraction — 2026-09-17

Apply `20260917180000_bank_provider_abstraction.sql` before deploying the
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

## Job application contacts — 2026-09-17

`20260917190000_job_application_contacts.sql` adds `contact_name` and
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
