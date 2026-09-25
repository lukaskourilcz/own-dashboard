# OwnDashboard

OwnDashboard is a bilingual, self-hosted personal operating system for running professional work. It connects projects, client acquisition, clients, career, invoices, costs, planning, and reusable knowledge in one authenticated, own-data-only workspace.

It is deliberately a personal application—not a SaaS, team workspace, CRM, or accounting suite. OwnDashboard remains the temporary product name until a replacement is explicitly approved; all application branding is centralized in `src/lib/brand.ts`.

## Product areas

- **Home** — an attention-focused daily surface with a priority-first randomized seven-task focus, a 49-day completion garden and task waiting age. Inbox (capture, notifications, routing into records) and References are hidden from navigation and still open at `/inbox` and `/references`.
- **Work** — portfolio overview, explainable project health, guided weekly planning (last week's calendar time by client, own-project and admin channel, finished focus tasks, carry-forward, next week's objectives, a summary), project workspaces, client opportunities, organizations/clients with ARES fill and VIES VAT checks, Career, and the canonical invoice workflow.
- **Projects** — a sortable portfolio table with the owner's own products first and freelance client work behind a "Freelance — hired" divider, plus a workspace per project with overview, the library links the project uses, tasks, activity, client communication history, GitHub repository documents, development/production links, crons with heartbeat freshness, finance with shared-subscription allocations, competition, knowledge, scaling and monetization. The daily projects come from a code-level registry, so they exist without GitHub, and the boardlessAI ventures Design Lab and GoVIRAL are listed under their parent. Projects match GitHub repositories by id, so a repository rename updates the project instead of duplicating it; renamed projects keep their earlier slugs as redirects.
- **Competition** — per-project competitor research: most useful features, social-media content, pricing model, lessons, a relevance score and a review date that is marked as needing a refresh once it is 90 days old.
- **Opportunities and clients** — a manual pipeline for Tugedr, referral, direct, inbound, and existing-client leads; won opportunities convert transactionally into linked organizations and projects only after confirmation. Tugedr is a client-opportunity source, never Pulse or mood tracking. Opportunities loads nothing until **Check for new offers** is pressed.
- **Career** — a React-focused Prague/remote job workspace that loads nothing until **Check for new offers / Zkontrolovat nové nabídky** is pressed; the press refreshes employer feeds and job boards and checks which listings are still open. It keeps an owner-scoped company directory, position-specific English/Czech letter guidance, saved positions with URL import and persistent drafts, prepared applications with Google Drive letters, sent dates and response statistics, application history, cover-letter templates, a stage board with contacts and follow-up dates, and permanent owner-scoped deletion.
- **Money and invoices** — a development-finance overview (recurring tooling and hosting spend split between own projects, client projects and unallocated overhead, per-project and per-vendor breakdowns, a committed-versus-paid timeline, and how much rests on amounts not yet checked against an invoice), accounts, CSV import and bank sync behind one provider interface (GoCardless, Fio, Enable Banking), staged transaction rules that file a payment by description, account, amount, date or direction and can be applied retroactively, deterministic pairing of incoming payments with issued invoices by variable symbol and amount, subscriptions grouped by operational purpose and importance with lifecycle dates, renewal countdowns and project allocations, project costs, static FX summaries, Czech VAT-aware invoices, QR Platba, print output, and deterministic PDF text extraction with a review form.
- **Planning** — GLOBAL priority-6 tasks, active-project/client-linked tasks, Google Calendar agenda and event creation, professional goals, and project/organization-linked deadlines, launches, renewals, interviews, and milestones.
- **Library** — BlockNote notes with full-context copy and automatic stale-empty cleanup; prompts grouped by the kind of job (design, audit, competition, UX and UI, analysis, documentation, new project, SEO, marketing) with the links an agent should open and a copy preview that fills in a project and its links; Tools, the library links really in use with what each does and how it helps each project; and masonry-grouped enriched links showing which projects use them. Project Knowledge reads Tech stack and third-party library summaries from `about-project.md`.
- **Settings** — database-synchronized appearance, navigation, task density, CV links, active GitHub projects, integrations, notification controls, AI/privacy consent, own-only exports, legacy archive download, and account controls.

