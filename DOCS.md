# OwnDashboard architecture

## Product model

OwnDashboard is an own-only professional operating system. The main entities form a connected graph:

```text
Organization ─┬─ Opportunities ── won conversion ── Project
              ├─ Projects
              └─ Invoices

Project ──────┬─ Tasks          Opportunity ── Tasks / Notes / Prompts
              ├─ Notes
              ├─ Client communication
              ├─ Costs / Crons
              ├─ Transactions / Subscriptions / Invoices
              ├─ Dates / Prompts
              └─ Library links (project_links: uses | reference | tool)

Prompt ── Library links (prompt_links)
Tool ── one library link ── Projects (project_links, role tool)
     └─ optional Subscription (monthly cost)

Inbox item ── confirmed routing ── Task | Note | Opportunity | Project
                                  Organization | Job application | Date
                                  Transaction category
```

These are real foreign-key relationships. RLS policies verify that every referenced organization, project, opportunity, invoice, or job application belongs to the authenticated user.

## Application architecture

`src/app/[[...slug]]/page.tsx` is the authenticated server boundary. It:

- validates a canonical or supported legacy route;
- redirects meaningful legacy bookmarks;
- checks the user with `auth.getUser()`;
- loads own-scoped Supabase rows and Google Calendar windows in parallel;
- performs no profile upsert or other rendering side effect;
- seeds `DashboardShell` with server data.

`src/components/dashboard-shell.tsx` keeps the existing single-shell architecture. Entity state is stored in the shared TanStack Query cache through `useEntityStore`, so existing high-value panels remain controlled and cache invalidation stays centralized.

The shell switches canonical routes with the History API for an SPA feel. Browser back/forward is synchronized through `popstate`. The sidebar, mobile navigation, keyboard chords, and command palette all use the same `NavTab` source of truth. Project detail is the one supported nested route: `/projects/[id-or-slug]`. The authenticated server boundary resolves it only against the current user's loaded projects; unknown or cross-user identifiers return 404.

## Hubs

### Home

Home shows the daily operating context: calendar, deadlines, opportunity follow-ups, recurring spend, active projects, and configurable widgets. Its task surface transactionally snapshots up to seven open tasks each day, ordered by priority and randomized within priority bands. GLOBAL tasks are database-enforced priority 6. Completing all seven marks that professional workday in a 49-day GitHub-style completion garden; this is task execution history, not the retired lifestyle streak feature.

### Inbox

Inbox and References are hidden from every navigation surface (`HIDDEN_NAV_TABS` in `src/lib/nav-tabs.ts`): the sidebar, the mobile bar and More sheet, the command palette, the `g` chords, Settings and Home widgets. Their routes still render at `/inbox` and `/references` with a short note, and their tables, RPCs and exports are unchanged. Notifications load only on the Inbox route; there is no sidebar bell.

Inbox is a triage queue, not a second task list. Manual captures and integration events land as `inbox_items`; notification records are visible in the same action center. Notifications support safe source links, mark-read, snooze, and dismiss actions. Inbox search, source/status/destination filters, snooze, dismiss, restore, source links, and bulk dismiss support deliberate triage. A user chooses the destination and clicks Process; only then does the `route_inbox_item` `SECURITY INVOKER` RPC create or update the destination and mark the item processed in one transaction. Retries return the recorded route instead of creating duplicates. Valid relationship identifiers in an item's payload are carried into routed records and are rechecked by RLS.

### Work

Work overview summarizes active projects, open opportunities, due follow-ups, issued invoices, explainable project-health warnings, and the current week's planning. Health is a transparent heuristic based on on-hold status, overdue linked tasks, disabled crons, crons that stopped reporting a successful run, and costs without recorded revenue.

