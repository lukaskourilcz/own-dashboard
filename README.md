# OwnDashboard

OwnDashboard is a bilingual, self-hosted personal operating system for running professional work. It connects projects, client acquisition, clients, career, invoices, costs, planning, and reusable knowledge in one authenticated, own-data-only workspace.

It is deliberately a personal application—not a SaaS, team workspace, CRM, or accounting suite. OwnDashboard remains the temporary product name until a replacement is explicitly approved; all application branding is centralized in `src/lib/brand.ts`.

Start with the [system map](./docs/SYSTEM-MAP.md): what the app does today, how it connects to Supabase, Vercel, Quorum, Meta, Anthropic and the rest, and where each part lives.

## Product areas

- **Home** — an attention-focused daily surface with a priority-first randomized seven-task focus, a 49-day completion garden and task waiting age. Inbox (capture, notifications, routing into records) and References are hidden from navigation and still open at `/inbox` and `/references`.
- **Work** — portfolio overview, explainable project health, guided weekly planning (last week's calendar time by client, own-project and admin channel, finished focus tasks, carry-forward, next week's objectives, a summary), a read-only Marketing card with the next seven days across the marketing calendars, project workspaces, client opportunities, organizations/clients with ARES fill and VIES VAT checks, Career, and the canonical invoice workflow.
- **Projects** — a sortable portfolio table with the owner's own products first and freelance client work behind a "Freelance" divider, plus a workspace per project with overview, the library links the project uses, tasks, activity, client communication history, GitHub repository documents, development/production links, crons with heartbeat freshness, finance with shared-subscription allocations, competition, knowledge, scaling and monetization. The daily projects come from a code-level registry, so they exist without GitHub, and the boardlessAI ventures Design Lab and GoVIRAL are listed under their parent. Projects match GitHub repositories by id, so a repository rename updates the project instead of duplicating it; renamed projects keep their earlier slugs as redirects.
- **Competition** — per-project competitor research: most useful features, social-media content, pricing model, lessons, a relevance score and a review date that is marked as needing a refresh once it is 90 days old. Complete research snapshots page locally in groups of 50; search and filters cover the full snapshot.
- **Opportunities and clients** — a manual pipeline for Tugedr, referral, direct, inbound, and existing-client leads; won opportunities convert transactionally into linked organizations and projects only after confirmation. Tugedr is a client-opportunity source, never Pulse or mood tracking. Opportunities loads nothing until **Check for new offers** is pressed.
- **Career** — an Oslo-first frontend/fullstack/AI integration workspace with a ranked research grid, transparent profile-match scores, role dialogs and private English letters. It includes 41 official careers destinations, manual feed/availability checks, saved/ready/sent workflows and follow-up tracking. Czech sources and records remain behind the synchronized OFF-by-default Settings checkbox. See [Oslo research](docs/career-oslo-research.md).
- **Money and invoices** — a development-finance overview (recurring tooling and hosting spend split between own projects, client projects and unallocated overhead, per-project and per-vendor breakdowns, a committed-versus-paid timeline, and how much rests on amounts not yet checked against an invoice), accounts, CSV import and bank sync behind one provider interface (GoCardless, Fio, Enable Banking), staged transaction rules that file a payment by description, account, amount, date or direction and can be applied retroactively, deterministic pairing of incoming payments with issued invoices by variable symbol and amount, subscriptions grouped by operational purpose and importance with lifecycle dates, renewal countdowns and project allocations, project costs, static FX summaries, Czech VAT-aware invoices, QR Platba, print output, and deterministic PDF text extraction with a review form.
- **Planning** — GLOBAL priority-6 tasks, active-project/client-linked tasks, Google Calendar agenda and event creation, professional goals, and project/organization-linked deadlines, launches, renewals, interviews, and milestones.
- **Library** — BlockNote notes with full-context copy and automatic stale-empty cleanup; prompts grouped by the kind of job (design, audit, competition, UX and UI, analysis, documentation, new project, SEO, marketing) with the links an agent should open and a copy preview that fills in a project and its links; Tools, which lists by itself what the active projects' repositories use (their `about-project.md`, or `package.json` as a fallback) next to the library links added by hand with what each does, its status, cost and how it helps each project; masonry-grouped enriched links showing which projects use them; and IG TIPS, the tips saved from Instagram Reels and research, grouped by topic, each card saying in plain sentences what the tip is and how to use it and which loaded marketing plans reference it, read live from the devShark and DNESKAi calendars. Project Knowledge renders the linked repository's `about-project.md` as formatted Markdown.
- **Settings** — database-synchronized appearance, navigation, task density, CV links, active GitHub projects with an Own/Freelance choice for each active one, integrations, notification controls, own-only exports, legacy archive download, and account controls.

