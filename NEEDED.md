# NEEDED — owner rollout checklist

The repository implementation is complete. The items below are the external account, secret, migration, and rollout steps that still require the repository owner. They are intentionally not performed by application code. This file is also imported into OwnDashboard Tasks; keep the `[imp:N]` and `[owner:me]` markers.

## Required before the restructured app is used in production

- [ ] **Back up Supabase and apply the five pending migrations** with `npx supabase db push --linked`; run `20260721165419_professional_restructure_core.sql`, then `20260721165421_remove_legacy_personal_scope.sql`, `20260722150000_atomic_inbox_routing.sql`, `20260722190000_operational_workflow_extensions.sql`, and `20260723065433_daily_focus_synced_preferences.sql`. Do **not** rerun `supabase/schema.sql` on an existing project. `[imp:5]` `[owner:me]`
- [ ] **Verify the production deployment environment** has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; add `SUPABASE_SERVICE_ROLE_KEY` server-side if Google token refresh, bank sync, or other privileged server workflows are enabled. Never expose the service-role key as `NEXT_PUBLIC_*`. `[imp:5]` `[owner:me]`
- [ ] **Deploy `main`, then run the post-deploy smoke test** in `docs/external-setup.md`: sign in, create and convert an opportunity, open a project workspace, link an invoice/subscription/task, process Inbox, export data, and verify a second account cannot read or link the first account's records. `[imp:4]` `[owner:me]`

## Enable the product capabilities you want

- [ ] **Contextual AI:** set `ANTHROPIC_API_KEY`. Optionally set `ANTHROPIC_BASE_URL` and the three centralized model overrides (`AI_INTENT_MODEL`, `AI_ENRICHMENT_MODEL`, `AI_SYNTHESIS_MODEL`). Without a key, deterministic `!todo`, `!inbox`, and `!cal` capture still works, but AI routing, search, briefs, copilots, enrichment, and knowledge review do not. `[imp:4]` `[owner:me]`
- [ ] **Scheduled jobs:** set a strong `CRON_SECRET` in Vercel and verify the three schedules in `vercel.json` call bank sync at 06:00 UTC, renewal warnings at 07:00 UTC, and jobs scraping at 08:00 UTC. Add `HEARTBEAT_URL` if you want an external success monitor. `[imp:4]` `[owner:me]`
- [ ] **Google Calendar:** enable the Google Calendar API, configure Google in Supabase Auth, add local/production redirect URLs, and set `GOOGLE_OAUTH_CLIENT_ID` plus `GOOGLE_OAUTH_CLIENT_SECRET` for server-side token refresh. `[imp:3]` `[owner:me]`
- [ ] **GitHub project operations:** configure GitHub in Supabase Auth and the OAuth callback. Set `GITHUB_OAUTH_CLIENT_ID` plus `GITHUB_OAUTH_CLIENT_SECRET` if disconnect/revoke and expiring-token refresh are required. Confirm the OAuth grant covers only repositories the app should read or update. `[imp:3]` `[owner:me]`
- [ ] **Repository knowledge:** add `about-project.md` to every active project repository. Include a short opening summary plus `## Tech stack` and `## Third-party libraries` list sections; write each entry as `Name — what it does`. Use Project → Knowledge → Check current info to verify parsing. `[imp:3]` `[owner:me]`
- [ ] **Renewal email:** verify a Resend sending domain, then set `RESEND_API_KEY` and `RESEND_FROM`. The in-app notification centre works without email. `[imp:3]` `[owner:me]`
- [ ] **Bank sync:** create GoCardless Bank Account Data credentials and set `GOCARDLESS_SECRET_ID` plus `GOCARDLESS_SECRET_KEY`. Test the production callback and transaction deduplication. CSV statement import remains available without this integration. `[imp:3]` `[owner:me]`
- [ ] **VPS agents:** set a long random `AGENT_RUNNER_TOKEN` and the owner's Supabase UUID as `DASHBOARD_OWNER_ID` in the deployed server environment and in the trusted VPS worker. Test claim/report with a disposable task before delegating real work; never expose the token to browser code or logs. `[imp:4]` `[owner:me]`
- [ ] **Brand-media production:** compare at least three current low-cost or free generators using primary pricing, licensing, privacy, watermark, and format documentation. Select a safe provider, then resume from `docs/design/generated-media-manifest.json`; do not register, purchase, upload private data, or publish unreviewed output without explicit approval. This is a one-off design-production dependency, not a runtime application dependency. `[imp:2]` `[owner:me]`

## Optional production hardening

- [ ] **Distributed AI rate limiting:** add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without them, the app uses a best-effort in-memory limiter per server instance. `[imp:2]` `[owner:me]`
- [ ] **Error monitoring:** configure `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and the deployment's Sentry auth token/release integration if desired. Verify captured context contains no private record bodies. `[imp:2]` `[owner:me]`
- [ ] **Privacy-conscious analytics:** configure `NEXT_PUBLIC_POSTHOG_KEY` and optionally `NEXT_PUBLIC_POSTHOG_HOST`. The only repository feature flag currently referenced is `costs-filter`; no Tugedr kill-switch exists. Leave PostHog unset to disable the client SDK. `[imp:2]` `[owner:me]`
- [ ] **Higher link-enrichment throughput:** add `JINA_API_KEY` only if the anonymous Jina Reader allowance is insufficient. `FIRECRAWL_API_KEY` is not used by this repository. `[imp:1]` `[owner:me]`
- [ ] **Cron registry ingestion:** set `CRON_REGISTRY_TOKEN` only if an external system writes to the cron registry endpoint. `[imp:1]` `[owner:me]`

## Brand and domain — wait for a confirmed replacement name

- [ ] When a final name is approved, update `src/lib/brand.ts`, then follow the manual rename checklist in `docs/external-setup.md` for Vercel, the domain, Supabase, Google/GitHub OAuth apps, PostHog, Sentry, Resend, cron monitors, and installed PWAs. OwnDashboard remains the deliberate temporary name; do not rename it to Takt. `[imp:1]` `[owner:me]`

## Migration safety note

The cleanup migration first copies Pulse, habits/streaks, books/reading, couples, invitations, and sharing preferences into the own-only `legacy_personal_archives` table, then drops the retired tables and partner-sharing function. After deployment, download the archive from **Settings → Data & export → Legacy** and retain it off-platform if needed. See `docs/migration-guide.md` for verification and rollback order.