Projects use a sortable summary table with a dedicated non-text drag handle. `projects.engagement` separates the owner's own products (`own`) from freelance work the owner was hired for (`client`); the table and the sidebar list own projects first, then a hairline "Freelance" divider and the client projects. Reordering works within a group while `sort_order` stays one sequence. The code-level portfolio registry (`src/lib/portfolio.ts`) materializes the daily projects without GitHub and binds each row by `projects.portfolio_key`; a venture subsection (Design Lab, GoVIRAL) is a child row through `projects.parent_id`, listed under its parent without a drag handle. The registry never renames a row or changes its engagement. Competition (`competitors`) is its own destination, documented in [Portfolio, Competition and development finance](docs/portfolio-competition-finance.md); it marks research whose review date is missing or 90 days old or older as needing a refresh and can filter the list down to exactly those rows. Each project has a canonical workspace with Overview, Tasks, Activity, Communication, Repository, Finance, Competition, Knowledge, Scaling and Monetization tabs. Overview lists the library links the project uses (`project_links`), each with a role and a note on how it helps, added through the shared library picker. Knowledge lists every prompt by kind and copies it with this project filled in.

Projects match GitHub repositories by the numeric repository id (`projects.repo_id`) and fall back to the current or a previous name (`previous_repo_full_names`). The auto-sync writes a renamed repository's new full name onto the existing project and records the old one; before it would create a project, it looks unresolved old names up on GitHub, which redirects renamed repositories. `taskBelongsToProject` in `src/lib/project-match.ts` is the one task-to-project rule, mirrored by the daily-focus RPC. Earlier slugs (`previous_slugs`) keep renamed project URLs and cron-registry calls working. Communication records are project-owned timeline entries with channel, direction, contact, summary, and next action. Projects may store separate production and development URLs. Revenue has an explicit currency and workspace finance converts revenue, costs, subscriptions, transactions, and invoices through the single deterministic static FX table.

Career and Opportunities load nothing on entry. Each opens with one button, **Check for new offers / Zkontrolovat nové nabídky**; Career's press refreshes the job boards through `/api/jobs/refresh` and re-verifies which listings are open, and both then load their on-demand records (`ON_DEMAND_TAB_DATA` in `src/lib/dashboard-data.ts`). The loaded state lasts for the page session, nothing refetches on focus, remount or a timer, and the next press refreshes. The Opportunities gate shows when it was last loaded in this browser session and the counts from then. There is no scheduled job scrape.

The weekly review is a guided five-step flow (`src/lib/weekly-planning.ts`, `src/components/work/weekly-planning.tsx`) that ends with a plan rather than a report: last week's calendar time by channel, the daily-focus tasks that were finished, what carries forward, next week's objectives, and a summary. It writes into the existing `weekly_reviews` row for the week (`unique (user_id, week_start)`), so there is no new table and no migration; the six free-text lists the flat review wrote are preserved and stay editable inside the summary step. Stepping between steps saves quietly and records the step, so reopening Work resumes where the owner stopped and never re-opens a week that was already completed. The flow opens only after the stored reviews have loaded, and a save writes only the fields the owner changed, so a Work tab reached before its data arrived cannot save empty lists over the week. Last week is Monday to Monday in the browser's timezone: the browser sends both instants to `/api/calendar/events?window=last-week`, and the server never works that week out from its own clock.

Time by channel is a transparent heuristic over the finished Monday-to-Monday window of the calendars already selected in Settings. An event whose title, location or description names a client organization — or a project that is a client engagement or belongs to an organization — is client work; another project is own-project work; anything naming neither is admin. Matching is whole-word and diacritic-insensitive and also accepts an organization's trading name without its legal form. All-day entries carry no duration and are counted separately, and the number of events that named nothing is always shown, because the split is only as good as the event titles. Only the aggregate minutes and counts are stored with the review; no calendar event body is ever persisted. When Google Calendar is not connected the step says so and offers a relink instead of showing a fabricated split, and the flow continues without it.

Each project cron carries an optional push-monitor URL and the timestamp of its last successful run, and the cron list shows the resulting freshness — On time, Late, Not reporting, No run yet or Unmonitored — beside the cost. The state is derived from the cron's own schedule (with `runs_per_month` as the fallback interval) and needs no external service; the push URL is what lets an external monitor alert when a run stops arriving. A successful run through `/api/crons/log`, or one of the app's own scheduled jobs, stamps the timestamp and pings the URL; a failed run pings nothing, which is what makes the missed ping meaningful. Uptime Kuma can post back to `/api/webhooks/uptime-kuma` with a shared token, turning a down monitor into one Inbox notification and a failed entry in the Home cron log, and a recovery into a dismissal plus one recovery notice. Setup is in [External setup](docs/external-setup.md).