Pulse, habits/streaks, books/reading, and couples mode are retired. The cleanup migration archives their rows before removal, restores strict own-only policies, and keeps the archive downloadable from Settings → Data & export.

## AI and safety boundaries

Outside the owner-authorized marketing workflow (DNESKAi generation with Claude, story classification with Jev, and topic titling and FACT or HYPE verdicts with Claude Haiku behind their switches; see the [system map](./docs/SYSTEM-MAP.md)), OwnDashboard makes no model calls. Link enrichment reads the submitted URL through Jina Reader and fills the form for review; the prompt library only composes text for the owner to copy. Owner records are never sent to an external model. See [AI and privacy](./docs/ai-and-privacy.md). Invoices are marked paid by the deterministic payment matcher in `src/lib/payment-matching.ts`, which compares a variable symbol and an amount, or by hand.

## Architecture and stack

| Layer | Implementation |
| --- | --- |
| Web | Modified Next.js `16.4.3` App Router, React `19.2`, strict TypeScript 5, Tailwind CSS 4, Motion |
| Data/auth | Supabase Postgres and Auth via `@supabase/ssr`/`supabase-js`; explicit Data API grants and own-only RLS |
| Client data | TanStack React Query 5 with centralized keys, route-scoped server seeds, lazy destination fetches, bounded stale times, invalidation, cancellation, and optimistic updates where reversible |
| UI | Radix primitives, Lucide, Recharts, BlockNote, date-fns, QRCode |
| Extraction | pdf.js deterministic invoice extraction in the browser; optional Jina Reader link enrichment |
| Operations | Vercel functions/crons, optional Upstash rate limiting, Resend email, PostHog analytics, Sentry monitoring |
| Integrations | Google Calendar OAuth, GitHub OAuth/repository files and commits, bank sync through GoCardless, Fio banka or Enable Banking |
| Quality | ESLint, TypeScript, Vitest, Playwright, axe accessibility checks |

The authenticated dashboard uses one canonical catch-all route and interactive shell to preserve navigation state. The server now seeds only the entities required by the requested destination; moving within the shell enables the corresponding React Query fetchers on demand. Google Calendar windows follow the same model through an authenticated, bounded endpoint. Supabase RLS remains the final data boundary, including ownership checks on related project and organization IDs.

## Information architecture and routes

```text
Home
Work: Overview · Projects · Competition · Opportunities · Clients · Career · Invoices
Money: Overview · Accounts · Transactions · Subscriptions · Categories
Planning: Tasks · Calendar · Goals · Dates
Library: Notes · Prompts · Tools · Links · IG TIPS
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
- `/works` → `/projects`

Removed personal destinations such as `/streaks`, `/books`, and `/couple` return 404. Stale stored navigation preferences are normalized and cannot resurrect removed sections.

## Local setup

1. Use the security-patched Node 22 LTS version in `.nvmrc`, then install dependencies:

```bash
nvm install
nvm use
npm ci
```

CI reads the same runtime pin. Vercel uses the latest supported Node 22 patch through `engines.node`; verify the deployed patch during release. Update `.nvmrc` when adopting a newer Node 22 security release.

2. Copy `.env.example` to `.env.local`. The minimum browser-safe variables are:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-OR-ANON-KEY
```