Pulse, habits/streaks, books/reading, and couples mode are retired. The cleanup migration archives their rows before removal, restores strict own-only policies, and keeps the archive downloadable from Settings → Data & export.

## AI and safety boundaries

OwnDashboard makes no model calls. Link enrichment reads the submitted URL through Jina Reader and fills the form for review; the prompt library only composes text for the owner to copy. Owner records are never sent to an external model. See [AI and privacy](./docs/ai-and-privacy.md). Invoices are marked paid by the deterministic payment matcher in `src/lib/payment-matching.ts`, which compares a variable symbol and an amount, or by hand.

## Architecture and stack

| Layer | Implementation |
| --- | --- |
| Web | Modified Next.js `16.2.6` App Router, React `19.2`, strict TypeScript 5, Tailwind CSS 4, Motion |
| Data/auth | Supabase Postgres and Auth via `@supabase/ssr`/`supabase-js`; explicit Data API grants and own-only RLS |
| Client data | TanStack React Query 5 with centralized keys, route-scoped server seeds, lazy destination fetches, bounded stale times, invalidation, cancellation, and optimistic updates where reversible |
| UI | Radix primitives, Lucide, Recharts, BlockNote, date-fns, QRCode |
| Extraction | pdf.js deterministic invoice extraction in the browser; optional Jina Reader link enrichment |
| Operations | Vercel functions/crons, optional Upstash rate limiting, Resend email, PostHog analytics/flags, Sentry monitoring |
| Integrations | Google Calendar OAuth, GitHub OAuth/repository files and commits, bank sync through GoCardless, Fio banka or Enable Banking |
| Quality | ESLint, TypeScript, Vitest, Playwright, axe accessibility checks |

The authenticated dashboard uses one canonical catch-all route and interactive shell to preserve navigation state. The server now seeds only the entities required by the requested destination; moving within the shell enables the corresponding React Query fetchers on demand. Google Calendar windows follow the same model through an authenticated, bounded endpoint. Supabase RLS remains the final data boundary, including ownership checks on related project and organization IDs.

## Information architecture and routes

```text
Home
Work: Overview · Projects · Competition · Opportunities · Clients · Career · Invoices
Money: Overview · Accounts · Transactions · Subscriptions · Categories
Planning: Tasks · Calendar · Goals · Dates
Library: Notes · Prompts · Tools · Links
Settings
Hidden from navigation, open by URL: /inbox · /references
```

Project workspaces use `/projects/[id-or-slug]`; an earlier slug (for example `/projects/aifirst`) redirects to the current one. Meaningful old bookmarks redirect:

- `/overview` → `/`
- `/todos` → `/tasks`
- `/plans` → `/goals`
- `/jobs` → `/career`
- `/finances` → `/money`
- `/github`, `/repositories`, `/costs`, `/scaling` → `/projects`
- `/ai`, `/ai-links` → `/links`
- `/shortcuts` → `/references`
- `/tugedr` → `/opportunities`

Removed personal destinations such as `/streaks`, `/books`, and `/couple` return 404. Stale stored navigation preferences are normalized and cannot resurrect removed sections.

## Local setup

1. Install dependencies:

```bash
npm ci
```

