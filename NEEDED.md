# NEEDED — owner rollout checklist

The repository implementation is complete. The items below are the external account, secret, migration, and rollout steps that still require the repository owner. They are intentionally not performed by application code. This file is also imported into OwnDashboard Tasks: only `- [ ]` lines are imported, and every open item carries `[imp:N]` `[owner:me]` `[time:…]` `[kind:…]`.

## Kickoff 2026-09-25 · prompts, links, projects, tools

`KICKOFF-25-9-2026.md` at the repository root is the programme; issues #75–#83 are the steps.
Owner parts, in this order:

- [x] **Apply the six kickoff migrations** — applied 2026-09-25 through the Supabase connector, one at a time and each verbatim from its file, after checks against the live schema. The daily-focus function signature and the `todos` repository columns matched, and no stored hidden tab was outside the new list. `main` went out at `8115276`, and that production deployment is READY. [imp:5] [owner:me] [time:20m] [kind:deploy]
- [x] **Backfill repository ids** — done 2026-09-25 for the four repositories being renamed: quorum `1309668143`, aifirst `1236398773`, react-express-app `1136996139`, own-dashboard `1235308023`. The other 44 fill themselves when Projects syncs with GitHub connected; `scripts/backfill-project-repo-ids.mjs` still covers them all if you want it now. [imp:4] [owner:me] [time:10m] [kind:setup]
- [x] **Backfill project links** — done 2026-09-25 with the script's own resolution rules, run as SQL: 574 relevance entries became 569 `project_links` rows across 12 projects. 5 stayed unresolved and were not guessed: 4 name `mma-files` and 1 names `interview-prepper`, neither of which is a project here. Check a few Links sections in the project workspaces. [imp:3] [owner:me] [time:15m] [kind:setup]
- [ ] **Rename the repositories on GitHub after the id backfill** — the id backfill is done (2026-09-25). `react-express-app → devShark`, `aifirst → DNESKAi`, `quorum → boardlessAI`; the auto-sync then updates the three projects' `repo_full_name` and remembers the old names instead of duplicating them. Update local remotes, Vercel Git links and Actions secrets as `docs/external-setup.md` §10 describes. Tracked with lukaskourilcz/quorum#565. [imp:4] [owner:me] [time:30m] [kind:setup]
- [ ] **Align the Supabase migration history before the next `db push`** — two mismatches remain. (1) The connector recorded the six kickoff migrations as `20260925141127`–`20260925141231`, not their file versions `20260925090000`–`20260925090500`; `npx supabase migration repair --status reverted 20260925141127 20260925141142 20260925141154 20260925141208 20260925141225 20260925141231` followed by `--status applied 20260925090000 20260925090100 20260925090200 20260925090300 20260925090400 20260925090500` aligns it. (2) Nine history rows `20260607130259`–`20260607153832` predate the repository and have no files; `supabase/schema.sql` stands in for them, so mark them `--status reverted`. The nine 2026-09-16 migrations are no longer a mismatch: their files now carry the versions production recorded (`20260916094243`–`20260916195556`). Then `npx supabase db push --linked --dry-run` should list only the four 2026-09-25 integration migrations below. [imp:4] [owner:me] [time:20m] [kind:setup]
- [x] **Decide the two unmerged branches whose schema is already live** — settled 2026-09-25. `claude/elegant-cori-h9cdgb` (#64–#73) is merged: `engagement` stays the one own-versus-client field and `projects.scope` is dropped, the Works section folded into Projects behind the freelance divider, and its migration files renamed to the versions production recorded. From `claude/busy-carson-lc5ise` only the migration file came across; its empty `ai_link_projects` and unused `projects.video_url` are dropped by a guarded migration, and the branch is to be archived as a tag. [imp:3] [owner:me] [time:45m] [kind:decision]
- [ ] **Apply the four integration migrations** — `20260925200000_fix_project_parent_policies.sql` (the `projects` insert and update policies compared a parent with itself, so no row with a parent could be saved), `20260925200100_project_engagement_replaces_scope.sql` (drops `projects.scope`), `20260925200200_project_competition_tab.sql` (lets Settings hide the Competition tab) and `20260925200300_drop_link_project_references.sql` (drops `ai_link_projects` and `projects.video_url`, and refuses if either holds data). Run them with `npx supabase db push --linked` after the history repair above, so each is recorded under its file version. `docs/migration-guide.md` has the checks. [imp:4] [owner:me] [time:20m] [kind:deploy]
- [ ] **Apply `20260925210000_restrict_purge_old_cron_runs.sql`** — `anon` and `authenticated` can run `purge_old_cron_runs()`, a `SECURITY DEFINER` delete, through `/rest/v1/rpc` (security advisor lints 0028 and 0029). The migration leaves it to `service_role` and the scheduler. Push it with `npx supabase db push --linked` after the four integration migrations; `docs/migration-guide.md` has the checks. [imp:3] [owner:me] [time:10m] [kind:deploy]
- [ ] **Decide whether phone-app may appear in this public repository** — the `lukaskourilcz/phone-app` repository is private, yet `src/lib/portfolio.ts` names it (LINKA, key `phone-app`) so its project row stays bound. Its description there is now "Private product in development."; the real one lives only in your own `projects.summary`, which Projects shows first. The guest tour no longer lists LINKA. The earlier description is still in the history of the pushed branch `claude/elegant-cori-h9cdgb`, and merging this branch carries that commit into `main`'s history. Say whether the name and repository may stay in source, or whether the entry should move out. [imp:3] [owner:me] [time:5m] [kind:decision]
- [ ] **Decide whether umyjemefasadu is client work** — the 2026-09-16 import marked it `work`, the kickoff left it `own`, and `projects.engagement` now decides. It is inactive, so it shows nowhere today; set Engagement to Freelance (hired) in the project form if it was a client job. [imp:1] [owner:me] [time:5m] [kind:decision]
- [ ] **Decide what Opportunities shows before the check** — it now shows only when it was last loaded in this browser session and the opportunity and platform counts from then. Say if stored counts should be visible without pressing the button. [imp:2] [owner:me] [time:5m] [kind:decision]

## Required before the restructured app is used in production

- [x] **Verify the production deployment environment** — verified 2026-09-25: the Vercel project own-dashboard (Production) holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and a sensitive, server-side `SUPABASE_SERVICE_ROLE_KEY`; no service-role key is exposed as `NEXT_PUBLIC_*`. [imp:5] [owner:me] [time:10m] [kind:deploy]
- [ ] **Run the post-deploy smoke test** — once `main` has deployed and the four integration migrations above are applied, walk `docs/external-setup.md` §9, including the second account that must not read or link the first account's records. [imp:4] [owner:me] [time:45m] [kind:deploy]

## Enable the product capabilities you want

- [ ] **Set `CRON_SECRET` in Vercel** — Production has none. Every `/api/cron/*` route answers 403 without it (#89), Vercel's own calls included, so the 06:00 bank sync, 06:30 payment matching and 07:00 renewal warnings do not run at all until it is set. Set it, then confirm the three runs return 200 in the Vercel cron log. Job boards refresh only from Career's **Check for new offers** button, so no scraping schedule exists. `[imp:5]` `[owner:me]` `[time:15m]` `[kind:setup]`
- [ ] **Cron heartbeats:** install Uptime Kuma on the VPS behind TLS, create one push monitor per job, and paste each push URL into the matching `HEARTBEAT_URL_*` variable or the cron's Heartbeat URL field. Then add a Kuma webhook notification to `/api/webhooks/uptime-kuma` with a generated `UPTIME_KUMA_WEBHOOK_TOKEN` (set in both places) and confirm `DASHBOARD_OWNER_ID` is set, or the receiver answers 503. Until the URLs exist every cron reads Unmonitored, which is honest and inert. `[imp:3]` `[owner:me]` `[time:60m]` `[kind:setup]`
- [ ] **Confirm the Uptime Kuma webhook body** against your own instance after the first alert — the receiver reads `monitor.name`, `monitor.id` and `heartbeat.status` and was written from the documented shape, not from a live call. If a down event does not create a notification, paste the real body into the issue and the parser is a one-line fix. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`
- [ ] **Google Calendar:** `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set in Production (2026-09-25). Still to confirm: the Calendar API is enabled, Google is configured in Supabase Auth, and the local and production redirect URLs are allowed; then link Google in Settings and create a test event. `[imp:3]` `[owner:me]` `[time:20m]` `[kind:setup]`
- [ ] **GitHub project operations:** configure GitHub in Supabase Auth and the OAuth callback. Set `GITHUB_OAUTH_CLIENT_ID` plus `GITHUB_OAUTH_CLIENT_SECRET` if disconnect/revoke and expiring-token refresh are required. Confirm the OAuth grant covers only repositories the app should read or update. `[imp:3]` `[owner:me]` `[time:20m]` `[kind:setup]`
- [ ] **Vercel Web Analytics on the project Overview:** create a Vercel access token and set `VERCEL_API_TOKEN` (server-side) plus optional `VERCEL_TEAM_ID`, then enable Web Analytics on each Vercel project you want traffic for. The dashboard matches each project by its linked repository and shows visitors/page views on the project Overview card; without the token the card explains it is unconfigured. `[imp:2]` `[owner:me]` `[time:20m]` `[kind:setup]`
- [ ] **Repository knowledge:** add `about-project.md` to every active project repository. Include a short opening summary plus `## Tech stack` and `## Third-party libraries` list sections; write each entry as `Name — what it does`. Use Project → Knowledge → Check current info to see it rendered. `[imp:3]` `[owner:me]` `[time:30m]` `[kind:content]`
- [ ] **Renewal email:** verify a Resend sending domain, then set `RESEND_API_KEY` and `RESEND_FROM`. Without them the renewal job sends nothing and writes no in-app notification; renewals show only as countdowns in Subscriptions and on Home. `[imp:3]` `[owner:me]` `[time:20m]` `[kind:setup]`
- [x] **Apply the bank provider migration** — applied to production on 2026-09-16 and recorded as `20260916141837`, the version its file now carries. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Decide which bank provider you actually depend on** — GoCardless Bank Account Data is closed to new signups, so it only works if your credentials already exist. Fio's token API costs nothing and covers a Fio account; Enable Banking covers most Czech banks on a free restricted-production tier for your own accounts. Pick one before the current consent lapses; #64 tracks it. `[imp:4]` `[owner:me]` `[time:30m]` `[kind:decision]`
- [ ] **Bank sync via GoCardless:** if your Bank Account Data credentials already exist, set `GOCARDLESS_SECRET_ID` plus `GOCARDLESS_SECRET_KEY` and re-test the production callback and transaction deduplication. CSV statement import remains available without this integration. `[imp:3]` `[owner:me]` `[time:20m]` `[kind:setup]`
- [ ] **Bank sync via Fio:** create a read-only API token in Fio internet banking and paste it into Finances → Connect bank → Fio banka. Then run one sync and check the imported rows against the statement — the parser was written from Fio's published column table and fixtures, never from a live response. `[imp:3]` `[owner:me]` `[time:30m]` `[kind:setup]`
- [ ] **Bank sync via Enable Banking:** register an application, generate an RSA key pair, upload the public key, and set `ENABLE_BANKING_APPLICATION_ID` plus `ENABLE_BANKING_PRIVATE_KEY`. The adapter signs the assertion their API expects but its request flow has never been executed, so it refuses every data call until someone verifies it against a real application. `[imp:2]` `[owner:me]` `[time:60m]` `[kind:setup]`
- [ ] **Brand-media production:** compare at least three current low-cost or free generators using primary pricing, licensing, privacy, watermark, and format documentation. Select a safe provider, then resume from `docs/design/generated-media-manifest.json`; do not register, purchase, upload private data, or publish unreviewed output without explicit approval. This is a one-off design-production dependency, not a runtime application dependency. `[imp:2]` `[owner:me]` `[time:2h]` `[kind:content]`

## Public guest tour and job-offer removal (2026-07-27)

`/guest` renders the real dashboard against the demo fixtures with no session,
and it is what the portfolio now links to. Career gained a source list, and
listings the boards no longer carry are removed on the next check instead of
after 45 days.

- [x] **Verify /guest in production** — verified 2026-09-25 signed out: `/guest` and `/guest?lang=en` on own-dashboard-tau.vercel.app return 200 with `x-matched-path: /guest` and the title "Guest tour · OwnDashboard", with no redirect to `/login`. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Decide whether /guest should be indexed** — it is currently `index: true`, which suits a page linked from the portfolio. Switch it to `noindex` if you would rather it stay reachable but unlisted. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:decision]`
- [ ] **Review the per-board removed counts** — 71 job-board runs from 2026-07-27 to 2026-09-25 pruned 414 listings. Open Career → sources after the next check. A board that removes an implausible share of its listings in one run has changed its markup, so mark that source incomplete in `src/lib/jobs/meta.ts`. `[imp:3]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Re-check the completeness flags if a board changes its API** — `complete: true` means one request returns the board's whole current set, which is what lets a missing offer be deleted without an HTTP check. If a board adds pagination or a result cap, that flag has to become `false` or live offers will be dropped. `[imp:3]` `[owner:me]` `[time:30m]` `[kind:decision]`
- [ ] **Consider raising the refresh route's time limit** — `maxDuration` is 60s, and the liveness probes for partial sources are bounded to 150 URLs and 15s so they cannot starve the scrape. If the sources list shows removals lagging behind reality, raise the limit rather than loosening the bounds. `[imp:2]` `[owner:me]` `[time:20m]` `[kind:decision]`

## Portfolio, Competition and development finance (2026-09-16)

The migration was applied to the linked project and the owner's live data was loaded from Gmail receipts and the research run. What still needs the owner:

- [ ] **Check the subscription allocations** in Subscriptions — Vercel is split equally across the eight deployed repositories, Supabase across the four projects with a database, Claude Max by where coding time goes. Adjust the shares; the Money overview follows them. `[imp:3]` `[owner:me]` `[time:20m]` `[kind:decision]`
- [ ] **Confirm Canva Pro is still active** — four payment failures between 2026-08-20 and 2026-08-28 and no successful invoice since 2026-07-20. Mark it ended if Canva cancelled it. `[imp:2]` `[owner:me]` `[time:10m]` `[kind:decision]`
- [ ] **Confirm the Apify plan tier** — the 2026-09-15 invoice was $22.99; the record is named "Usage plan" until the console confirms the tier. `[imp:2]` `[owner:me]` `[time:10m]` `[kind:setup]`
- [ ] **Add the GitHub repository allow-list entry for phone-app** (Settings → Repositories) if you also want its NEEDED.md tasks and commits; the project row itself no longer depends on it. `[imp:2]` `[owner:me]` `[time:5m]` `[kind:setup]`
- [ ] **Review the imported competitors** in Competition; every record carries sources and a review date, and unverified prices are marked in the text. The links a project uses are its `project_links` rows on the workspace Overview. `[imp:3]` `[owner:me]` `[time:45m]` `[kind:content]`
- [ ] **Refresh the competitor reviews before 15 December 2026** — every imported record is dated 2026-09-16, so all of them flip to "needs refresh" on the same day. Competition → Review → Needs refresh lists them; check what changed and save a new review date per record. `[imp:3]` `[owner:me]` `[time:60m]` `[kind:content]`
- [ ] **Merge the duplicate library categories** — Links → Manage categories names the pairs whose titles read the same; the merge control on each category header moves its records and deletes the emptied category. The category rows live only in the linked Supabase project, so no agent can see or run this. `[imp:2]` `[owner:me]` `[time:20m]` `[kind:content]`
- [x] **Decide whether devShark becomes its own registry entry** — overtaken: StudyShark moved to its own repository on 2026-09-24, so `react-express-app` is devShark alone, and #76 renamed the project row to devShark. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:decision]`
- [ ] **Decide whether client projects carry competitors** — a client project already has a Competition tab and appears on `/competition` once something is recorded; what is missing is an empty card inviting it. Say yes and it is a one-condition change in `src/components/panels/competition-panel.tsx`. `[imp:2]` `[owner:me]` `[time:10m]` `[kind:decision]`
- [ ] **Set VERCEL_API_TOKEN** if you want per-project Vercel usage instead of the equal split. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`
- [ ] **Confirm the Claude Max 20x App Store amounts for June and July** — 6,199 CZK each came from Apple's price notice, not from the invoice PDFs. Open the App Store purchase history, then confirm the amount on the row in Subscriptions. `[imp:3]` `[owner:me]` `[time:15m]` `[kind:content]`
- [ ] **Confirm the UptimeRobot start date** — `started_on` was inferred from the monthly cycle, not read from a first invoice. `[imp:1]` `[owner:me]` `[time:10m]` `[kind:content]`
- [ ] **Decide whether the lukaskouril.dev domain stays unallocated** — it is personal brand, so the Money overview reports it under Unallocated. Allocate it to a project if that is wrong. `[imp:1]` `[owner:me]` `[time:5m]` `[kind:decision]`
- [ ] **Work through the unconfirmed amounts in Money → Development finance** — every subscription starts unconfirmed. Open Subscriptions, compare each amount with the vendor's invoice and press the check icon on the row. The figure under the recurring total drops as you go. `[imp:3]` `[owner:me]` `[time:40m]` `[kind:content]`

## Optional production hardening

- [ ] **Distributed rate limiting:** add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without them, the app uses a best-effort in-memory limiter per server instance. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`
- [ ] **Error monitoring:** configure `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and the deployment's Sentry auth token/release integration if desired. Verify captured context contains no private record bodies. `[imp:2]` `[owner:me]` `[time:30m]` `[kind:setup]`
- [ ] **Privacy-conscious analytics:** configure `NEXT_PUBLIC_POSTHOG_KEY` and optionally `NEXT_PUBLIC_POSTHOG_HOST`. No code reads a PostHog feature flag, and no Tugedr kill-switch exists. Leave PostHog unset to disable the client SDK. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`
- [ ] **Higher link-enrichment throughput:** add `JINA_API_KEY` only if the anonymous Jina Reader allowance is insufficient. `[imp:1]` `[owner:me]` `[time:10m]` `[kind:setup]`
- [ ] **Cron log (Home → Crons panel)** — set `DASHBOARD_OWNER_ID` in Production so the app's own Vercel crons can write `cron_runs` (0 rows on 2026-09-25). No repository has posted to `POST /api/crons/log` since quorum `627515fd` (2026-08-06) removed the reporter from quorum and aifirst. `/api/crons/log` and `/api/crons/registry` answer 503 until `CRON_REGISTRY_TOKEN` is set (#89); set it only if a reporter or a registry reader returns. A run that names the dashboard cron's `cron_id` or `endpoint` stamps its last success and fires its heartbeat URL. `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`
- [ ] **Turn on leaked-password protection in Supabase Auth** — the security advisor still reports it disabled (2026-09-25). Authentication → Password security → check passwords against HaveIBeenPwned. `[imp:2]` `[owner:me]` `[time:5m]` `[kind:setup]`
- [ ] **Correct the two DNESKAi cron rows** — Projects → DNESKAi → Crons lists "Denní generování článku" (`0 6 * * *`, `daily.yml`, AI call) and "Týdenní souhrn" (`weekly.yml`, AI call). aifirst has only `daily.yml`, a 07:00 UTC sentinel that makes no model call, and no `weekly.yml`, so Home and the project cost estimate count two AI jobs that do not exist. Edit the first to `0 7 * * *` with AI call off and delete the second; say whether `src/lib/project-cron-seeds.ts` should seed the same. `[imp:2]` `[owner:me]` `[time:10m]` `[kind:content]`
- [ ] **Decide whether to drop the unused agents queue** — `public.agent_tasks` (0 rows) and `claim_agent_task` have had no caller since the Agents routes went in `5d32e6b`. Dropping them takes a new migration; say the word and it gets written. `[imp:1]` `[owner:me]` `[time:5m]` `[kind:decision]`

## Brand and domain — wait for a confirmed replacement name

- [ ] **Rename OwnDashboard once a final name is approved** — update `src/lib/brand.ts`, then follow the rename checklist in `docs/external-setup.md` §10 for Vercel, the domain, Supabase, Google/GitHub OAuth apps, PostHog, Sentry, Resend, cron monitors, and installed PWAs. OwnDashboard remains the deliberate temporary name; do not rename it to Takt. `[imp:1]` `[owner:me]` `[time:1h]` `[kind:decision]`

## Developer tooling

- [ ] **Install and initialize RTK (`rtk-ai/rtk`)** — RTK could not be set up from the Claude Code web session because its GitHub download host is outside the session's network allowlist (`github.com/rtk-ai/rtk` and its release binaries return HTTP 403). Set it up locally at home with the commands below, then enable it for this repository following `rtk --help` / the RTK docs (the exact per-repo command isn't documented here because the tool wouldn't install in the sandbox). `[imp:2]` `[owner:me]` `[time:15m]` `[kind:setup]`

```sh
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
rtk init --global
```

## Career workspace (7 September 2026)

- [ ] **Optional Apify job imports** — set server-only `APIFY_TOKEN` and `APIFY_JOB_TASK_IDS` and supply completed saved tasks with full job descriptions; the app starts no Actor. See `docs/career-workspace.md` for sources, schema expectations and costs. `[imp:2]` `[owner:me]` `[time:30m]` `[kind:setup]`

## Organization tax registries (16 September 2026)

"Fill from ARES" and the VIES VAT check are live in Clients, and the invoice
buyer block shows the stored verdict. Both registries are free public services,
so there is nothing to sign up for — only the migration and one real check.

- [x] **Apply the organization registry migration** — applied to production on 2026-09-16 and recorded as `20260916125652`, the version its file now carries. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Check one real client end to end** — open Clients, fill a new organization from a real IČO, verify its DIČ, and confirm the verdict, the date and any VIES name difference show on the organization and on a new invoice. `[imp:3]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Decide what a verified VAT id should do to an invoice** — the dashboard shows the check and applies no VAT logic. Applying reverse charge (zero VAT plus the "daň odvede zákazník" note) is a tax decision, not a code decision; say what you want before it is built. `[imp:2]` `[owner:me]` `[time:30m]` `[kind:decision]`

## Transaction rules (16 September 2026)

Money now has a rule editor: staged conditions on description, account, amount,
date or direction that set the category, project, subscription or description,
applied on every bank sync, every CSV import and retroactively on request. The
old single-keyword auto-categories are gone from the UI; their rows are copied
into the new table by the migration and the old table is kept as the rollback
path.

- [x] **Apply the transaction rules migration** — applied to production on 2026-09-16 and recorded as `20260916125742`, the version its file now carries. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
- [ ] **Check the backfilled keyword rules** — after the migration, open Money → Transaction rules and confirm each old auto-category came across as one "Description contains …" rule. Delete the ones you no longer want before running an apply. `[imp:3]` `[owner:me]` `[time:15m]` `[kind:content]`
- [ ] **Decide when the legacy table can go** — `transaction_category_rules` is still read by nothing and still exported. Once the new rules have run for a while, say the word and it can be dropped in its own migration. `[imp:1]` `[owner:me]` `[time:10m]` `[kind:decision]`

## Changelog (16 September 2026)

`CHANGELOG.md` is generated from `src/lib/changelog.ts`, and the Work overview's
weekly review lists the entries published since the last review you completed.
Four entries are written from real commits. There is nothing to deploy — the
changelog is repository content, not owner data — but one date needs a person.

- [x] **Set the release entry's date to the merge day** — done 2026-09-25: the two 2026-09-16/17 entries for the branch became one entry dated 2026-09-25, the day it merged, together with the kickoff work, and `CHANGELOG.md` was regenerated. `[imp:2]` `[owner:me]` `[time:10m]` `[kind:content]`
- [x] **Capture the screenshots** — four `/dev-preview` captures are committed under `media/changelog/` and wired to their features: Projects, Competition and Development finance (retaken on 2026-09-25 after the merge) and Career match scoring. The remaining `media: null` features are the deferred state, not a gap. An element screenshot does not scroll, so each image stops at the fold of the 808 px scroll area. `[imp:2]` `[owner:me]` `[time:30m]` `[kind:content]`

## Invoice payment matching (17 September 2026)

Incoming payments are now paired with issued invoices by variable symbol and
amount — deterministically, with no model involved — and the leftovers are
listed on the Money child routes with a reason each and a manual link. The
matcher runs from `/api/cron/payment-match`, and "Match now" runs the same check
on demand.

- [x] **Apply the payment-matching migration** — applied to production on 2026-09-16 and recorded as `20260916125718`, the version its file now carries. `[imp:4]` `[owner:me]` `[time:15m]` `[kind:deploy]`
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

- [x] **Apply the contact migration** — applied to production on 2026-09-16 and recorded as `20260916141348`, the version its file now carries. `[imp:3]` `[owner:me]` `[time:10m]` `[kind:deploy]`
- [ ] **Decide what to do about the AI cover-letter budget** — the third bullet of issue #69 asks for a visible monthly budget for cover-letter generation, and there is nothing to budget: every LLM-backed feature was removed in commit 5d32e6b and `docs/ai-and-privacy.md` states the product uses no LLM. Reinstating generation means reversing that decision, adding a provider credential, and choosing the monthly ceiling, what resets it and what happens at the cap. `src/components/panels/career-letter-helper.tsx` stays deterministic template assembly either way. Until then issue #69 stays open on a bullet with no subject: reframe it around a cost the product can actually incur, or close it. `[imp:2]` `[owner:me]` `[time:30m]` `[kind:decision]`
- [ ] **Decide whether follow-ups should also leave the app** — the due date is surfaced in-app only. An email or push reminder needs a `vercel.json` cron entry plus `RESEND_API_KEY`, `RESEND_FROM` and `CRON_SECRET`, which is the same shape as the renewal warnings job. Say the word and it gets built. `[imp:2]` `[owner:me]` `[time:20m]` `[kind:decision]`

## Database baseline and fresh installs (17 September 2026)

`supabase/schema.sql` and `supabase/migrations/` disagree, and a fresh install
aborts because of it. Both blockers were reproduced against a real Postgres
database and both come from the same habit: copying a new migration's block back
into the baseline. The linked project is unaffected — it was migrated
incrementally — so this is about new installs, local validation and recovery from
a backup. Nothing under `supabase/` was changed; the fix is your decision.

- [x] **Decide how the baseline gets fixed** — done in #85 (`6b76ce3`): every mirrored block was removed from `supabase/schema.sql`, and a fresh install runs the baseline and every migration under `ON_ERROR_STOP=1` with exit 0. `[imp:5]` `[owner:me]` `[time:30m]` `[kind:decision]`
- [x] **Write the no-mirroring rule into the baseline header, and turn the README clause into a procedure** — done in #85 (`6b76ce3`, `4b66496`): the header carries the rule and the install order, and `docs/migration-guide.md` has the Fresh install and Existing install procedures. `[imp:3]` `[owner:me]` `[time:30m]` `[kind:setup]`