`.env.example` lists the optional variables: OAuth, cron, heartbeat, email, bank, rate limiting, analytics, monitoring, Vercel Web Analytics and Apify. [External setup](./docs/external-setup.md) covers each provider account, and [Career workspace](./docs/career-workspace.md) covers the Apify import.

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
37. `20260925210000_restrict_purge_old_cron_runs.sql` — takes `purge_old_cron_runs()` away from `anon` and `authenticated`, leaving it to `service_role` and the scheduler.
38. `20260926140000_ig_tips.sql` — `ai_links.tip_group` and `ai_links.tip_summary`: the topic group and the plain summary each IG TIPS card shows.
39. `20261013193104_marketing_control_surface.sql` — owned campaigns/sources/revisions/approval and fenced publication queue.
40. `20261013193105_marketing_durable_jobs.sql` — consent-bound durable jobs, calendar rebinding and publishing receipts.
41. `20261013193106_marketing_knowledge_import.sql` — provenance-backed atomic procedures and consent-bound extraction.
42. `20261013193107_marketing_private_assets.sql` — private immutable worker assets with owner-prefix reads.
43. `20261013193108_marketing_staging_pilot_guard.sql` — immutable owner pilot limits, lifetime reservations and fenced invocation deadlines.
44. `20261013193131_marketing_offline_import.sql` — owner-bound offline draft imports with immutable review holds and active pilot checks.
45. `20261013193132_marketing_story_receipts.sql` — accepts a verified Story publication ID without requiring a permanent public URL.
46. `20261013193134_marketing_dneskai_collection.sql` — owner-scoped DNESKAi research collection, fenced daily runs and bounded provider reservations; no approval or publication.
47. `20261013193136_dneskai_collection_pilot.sql` — separate immutable Preview collection scope, one lifetime run with at most $0.24 reserved provider spend; generation limits and final approval requirements remain unchanged.
48. `20261015234547_oslo_career_preferences.sql` — synchronized Czech Career opt-in, OFF by default; preserves existing records.
49. `20261021122104_dneskai_collection_cursor_limits.sql` — DNESKAi collection cursor advances after a read capped only by its item limit; Instagram cap 10 per profile and 50 per day within the unchanged $0.25 daily ceiling; Jev stages planned from the candidate count (at most 16).
50. `20261021122220_marketing_account_tokens.sql` — one long-lived Meta token per marketing account, readable only through service-role functions; the owner sees expiry, refresh time and scopes.
51. `20261021122330_scope_retired_pilot_ledgers.sql` — retired October pilot ledgers block ordinary admission and paid collection only while their window is unexpired, and a reserved pilot job is never claimed as ordinary work; every ledger row and reservation is kept.
52. `20261021122453_dneskai_source_media.sql` — DNESKAi source pictures for selected topics: private `marketing-media` bucket (JPEG, PNG, WebP, 32 MiB), one asset per owner and sha256 with origin, order, size, pHash and credit, links per candidate, per-candidate collection state, and service-role functions for collection, lookup and retention.
53. `20261021122551_marketing_revision_media_identity.sql` — revisions keep their approval across signed-URL renewal: a service-role function rewrites only `assets[].url` for the same private objects; deck renders attach once to an unready revision, and approval refuses a blocking render report.
54. `20261021123547_dneskai_events_briefs.sql` — DNESKAi events and briefs, part 1 of 3: one owner-readable brief row per selected event and the event and member identity helpers.
55. `20261021124058_dneskai_events_briefs_finish.sql` — part 2: `marketing_dneskai_finish` takes the event grouping and selects up to four events; the five-argument function is renamed `marketing_dneskai_finish_retired_20261021` and locked, as production applied it.
56. `20261021124144_dneskai_events_briefs_functions.sql` — part 3: service-role functions that build, skip, admit (DNESKAi daily campaign and one calendar entry) and re-read a brief.
57. `20261021124400_marketing_scheduler.sql` — the scheduler's tick record (`marketing_ticks`) and one lease per category with backoff and small state.
58. `20261021124438_marketing_scheduler_functions.sql` — the service-role functions that record ticks and take, release and save category leases.
59. `20261021124628_marketing_scheduler_cron.sql` — pg_cron, pg_net and pgcrypto; a Vault-configured, signed request to `/api/marketing/tick` every five minutes and daily at 02:18 UTC that sends nothing until both Vault secrets exist; the history prune job is in 20261022000000.
60. `20261021124651_dneskai_daily_generation_budget.sql` — the DNESKAi daily generation ceiling: a private spend ledger and a service-role function that reserves a job's maximum before every paid DNESKAi model call and refuses it when the last 24 hours plus that maximum would pass the configured ceiling.
61. `20261021124706_marketing_job_render_report.sql` — a finished generation job stores the studio's render report beside the DNESKAi revision it saves, so the review shows advisories on a generated post as it already did after an owner edit.
62. `20261021124712_dneskai_hideable_project_tabs.sql` — recreates the `user_preferences.hidden_project_tabs` check with the four DNESKAi workspace tabs (For review today, Calendar, Published, Errors and costs) after the eleven project tabs, so Settings can hide them. No row is rewritten.
63. `20261021125123_restrict_pg_net_browser_roles.sql` — revokes `net` from `anon` and `authenticated` where `pg_net` exists; recorded in production, where it changed nothing because Supabase grants `net.http_post` to `PUBLIC`.
64. `20261022000000_marketing_scheduler_retention.sql` — applied 23 October 2026; `marketing_scheduler_prune_ticks` (14 days of ticks) and the `marketing-cron-history-prune` job, which the scheduler release left out of production.
65. `20261022013957_dneskai_apify_research.sql` — applied 23 October 2026; isolated $150 research ledger and derived public metrics; no scheduler, production switch or pipeline budget changes.
66. `20261022020702_dneskai_richer_brief_evidence.sql` — applied 23 October 2026; bounded article prose stored under the existing media lease; source image alt metadata stays in the fixed plan.
67. `20261022020759_dneskai_brief_v2_compatibility.sql` — applied 23 October 2026; accept brief/2 while retaining strict brief/1 reads and old snapshots.
68. `20261022021835_dneskai_release_lapsed_reports.sql` — future skips release only lapsed, never-generated reports; applied 23 October 2026.
69. `20261022110000_marketing_requeue_unpublished_publication.sql` — owner "give up and queue again" for a stuck publication that provably published nothing (approval-04); applied 23 October 2026.
70. `20261022141512_dneskai_owner_recovery.sql` — applied 23 October 2026; owner-only release of a held report to the next nightly review and reslot of a lapsed, unadmitted brief; called only with `DNESKAI_OWNER_RECOVERY_ENABLED=true`.
71. `20261022141613_dneskai_release_lapsed_brief.sql` — applied 23 October 2026; owner-only release of a lapsed brief's selected reports; refuses to apply before migration 68; called only with `DNESKAI_LAPSED_RELEASE_ENABLED=true`.
72. `20261022160000_dneskai_event_majority_category.sql` — applied 23 October 2026; `marketing_dneskai_finish` takes an event's optional majority category from `p_events` (SEL-10).
73. `20261022171000_dneskai_collection_unresolved_scope.sql` — applied 23 October 2026; an unknown collection cost blocks paid stages only on its own run and Prague day; the old reservation rows stay unchanged.
74. `20261022180000_dneskai_relevance_first_selection.sql` — applied 23 October 2026; `marketing_dneskai_finish` picks the day's events by relevance with at most one outside ai-news and tech-news (owner decisions 11 and 12).
75. `20261022180100_dneskai_held_requeue.sql` — applied 23 October 2026; `marketing_dneskai_requeue_held` gives a recent Jev hold one automatic second review (decision 13); called only with `DNESKAI_SELECTION_V2_ENABLED=true`.
76. `20261022190000_dneskai_regenerate_with_note.sql` — applied 23 October 2026; a finished regeneration job supersedes the returned or in-review version it replaces (owner decision 8); called only with `DNESKAI_REGENERATE_ENABLED=true`.
77. `20261023100000_dneskai_topics.sql` — applied 23 October 2026; `marketing_dneskai_topics` (náměty: title-only topics the owner approves before anything is paid for) with own-only reads and three owner functions to approve, reject, restore, edit and create; read only with `DNESKAI_TOPICS_ENABLED=true`.
78. `20261023100100_dneskai_topic_spend.sql` — applied 23 October 2026; the spend ledger for paid topic work: Apify reel transcripts under their own $0.50 daily ceiling, and topic model calls (FACT or HYPE, titling) counted inside the $1 DNESKAi generation ceiling; used only with `DNESKAI_FACT_OR_HYPE_ENABLED=true` or the titling switch.
79. `20261023100200_dneskai_topic_briefs.sql` — applied 23 October 2026; `marketing_dneskai_briefs.topic_id` and ranks 5–16 for a topic's own brief, so an approved topic goes through the ordinary brief, calendar and job guards; used only with `DNESKAI_TOPIC_BRIEFS_ENABLED=true`.
80. `20261023100300_dneskai_daily_mix.sql` — applied 23 October 2026; `marketing_dneskai_daily_mix`: news and education posts a day (0 to 4 each, default 1 and 1) and the active times (default 08:00 and 17:00), own-only; read only with `DNESKAI_DAILY_MIX_ENABLED=true`.
81. `20261023110000_dneskai_sources_table.sql` — applied 23 October 2026; `marketing_dneskai_sources`: the sources Zdroje edits (Instagram profiles and websites, own-only reads, three owner functions to seed, save and remove); read only with `DNESKAI_SOURCES_TABLE_ENABLED=true`.
82. `20261023120000_dneskai_comment_replies.sql` — applied 23 October 2026; `marketing_instagram_comment_replies` (one private reply per keyword comment, unique comment id, no commenter data) and `marketing_instagram_comment_checks` (where the comment watcher continues and the counts of its last pass), both own-read with service-role writes, plus the per-account comment-reply switch on `marketing_accounts`; used only with `DNESKAI_ENGAGEMENT_ENABLED=true`.
83. `20261023130000_dneskai_reel_bucket.sql` — applied 23 October 2026; the private `marketing-reels` bucket (MP4 only, 64 MiB) for rendered DNESKAi Reels, owner-prefix reads and no browser writes; used only with `MARKETING_DNESKAI_REELS_ENABLED=true`.
84. `20261023130100_dneskai_audio_tracks.sql` — applied 23 October 2026; the DNESKAi audio library: `marketing_audio_tracks` (own-only reads, service-role writes) and the private `marketing-audio` bucket; used only with `MARKETING_DNESKAI_REELS_ENABLED=true`.
85. `20261023130200_dneskai_audio_trends.sql` — applied 23 October 2026; `marketing_audio_trends`: the day's trending sounds from Meta's Audio API under Facebook Login (own-only reads, service-role writes); used only with `DNESKAI_AUDIO_TRENDS_ENABLED=true`.
86. `20261023130300_dneskai_tiktok_spend.sql` — applied 23 October 2026; a fourth kind `tiktok` in the topic spend ledger for the daily TikTok CZ sound chart under its own ceiling, plus service-only run lookup and binding; used only with `DNESKAI_TIKTOK_TRENDS_ENABLED=true`.
87. `20261023135551_dneskai_engagement_receipts.sql` — prepared, unapplied; an authenticated-owner, security-invoker JSON aggregate for complete DNESKAi engagement receipts and the independent seven-day publication summary. Apply before deploying the audit implementation branch.
88. `20261023164118_app_wide_rls_initplans.sql` — prepared, unapplied; evaluate identity once per statement in 73 existing ownership policies without changing roles or ownership checks.
89. `20261023170010_project_parent_rls_lookup.sql` — prepared, unapplied; prevent project-parent write-policy recursion with a security-invoker lookup that preserves RLS and existing parent checks.
90. `20261023175801_daily_focus_garden_summary.sql` — prepared, unapplied; summarize all generations in the owner’s 49-day Daily Focus garden without an arbitrary generation cap.
91. `20261023183345_career_owner_day.sql` — prepared, unapplied; validate application and response dates in the configured owner timezone, preserving the transactional application/history functions.
92. `20261023190841_invoice_document_transaction.sql` — prepared, unapplied; save invoice headers and line items atomically, with retry identity and stale/incomplete-edit protection.
93. `20261023200938_atomic_knowledge_documents.sql` — prepared, unapplied; atomic prompt/resource saves, complete bounded owner collection snapshots and idempotent curated imports.
94. `20261023210737_library_category_merge.sql` — prepared, unapplied; merge a library category and all its resources atomically, rejecting changed source membership.
95. `20261023212535_atomic_payment_matching.sql` — prepared, unapplied; read complete matching inputs, settle payment/invoice pairs atomically and discover matching owners without REST truncation.
96. `20261023221856_transaction_rule_context.sql` — prepared, unapplied; one complete invoker/RLS snapshot of financial rules and owned project/subscription ids, with explicit service ownership and bounded response size.
97. `20261023222504_confirmed_transaction_import.sql` — prepared, unapplied; confirmed atomic import batches using the existing partial unique index and explicit owner/parent checks.
98. `20261023233432_atomic_bank_credentials.sql` — prepared, unapplied; service-only transactional Fio storage/removal with connection receipts, owner-scoped locking and rollback.
99. `20261024001739_invoice_payment_state.sql` — prepared, unapplied; atomic owner-only invoice payment state, linked-payment releases and metadata cleanup on invoice deletion.
100. `20261024004341_atomic_transaction_rule_application.sql` — prepared, unapplied; complete rule/ledger snapshots and atomic versioned metadata application, with confirmed receipts and owner rule-write serialization.
101. `20261024010610_account_scoped_bank_imports.sql` — prepared, unapplied; account-scoped bank identities with legacy/rolling-deployment deduplication, shared set-based ownership validation and confirmed source fields.
102. `20261024022229_oauth_refresh_leases.sql` — prepared, unapplied; private service-only OAuth refresh reservations that survive provider HTTP calls, with source-version checks and confirmed atomic token rotation.
103. `20261024024945_oauth_revocation_receipts.sql` — prepared, unapplied; reserve explicit OAuth removal against the same captured source version, keeping its confirmed local receipt separate from upstream revocation.
104. `20261024034239_repository_record_receipts.sql` — prepared, unapplied; complete repository/task reads, versioned repository-note saves and confirmed consumption of unchanged published notes/finished GitHub tasks.
105. `20261024041457_repository_task_sync.sql` — prepared, unapplied; atomic source-task imports and captured-version refresh cleanup, with retained continuation-line assignees.
106. `20261024095216_complete_project_collections.sql` — prepared, unapplied; complete bounded owner snapshots of project metadata, monthly cost lines and cron inputs.
107. `20261024101934_atomic_project_order.sql` — prepared, unapplied; atomic captured-version reordering of one complete owned active project group, with minimal changed-row receipts.
108. `20261024113157_daily_focus_repository_identity.sql` — prepared, unapplied; Daily Focus prefers explicit project and known repository IDs before legacy names, preserving existing generations.
109. `20261024120023_confirmed_project_notes.sql` — prepared, unapplied; field-scoped project-note compare-and-save with compact hash/version receipts; the operations editor uses the guarded autosave contract.
110. `20261024130626_confirmed_project_preferences.sql` — prepared, unapplied; active/engagement compare-and-save with compact versioned receipts, conflicts and no-op retries; Settings and Projects wait for confirmation.
111. `20261024134706_confirmed_project_details.sql` — prepared, unapplied; manual detail/version receipts retain slug and verified repository history without returning notes; manual edits use the contract with guarded conflict recovery. Creation and synchronization remain under review.

