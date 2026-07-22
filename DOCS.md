# OwnDashboard architecture

## Product model

OwnDashboard is an own-only professional operating system. The main entities form a connected graph:

```text
Organization ─┬─ Opportunities ── won conversion ── Project
              ├─ Projects
              └─ Invoices

Project ──────┬─ Tasks          Opportunity ── Tasks / Notes / Prompts
              ├─ Notes
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

Home shows the daily operating context: calendar, deadlines, opportunity follow-ups, recurring spend, open tasks, active projects, quick capture, and configurable widgets. The retired habit KPI/widget was replaced by project/work attention.

### Inbox

Inbox is a triage queue, not a second task list. Manual captures and integration events land as `inbox_items`; notification records are visible in the same action center and through the sidebar unread indicator. Notifications support safe source links, mark-read, snooze, and dismiss actions. Inbox search, source/status/destination filters, snooze, dismiss, restore, source links, and bulk dismiss support deliberate triage. A user chooses the destination and clicks Process; only then does the `route_inbox_item` `SECURITY INVOKER` RPC create or update the destination and mark the item processed in one transaction. Retries return the recorded route instead of creating duplicates. Valid relationship identifiers in an item's payload are carried into routed records and are rechecked by RLS.

### Work

Work overview summarizes active projects, open opportunities, due follow-ups, issued invoices, explainable project-health warnings, and the current weekly review. Health is a transparent heuristic based on on-hold status, overdue linked tasks, disabled crons, and costs without recorded revenue.

Projects retain the mature GitHub, notes, cost, and cron implementation. Each project has a canonical workspace with Overview, Tasks, Activity, Repository, Operations, Finance, and Knowledge tabs. Revenue has an explicit currency and workspace finance converts revenue, costs, subscriptions, transactions, and invoices through the single deterministic static FX table.

Opportunities provide the Tugedr/referral/direct/inbound pipeline. After browser confirmation, the `convert_opportunity_to_project` security-invoker RPC locks the owned opportunity and atomically creates or links its organization, creates the project, preserves the opportunity currency as project revenue currency, and marks the opportunity won. A failure rolls back the whole conversion. Clients are organizations with connected projects, opportunities, invoices, tasks, notes, and dates. Career and Invoices reuse the established implementations.

### Money

Money preserves accounts, transactions, bank synchronization, subscriptions, categories, charts, and project infrastructure costs. Canonical child routes currently open the same integrated financial workspace so no mature functionality is duplicated.

### Planning and Library

Planning preserves Tasks, Google Calendar, Goals (the renamed plans system), and own-only professional Dates. Library preserves Notes, Prompts, Links (the broadened link catalogue), and References (commands plus editable cheatsheets).

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

AI is contextual rather than a global chat surface. `/api/quick-add` returns a structured proposed action only. Task and inbox writes require user confirmation; calendar proposals open the existing prefilled form for review. It can also route an owned-record question to `/api/ai/search`, which requires sensitive-context opt-in and explicit consent, reads a bounded professional snapshot, and returns a read-only answer with validated source identifiers. AI link enrichment proposes metadata but the existing form remains the save boundary.

`/api/ai/project-copilot` loads only an authenticated, owned project's bounded related context and returns validated facts, risks, suggestions, and deterministic source identifiers. Notes and invoice metadata are excluded unless sensitive-context opt-in is enabled. `/api/ai/weekly-brief` requires that opt-in, reads a bounded multi-domain operating snapshot, and fills the editable weekly-review draft only after explicit consent. Saving or completing the review remains a separate user action.

`/api/ai/career-copilot` grounds one owned listing against bounded projects, notes, repository notes, applications, and events; it returns evidence, gaps, suggestions, a cover-letter draft, and interview questions without changing the application. `/api/ai/knowledge-review` returns maintenance proposals from bounded notes, prompts, AI links, projects, repository notes, and reference rows. Search, career, and knowledge workflows require an explicit browser confirmation, are rate-limited and read-only, validate every cited identifier against the server-loaded source set, and reject invalid structured model output.

Invoice PDF extraction stays local to the browser and deterministic. The selected file is parsed with `pdf.js`, is not sent to an AI provider, and is not stored. A model fallback is intentionally omitted until secure temporary upload and provider-retention behavior can be guaranteed.

AI enablement and sensitive-context opt-in live in `user_preferences`. Sensitive opt-in defaults off. Intent, enrichment, and synthesis model ids plus the compatible provider base URL are centralized in `src/lib/ai-config.ts`. See [AI and privacy](./docs/ai-and-privacy.md).

## Integration status

Settings calls an authenticated, private/no-store status endpoint. It reports only connection/configuration booleans and the user's latest bank-sync timestamp. OAuth token tables are checked server-side with the service role after user authentication; tokens and secret values never enter the response.

## Internationalization

Czech and English dictionaries share typed interfaces. New professional copy is in `src/lib/i18n/sections/professional.ts`. Product identity is centralized in `src/lib/brand.ts` and reused by document metadata, PWA manifest, login, app, and navigation.

## Product design and public surfaces

The authoritative product-design system lives under `docs/design/`. Its thesis is calm operational intelligence for one professional, expressed through operational cartography: aligned relationships, compact ledger-like rows, restrained signals, and explicit evidence. The implementation extends the existing neutral foundation with semantic paper, stone, graphite, ink, amber, success, risk, integration, AI, and chart tokens. Status labels are canonical and localized rather than formatting database enums at render time.

The public surface remains a private sign-in entry, not a marketing site. It uses the centralized brand mark, explains the own-only operating model, keeps Google sign-in primary, handles callback errors, and exposes a media seam without shipping substitute artwork. Higgsfield assets remain deferred in `docs/design/generated-media-manifest.json`; production metadata does not reference proposed files.

The web app manifest and dynamic icon route reuse the same name-independent brand symbol. The authenticated shell can expose the browser install prompt through the existing mobile PWA affordance. There is no custom offline data cache or service worker: authenticated records and integrations remain online-dependent, which avoids presenting stale financial, invoice, or operational data as current. `/dev-preview` is fixture-only and returns 404 in production.

Future coding agents start with `AGENTS.md` and `CLAUDE.md`, then use the narrow product, design-system, visual-QA, release, and deferred-media skills in `.claude/skills/`. The project commands under `.claude/commands/` implement repository inspection, screen work, visual QA, asset production, and release validation against real paths.

## Testing

- Vitest covers existing financial/date/invoice/job utilities plus canonical navigation repair, project-health behavior, and strict AI-output and citation validation.
- Vitest also guards the atomic Inbox-routing migration, localized presentation labels, and local documentation links.
- Playwright navigates every professional section and the nested project workspace, checks removed navigation, exercises stale preference repair, responsive behavior, customization, login and auth errors, contextual AI proposal flows, mobile destination access, and axe accessibility scans.
- Responsive coverage explicitly checks 360, 430, 768, 1024, 1440, and 1728 px, with a Czech narrow view and a dark 1024 px view.
- Production build is a required verification step because the shell spans server/client boundaries and lazy chart/editor bundles.