2. Copy `.env.example` to `.env.local`. The minimum browser-safe variables are:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-OR-ANON-KEY
```

All optional AI, OAuth, cron, email, bank, rate-limit, analytics, and monitoring variables are documented inline in `.env.example` and in [External setup](./docs/external-setup.md).

3. Prepare the database.

For a new database, run `supabase/schema.sql` once, create the one owner account in Supabase Auth, then apply every migration in timestamp order. The owner account has to exist before `20260908063200_seed_owner_saved_positions.sql`, which refuses to run unless `auth.users` holds exactly one row. `npx supabase db reset` cannot build this schema: it applies only `supabase/migrations`, and the first migration alters tables that only the baseline creates. The exact commands are in [Fresh install](./docs/migration-guide.md#fresh-install).

For an existing installation, link the intended Supabase project and push migrations in timestamp order:

```bash
npx supabase db push --linked
```

The migrations, in the order they run:

1. `20260721165419_professional_restructure_core.sql` — professional entities, relationships, explicit grants/indexes, transaction-safe opportunity conversion, and own-only relationship policies.
2. `20260721165421_remove_legacy_personal_scope.sql` — archive legacy data, restore own-only reads, then remove retired personal tables and sharing infrastructure.
3. `20260722150000_atomic_inbox_routing.sql` — route one owned Inbox item and mark it processed in a single `SECURITY INVOKER` transaction.
4. `20260722190000_operational_workflow_extensions.sql` — subscription grouping/importance, project development links and communication history, plus the own-only VPS agent task queue and atomic claim RPC.
5. `20260723065433_daily_focus_synced_preferences.sql` — GLOBAL task priority, daily focus sets/completion garden, synchronized UI preferences, and permanent owner-scoped Career deletion tombstones.
6. `20260723082424_sync_preferences_project_tabs.sql` — reliable authenticated preference grants and own-only policies, synchronized project-workspace tab visibility, and repository-aware daily-focus selection.
7. `20260723120000_prompts_description.sql` — a short description on each prompt.
8. `20260724090000_task_time_and_kind.sql` — estimated minutes and a work kind on tasks.
9. `20260724100000_prompts_visibility.sql` — `prompts.is_public`, separating the owner's prompts from curated ones.
10. `20260724110000_cron_runs.sql` — the `cron_runs` log and its two-week purge function.
11. `20260908062146_add_saved_job_positions.sql` — `saved_job_positions` with own-only RLS.
12. `20260908063200_seed_owner_saved_positions.sql` — seeds eight saved positions for the single owner and raises an exception when `auth.users` does not hold exactly one row.
13. `20260911080040_career_directory_and_application_pipeline.sql` — `career_companies`, application readiness and response tracking, and the application RPCs.
14. `20260911102058_freelance_opportunities.sql` — `freelance_platforms`, freelance fields on opportunities, and the `opportunity_events` history written by a trigger.
15. `20260911103455_freelance_metrics.sql` — the `freelance_opportunity_metrics` RPC.
16. `20260911104131_freelance_resources.sql` — `freelance_platforms.resources_url`.
17. `20260915210805_link_ideas_and_relevance.sql` — record type, rating, pricing evidence and project relevance on library links.
18. `20260916094243_portfolio_works_competition_finance.sql` — project subsections (`parent_id`) and registry keys (`portfolio_key`), subscription lifecycle fields and the quarterly cycle, subscription allocations, transaction-to-subscription links, competitor research, and the since-dropped `projects.scope`.
19. `20260916125652_organization_registry_verification.sql` — ARES fill provenance and the cached VIES verdict on organizations.
20. `20260916125708_subscription_amount_confirmation.sql` — `subscriptions.amount_confirmed_on`.
21. `20260916125718_invoice_payment_matching.sql` — variable symbol, match time and match source on transactions, for pairing payments with invoices.
22. `20260916125742_transaction_rules.sql` — staged, specificity-ranked `transaction_rules`, backfilled from the legacy keyword rules.
23. `20260916135326_cron_heartbeats.sql` — per-cron push-monitor URL and last-success timestamp, so a scheduled job that stops running is visible instead of silent.
24. `20260916141348_job_application_contacts.sql` — contact name and address on job applications.
25. `20260916141837_bank_provider_abstraction.sql` — provider-neutral bank connections and service-role-only `bank_provider_credentials`.
26. `20260916195556_link_project_references.sql` — `ai_link_projects` and `projects.video_url` from the archived busy-carson line; superseded by `project_links` and dropped again below.
27. `20260925090000_project_repository_identity.sql` — `projects.repo_id`, earlier repository names, and repository-id matching in `create_daily_focus_set`.
28. `20260925090100_project_engagement_and_names.sql` — own versus client projects, `previous_slugs`, and the DNESKAi / devShark / boardlessAI renames.
29. `20260925090200_fix_hidden_project_tabs_check.sql` — the corrected project-tab check on `user_preferences.hidden_project_tabs`.
30. `20260925090300_project_links.sql` — `project_links`.
31. `20260925090400_prompt_kinds_and_links.sql` — `prompts.kind` and `prompt_links`.
32. `20260925090500_tools.sql` — `tools`.
33. `20260925200000_fix_project_parent_policies.sql` — the corrected parent-ownership check in the `projects` insert and update policies.
34. `20260925200100_project_engagement_replaces_scope.sql` — drops `projects.scope`; `engagement` is the one own-versus-client field.
35. `20260925200200_project_competition_tab.sql` — adds `competition` to the `user_preferences.hidden_project_tabs` check.
36. `20260925200300_drop_link_project_references.sql` — guarded drop of the unused `ai_link_projects` and `projects.video_url`.

The freelance set (14–16), each 2026-09-16 migration (18–26) and each 2026-09-25 migration (27–36) have an entry with verification steps in the migration guide. Migrations 18–32 are applied in production; 33–36 are the pending ones.

Do not rerun `supabase/schema.sql` on an existing project, and do not apply the cleanup migration alone. Never copy a migration's objects back into `supabase/schema.sql`; every schema change is a new migration file. No repository change claims that a linked/production database was migrated. Follow [Migration and rollback](./docs/migration-guide.md).

4. Start the app:

```bash
npm run dev
```

Open <http://localhost:3000>. `/dev-preview` provides deterministic data for local UI validation and returns 404 in ordinary production builds. Playwright alone sets the server-only `NEXT_E2E=1` flag on its local optimized test build; never configure that flag in a deployed environment.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm run test
npm run build
npm run test:e2e
```

