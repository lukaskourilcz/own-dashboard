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
              └─ Dates / Prompts

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

Home shows the daily operating context: calendar, deadlines, opportunity follow-ups, recurring spend, active projects, quick capture, and configurable widgets. Its task surface transactionally snapshots up to seven open tasks each day, ordered by priority and randomized within priority bands. GLOBAL tasks are database-enforced priority 6. Completing all seven marks that professional workday in a 49-day GitHub-style completion garden; this is task execution history, not the retired lifestyle streak feature.

### Inbox

Inbox is a triage queue, not a second task list. Manual captures and integration events land as `inbox_items`; notification records are visible in the same action center and through the sidebar unread indicator. Notifications support safe source links, mark-read, snooze, and dismiss actions. Inbox search, source/status/destination filters, snooze, dismiss, restore, source links, and bulk dismiss support deliberate triage. A user chooses the destination and clicks Process; only then does the `route_inbox_item` `SECURITY INVOKER` RPC create or update the destination and mark the item processed in one transaction. Retries return the recorded route instead of creating duplicates. Valid relationship identifiers in an item's payload are carried into routed records and are rechecked by RLS.

### Work

Work overview summarizes active projects, open opportunities, due follow-ups, issued invoices, explainable project-health warnings, and the current weekly review. Health is a transparent heuristic based on on-hold status, overdue linked tasks, disabled crons, and costs without recorded revenue.

Projects use a sortable summary table with a dedicated non-text drag handle. Each project has a canonical workspace with Overview, Tasks, Activity, Communication, Repository, Operations, Finance, and Knowledge tabs. Communication records are project-owned timeline entries with channel, direction, contact, summary, and next action. Projects may store separate production and development URLs. Revenue has an explicit currency and workspace finance converts revenue, costs, subscriptions, transactions, and invoices through the single deterministic static FX table.

Career listings are rendered as a semantic, horizontally resilient table. Match is an explicit comparable column and users can sort by best/lowest match, remote availability, location, or discovery date. Rows support accessible bulk selection. Permanent deletion writes an owner-scoped `deleted` tombstone, so a shared scraped listing cannot reappear for that owner after refresh and one owner cannot mutate the global feed for another.

Opportunities provide the Tugedr/referral/direct/inbound pipeline. After browser confirmation, the `convert_opportunity_to_project` security-invoker RPC locks the owned opportunity and atomically creates or links its organization, creates the project, preserves the opportunity currency as project revenue currency, and marks the opportunity won. A failure rolls back the whole conversion. Clients are organizations with connected projects, opportunities, invoices, tasks, notes, and dates. Career and Invoices reuse the established implementations.

### Money

Money preserves accounts, transactions, bank synchronization, subscriptions, categories, charts, and project infrastructure costs. Subscriptions retain a custom detail category and add a canonical operational group (`development`, `entertainment`, `business`, `infrastructure`, `productivity`, `finance`, or `other`) plus an importance level. Active records require a next billing date in the UI; every recurring-spend view shows the date and remaining/overdue days. Canonical child routes currently open the same integrated financial workspace so no mature functionality is duplicated.

### Planning and Library

Planning preserves Tasks, Google Calendar, Goals (the renamed plans system), and own-only professional Dates. Tasks distinguish GLOBAL work from active-project work and exclude inactive-project tasks from operational surfaces. Library preserves Notes, Prompts, Links (the broadened link catalogue), and References. Empty notes older than the editing grace period are removed automatically; every note exposes full-context copy. Link categories use masonry columns so unequal groups do not create empty grid rows. Project Knowledge parses `about-project.md` into Tech stack and third-party library lists and can explicitly recheck GitHub.

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

`20260722190000_operational_workflow_extensions.sql` adds `project_communications` and `agent_tasks`, both with explicit Data API grants, indexed owner/relationship access, own-only RLS, and foreign-project ownership checks. `claim_agent_task` remains `SECURITY INVOKER`, uses `FOR UPDATE SKIP LOCKED`, and is executable only by `service_role`; the browser cannot invoke it.

`20260723065433_daily_focus_synced_preferences.sql` extends task importance to 6, enforces GLOBAL task scope in a trigger, and adds own-only `daily_focus_sets` plus snapshot items. The `create_daily_focus_set` RPC is `SECURITY INVOKER`, uses an owner/date advisory transaction lock, excludes inactive projects, and preserves historical titles if a task is later removed. The same migration stores language, theme, currency, navigation visibility/order, task density, and CV links in `user_preferences`, and migrates Career `hidden` state into durable owner-scoped `deleted` tombstones.

`20260723082424_sync_preferences_project_tabs.sql` makes those preferences reliably available to authenticated Data API callers with explicit own-only select/insert/update policies and grants. It adds `hidden_project_tabs`, which Settings synchronizes across devices, and updates the daily-focus RPC so imported NEEDED.md tasks resolve to their active project by repository when `project_id` is not populated. Client preference writes are serialized to preserve rapid toggle order; a failed server load no longer overwrites a valid device cache with defaults.

Project workspace navigation remains inside the persistent dashboard shell. Opening an active project updates History API state without forcing a new server render, browser back/forward restores the selected project, and choosing the canonical Projects destination clears the selection and restores the project table.

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

The authoritative product-design system lives under `docs/design/`. Its thesis is calm operational intelligence for one professional, expressed through macOS-native operational cartography: a graphite desktop, contained working window, translucent dark navigation, compact toolbar, aligned ledger-like rows, restrained system accents, and explicit evidence. The implementation maps the approved macOS register to semantic surface, sidebar, toolbar, interaction, status, AI, and chart tokens. Status labels are canonical and localized rather than formatting database enums at render time.

The public surface remains a private sign-in entry, not a marketing site. It uses the centralized brand mark, explains the own-only operating model, keeps Google sign-in primary, handles callback errors, and exposes a media seam without shipping placeholder artwork. A future media pass must research current low-cost or free generators from primary sources and may use only a documented option with acceptable rights, privacy, watermark, and format behavior. Prompts and intended placements remain in `docs/design/generated-media-manifest.json`; production metadata does not reference proposed files.

The web app manifest and dynamic icon route reuse the same name-independent brand symbol. The authenticated shell can expose the browser install prompt through the existing mobile PWA affordance. There is no custom offline data cache or service worker: authenticated records and integrations remain online-dependent, which avoids presenting stale financial, invoice, or operational data as current. `/dev-preview` is fixture-only and returns 404 in ordinary production; only Playwright's local optimized build exposes it through the server-only `NEXT_E2E=1` flag.

Future coding agents start with `AGENTS.md` and `CLAUDE.md`, then use the narrow product, design-system, visual-QA, release, and deferred-media skills in `.claude/skills/`. The project commands under `.claude/commands/` implement repository inspection, screen work, visual QA, asset production, and release validation against real paths.

## Testing

- Vitest covers existing financial/date/invoice/job utilities plus canonical navigation repair, project-health behavior, and strict AI-output and citation validation.
- Vitest also guards the atomic Inbox-routing migration, localized presentation labels, and local documentation links.
- Playwright navigates every professional section and the nested project workspace, checks removed navigation, exercises stale preference repair, responsive behavior, customization, login and auth errors, contextual AI proposal flows, mobile destination access, Career table containment/sorting, project Communication, Agents, subscription classification/renewals, and axe accessibility scans.
- Responsive coverage explicitly checks 360, 430, 768, 1024, 1440, and 1728 px, with a Czech narrow view and a dark 1024 px view.
- Production build is a required verification step because the shell spans server/client boundaries and lazy chart/editor bundles.
