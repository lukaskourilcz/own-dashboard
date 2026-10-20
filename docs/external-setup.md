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

## 7. Existing finance connections

The owner keeps the current Finance features and existing connections. There is no pending bank-provider, business-data, email-renewal, VPS-monitoring or usage-API rollout. CSV imports, invoices, payment matching and manual subscription allocations remain available.

Existing configured bank connections retain their sync and revoke controls. A connection that expires must be renewed through its existing provider only if the owner still uses it. Unconfigured providers are omitted from setup controls; do not add credentials or start a provider signup as maintenance work.

The existing cron routes remain guarded by their server secrets. Do not enable new scheduled integrations to satisfy old checklist entries. Heartbeat URLs are optional references for installations that already use monitoring.

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

## 11. Instagram publishing for @dneskai (#121)

The code connects one Instagram professional account through the Instagram API with Instagram Login (host `graph.instagram.com`). The owner creates the account, the app and the token; nothing in this repository registers, buys or publishes. Publishing stays off throughout this setup: `MARKETING_PUBLISH_ENABLED`, `MARKETING_DNESKAI_PUBLISH_ENABLED` and the account's `enabled` column remain false until the pilot (#123).

1. **Professional account.** In Instagram, switch `@dneskai` to a Business or Creator account. A personal account cannot publish through the API; verification refuses it with `professional-account-required`.
2. **Meta app in Development mode.** In developers.facebook.com, use a Business-type app with the Instagram use case and *API setup with Instagram login*. Leave the app in Development mode. In that mode the app may publish to accounts that hold a role on it, so App Review is not needed for the owner's own account.
3. **App role.** Add `@dneskai` as an Instagram tester under App roles and accept the invitation in the Instagram app. Without a role the token cannot publish.
4. **Scopes.** Request exactly `instagram_business_basic` and `instagram_business_content_publish`. Do not add messaging, comments, insights or ads permissions.
5. **Long-lived token.** Generate the token for `@dneskai` in the Instagram login API setup. It is a long-lived Instagram User token valid for 60 days. A short-lived OAuth token must first be exchanged with `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`, which needs the app secret; do that on your own machine and never paste the secret or the token into the repository, an issue or a chat.
6. **Expiry and scopes.** Open the token in Meta's Access Token Debugger and copy its expiry and granted scopes. Instagram Login has no API that lists a token's permissions (`debug_token` belongs to Facebook Login and needs an app token), so the server takes the scopes from `MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES`. Record only what the debugger shows.
7. **Production environment** (Vercel, Production, marked Sensitive):

   | Name | Value |
   |---|---|
   | `MARKETING_OWNER_ID` | The owner's Supabase Auth user UUID. The verify route refuses every other signed-in user. |
   | `MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN` | The long-lived token from step 5. It is the bootstrap value only. |
   | `MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE` | `instagram` |
   | `MARKETING_DNESKAI_INSTAGRAM_API_VERSION` | The Graph API version you confirmed for the app. Meta's Instagram reference examples used `v26.0` on 20 October 2026. |
   | `MARKETING_DNESKAI_INSTAGRAM_API_VERSION_VERIFIED_AT` | ISO date and time when you checked that version. |
   | `MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT` | ISO expiry from the debugger, for example `2026-12-19T10:00:00Z`. |
   | `MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES` | `instagram_business_basic,instagram_business_content_publish` |
   | `MARKETING_DNESKAI_INSTAGRAM_HANDLE` | Optional. Set it only when the handle is not `dneskai`; verification refuses any other account. |
   | `MARKETING_APPROVED_ASSET_HOSTS` | The Supabase Storage host of the production project, `<project-ref>.supabase.co`. Meta downloads the signed JPEG URLs from it. |

8. **Database.** Apply `supabase/migrations/20261020110000_marketing_account_tokens.sql` before the code that uses it is deployed. It adds `marketing_account_tokens`, which no API role can read directly; only service-role functions read or write the token, and the owner sees expiry, refresh time and scopes. Without the migration, every publish and reconciliation holds with `credential-store-unavailable` and the panel shows the account as unavailable.
9. **Verify.** After the deploy, open the DNESKAi project, tab **Sources**, panel **Instagram account**, and press **Verify account**. The server reads `GET /<version>/me?fields=user_id,username,account_type` with the bootstrap token (or a stored token that expires later) and stores the professional `user_id`, the handle and the token. The expected result is *Verified*, *Publishing disabled* and a valid token with its expiry date. Verification allows five attempts per ten minutes.

### Token lifetime

- The stored token wins while it is unexpired. The environment token is used only when nothing valid is stored. When neither is valid, publishing holds with `access-token-expired` or `access-token-missing` before any request to Meta.
- `refreshInstagramToken` exchanges a token that is at least 24 hours old and still valid through `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` and stores the new 60-day token. The pg_cron ticker (#120) calls it once fewer than ten days remain. A failed or ambiguous refresh is reported and not retried, and the old token stays in place.
- The panel warns when fewer than ten days remain and when the token has expired. If no automatic refresh has run by then, generate a new token, replace the environment value and verify again.
- Verification reads `/me` with whichever valid token expires later: the stored one after a refresh, or a newly installed environment token. So verifying still works after the environment token's own 60 days have passed, and an older environment token never replaces a newer stored token. Verifying a different account (another `user_id` or handle) replaces the token and sets `enabled=false`. Re-verifying the same account keeps its current `enabled` value.
