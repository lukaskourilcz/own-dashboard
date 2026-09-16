# NEEDED — owner rollout checklist

The repository implementation is complete. The items below are the external account, secret, migration, and rollout steps that still require the repository owner. They are intentionally not performed by application code. This file is also imported into OwnDashboard Tasks; keep the `[imp:N]` and `[owner:me]` markers.

## Required before the restructured app is used in production

- [ ] **Verify the production deployment environment** has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; add `SUPABASE_SERVICE_ROLE_KEY` server-side if Google token refresh, bank sync, or other privileged server workflows are enabled. Never expose the service-role key as `NEXT_PUBLIC_*`. `[imp:5]` `[owner:me]`
- [ ] **Deploy `main`, then run the post-deploy smoke test** in `docs/external-setup.md`: sign in, create and convert an opportunity, open a project workspace, link an invoice/subscription/task, process Inbox, export data, and verify a second account cannot read or link the first account's records. `[imp:4]` `[owner:me]`

## Enable the product capabilities you want

- [ ] **Scheduled jobs:** set a strong `CRON_SECRET` in Vercel and verify the three schedules in `vercel.json` call bank sync at 06:00 UTC, renewal warnings at 07:00 UTC, and jobs scraping at 08:00 UTC. Add `HEARTBEAT_URL` if you want an external success monitor. `[imp:4]` `[owner:me]`
- [ ] **Cron heartbeats:** run `supabase/migrations/20260917150000_cron_heartbeats.sql`, install Uptime Kuma on the VPS behind TLS, create one push monitor per job, and paste each push URL into the matching `HEARTBEAT_URL_*` variable or the cron's Heartbeat URL field. Then add a Kuma webhook notification to `/api/webhooks/uptime-kuma` with a generated `UPTIME_KUMA_WEBHOOK_TOKEN` (set in both places) and confirm `DASHBOARD_OWNER_ID` is set, or the receiver answers 503. Until the URLs exist every cron reads Unmonitored, which is honest and inert. `[imp:3]` `[owner:me]` `[time:60m]` `[kind:setup]`
- [ ] **Confirm the Uptime Kuma webhook body** against your own instance after the first alert — the receiver reads `monitor.name`, `monitor.id` and `heartbeat.status` and was written from the documented shape, not from a live call. If a down event does not create a notification, paste the real body into the issue and the parser is a one-line fix. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`
- [ ] **Google Calendar:** enable the Google Calendar API, configure Google in Supabase Auth, add local/production redirect URLs, and set `GOOGLE_OAUTH_CLIENT_ID` plus `GOOGLE_OAUTH_CLIENT_SECRET` for server-side token refresh. `[imp:3]` `[owner:me]`
- [ ] **GitHub project operations:** configure GitHub in Supabase Auth and the OAuth callback. Set `GITHUB_OAUTH_CLIENT_ID` plus `GITHUB_OAUTH_CLIENT_SECRET` if disconnect/revoke and expiring-token refresh are required. Confirm the OAuth grant covers only repositories the app should read or update. `[imp:3]` `[owner:me]`
- [ ] **Vercel Web Analytics on the project Overview:** create a Vercel access token and set `VERCEL_API_TOKEN` (server-side) plus optional `VERCEL_TEAM_ID`, then enable Web Analytics on each Vercel project you want traffic for. The dashboard matches each project by its linked repository and shows visitors/page views on the project Overview card; without the token the card explains it is unconfigured. `[imp:2]` `[owner:me]` `[time:20m]` `[kind:setup]`
- [ ] **Repository knowledge:** add `about-project.md` to every active project repository. Include a short opening summary plus `## Tech stack` and `## Third-party libraries` list sections; write each entry as `Name — what it does`. Use Project → Knowledge → Check current info to verify parsing. `[imp:3]` `[owner:me]`
- [ ] **Renewal email:** verify a Resend sending domain, then set `RESEND_API_KEY` and `RESEND_FROM`. The in-app notification centre works without email. `[imp:3]` `[owner:me]`
- [ ] **Apply the bank provider migration** — run `supabase/migrations/20260917180000_bank_provider_abstraction.sql` against the linked Supabase project. Until it runs, connecting a bank, storing a Fio token and every sync write fail on a missing column or table. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Decide which bank provider you actually depend on** — GoCardless Bank Account Data is closed to new signups, so it only works if your credentials already exist. Fio's token API costs nothing and covers a Fio account; Enable Banking covers most Czech banks on a free restricted-production tier for your own accounts. Pick one before the current consent lapses. `[imp:4]` `[owner:me]` `[time:30m]` `[kind:decision]`
- [ ] **Bank sync via GoCardless:** if your Bank Account Data credentials already exist, set `GOCARDLESS_SECRET_ID` plus `GOCARDLESS_SECRET_KEY` and re-test the production callback and transaction deduplication. CSV statement import remains available without this integration. `[imp:3]` `[owner:me]` `[kind:setup]`
- [ ] **Bank sync via Fio:** create a read-only API token in Fio internet banking and paste it into Finances → Connect bank → Fio banka. Then run one sync and check the imported rows against the statement — the parser was written from Fio's published column table and fixtures, never from a live response. `[imp:3]` `[owner:me]` `[time:30m]` `[kind:setup]`
- [ ] **Bank sync via Enable Banking:** register an application, generate an RSA key pair, upload the public key, and set `ENABLE_BANKING_APPLICATION_ID` plus `ENABLE_BANKING_PRIVATE_KEY`. The adapter signs the assertion their API expects but its request flow has never been executed, so it refuses every data call until someone verifies it against a real application. `[imp:2]` `[owner:me]` `[time:60m]` `[kind:setup]`
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