112. `20261024170208_confirmed_dneskai_daily_mix.sql` — prepared, unapplied; captured-version daily volume saves, own-only persisted receipts and no-op retries. Unreadable enabled configuration stops scheduling instead of restoring defaults.

113. `20261024174247_confirmed_dneskai_sources.sql` — prepared, unapplied; captured source-setting save/removal receipts and no-op retries; compatible legacy writers share the project-first lock and 120-source limit. API/browser/editor callers use the guarded receipt contract; final release checks remain pending.

114. `20261024220621_weekly_focus_snapshot.sql` — prepared, unapplied; one invoker/RLS snapshot of the latest generation for each of seven days, at most 49 focus items, bounded text/response and explicit owner/week identity. Weekly planning refuses unavailable history instead of an empty recap.

115. `20261024223552_confirmed_weekly_review.sql` — prepared, unapplied; owner/week/version-bound weekly review saves, stable creation identities, preserved legacy keys and persisted no-op/conflict receipts. The guarded editor uses this contract; final release checks remain pending.

116. `20261025000844_confirmed_task_writes.sql` — prepared, unapplied; monotonic task versions and owner-bound create/toggle/delete receipts. Private metadata prevents an ambiguous creation retry from recreating a deleted task. The Tasks UI adopts captured creation/completion/deletion and repository actions; exact evidence remains in the app-wide report.

