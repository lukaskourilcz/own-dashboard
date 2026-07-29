# NEEDED — owner rollout checklist

The repository implementation is complete. The items below are the external account, secret, migration, and rollout steps that still require the repository owner. They are intentionally not performed by application code. This file is also imported into OwnDashboard Tasks; keep the `[imp:N]` and `[owner:me]` markers.

## Required before the restructured app is used in production

- [ ] **Back up Supabase and apply the six pending migrations** with `npx supabase db push --linked`; run `20260721165419_professional_restructure_core.sql`, then `20260721165421_remove_legacy_personal_scope.sql`, `20260722150000_atomic_inbox_routing.sql`, `20260722190000_operational_workflow_extensions.sql`, `20260723065433_daily_focus_synced_preferences.sql`, and `20260723082424_sync_preferences_project_tabs.sql`. The last migration restores authenticated preference grants/RLS, synchronizes project-workspace tab visibility, and makes the daily seven follow active project/repository assignments. Do **not** rerun `supabase/schema.sql` on an existing project. `[imp:5]` `[owner:me]`
- [ ] **Verify the production deployment environment** has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; add `SUPABASE_SERVICE_ROLE_KEY` server-side if Google token refresh, bank sync, or other privileged server workflows are enabled. Never expose the service-role key as `NEXT_PUBLIC_*`. `[imp:5]` `[owner:me]`
- [ ] **Deploy `main`, then run the post-deploy smoke test** in `docs/external-setup.md`: sign in, create and convert an opportunity, open a project workspace, link an invoice/subscription/task, process Inbox, export data, and verify a second account cannot read or link the first account's records. `[imp:4]` `[owner:me]`

## Enable the product capabilities you want

- [ ] **Scheduled jobs:** set a strong `CRON_SECRET` in Vercel and verify the three schedules in `vercel.json` call bank sync at 06:00 UTC, renewal warnings at 07:00 UTC, and jobs scraping at 08:00 UTC. Add `HEARTBEAT_URL` if you want an external success monitor. `[imp:4]` `[owner:me]`
- [ ] **Google Calendar:** enable the Google Calendar API, configure Google in Supabase Auth, add local/production redirect URLs, and set `GOOGLE_OAUTH_CLIENT_ID` plus `GOOGLE_OAUTH_CLIENT_SECRET` for server-side token refresh. `[imp:3]` `[owner:me]`
- [ ] **GitHub project operations:** configure GitHub in Supabase Auth and the OAuth callback. Set `GITHUB_OAUTH_CLIENT_ID` plus `GITHUB_OAUTH_CLIENT_SECRET` if disconnect/revoke and expiring-token refresh are required. Confirm the OAuth grant covers only repositories the app should read or update. `[imp:3]` `[owner:me]`
- [ ] **Vercel Web Analytics on the project Overview:** create a Vercel access token and set `VERCEL_API_TOKEN` (server-side) plus optional `VERCEL_TEAM_ID`, then enable Web Analytics on each Vercel project you want traffic for. The dashboard matches each project by its linked repository and shows visitors/page views on the project Overview card; without the token the card explains it is unconfigured. `[imp:2]` `[owner:me]` `[time:20m]` `[kind:setup]`
- [ ] **Repository knowledge:** add `about-project.md` to every active project repository. Include a short opening summary plus `## Tech stack` and `## Third-party libraries` list sections; write each entry as `Name — what it does`. Use Project → Knowledge → Check current info to verify parsing. `[imp:3]` `[owner:me]`
- [ ] **Renewal email:** verify a Resend sending domain, then set `RESEND_API_KEY` and `RESEND_FROM`. The in-app notification centre works without email. `[imp:3]` `[owner:me]`
- [ ] **Bank sync:** create GoCardless Bank Account Data credentials and set `GOCARDLESS_SECRET_ID` plus `GOCARDLESS_SECRET_KEY`. Test the production callback and transaction deduplication. CSV statement import remains available without this integration. `[imp:3]` `[owner:me]`
- [ ] **Brand-media production:** compare at least three current low-cost or free generators using primary pricing, licensing, privacy, watermark, and format documentation. Select a safe provider, then resume from `docs/design/generated-media-manifest.json`; do not register, purchase, upload private data, or publish unreviewed output without explicit approval. This is a one-off design-production dependency, not a runtime application dependency. `[imp:2]` `[owner:me]`

## Public guest tour and job-offer removal (2026-07-27)

