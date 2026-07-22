# External setup and production rollout

These steps require the owner's provider accounts, billing access, secrets, or production domain. Repository code intentionally does not perform them. The concise outstanding checklist lives in `NEEDED.md`; this document supplies the implementation details.

## 1. GitHub and deployment baseline

- Set `main` as the repository's default branch. It currently still points to `claude/personal-dashboard-app-O4De1`.
- Connect the Vercel project to `main`, add the production domain, and configure environment variables for Production and the Preview environments that should exercise integrations.
- Deploy only after the database migration plan below is ready; the professional shell expects its new tables and columns.

## 2. Supabase database and Auth

1. Back up the intended database or create a recovery point.
2. Link the Supabase CLI to the intended project.
3. Apply migrations in timestamp order:

```bash
npx supabase db push --linked
```

Do not rerun `supabase/schema.sql` on an existing installation and do not run the cleanup migration alone. `20260721165421_remove_legacy_personal_scope.sql` first writes every owner's retired personal records to `legacy_personal_archives`, then removes Pulse, habits, books, couple tables, and partner sharing. `20260722150000_atomic_inbox_routing.sql` then adds the own-scoped transaction boundary used by Inbox processing. Follow `docs/migration-guide.md` for verification and rollback.

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

OwnDashboard reads GitHub Actions schedule metadata where available. It does not trigger workflows or edit workflow cron files.

## 5. Contextual AI and enrichment

- Set `ANTHROPIC_API_KEY`.
- Leave `ANTHROPIC_BASE_URL` unset for the official Anthropic API, or set it only for a verified compatible gateway.
- Keep the defaults in `.env.example` or explicitly set `AI_INTENT_MODEL`, `AI_ENRICHMENT_MODEL`, and `AI_SYNTHESIS_MODEL` to supported model IDs.
- Add `JINA_API_KEY` only when higher link-reader throughput is needed.
- Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for rate limiting shared across serverless instances.
- Configure provider spend limits and review provider retention terms before enabling sensitive AI context.

`FIRECRAWL_API_KEY` is not read by the repository. Without Anthropic, deterministic `!todo`, `!inbox`, and `!cal` quick capture remains available, while AI search, briefs, copilots, enrichment, and knowledge review remain unavailable.

## 6. Scheduled jobs, email, and bank sync

Set a strong `CRON_SECRET`. Vercel's `vercel.json` contains:

- `/api/cron/bank-sync` at 06:00 UTC daily
- `/api/cron/renewal-warnings` at 07:00 UTC daily
- `/api/cron/jobs-scrape` at 08:00 UTC daily

Verify the deployment sends the expected Bearer authorization. Add `HEARTBEAT_URL` for renewal-job success pings. `CRON_REGISTRY_TOKEN` is needed only if an external system writes registry metadata.

For email, verify a Resend domain and set:

- `RESEND_API_KEY`
- `RESEND_FROM` (for example `OwnDashboard <notifications@your-domain.example>`)

For GoCardless Bank Account Data, set `GOCARDLESS_SECRET_ID` and `GOCARDLESS_SECRET_KEY`, connect a bank, confirm the callback at `https://YOUR-DOMAIN/api/bank/callback`, run two syncs, and verify external transaction IDs prevent duplicates. Do not assume a universal free price; check the owner's GoCardless agreement. CSV import remains the offline fallback.

## 7. Analytics and monitoring

PostHog is disabled when `NEXT_PUBLIC_POSTHOG_KEY` is absent. If enabled, set the host for the correct region, verify sensitive values are not captured, configure a billing limit, and test the currently referenced `costs-filter` feature flag. There is no Tugedr feature-flag kill-switch in this repository.

Sentry is optional. Configure `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and a build-time `SENTRY_AUTH_TOKEN` when source-map upload is desired. Keep `sendDefaultPii` disabled and inspect real events for private record content before broad use.

## 8. Post-deploy smoke test

1. Sign in and confirm Home loads without fetching unrelated Career/transaction tables; navigate between sections and confirm destination data loads.
2. Create an organization and a Tugedr opportunity, convert it with confirmation, and open `/projects/[slug]`.
3. Link a task, subscription, transaction, professional date, prompt, note, and invoice to the project; verify they appear in the relevant workspace tabs.
4. Route, snooze, and dismiss Inbox/notification items.
5. Generate a weekly brief/project copilot result, verify sources and proposals, and confirm nothing is written until a separate action.
6. Create a Czech invoice, verify totals/QR/print output, and test deterministic PDF import review.
7. Download full, financial, professional, knowledge, and legacy exports; retain the legacy archive off-platform if needed.
8. Exercise each enabled integration's connect, error, disconnect, and reauthorization state.
9. Sign in as a second user and verify cross-user reads and relationship writes fail.

## 9. Future brand, domain, and repository rename

OwnDashboard remains the temporary confirmed name. When a replacement name is approved, update `src/lib/brand.ts` first, then:

- Rename the Vercel project and attach the new domain; keep the old domain redirecting during transition.
- Update Supabase Site URL and Auth redirect allowlist. Change only the Supabase display name unless a project migration is deliberately planned.
- Update Google/GitHub OAuth application names, homepages, consent-screen domains, origins, and callback URLs.
- If the GitHub repository is renamed, update local `origin`, Vercel linkage, badges, repository allowlists, and Actions secrets.
- Update PostHog configured domains, Sentry project/environment/release configuration, and the Resend sender/domain/templates.
- Update external cron consumers and heartbeat monitors without changing their secret contract.
- Ask installed-PWA users to reinstall/refresh after deployment so the new manifest name and icons replace cached metadata.

Do not rename the product to Takt; that name was explicitly rejected.