117. `20261025032227_dneskai_public_slide_policy.sql` — prepared, unapplied; private structural content policy blocks first-slide extra text, public credits and sources slides at owner approval and publication claim, retaining stored legacy revisions.

118. `20261025040638_complete_dneskai_cost_reads.sql` — prepared, unapplied; complete own-only cost/tick aggregates with bounded diagnostics and a narrow owner/date job index.

119. `20261025091027_complete_organization_records.sql` — prepared, unapplied; finite monotonic organization versions and a complete owned organization snapshot. Existing records and own-only policies remain unchanged; captured browser mutation adoption follows separately.

120. `20261025094511_captured_collection_owner.sql` — prepared, unapplied; authenticated captured-owner binding before complete collection reads, including empty results; existing one-argument callers and collection policies remain unchanged.
121. `20261025114445_complete_competitor_records.sql` — prepared, unapplied; finite, monotonic competitor update versions and complete owned research snapshots; existing project/RLS ownership and stored fields remain unchanged. Complete captured-owner reads and confirmed editor/deletion controls are adopted in findings 226–228.

122. `20261025142409_complete_data_exports.sql` — prepared, unapplied; complete captured-owner export snapshots with explicit table/column projections, existing invoker RLS, deterministic ordering and refused row/byte overflow. Finding 236 adopts its strict complete download route.
123. `20261025170608_confirmed_plan_records.sql` — prepared, unapplied; finite monotonic plan versions and complete owned Goals/Home snapshots, with unchanged recurrence, Calendar links and invoker RLS. Findings 247/250 adopt complete reads and confirmed Goals/Home controls; production rollout remains pending.
124. `20261025184649_tiktok_prague_daily_admission.sql` — prepared, unapplied; atomic service-only TikTok chart admission per Prague calendar day under the existing owner lock, retaining the independent rolling spend ceiling and all reservation evidence. No extra index or paid activation.
125. `20261025204635_career_monotonic_source_snapshots.sql` — prepared, unapplied; service-only atomic global discovery snapshots and monotonic source watermarks, exact update/retention receipts and version/URL cleanup that preserves permanent owner deletion markers. Adds the measured listing-reference index; existing owner data/RLS remains unchanged.
126. `20261025214416_complete_captured_career_reads.sql` — prepared, unapplied; complete captured-owner Career read projections, own deletion markers excluded before the listing bound and a native workplace-evidence cutover without rewriting private history or legacy remote values.