Career listings are rendered as a semantic, horizontally resilient table. Match is an explicit comparable column and users can sort by best/lowest match, remote availability, location, or discovery date. Rows support accessible bulk selection. Permanent deletion writes an owner-scoped `deleted` tombstone, so a shared scraped listing cannot reappear for that owner after refresh and one owner cannot mutate the global feed for another.

Opportunities provide the Tugedr/referral/direct/inbound pipeline. After browser confirmation, the `convert_opportunity_to_project` security-invoker RPC locks the owned opportunity and atomically creates or links its organization, creates the project, preserves the opportunity currency as project revenue currency, and marks the opportunity won. A failure rolls back the whole conversion. Clients are organizations with connected projects, opportunities, invoices, tasks, notes, and dates. The organization form collects the invoice-relevant registration number, VAT number and address, and "Fill from ARES" completes them from the public Czech economic-subject register through `/api/registry/ares`, both while creating an organization and from the detail panel of one that already exists. A fill keeps every value already typed and refreshes the registered name, which is the point of the lookup. An EU VAT number can be checked against the public VIES service through `/api/registry/vies`; the verdict, the number it belongs to and the registered name VIES returned are stored on the organization and reused for 30 days, so a re-check is offered rather than repeated automatically. A member-state outage is reported as an unavailable check and never overwrites a verdict that still stands for the same number. The invoice buyer block shows that stored verdict read-only; it applies no VAT logic and no reverse charge. Career and Invoices reuse the established implementations.

Opportunities also includes an own-only freelance platform directory, editable profile/service drafts, reviewed remote eligibility and stack notes, proposal text and document links, actual submission/first-response dates, and a platform-filtered response rate. Drafts never imply a published external account or a sent proposal. External login, paid memberships and proposal submission happen on the platform; no automatic scraping or account synchronization is claimed. The platform query is mounted only in Opportunities and scoped by authenticated user, while history is fetched only for the open opportunity. Composite ownership constraints prevent linking another user's platform, and append-only `opportunity_events` are written by a fixed-search-path trigger, with no client mutation grants. Professional exports include both new tables. Public preview uses deterministic non-personal drafts with mutations disabled.

The weekly review ends with **Shipped since last review**: the changelog entries published after the last review that was actually completed, newest first. `src/lib/changelog.ts` is the source of truth for those entries and [CHANGELOG.md](CHANGELOG.md) is generated from it, so the panel needs no filesystem read and no network call — `tests/lib/changelog.test.ts` fails if the module and the file disagree. A draft review does not close the window; with no earlier completed review, or one older than the twelve weeks the loader fetches, the block shows the newest entries and says so. Screenshots are authentic `/dev-preview` captures under `media/changelog/`, taken by the opt-in `e2e/changelog-capture.spec.ts`; a feature with no capture yet ships without an image rather than with a placeholder, and the images appear in `CHANGELOG.md` rather than in the app, which serves no static media.

### Money

The Money overview shows development finance only: subscriptions in the Development group or with a project allocation, transactions linked to a subscription, a project or a development category, split between own projects, client projects (`projects.engagement`) and unallocated overhead. Accounts, transactions, bank synchronization, categories and charts remain on their child routes. Subscriptions retain a custom detail category and add a canonical operational group (`development`, `entertainment`, `business`, `infrastructure`, `productivity`, `finance`, or `other`) plus an importance level. Active records require a next billing date in the UI; every recurring-spend view shows the date and remaining/overdue days. Canonical child routes currently open the same integrated financial workspace so no mature functionality is duplicated.

Transaction rules replace the old single-keyword auto-categories. A rule is a list of conditions — description, account, amount, date or direction, compared with is, contains, does not contain, a regular expression, one-of, a threshold or a range — and a set of actions that write the category, project, subscription or description. Rules run in three stages (before, default, after) and inside a stage the broadest rule runs first, so a narrower rule overwrites it; `src/lib/transaction-rules.ts` is the whole engine and is shared by every bank sync, the CSV import, the editor and the apply route, so a transaction is filed the same way whichever path it arrives on. There is no payee column: the bank's merchant and remittance text lands in `transactions.note`, and a rule about a merchant is a rule about the description. The editor shows two counts and labels both — how many of the loaded transactions a rule matches, and, on request, a full count from `POST /api/money/rules/apply`, which pages through the owner's whole ledger with their own session and can also apply the rule retroactively. A rule action naming a project or subscription the owner does not own is dropped before the write, because the transactions policies verify each relationship. Legacy `transaction_category_rules` rows are copied into the new table by the migration; the old table is kept as the rollback path and stays in the financial export.