## Portfolio, Works, Competition and development finance (2026-09-16)

The migration was applied to the linked project and the owner's live data was loaded from Gmail receipts and the research run. What still needs the owner:

- [ ] **Check the subscription allocations** in Subscriptions — Vercel is split equally across the eight deployed repositories, Supabase across the four projects with a database, Claude Max by where coding time goes. Adjust the shares; the Money overview follows them. `[imp:3]` `[owner:me]` `[time:20m]` `[kind:decision]`
- [ ] **Confirm Canva Pro is still active** — four payment failures between 2026-08-20 and 2026-08-28 and no successful invoice since 2026-07-20. Mark it ended if Canva cancelled it. `[imp:2]` `[owner:me]` `[time:10m]` `[kind:decision]`
- [ ] **Confirm the Apify plan tier** — the 2026-09-15 invoice was $22.99; the record is named "Usage plan" until the console confirms the tier. `[imp:2]` `[owner:me]` `[time:10m]` `[kind:setup]`
- [ ] **Add the GitHub repository allow-list entry for phone-app** (Settings → Repositories) if you also want its NEEDED.md tasks and commits; the project row itself no longer depends on it. `[imp:2]` `[owner:me]` `[time:5m]` `[kind:setup]`
- [ ] **Review the imported competitors, links and ideas** in Competition and each project's Links & Ideas tab; every record carries sources and a review date, and unverified prices are marked in the text. `[imp:3]` `[owner:me]` `[time:45m]` `[kind:content]`
- [ ] **Refresh the competitor reviews before 15 December 2026** — every imported record is dated 2026-09-16, so all of them flip to "needs refresh" on the same day. Competition → Review → Needs refresh lists them; check what changed and save a new review date per record. `[imp:3]` `[owner:me]` `[time:60m]` `[kind:content]`
- [ ] **Merge the duplicate library categories** — Links → Manage categories names the pairs whose titles read the same; the merge control on each category header moves its records and deletes the emptied category. The category rows live only in the linked Supabase project, so no agent can see or run this. `[imp:2]` `[owner:me]` `[time:20m]` `[kind:content]`
- [ ] **Decide whether devShark becomes its own registry entry** — it is a sibling product inside `react-express-app`, and splitting it means a new `PORTFOLIO` row plus moving the competitors, link relevance markers and subscription allocations that currently hang off the shared project row. Worth it only when devShark needs its own competition and finance. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:decision]`
- [ ] **Decide whether Works carry the client's competitors** — a work already has a Competition tab and appears on `/competition` once something is recorded; what is missing is an empty card inviting it. Say yes and it is a one-condition change in `src/components/panels/competition-panel.tsx`. `[imp:2]` `[owner:me]` `[time:10m]` `[kind:decision]`
- [ ] **Set VERCEL_API_TOKEN** if you want per-project Vercel usage instead of the equal split. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`
- [ ] **Confirm the Claude Max 20x App Store amounts for June and July** — 6,199 CZK each came from Apple's price notice, not from the invoice PDFs. Open the App Store purchase history, then confirm the amount on the row in Subscriptions. `[imp:3]` `[owner:me]` `[time:15m]` `[kind:content]`
- [ ] **Confirm the UptimeRobot start date** — `started_on` was inferred from the monthly cycle, not read from a first invoice. `[imp:1]` `[owner:me]` `[time:10m]` `[kind:content]`
- [ ] **Decide whether the lukaskouril.dev domain stays unallocated** — it is personal brand, so the Money overview reports it under Unallocated. Allocate it to a project if that is wrong. `[imp:1]` `[owner:me]` `[time:5m]` `[kind:decision]`
- [ ] **Work through the unconfirmed amounts in Money → Development finance** — every subscription starts unconfirmed. Open Subscriptions, compare each amount with the vendor's invoice and press the check icon on the row. The figure under the recurring total drops as you go. `[imp:3]` `[owner:me]` `[time:40m]` `[kind:content]`