127. `20261025233522_career_snapshot_remote_evidence.sql` — prepared, unapplied; nullable remote workplace evidence in saved/application snapshots, preserved through the application transaction and explicit complete reads. Existing history remains unknown instead of being inferred from later listings.

128. `20261025234711_career_private_record_versions.sql` — prepared, unapplied; finite database-maintained monotonic update versions for saved positions, applications and letter templates, preserving existing records and own-only policies. Captured browser writes adopt this foundation separately.

129. `20261025235237_captured_career_listing_save.sql` — prepared, unapplied; captured-owner/version atomic discovery saves with stable retries, unchanged existing private drafts and strict receipts. Uses the existing source guard without granting global write access.

130. `20261026001926_captured_career_triage.sql` — prepared, unapplied; nullable monotonic triage versions, atomic captured source/state changes and durable deletion markers protected from legacy writes or listing cascades. Existing owner-deletion cascades remain valid; finding 283 adopts captured browser confirmation, retry and recovery.

131. `20261026163911_career_application_lock_order.sql` — prepared, unapplied; application conversion takes the existing shared source guard before private row locks, bounds each lock wait at five seconds and accepts the existing 300-character source-title contract. Request identity, snapshots, events, RLS and owner-day semantics remain.

132. `20261026182155_captured_career_application.sql` — prepared, unapplied; captured-owner/Saved-version application conversion, exact original-intent retry and positive application/event receipts preserve newer drafts and progress. Legacy history remains unchanged.