Incoming bank payments are paired with issued invoices deterministically. `src/lib/payment-matching.ts` is the whole rule: the payment's variable symbol has to name exactly one issued bank invoice, the currencies have to be identical, and the amount has to sit inside that invoice's own rounding tolerance — a crown on a CZK invoice with `round_total`, because that is what `computeTotals` rounds to, and a cent everywhere else. Nothing here calls a model. A pair sets `transactions.invoice_id`, `matched_at` and `match_source`, and marks the invoice paid on the day the money arrived rather than the day the matcher ran. Everything else stays in the **Unmatched payments** card on the Money child routes, each leftover labelled with its reason: no variable symbol, no invoice with that symbol, a different currency, an amount that does not match, an invoice that is already paid, or two open invoices sharing one symbol. The card links a leftover by hand through `POST /api/money/payment-match`, which runs with the owner's own session so the transactions update policy verifies the invoice's owner. The same matcher runs unattended from `/api/cron/payment-match`; it is idempotent, because a linked payment carries `invoice_id` and is no longer a candidate. The variable symbol itself is captured at ingest — from the provider's structured reference or remittance text — GoCardless's PSD2 fields, Fio's own VS column — and from a `Variabilní symbol` column on an imported statement — with a note fallback for rows synced before the column existed. The invoice list names the payment that settled each paid invoice.

Bank sync is one adapter per provider behind a single interface. `src/lib/bank/provider.ts` is the contract — consent status and expiry, accounts, transactions since a cursor, revoke — and `src/lib/bank/registry.ts` is the only place anything asks whether bank sync is usable, so a deployment configured for one provider is not blocked by another being unset. GoCardless Bank Account Data, Fio banka's token API and Enable Banking are the registered providers; a `bank_connections.provider` value outside that set throws instead of being treated as GoCardless, and the database carries the same check. GoCardless is an app-level secret pair; a Fio token belongs to one person and is stored in the service-role-only `bank_provider_credentials` table, written through `POST /api/bank/credentials` and never returned by any endpoint, including `/api/integrations/status`. Enable Banking is registered and signs the RS256 assertion its API expects, but reports itself as not set up and refuses every data call until an application id and RSA key pair exist and its flow has been verified. Each provider namespaces the keys it writes — Fio uses `fio:` on both `accounts.external_ref` and `transactions.external_id`, GoCardless keeps its refs bare so existing rows still match — so re-syncing stays idempotent across providers. Consent expiry is modelled rather than inferred: `consent_expires_at` is stored whenever the provider states one, the bank card shows it beside the status, and `/api/cron/bank-sync` marks a lapsed connection expired before it pulls anything. Each connection also has its own sync trigger, `POST /api/bank/sync` with a `connectionId`, beside the existing sync-everything button.

### Planning and Library

Planning preserves Tasks, Google Calendar, Goals (the renamed plans system), and own-only professional Dates. Tasks distinguish GLOBAL work from active-project work and exclude inactive-project tasks from operational surfaces. Library holds Notes, Prompts, Tools and Links; References remains reachable by URL only.

Each prompt has a kind: design, audit, competition, UX and UI, analysis, documentation, new project, SEO, marketing or other. The Prompts page groups them in that order, with filter chips and a Public badge. Each prompt lists the library links an agent should open (`prompt_links`, with a note per link). Copying opens a preview built by `composePromptCopy` in `src/lib/prompt-composer.ts`: the `{{project.name}}`, `{{project.repo}}`, `{{project.url}}` and `{{project.dev_url}}` placeholders are expanded for the chosen project, a Project block follows, and "Links to consult" lists the prompt's links plus the project's links whose category fits the kind (all of them when the prompt has none). Without a project the placeholders stay and the Project block is omitted. No model is called.