The deterministic `/dev-preview` harness drives the Playwright responsive matrix at 360, 430, 768, 1024, 1440, and 1728 px, including mobile destination access, Czech copy, dark mode, overflow, axe checks, PWA metadata, and single-page A4 invoice output. It contains fixtures only and remains unavailable in deployed production.

## Product design and media

OwnDashboard follows the documented **calm operational intelligence** thesis through a **macOS-native operational cartography** visual direction. The authenticated product is framed as a private graphite desktop window with translucent navigation, compact toolbar, semantic system accents, dense tables, canonical localized statuses, one Lucide icon family, and authentic application rendering. Generated UI, fabricated metrics, and filler illustration are prohibited.

No generated brand media is currently shipped. The next media-production pass must compare at least three current low-cost or free generators from primary provider sources and may use only a documented option with suitable output rights, privacy, formats, and no watermark. The login layout exposes its media seam, existing empty states remain complete without illustration, and the manifest records prompts and proposed destinations without referencing nonexistent files.

## Deployment and owner actions

The repository cannot safely configure external account secrets, OAuth consent screens, production domains, or a linked Supabase project. The current owner-only rollout list is in [NEEDED.md](./NEEDED.md). Cost tiers and scaling triggers are documented in [scaling.md](./scaling.md).

## More documentation

- [Architecture and product reference](./DOCS.md)
- [Changelog — what shipped, by date](./CHANGELOG.md)
- [External services, callbacks, and rename checklist](./docs/external-setup.md)
- [Migration and rollback](./docs/migration-guide.md)
- [Portfolio, Competition and development finance](./docs/portfolio-competition-finance.md)
- [AI and privacy](./docs/ai-and-privacy.md)
- [Product design audit](./docs/design/product-design-audit.md)
- [Reference research](./docs/design/reference-research.md)
- [Brand system](./docs/design/brand-system.md) and [design system](./docs/design/design-system.md)
- [Brand-media opportunity audit](./docs/design/brand-media-opportunity-audit.md), [art direction](./docs/design/brand-media-art-direction.md), and [manifest](./docs/design/generated-media-manifest.json)
- [Visual QA record](./docs/design/visual-qa.md)
- [Future-agent control document](./CLAUDE.md)

Career source research, operating limits and optional Apify setup: [Career workspace](docs/career-workspace.md).

Career tracking and integration decisions: [Career pipeline](docs/career-pipeline.md).