## Optional production hardening

- [ ] **Distributed rate limiting:** add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without them, the app uses a best-effort in-memory limiter per server instance. `[imp:2]` `[owner:me]`
- [ ] **Error monitoring:** configure `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and the deployment's Sentry auth token/release integration if desired. Verify captured context contains no private record bodies. `[imp:2]` `[owner:me]`
- [ ] **Privacy-conscious analytics:** configure `NEXT_PUBLIC_POSTHOG_KEY` and optionally `NEXT_PUBLIC_POSTHOG_HOST`. The only repository feature flag currently referenced is `costs-filter`; no Tugedr kill-switch exists. Leave PostHog unset to disable the client SDK. `[imp:2]` `[owner:me]`
- [ ] **Higher link-enrichment throughput:** add `JINA_API_KEY` only if the anonymous Jina Reader allowance is insufficient. `[imp:1]` `[owner:me]`
- [ ] **Cron log ingestion (Home → Crons panel):** set `CRON_REGISTRY_TOKEN` and `DASHBOARD_OWNER_ID` server-side so external GitHub Actions crons can report runs to `POST /api/crons/log`. Then, in each repo with scheduled workflows (currently `aifirst` and `quorum`), add the Actions secrets `OWNDASHBOARD_CRON_URL` (this app's `/api/crons/log` URL) and `OWNDASHBOARD_CRON_TOKEN` (= `CRON_REGISTRY_TOKEN`). The app's own Vercel crons log automatically. Include the dashboard cron's `cron_id` (or its `endpoint`) in the POST body if you want that run to stamp the cron's last success and fire its heartbeat URL. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`

## Brand and domain — wait for a confirmed replacement name

- [ ] When a final name is approved, update `src/lib/brand.ts`, then follow the manual rename checklist in `docs/external-setup.md` for Vercel, the domain, Supabase, Google/GitHub OAuth apps, PostHog, Sentry, Resend, cron monitors, and installed PWAs. OwnDashboard remains the deliberate temporary name; do not rename it to Takt. `[imp:1]` `[owner:me]`

## Developer tooling