Tools is the curated in-use subset of Links: a `tools` row names a library link as a tool with what it does, a status (in use, trial, retired) and an optional subscription for its monthly cost. How it helps each project is a `project_links` row with role `tool`, so the note also appears in that project's Links section. Link cards show "Used by" project chips, a Tool badge and an "Add to project" action. Empty notes older than the editing grace period are removed automatically; every note exposes full-context copy. Link categories use masonry columns so unequal groups do not create empty grid rows. Project Knowledge renders the repository's `about-project.md` as formatted Markdown and can explicitly recheck GitHub.

## Database and RLS

The professional foundation migration creates:

- `organizations`
- `client_opportunities`
- `inbox_items`
- `notifications`
- `weekly_reviews`
- a missing `notes` definition for fresh environments

It extends projects with `organization_id`, `summary`, `status`, `revenue`, and `revenue_currency`, and adds optional canonical relationships to tasks, notes, invoices, subscriptions, transactions, dates, prompts, and job applications. It also installs the confirmed opportunity-conversion transaction.

Every new user table has RLS enabled, explicit `authenticated` Data API grants, four own-only CRUD policies, and service-role grants. Insert/update relationship policies use `WITH CHECK` and verify the owner of each foreign row. No new `SECURITY DEFINER` authorization function is introduced.

The cleanup migration snapshots retired rows per user into `legacy_personal_archives`, restores own-only read policies, drops the couple relationship from dates, and then removes Pulse, streak, book, couple, invite, sharing, and helper-function storage. The subsequent Inbox-routing migration adds only a `SECURITY INVOKER` RPC; it does not bypass existing row or relationship policies.

`20260722190000_operational_workflow_extensions.sql` adds `project_communications` and `agent_tasks`, both with explicit Data API grants, indexed owner/relationship access, own-only RLS, and foreign-project ownership checks. `claim_agent_task` remains `SECURITY INVOKER`, uses `FOR UPDATE SKIP LOCKED`, and is executable only by `service_role`; the browser cannot invoke it. The Agents feature that used the queue was removed in `5d32e6b`; `agent_tasks` and `claim_agent_task` remain in the database with no application caller.

`20260723065433_daily_focus_synced_preferences.sql` extends task importance to 6, enforces GLOBAL task scope in a trigger, and adds own-only `daily_focus_sets` plus snapshot items. The `create_daily_focus_set` RPC is `SECURITY INVOKER`, uses an owner/date advisory transaction lock, excludes inactive projects, and preserves historical titles if a task is later removed. The same migration stores language, theme, currency, navigation visibility/order, task density, and CV links in `user_preferences`, and migrates Career `hidden` state into durable owner-scoped `deleted` tombstones.

`20260723082424_sync_preferences_project_tabs.sql` makes those preferences reliably available to authenticated Data API callers with explicit own-only select/insert/update policies and grants. It adds `hidden_project_tabs`, which Settings synchronizes across devices, and updates the daily-focus RPC so imported NEEDED.md tasks resolve to their active project by repository when `project_id` is not populated. Client preference writes are serialized to preserve rapid toggle order; a failed server load no longer overwrites a valid device cache with defaults.

The 2026-09-25 migrations add `projects.repo_id`, `previous_repo_full_names`, `engagement` and `previous_slugs`; correct the `hidden_project_tabs` check to the current workspace tabs; and create `project_links`, `prompt_links` (with `prompts.kind`) and `tools`. Each new table has explicit authenticated grants and own-only RLS whose insert and update checks require that every referenced project, prompt, link and subscription belongs to the caller; deleting a parent cascades to its relations. See [the migration guide](docs/migration-guide.md).

Project workspace navigation remains inside the persistent dashboard shell. Opening an active project updates History API state without forcing a new server render, browser back/forward restores the selected project, and choosing the canonical Projects destination clears the selection and restores the project table.

`20260916094243_portfolio_works_competition_finance.sql` adds `projects.parent_id` and `portfolio_key` (with a parent ownership check in the insert/update policies), a since-dropped `projects.scope`, subscription lifecycle columns and the quarterly cycle, `subscription_allocations` and `competitors` (own-only RLS, foreign ownership checks), and `transactions.subscription_id` checked by the transaction policies.