133. `20261026195100_captured_career_progress.sql` — prepared, unapplied; expected-owner/application-version patches commit progress and contacts together, return only confirmed changed history and preserve all untouched private fields. No data rewrite; legacy RPC retained.

134. `20261027022446_atomic_uptime_kuma_transitions.sql` — prepared, unapplied; service-only stable-monitor/time transitions atomically record an alert and failed cron run, resolve every matching open alert on recovery and suppress stale/repeated events. Historical name-keyed alerts remain unchanged.

135. `20261027030141_complete_dneskai_niche_audio_read.sql` — prepared, unapplied; one service-only owned seven-day snapshot projects ranking fields, bounds complete results at 10,000 records/10 MiB and uses a partial date/id index. No candidate rewrite or provider request.
136. `20261027044222_atomic_dneskai_audio_observations.sql` — prepared, unapplied; account-bound atomic Meta audio observations, monotonic day history, legacy-writer protection and a minimal current-account recommendation projection. Existing history stays unproven until observed.
137. `20261027050940_dated_dneskai_tiktok_receipts.sql` — prepared, unapplied; dated account-bound TikTok proof, complete bounded progress and atomic match/cost/completion receipts. Legacy flags and settlements stay unproven; confirmed Meta metadata remains intact.
138. `20261027061021_captured_dneskai_tiktok_admission.sql` — prepared, unapplied; current-account admission reuses the owner’s daily/rolling budget lock and records exact actor/input intent; positive immutable binding records a known provider start against its original admission. No legacy history or credentials are copied.
139. `20261027111657_captured_dneskai_audio_toggles.sql` — prepared, unapplied; finite maintained track versions and a service-only owner/version-confirmed toggle with a checked final-row receipt. No history rewrite; finding 324 adopts captured API/browser controls and positive receipts. Canonical rollout and final release remain pending.

140. `20261027141619_confirmed_dneskai_audio_object_presence.sql` — prepared, unapplied; service-only read-only exact owned-path presence proof distinguishes a missing upload from unavailable Storage without reading file bytes or changing records.

141. `20261027175307_confirmed_dneskai_reel_records.sql` — prepared, unapplied; service-only atomic exact owner/revision/hash MP4 records, identical retry receipts and post-trigger persisted-row proof preserve event history and refuse stale/contradictory writes.

142. `20261027184102_confirmed_dneskai_cache_object_presence.sql` — prepared, unapplied; service-only read-only exact owned slide/Reel path presence proof distinguishes absent cache objects from unavailable Storage.