- [ ] **Install and initialize RTK (`rtk-ai/rtk`)** — RTK could not be set up from the Claude Code web session because its GitHub download host is outside the session's network allowlist (`github.com/rtk-ai/rtk` and its release binaries return HTTP 403). Set it up locally at home with the commands below, then enable it for this repository following `rtk --help` / the RTK docs (the exact per-repo command isn't documented here because the tool wouldn't install in the sandbox). `[imp:2]` `[owner:me]`

```sh
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
rtk init --global
```

## Career workspace (7 September 2026)

- Optional Apify imports: configure server-only `APIFY_TOKEN` and `APIFY_JOB_TASK_IDS`; supply completed saved tasks with full job descriptions. No Actor is started by the app. See `docs/career-workspace.md` for sources, schema expectations and costs.
- Verify `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` in production for source ingestion. These values were unavailable for verification in this workspace. Existing authenticated Supabase letter/template tables are reused; no new migration is needed.

## Organization tax registries (16 September 2026)

"Fill from ARES" and the VIES VAT check are live in Clients, and the invoice
buyer block shows the stored verdict. Both registries are free public services,
so there is nothing to sign up for — only the migration and one real check.

- [ ] **Apply the organization registry migration** — run `supabase/migrations/20260916140000_organization_registry_verification.sql` against the linked Supabase project. Until it runs, the new organization columns do not exist and every VAT check fails to save. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Check one real client end to end** — open Clients, fill a new organization from a real IČO, verify its DIČ, and confirm the verdict, the date and any VIES name difference show on the organization and on a new invoice. `[imp:3]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Decide what a verified VAT id should do to an invoice** — the dashboard shows the check and applies no VAT logic. Applying reverse charge (zero VAT plus the "daň odvede zákazník" note) is a tax decision, not a code decision; say what you want before it is built. `[imp:2]` `[owner:me]` `[time:30m]` `[kind:decision]`

## Transaction rules (16 September 2026)

Money now has a rule editor: staged conditions on description, account, amount,
date or direction that set the category, project, subscription or description,
applied on every bank sync, every CSV import and retroactively on request. The
old single-keyword auto-categories are gone from the UI; their rows are copied
into the new table by the migration and the old table is kept as the rollback
path.

- [ ] **Apply the transaction rules migration** — run `supabase/migrations/20260916160000_transaction_rules.sql` against the linked Supabase project. Until it runs, the rule card shows a load error and bank sync files nothing automatically. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Check the backfilled keyword rules** — after the migration, open Money → Transaction rules and confirm each old auto-category came across as one "Description contains …" rule. Delete the ones you no longer want before running an apply. `[imp:3]` `[owner:me]` `[time:15m]` `[kind:content]`
- [ ] **Decide when the legacy table can go** — `transaction_category_rules` is still read by nothing and still exported. Once the new rules have run for a while, say the word and it can be dropped in its own migration. `[imp:1]` `[owner:me]` `[time:10m]` `[kind:decision]`

## Changelog (16 September 2026)

`CHANGELOG.md` is generated from `src/lib/changelog.ts`, and the Work overview's
weekly review lists the entries published since the last review you completed.
Three entries are seeded from real commits. There is nothing to deploy — the
changelog is repository content, not owner data — but two things need a person.

- [ ] **Write the next entry** — add a dated `ChangelogEntry` to `src/lib/changelog.ts` for what landed since 2026-09-16, regenerate `CHANGELOG.md` and let the test confirm the two match. At least one entry every two weeks; only work that actually shipped. `[imp:2]` `[owner:ai]` `[time:30m]` `[kind:content]`
- [ ] **Capture the screenshots** — run `npx playwright install chromium`, then `CHANGELOG_CAPTURE=1 npx playwright test e2e/changelog-capture.spec.ts --project=desktop`, and point each `ChangelogFeature.media` at the committed file. Every feature currently ships with `media: null` because no browser binary was available; the captures are real `/dev-preview` screenshots, never stand-ins. `[imp:2]` `[owner:me]` `[time:30m]` `[kind:content]`

## Invoice payment matching (17 September 2026)

Incoming payments are now paired with issued invoices by variable symbol and
amount — deterministically, with no model involved — and the leftovers are
listed on the Money child routes with a reason each and a manual link. The
matcher runs from `/api/cron/payment-match`, and "Match now" runs the same check
on demand.

- [ ] **Apply the payment-matching migration** — run `supabase/migrations/20260917090000_invoice_payment_matching.sql` against the linked Supabase project. Until it runs, `transactions.variable_symbol`, `matched_at` and `match_source` do not exist and every match fails to save. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Decide the matching cadence** — the job is registered daily at 06:30 UTC because Vercel Hobby runs a cron at most once a day and `vercel.json` already declares more jobs than that allows. The matcher is idempotent, so on a paid plan change the schedule to `0 * * * *` and nothing else has to change. `[imp:3]` `[owner:me]` `[time:15m]` `[kind:decision]`
- [ ] **Check one real payment end to end** — issue an invoice, pay it from a linked account or import the statement row, and confirm the invoice turns paid on the day the money arrived and the payment leaves the unmatched list. Only a real Czech bank shows whether your bank sends the variable symbol structured or only inside the message. `[imp:3]` `[owner:me]` `[time:30m]` `[kind:deploy]`

## Weekly planning (17 September 2026)

The Work overview's weekly review is now a guided five-step flow: last week's
calendar time by client/project/admin channel, the focus tasks you finished,
what carries forward, next week's objectives, and a summary. It reuses the
existing `weekly_reviews` row, so there is nothing to migrate and nothing to
deploy. Two things only a real week can settle.

- [ ] **Run one real week through it** — on a Monday, open Work and walk the five steps. The channel split only works if your calendar entries name the project or the client; the step shows how many events named neither, so check that number before trusting the percentages. `[imp:3]` `[owner:me]` `[time:20m]` `[kind:content]`
- [ ] **Decide whether the split needs a mapping** — if too many events land in Admin, the fix is a per-calendar or keyword rule stored on `user_preferences`, which means a migration and an owner-applied `npx supabase db push`. Say the word and it gets built; until then the heuristic reads event titles only. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:decision]`

