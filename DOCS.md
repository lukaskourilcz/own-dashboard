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

Inbox is a triage queue, not a second task list. Manual captures and integration events land as `inbox_items`; notification records are visible in the same action center and through the sidebar unread indicator. Search, source/status/destination filters, snooze, dismiss, restore, source links, and bulk dismiss support deliberate triage. A user chooses the destination and clicks Process; only then is the destination record created or a transaction categorized and the inbox item marked processed. Valid relationship identifiers in an item's payload are carried into routed records and are rechecked by RLS.

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

The cleanup migration snapshots retired rows per user into `legacy_personal_archives`, restores own-only read policies, drops the couple relationship from dates, and then removes Pulse, streak, book, couple, invite, sharing, and helper-function storage.

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

AI is contextual rather than a global chat surface. `/api/quick-add` returns a structured proposed action only. Task and inbox writes require user confirmation; calendar proposals open the existing prefilled form for review. AI link enrichment proposes metadata but the existing form remains the save boundary.

`/api/ai/project-copilot` loads only an authenticated, owned project's bounded related context and returns validated facts, risks, suggestions, and deterministic source identifiers. Notes and invoice metadata are excluded unless sensitive-context opt-in is enabled. `/api/ai/weekly-brief` requires that opt-in, reads a bounded multi-domain operating snapshot, and fills the editable weekly-review draft only after explicit consent. Saving or completing the review remains a separate user action. Both endpoints are rate-limited, read-only, and reject invalid structured model output.

AI enablement and sensitive-context opt-in live in `user_preferences`. Sensitive opt-in defaults off. Intent, enrichment, and synthesis model ids plus the compatible provider base URL are centralized in `src/lib/ai-config.ts`. See [AI and privacy](./docs/ai-and-privacy.md).

## Integration status

Settings calls an authenticated, private/no-store status endpoint. It reports only connection/configuration booleans and the user's latest bank-sync timestamp. OAuth token tables are checked server-side with the service role after user authentication; tokens and secret values never enter the response.

## Internationalization

Czech and English dictionaries share typed interfaces. New professional copy is in `src/lib/i18n/sections/professional.ts`. Product identity is centralized in `src/lib/brand.ts` and reused by document metadata, PWA manifest, login, app, and navigation.

## Testing

- Vitest covers existing financial/date/invoice/job utilities plus canonical navigation repair, project-health behavior, and strict AI-output validation.
- Playwright navigates every professional section and the nested project workspace, checks removed navigation, exercises stale preference repair, responsive behavior, customization, login, and axe accessibility scans.
- Production build is a required verification step because the shell spans server/client boundaries and lazy chart/editor bundles.