`20260916125742_transaction_rules.sql` adds `transaction_rules`: owner-authored `conditions` and `actions` as jsonb, a `pre`/`default`/`post` stage, a sort order and an enabled flag, with own-only RLS, explicit authenticated grants, four CRUD policies and an `updated_at` trigger. Action ids are deliberately not foreign keys — a rule is a template, and the transactions insert/update policies already reject a foreign or stale project or subscription when the rule is applied. Because the jsonb columns are owner-authored, every reader parses them through `src/lib/transaction-rules.ts`, which drops malformed conditions and actions and reports the number of unreadable rules instead of failing the panel. The migration backfills each legacy keyword rule as one `note contains …` rule and does not drop `transaction_category_rules`.

`20260916125718_invoice_payment_matching.sql` adds `transactions.variable_symbol` (digits only, at most ten, the SPAYD limit), `matched_at` and `match_source` (`auto` or `manual`), plus a partial index for the unmatched-income scan and one for the invoice→payment lookup. It adds columns and indexes only: `transactions.invoice_id` and the insert/update policies that verify the invoice's owner already existed, no new foreign reference is introduced, and the four own-only `transactions` policies cover the new columns unchanged.

The 2026-09-16 migrations were applied to production before their code reached `main`, and their files carry the versions production recorded. Four 2026-09-25 migrations reconcile them with the kickoff: `20260925200000_fix_project_parent_policies.sql` recreates the `projects` insert and update policies with `projects.parent_id`, because the 2026-09-16 check bound `parent_id` to the inner row and rejected every row with a parent; `20260925200100_project_engagement_replaces_scope.sql` drops `projects.scope`, leaving `engagement` as the one own-versus-client field; `20260925200200_project_competition_tab.sql` adds `competition` to the `hidden_project_tabs` check; and `20260925200300_drop_link_project_references.sql` drops the unused `ai_link_projects` and `projects.video_url` from the archived busy-carson line, refusing when either holds data. `20260925210000_restrict_purge_old_cron_runs.sql` then revokes the `SECURITY DEFINER` retention function `purge_old_cron_runs()` from `anon` and `authenticated`, which Supabase's default privileges had granted it directly, and leaves it to `service_role` and the scheduler.

`20260916125652_organization_registry_verification.sql` adds `organizations.ares_verified_at` and the cached VIES verdict (`vat_verification_status` constrained to `unchecked`/`valid`/`invalid`/`unavailable`, `vat_verified_at`, `vat_verified_id`, `vat_verified_name`, `vat_verified_address`). It adds columns only: no table, no policy, no grant and no function, so the four own-only `organizations` policies cover the new columns unchanged. Both registry routes authenticate the caller, rate-limit per user and only read; the Supabase write stays in the browser mutation, so no service-role client is involved.

## Exports

Authenticated, private/no-store JSON downloads are available at:

- `/api/export/full`
- `/api/export/financial`
- `/api/export/professional`
- `/api/export/knowledge`
- `/api/export/projects`
- `/api/export/notes`
- `/api/export/prompts`
- `/api/export/career`
- `/api/export/legacy`

Table-level CSV is available for non-full, non-legacy scopes through `?format=csv&table=TABLE`, with the table restricted to that scope's allowlist. The legacy endpoint reads `legacy_personal_archives` after migration and falls back to live legacy tables before migration. Missing optional tables are represented as unavailable rather than causing the whole export to fail. Full export includes a safe profile/preferences subset and deliberately excludes OAuth tokens, service credentials, and provider secrets.

## AI boundary

