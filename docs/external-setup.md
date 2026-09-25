# External setup and production rollout

These steps require the owner's provider accounts, billing access, secrets, or production domain. Repository code intentionally does not perform them. The concise outstanding checklist lives in `NEEDED.md`; this document supplies the implementation details.

## 1. GitHub and deployment baseline

- Keep `main` as the repository's default branch and connect the Vercel production project to it.
- Connect the Vercel project to `main`, add the production domain, and configure environment variables for Production and the Preview environments that should exercise integrations.
- Deploy only after the database migration plan below is ready; the professional shell expects its new tables and columns.

## 2. Supabase database and Auth

1. Back up the intended database or create a recovery point.
2. Link the Supabase CLI to the intended project.
3. Apply migrations in timestamp order:

```bash
npx supabase db push --linked
```

Do not rerun `supabase/schema.sql` on an existing installation and do not run the cleanup migration alone. `20260721165421_remove_legacy_personal_scope.sql` first writes every owner's retired personal records to `legacy_personal_archives`, then removes Pulse, habits, books, couple tables, and partner sharing. `20260722150000_atomic_inbox_routing.sql` adds the own-scoped Inbox transaction boundary; `20260722190000_operational_workflow_extensions.sql` adds subscription classification, project communication history, development URLs, and the VPS agent task queue (unused since `5d32e6b` removed Agents); `20260723065433_daily_focus_synced_preferences.sql` adds GLOBAL tasks, daily focus history, synchronized UI preferences, and durable owner Career deletions; `20260723082424_sync_preferences_project_tabs.sql` restores explicit preference grants/RLS, adds synchronized project-workspace tab visibility, and aligns daily-focus task assignment with active repositories. Later migrations and their checks are listed in `docs/migration-guide.md`, which also covers verification and rollback.

Set these deployment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` server-side when privileged token refresh/provider-sync routes are used

In Supabase Auth:

- Set the production Site URL.
- Allow `http://localhost:3000/auth/callback` for local development and `https://YOUR-DOMAIN/auth/callback` for production.
- Enable only the Google/GitHub providers that will be used.
- After migration, test with two users: user B must not select user A's rows or attach a project/organization relationship to them.

## 3. Google Calendar