143. `20261027194255_confirmed_marketing_account_snapshot.sql` — prepared, unapplied; authenticated-only captured-owner stable account/token-metadata snapshot under existing own RLS; no credentials, writes or table grants.

144. `20261027195903_captured_marketing_account_switches.sql` — prepared, unapplied; finite monotonic account versions and service-only captured switch transactions with locked current token eligibility and post-trigger receipts. Finding 350 adopts the captured API/browser controls; migration 145 includes versions in the private read.

145. `20261027202033_versioned_marketing_account_snapshot.sql` — prepared, unapplied; adds exact account versions to the existing authenticated-owner snapshot without credential values or row/table-grant changes.

146. `20261027212131_captured_marketing_account_verification.sql` — prepared, unapplied; service-only captured owner/account/version and private credential-fingerprint transaction with exact persisted account/token checks. Finding 355 adopts strict captured verification receipts; canonical rollout remains pending.

147. `20261028123118_captured_marketing_credential_renewal.sql` — prepared, unapplied; service-only account/version/private credential-fingerprint renewal with unchanged-account and exact persisted-token proof. Finding 360 adopts captured renewal and exact receipts; canonical rollout remains pending.

148. `20261028132841_complete_marketing_token_metadata.sql` — prepared, unapplied; service-only complete non-secret token metadata aggregate before the REST row limit, with four-tuple/count/16KiB bounds and no new table access. Finding 361 adopts bounded strict reads.
149. `20261028154447_complete_dneskai_calendar.sql` — prepared, unapplied; complete own-RLS seven-day revision/job/waiting-brief snapshot independent of creation age and review cursors, with bounded records/body and explicit unknown dates. Calendar marks unconfirmed occupancy as unknown.

150. `20261028233906_confirmed_marketing_campaign_import.sql` — prepared, unapplied; service-only invoker import with complete post-trigger campaign/entry confirmation and atomic refusal. Exact source/start replays preserve owner edits and never recreate deleted slots.
151. `20261029010744_confirmed_marketing_campaign_activation.sql` — prepared, unapplied; authenticated activation retains the void RPC and confirms the captured owner/brand/source-hash/status set after triggers. Missing/changed source intent or suppressed writes roll back activation and archival together.

The migration guide describes migrations 1–6 under Apply and Verify and gives every later migration its own entry. The first 38 migrations were verified in production on 2026-09-28; migrations through 63 were reconciled on 22 October. The authorised 23 October rollout applied migrations 64–86, through `20261023130300`. The sixty-five audit migrations 87–151 remain unapplied; apply them in filename order before deploying the implementation branch.

Do not rerun `supabase/schema.sql` on an existing project, and do not apply the cleanup migration alone. Never copy a migration's objects back into `supabase/schema.sql`; every schema change is a new migration file. Editing or committing a migration does not apply it to a linked/production database. The applied dates above record the earlier authorised rollout, not a database change by this implementation task. Follow [Migration and rollback](./docs/migration-guide.md).

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

The MP4 review suite uses installed Google Chrome (`channel: "chrome"`) for H.264 playback; other suites keep bundled Chromium. CI installs both with `npx playwright install --with-deps chromium chrome`. Local checks use an isolated test profile, never the signed-in Chrome profile.

The deterministic `/dev-preview` harness drives the Playwright responsive matrix at 360, 430, 768, 1024, 1440, and 1728 px, including mobile destination access, Czech copy, dark mode, overflow, axe checks, PWA metadata, and single-page A4 invoice output. It contains fixtures only and remains unavailable in deployed production.

## Product design and media

OwnDashboard follows the documented **calm operational intelligence** thesis through a **macOS-native operational cartography** visual direction. The authenticated product is framed as a private graphite desktop window with translucent navigation, compact toolbar, semantic system accents, dense tables, canonical localized statuses, one Lucide icon family, and authentic application rendering. Generated UI, fabricated metrics, and filler illustration are prohibited.

No generated brand media is currently shipped. The next media-production pass must compare at least three current low-cost or free generators from primary provider sources and may use only a documented option with suitable output rights, privacy, formats, and no watermark. The login layout exposes its media seam, existing empty states remain complete without illustration, and the manifest records prompts and proposed destinations without referencing nonexistent files.

## Deployment and owner actions

The repository cannot safely configure external account secrets, OAuth consent screens, production domains, or a linked Supabase project. The remaining rollout list is in [NEEDED.md](./NEEDED.md). Cost tiers and scaling triggers are documented in [scaling.md](./scaling.md).

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