The app has no LLM-backed AI. The only remaining "AI"-labelled route is `/api/ai-links/enrich`, which reads the URL the user submitted through Jina Reader (https://r.jina.ai) and returns page title + description for review — no model call, no owner-data context sent. Owner records (notes, projects, invoices, transactions, tasks, applications) are never sent to any external service.

Invoice PDF extraction stays local to the browser and deterministic. The selected file is parsed with `pdf.js`, is not sent anywhere, and is not stored.

See [AI and privacy](./docs/ai-and-privacy.md).

## Integration status

Settings calls authenticated, private/no-store endpoints. UI preferences are loaded at the server boundary and hydrate the existing local cache, while edits are upserted into the own-only `user_preferences` row for cross-device consistency. Active projects use the canonical `projects.is_active` field rather than a second preference list; a bounded active-project navigation seed is the only project data loaded for routes that otherwise do not need projects. Integration status reports only connection/configuration booleans and the user's latest bank-sync timestamp. OAuth token tables are checked server-side with the service role after user authentication; tokens and secret values never enter the response.

## Internationalization

Czech and English dictionaries share typed interfaces. New professional copy is in `src/lib/i18n/sections/professional.ts`. Product identity is centralized in `src/lib/brand.ts` and reused by document metadata, PWA manifest, login, app, and navigation.

## Product design and public surfaces

The authoritative product-design system lives under `docs/design/`. Its thesis is calm operational intelligence for one professional, expressed through macOS-native operational cartography: a graphite desktop, contained working window, translucent dark navigation, compact toolbar, aligned ledger-like rows, restrained system accents, and explicit evidence. The implementation maps the approved macOS register to semantic surface, sidebar, toolbar, interaction, status and chart tokens. Status labels are canonical and localized rather than formatting database enums at render time.

The public surface remains a private sign-in entry, not a marketing site. It uses the centralized brand mark, explains the own-only operating model, keeps Google sign-in primary, handles callback errors, and exposes a media seam without shipping placeholder artwork. A future media pass must research current low-cost or free generators from primary sources and may use only a documented option with acceptable rights, privacy, watermark, and format behavior. Prompts and intended placements remain in `docs/design/generated-media-manifest.json`; production metadata does not reference proposed files.

The web app manifest and dynamic icon route reuse the same name-independent brand symbol. The authenticated shell can expose the browser install prompt through the existing mobile PWA affordance. There is no custom offline data cache or service worker: authenticated records and integrations remain online-dependent, which avoids presenting stale financial, invoice, or operational data as current. `/dev-preview` is fixture-only and returns 404 in ordinary production; only Playwright's local optimized build exposes it through the server-only `NEXT_E2E=1` flag.

Future coding agents start with `AGENTS.md` and `CLAUDE.md`, then use the narrow product, design-system, visual-QA, release, and deferred-media skills in `.claude/skills/`. The project commands under `.claude/commands/` implement repository inspection, screen work, visual QA, asset production, and release validation against real paths.

## Testing

- Vitest covers existing financial/date/invoice/job utilities plus canonical navigation repair, project-health behavior, repository matching and rename planning, own/freelance grouping, project and prompt links, the prompt copy composer, curated prompts, Tools grouping and cost, and the on-demand data boundary.
- Vitest also guards the atomic Inbox-routing migration, the migration contracts (RLS and check constraints), localized presentation labels, and local documentation links.
- Playwright navigates every visible section and the nested project workspace, checks removed and hidden navigation, exercises stale preference repair, responsive behavior, customization, login and auth errors, mobile destination access, the freelance divider, project links, prompt grouping and copy preview, Tools, the Career and Opportunities check button, Career table containment/sorting, project Communication, subscription classification/renewals, and axe accessibility scans.
- Responsive coverage explicitly checks 360, 430, 768, 1024, 1440, and 1728 px, with a Czech narrow view and a dark 1024 px view.
- Production build is a required verification step because the shell spans server/client boundaries and lazy chart/editor bundles.

## Career application pipeline

The owner-scoped company directory, Google Drive letter links, prepared queue, atomic sent transition and response metrics are described in [Career pipeline](docs/career-pipeline.md). The additive migration is `20260911080040_career_directory_and_application_pipeline.sql`.

Applied also has a stage board beside its list: five columns over the existing `job_applications.status` plus the `saved_job_positions` queue, where a drag writes through the same `update_job_application_progress` RPC and a saved position still becomes an application only through the review dialog. Every card carries a stage menu, so the board needs no pointer. A due follow-up now also appears on the Work overview and in the Home hero's follow-up column, derived from the loaded records rather than written to `notifications`. Structured `contact_name` and `contact_email` arrive with the additive `20260916141348_job_application_contacts.sql`; until it is applied the dialog says the fields need it.

## Resource library

The Links section provides categorized resources with compact expandable cards, pricing dots and a visible legend, combined search/category/pricing/project filters, "Used by" project chips, and existing edit/delete actions. A category header can also merge its category into another one or into Uncategorized, and headers whose names differ only by accents, case, separators or an English plural are flagged as merge candidates. Storage, pricing boundaries, URL handling and verification are described in [Resource library](docs/link-library.md).