1. Enable Google Calendar API in the Google Cloud project.
2. Configure the OAuth consent screen and authorized production domain.
3. Add the Supabase provider callback (`https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`) to the Google OAuth client.
4. Configure the same client ID/secret in Supabase Auth and as server variables `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
5. Confirm the app callback URLs from the Supabase section are allowlisted.
6. Sign in, explicitly link Google from Settings, create an event, verify agenda loading, then disconnect/relink to test refresh-token behavior.

The app requests profile/email plus Calendar access when Google is deliberately linked. It does not store full Calendar event bodies in Postgres.

## 4. GitHub

1. Configure a GitHub OAuth app and add the Supabase provider callback (`https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`).
2. Configure the provider in Supabase Auth.
3. Add `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` if revoke/disconnect and expiring-token refresh should be supported.
4. Grant only the repository access needed for repository discovery, Markdown reads, NEEDED.md synchronization, and confirmed file commits.
5. Link GitHub in Settings, activate a repository as a project, inspect documents, then perform a disposable confirmed Markdown commit.

OwnDashboard does not read GitHub Actions. Known schedules are seeded from `src/lib/project-cron-seeds.ts` when a project is linked to its repository; the app never triggers workflows or edits workflow cron files.

## 5. Link enrichment

- The AI-links Auto-fill route uses Jina Reader (https://r.jina.ai) with no key by default.
- Add `JINA_API_KEY` only when higher link-reader throughput is needed.
- Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for rate limiting shared across serverless instances.

## 6. Tax registries (ARES and VIES)

- Both are credential-free public government services. There is no account, no API key and no environment variable to set; the feature works as soon as the migration is applied.
- `/api/registry/ares` reads `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}`. `/api/registry/vies` posts to `https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`.
- Both routes reject cross-origin requests, require a signed-in user, and are rate-limited to 20 requests per minute per user. They read only — the organization row is written by the browser under own-only RLS.
- The only data that leaves the deployment is the registration number or VAT number being checked. No owner record, note, invoice or personal detail is sent.
- VIES forwards each question to the member state that issued the number, and those national services go down routinely. An outage answers `status: "unavailable"`, which is shown to the user and never overwrites a verdict that still stands for the same number.
- Run `supabase/migrations/20260916125652_organization_registry_verification.sql` before using the feature; until then the new organization columns do not exist.

## 7. Scheduled jobs, email, and bank sync

Set a strong `CRON_SECRET`. Vercel's `vercel.json` contains:

- `/api/cron/bank-sync` at 06:00 UTC daily
- `/api/cron/payment-match` at 06:30 UTC daily
- `/api/cron/renewal-warnings` at 07:00 UTC daily

Job boards are no longer scraped on a schedule. Career refreshes them only when the owner presses **Check for new offers**; `/api/cron/jobs-scrape` remains for an authenticated manual run.

`payment-match` runs half an hour after the bank sync so it sees that morning's
payments. It is deliberately scheduled daily rather than hourly: Vercel Hobby
runs a cron at most once a day, and this file already declares more jobs than
that plan allows. The matcher itself has no cadence of its own — it is
idempotent and safe to run as often as the plan permits, so on a paid plan
change the schedule to `0 * * * *` and nothing else has to change. Until then,
"Match now" on the Money child routes runs the same check on demand.

Run `supabase/migrations/20260916125718_invoice_payment_matching.sql` before the
first run; until then `transactions.variable_symbol`, `matched_at` and
`match_source` do not exist and every matching write fails.

### Bank providers

Bank sync is provider-agnostic. `src/lib/bank/registry.ts` holds one adapter per
provider and every route asks the registry, so configuring one provider is
enough and none of them is required — CSV statement import works with all three
unset.

Run `supabase/migrations/20260916141837_bank_provider_abstraction.sql` first.
Until it runs, `bank_connections.provider_ref`, `consent_expires_at`,
`last_error` and `sync_cursor` do not exist and neither does
`bank_provider_credentials`, so every connection write fails.

**GoCardless Bank Account Data** — set `GOCARDLESS_SECRET_ID` and
`GOCARDLESS_SECRET_KEY`, then connect a bank from Finances. GoCardless has
closed Bank Account Data to new signups, so this path only works for an account
that already exists.

**Fio banka** — no environment variable. In Fio internet banking create an API
token limited to reading one account, then paste it into Finances → Connect bank
→ Fio banka. It is stored in `bank_provider_credentials`, which is service-role
only, and is never returned to the browser. Fio rejects a second call on the
same token within 30 seconds, so one sync makes one upstream request. A Fio
token does not expire; revoke it in internet banking when you are done with it.

**Enable Banking** — register an application at enablebanking.com, generate an
RSA key pair, upload the public key, and set the issued application id as
`ENABLE_BANKING_APPLICATION_ID` with the private key as
`ENABLE_BANKING_PRIVATE_KEY`. The adapter is registered and signs the RS256
assertion their API expects, but its request flow has not been executed against
a real application, so it reports itself as not set up and every data call fails
with a typed error rather than guessing at an endpoint. Finish and verify that
flow before relying on it.

### Renewing a bank consent

A PSD2 consent lasts 90 days. The connection row stores `consent_expires_at`
whenever the provider states one, the bank card shows the date beside the status,
and the daily cron marks a connection expired the morning the date passes rather
than waiting for a sync to fail. Reconnecting the bank from Finances is what
renews it; a Fio token has no expiry and shows no date.

Every `/api/cron/*` route answers 403 until `CRON_SECRET` is set, Vercel's own scheduled calls included, so no bank pull, matching run or renewal email happens without it and no anonymous caller can start one. After setting it, confirm in the Vercel cron log that the scheduled calls return 200. `/api/crons/registry` and `/api/crons/log` answer 503 until `CRON_REGISTRY_TOKEN` is set and 403 to any other `Authorization: Bearer` token; the log also needs `DASHBOARD_OWNER_ID`. Nothing calls either today, so leave the token unset until a consumer or a reporter exists. `DASHBOARD_OWNER_ID` also attributes the app's own cron runs in `cron_runs`.

### Heartbeat monitoring

A cron that stops being invoked reports nothing, so nothing in this app can
notice on its own. Each job therefore pushes to an external monitor after a
successful run, and the monitor's missed-ping alert is what makes the silence
visible.

Set the push URL per job — `HEARTBEAT_URL_BANK_SYNC`,
`HEARTBEAT_URL_PAYMENT_MATCH`, `HEARTBEAT_URL_RENEWAL_WARNINGS`,
`HEARTBEAT_URL_JOBS_SCRAPE` — or set the shared `HEARTBEAT_URL` for all of them.
Every variable is optional; unset means that job is unmonitored, and nothing is
pinged. A failed run never pings, which is the whole point.

Project crons carry their own push URL in the cron form (Projects → a project →
Crons → Heartbeat URL). The server stamps `last_success_at` and pings that URL
when a run reports success through `/api/crons/log` with a `cron_id`, or with an
`endpoint` matching the cron's own. The cron row then shows On time, Late or Not
reporting beside its cost, derived from its schedule — that part works with no
external service at all.

[Uptime Kuma](https://github.com/louislam/uptime-kuma) (self-hosted, MIT) is the
reference monitor:

1. Run it on the VPS behind TLS and create the admin account.
2. Add one **Push** monitor per job, set its heartbeat interval to the job's
   schedule, and copy the generated push URL into the matching environment
   variable or cron field.
3. Add a **Webhook** notification pointing at
   `https://YOUR-DOMAIN/api/webhooks/uptime-kuma`, put
   `{"Authorization": "Bearer <UPTIME_KUMA_WEBHOOK_TOKEN>"}` in its additional
   headers, and attach it to those monitors. The route reads the token from
   that header only and refuses a `?token=` query string, which request logs
   would keep.
4. Set `UPTIME_KUMA_WEBHOOK_TOKEN` and `DASHBOARD_OWNER_ID` in the deployment.
   Without both, the route answers 503 and records nothing.

A down event then opens one notification per monitor in the Inbox action centre
and logs a failed run in the Home cron monitor; a recovery dismisses that open
alert and posts one recovery notice. Confirm the payload against your own
instance after the first alert: the receiver reads `monitor.name`,
`monitor.id` and `heartbeat.status`, ignores anything else, and answers 200 to a
body it cannot use so Kuma does not retry.

For email, verify a Resend domain and set:

- `RESEND_API_KEY`
- `RESEND_FROM` (for example `OwnDashboard <notifications@your-domain.example>`)

For GoCardless Bank Account Data, set `GOCARDLESS_SECRET_ID` and `GOCARDLESS_SECRET_KEY`, connect a bank, confirm the callback at `https://YOUR-DOMAIN/api/bank/callback`, run two syncs, and verify external transaction IDs prevent duplicates. Do not assume a universal free price; check the owner's GoCardless agreement. CSV import remains the offline fallback.

## 8. Analytics and monitoring

PostHog is disabled when `NEXT_PUBLIC_POSTHOG_KEY` is absent. If enabled, set the host for the correct region, verify sensitive values are not captured, and configure a billing limit. No code reads a PostHog feature flag, and there is no Tugedr feature-flag kill-switch in this repository.

Vercel Web Analytics on a project's Overview needs a server-only `VERCEL_API_TOKEN`, plus `VERCEL_TEAM_ID` when the Vercel projects belong to a team, and Web Analytics enabled on each Vercel project. The card finds a Vercel project by its linked repository and says when the token is missing.

Sentry is optional. Configure `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and a build-time `SENTRY_AUTH_TOKEN` when source-map upload is desired. Keep `sendDefaultPii` disabled and inspect real events for private record content before broad use.

## 9. Post-deploy smoke test

1. Sign in and confirm Home loads without fetching unrelated Career/transaction tables; navigate between sections and confirm destination data loads.
2. Create an organization and a Tugedr opportunity, convert it with confirmation, and open `/projects/[slug]`. Fill the organization from ARES with a real IČO, check its VAT number against VIES, and confirm the verdict and its date appear on the organization and on the invoice buyer block.
3. Link a task, subscription, transaction, professional date, prompt, note, and invoice to the project; add a communication entry and verify every record appears only in the selected workspace. Verify separate production and development links open the intended destinations.
4. Open Career and confirm nothing loads until **Check for new offers** is pressed; then compare the Match/Remote/Location columns and exercise each sort option without changing source records. Repeat the press check on Opportunities.
5. Open Subscriptions and Money; confirm every active subscription has a next-payment date/countdown, comparable services share an operational group, and importance is visible.
6. Open `/inbox` by URL (it is hidden from navigation) and route, snooze, and dismiss Inbox/notification items.
7. Open `/projects/aifirst` and confirm it redirects to `/projects/dneskai`; add a library link to a project and a tool with a project note, and copy a prompt with that project.
8. Create a Czech invoice, verify totals/QR/print output, and test deterministic PDF import review.
9. Download full, financial, professional, knowledge, and legacy exports; retain the legacy archive off-platform if needed.
10. Exercise each enabled integration's connect, error, disconnect, and reauthorization state.
11. Sign in as a second user and verify cross-user reads and relationship writes fail, including project links, prompt links and tools.

## 10. Future brand, domain, and repository rename

OwnDashboard remains the temporary confirmed name. When a replacement name is approved, update `src/lib/brand.ts` first, then:

- Rename the Vercel project and attach the new domain; keep the old domain redirecting during transition.
- Update Supabase Site URL and Auth redirect allowlist. Change only the Supabase display name unless a project migration is deliberately planned.
- Update Google/GitHub OAuth application names, homepages, consent-screen domains, origins, and callback URLs.
- If the GitHub repository is renamed, update local `origin`, Vercel linkage, badges, repository allowlists, and Actions secrets.
- Update PostHog configured domains, Sentry project/environment/release configuration, and the Resend sender/domain/templates.
- Update external cron consumers and heartbeat monitors without changing their secret contract.
- Ask installed-PWA users to reinstall/refresh after deployment so the new manifest name and icons replace cached metadata.

Do not rename the product to Takt; that name was explicitly rejected.

### Renaming a project repository

Projects are matched to GitHub by the numeric repository id (`projects.repo_id`), which survives a rename. Before renaming a repository on GitHub:

1. Apply `20260925090000_project_repository_identity.sql`.
2. Fill `repo_id` for existing projects. Either open Projects once while GitHub is connected (the auto-sync writes the id for every project whose repository is in the active list), or run the backfill with your own token:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… GITHUB_TOKEN=… DASHBOARD_OWNER_ID=… \
     node scripts/backfill-project-repo-ids.mjs          # dry run
   node scripts/backfill-project-repo-ids.mjs --apply    # same variables, writes
   ```

3. Rename the repository on GitHub, then update the local `origin` remote, the Vercel Git link and any Actions secrets that name the repository.
4. Open Projects. The auto-sync finds the repository by id, writes the new `repo_full_name` and appends the old one to `previous_repo_full_names`. Tasks imported under the old name, crons, costs and communications stay on the same project; no second project is created. If the id was never stored, the sync looks the old name up on GitHub (which redirects renamed repositories) before it would create anything.

The project's display name and slug do not follow the repository name; change them in the project form. Cron seeds are keyed by slug, so a repository rename never loses them.