## Career stage board, follow-ups and contacts (17 September 2026)

Applied gained a stage board next to its list, a due follow-up now shows up on
the Work overview and in the Home hero, and the recruiter you are talking to has
two structured fields instead of a line in the notes. The board and the
follow-up surfacing work against the database as it is today; the contact fields
need one migration.

- [ ] **Apply the contact migration** — run `supabase/migrations/20260917190000_job_application_contacts.sql` against the linked Supabase project. It adds `contact_name` and `contact_email` to `job_applications` and nothing else. Until it runs, the response dialog says the fields need the migration rather than offering inputs that cannot save, so nothing breaks in the meantime. `[imp:3]` `[owner:me]` `[time:10m]` `[kind:deploy]`
- [ ] **Decide what to do about the AI cover-letter budget** — the third bullet of the issue asks for a visible monthly budget for cover-letter generation, and there is nothing to budget: every LLM-backed feature was removed in commit 5d32e6b and `docs/ai-and-privacy.md` states the product uses no LLM. Reinstating generation means reversing that decision, adding a provider credential, and choosing the monthly ceiling, what resets it and what happens at the cap. `src/components/panels/career-letter-helper.tsx` stays deterministic template assembly either way. `[imp:2]` `[owner:me]` `[time:30m]` `[kind:decision]`
- [ ] **Decide whether follow-ups should also leave the app** — the due date is surfaced in-app only. An email or push reminder needs a `vercel.json` cron entry plus `RESEND_API_KEY`, `RESEND_FROM` and `CRON_SECRET`, which is the same shape as the renewal warnings job. Say the word and it gets built. `[imp:2]` `[owner:me]` `[time:20m]` `[kind:decision]`
