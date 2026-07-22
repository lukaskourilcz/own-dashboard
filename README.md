# OwnDashboard

OwnDashboard is a bilingual, self-hosted personal operating system for running professional work. It connects projects, client acquisition, clients, career, invoices, costs, planning, and reusable knowledge in one authenticated, own-data-only workspace.

It is deliberately a personal application—not a SaaS, team workspace, CRM, or accounting suite. OwnDashboard remains the temporary product name until a replacement is explicitly approved; all application branding is centralized in `src/lib/brand.ts`.

## Product areas

- **Home and Inbox** — an attention-focused daily surface, quick capture, unclassified input, operational warnings, notifications, snooze/dismiss, and deliberate conversion into professional records.
- **Work** — portfolio overview, explainable project health, weekly reviews, project workspaces, client opportunities, organizations/clients, Career, and the canonical invoice workflow.
- **Projects** — a sortable portfolio table plus a workspace per project with overview, tasks, activity, client communication history, GitHub repository documents, development/production links, cron and operations metadata, finance, knowledge, and a project-scoped copilot.
- **Agents** — an own-only task queue for explicit work delegated to authenticated workers running on the owner's VPS. The browser never receives the runner token and is not a remote shell.
- **Opportunities and clients** — a manual pipeline for Tugedr, referral, direct, inbound, and existing-client leads; won opportunities convert transactionally into linked organizations and projects only after confirmation. Tugedr is a client-opportunity source, never Pulse or mood tracking.
- **Career** — a dense listing table sortable by match, remote availability, location, or discovery date; shortlist/hide state, application history, cover-letter templates, follow-ups, and an evidence-grounded Career copilot.
- **Money and invoices** — accounts, CSV/GoCardless bank imports, transaction categories/rules, subscriptions grouped by operational purpose and importance with renewal countdowns, project costs, static FX summaries, Czech VAT-aware invoices, QR Platba, print output, and deterministic PDF text extraction with a review form.
- **Planning** — project/client-linked tasks, Google Calendar agenda and event creation, professional goals, and project/organization-linked deadlines, launches, renewals, interviews, and milestones.
- **Library** — BlockNote notes, reusable prompts, enriched links, shortcuts, and structured references. Notes and prompts can be linked to project knowledge without duplicating their records.
- **Settings** — appearance, navigation, integrations, notification controls, AI/privacy consent, own-only exports, legacy archive download, and account controls.

Pulse, habits/streaks, books/reading, and couples mode are retired. The cleanup migration archives their rows before removal, restores strict own-only policies, and keeps the archive downloadable from Settings → Data & export.

## AI and safety boundaries

AI is contextual rather than a standalone chatbot. The Anthropic integration supports intent routing, owned-record search, weekly operating briefs, project and Career copilots, link enrichment, and knowledge-maintenance proposals.

- Server routes authenticate the user and load only owned records relevant to the initiated workflow.
- Financial, invoice, calendar, career, repository-document, client, subscription, and private-note context requires explicit initiation; the most sensitive workflows also respect the Settings opt-in.
- Model output is schema-validated and presented as fact/risk/suggestion or a proposal.
- AI never autonomously deletes records, sends invoices, marks payments, disconnects integrations, triggers crons, or writes GitHub workflows.
- Application writes require a separate user confirmation and server-side authorization.
- Prompt/response contents and private record values are not sent to PostHog event properties.

See [AI and privacy](./docs/ai-and-privacy.md) for the exact boundaries.

## Architecture and stack

| Layer | Implementation |
| --- | --- |
| Web | Modified Next.js `16.2.6` App Router, React `19.2`, strict TypeScript 5, Tailwind CSS 4, Motion |
| Data/auth | Supabase Postgres and Auth via `@supabase/ssr`/`supabase-js`; explicit Data API grants and own-only RLS |
| Client data | TanStack React Query 5 with centralized keys, route-scoped server seeds, lazy destination fetches, bounded stale times, invalidation, cancellation, and optimistic updates where reversible |
| UI | Radix primitives, Lucide, Recharts, BlockNote, date-fns, QRCode |
| AI/extraction | Anthropic SDK with centralized Haiku/Sonnet-class model roles; pdf.js deterministic extraction first; optional Jina Reader enrichment |
| Operations | Vercel functions/crons, optional Upstash rate limiting, Resend email, PostHog analytics/flags, Sentry monitoring |
| Integrations | Google Calendar OAuth, GitHub OAuth/repository files and commits, GoCardless Bank Account Data |
| Quality | ESLint, TypeScript, Vitest, Playwright, axe accessibility checks |