`/guest` renders the real dashboard against the demo fixtures with no session,
and it is what the portfolio now links to. Career gained a source list, and
listings the boards no longer carry are removed on the next check instead of
after 45 days.

- [ ] **Verify /guest in production** — open it signed out, in a private window, and confirm it renders instead of redirecting to `/login`. The middleware exempts the path, but this is the one behaviour the portfolio link depends on. Check `/guest?lang=en` too. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Decide whether /guest should be indexed** — it is currently `index: true`, which suits a page linked from the portfolio. Switch it to `noindex` if you would rather it stay reachable but unlisted. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:decision]`
- [ ] **Watch the first real scrape after the removal change** — open Career → sources and read the removed counts per board. A board removing an implausible share of its listings in one run means its markup changed and the guard did not catch it; the fix is to mark that source incomplete in `src/lib/jobs/meta.ts`. `[imp:4]` `[owner:me]` `[time:30m]` `[kind:deploy]`
- [ ] **Re-check the completeness flags if a board changes its API** — `complete: true` means one request returns the board's whole current set, which is what lets a missing offer be deleted without an HTTP check. If a board adds pagination or a result cap, that flag has to become `false` or live offers will be dropped. `[imp:3]` `[owner:me]` `[time:30m]` `[kind:decision]`
- [ ] **Consider raising the refresh route's time limit** — `maxDuration` is 60s, and the liveness probes for partial sources are bounded to 150 URLs and 15s so they cannot starve the scrape. If the sources list shows removals lagging behind reality, raise the limit rather than loosening the bounds. `[imp:2]` `[owner:me]` `[time:20m]` `[kind:decision]`

## Optional production hardening

- [ ] **Distributed rate limiting:** add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without them, the app uses a best-effort in-memory limiter per server instance. `[imp:2]` `[owner:me]`
- [ ] **Error monitoring:** configure `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and the deployment's Sentry auth token/release integration if desired. Verify captured context contains no private record bodies. `[imp:2]` `[owner:me]`
- [ ] **Privacy-conscious analytics:** configure `NEXT_PUBLIC_POSTHOG_KEY` and optionally `NEXT_PUBLIC_POSTHOG_HOST`. The only repository feature flag currently referenced is `costs-filter`; no Tugedr kill-switch exists. Leave PostHog unset to disable the client SDK. `[imp:2]` `[owner:me]`
- [ ] **Higher link-enrichment throughput:** add `JINA_API_KEY` only if the anonymous Jina Reader allowance is insufficient. `[imp:1]` `[owner:me]`
- [ ] **Cron log ingestion (Home → Crons panel):** set `CRON_REGISTRY_TOKEN` and `DASHBOARD_OWNER_ID` server-side so external GitHub Actions crons can report runs to `POST /api/crons/log`. Then, in each repo with scheduled workflows (currently `aifirst` and `quorum`), add the Actions secrets `OWNDASHBOARD_CRON_URL` (this app's `/api/crons/log` URL) and `OWNDASHBOARD_CRON_TOKEN` (= `CRON_REGISTRY_TOKEN`). The app's own Vercel crons log automatically. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`

## Brand and domain — wait for a confirmed replacement name

- [ ] When a final name is approved, update `src/lib/brand.ts`, then follow the manual rename checklist in `docs/external-setup.md` for Vercel, the domain, Supabase, Google/GitHub OAuth apps, PostHog, Sentry, Resend, cron monitors, and installed PWAs. OwnDashboard remains the deliberate temporary name; do not rename it to Takt. `[imp:1]` `[owner:me]`

## Migration safety note

The cleanup migration first copies Pulse, habits/streaks, books/reading, couples, invitations, and sharing preferences into the own-only `legacy_personal_archives` table, then drops the retired tables and partner-sharing function. After deployment, download the archive from **Settings → Data & export → Legacy** and retain it off-platform if needed. See `docs/migration-guide.md` for verification and rollback order.

## Developer tooling

- [ ] **Install and initialize RTK (`rtk-ai/rtk`)** — RTK could not be set up from the Claude Code web session because its GitHub download host is outside the session's network allowlist (`github.com/rtk-ai/rtk` and its release binaries return HTTP 403). Set it up locally at home with the commands below, then enable it for this repository following `rtk --help` / the RTK docs (the exact per-repo command isn't documented here because the tool wouldn't install in the sandbox). `[imp:2]` `[owner:me]`

```sh
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
rtk init --global
```