The authenticated dashboard uses one canonical catch-all route and interactive shell to preserve navigation state. The server now seeds only the entities required by the requested destination; moving within the shell enables the corresponding React Query fetchers on demand. Google Calendar windows follow the same model through an authenticated, bounded endpoint. Supabase RLS remains the final data boundary, including ownership checks on related project and organization IDs.

## Information architecture and routes

```text
Home
Inbox
Work: Overview · Projects · Opportunities · Clients · Agents · Career · Invoices
Money: Overview · Accounts · Transactions · Subscriptions · Categories
Planning: Tasks · Calendar · Goals · Dates
Library: Notes · Prompts · Links · References
Settings
```

Project workspaces use `/projects/[id-or-slug]`. Meaningful old bookmarks redirect:

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

For an existing installation, link the intended Supabase project and push migrations in timestamp order:

```bash
npx supabase db push --linked
```

The relevant migrations are:

1. `20260721165419_professional_restructure_core.sql` — professional entities, relationships, explicit grants/indexes, transaction-safe opportunity conversion, and own-only relationship policies.
2. `20260721165421_remove_legacy_personal_scope.sql` — archive legacy data, restore own-only reads, then remove retired personal tables and sharing infrastructure.
3. `20260722150000_atomic_inbox_routing.sql` — route one owned Inbox item and mark it processed in a single `SECURITY INVOKER` transaction.
4. `20260722190000_operational_workflow_extensions.sql` — subscription grouping/importance, project development links and communication history, plus the own-only VPS agent task queue and atomic claim RPC.

Do not rerun `supabase/schema.sql` on an existing project and do not apply the cleanup migration alone. For a new local instance, initialize the historic base schema before applying all migrations. No repository change claims that a linked/production database was migrated. Follow [Migration and rollback](./docs/migration-guide.md).

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

OwnDashboard follows the documented **calm operational intelligence** thesis and **operational cartography** visual direction. Production UI uses semantic tokens, canonical localized statuses, one Lucide icon family, compact data presentation, and authentic application rendering. Generated UI, fabricated metrics, and filler illustration are prohibited.

No generated brand media is currently shipped. The next media-production pass must compare at least three current low-cost or free generators from primary provider sources and may use only a documented option with suitable output rights, privacy, formats, and no watermark. The login layout exposes its media seam, existing empty states remain complete without illustration, and the manifest records prompts and proposed destinations without referencing nonexistent files.

## Deployment and owner actions

The repository cannot safely configure external account secrets, OAuth consent screens, production domains, or a linked Supabase project. The current owner-only rollout list is in [NEEDED.md](./NEEDED.md). Cost tiers and scaling triggers are documented in [stack-and-scaling.md](./stack-and-scaling.md).

## More documentation

- [Architecture and product reference](./DOCS.md)
- [External services, callbacks, and rename checklist](./docs/external-setup.md)
- [Migration and rollback](./docs/migration-guide.md)
- [AI and privacy](./docs/ai-and-privacy.md)
- [Product design audit](./docs/design/product-design-audit.md)
- [Reference research](./docs/design/reference-research.md)
- [Brand system](./docs/design/brand-system.md) and [design system](./docs/design/design-system.md)
- [Brand-media opportunity audit](./docs/design/brand-media-opportunity-audit.md), [art direction](./docs/design/brand-media-art-direction.md), and [manifest](./docs/design/generated-media-manifest.json)
- [Visual QA record](./docs/design/visual-qa.md)
- [Future-agent control document](./CLAUDE.md)
