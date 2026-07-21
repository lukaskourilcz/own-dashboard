# OwnDashboard

OwnDashboard is a bilingual, self-hosted professional personal operating system. It brings delivery, client pipeline, career, money, planning, and reusable knowledge into one authenticated workspace.

The canonical information architecture is:

- Home and Inbox
- Work: Overview, Projects, Opportunities, Clients, Career, Invoices
- Money: Overview, Accounts, Transactions, Subscriptions, Categories
- Planning: Tasks, Calendar, Goals, Dates
- Library: Notes, Prompts, Links, References
- Settings

Pulse, habits/streaks, books/reading, and couples mode were retired. Their rows are archived before removal and remain downloadable from Settings → Data & export. Tugedr is retained only as an opportunity source; it is not a separate scratchpad.

## What is included

- Work overview with delivery metrics, explainable project-health warnings, follow-ups, and weekly reviews
- Project workspaces at `/projects/[slug]` with overview, tasks, activity, repository, operations, finance, knowledge, explainable health, and a source-backed project copilot
- Opportunity pipeline with Tugedr/referral/direct/inbound sources and confirmed, transactional conversion into linked organizations and projects
- Client organizations with connected projects, opportunities, invoices, tasks, notes, dates, and FX-normalized revenue context
- Career listings and application tracking
- Czech VAT-aware invoices, QR payment, PDF import, and supplier defaults
- Accounts, transactions, bank sync, subscriptions, spend categories, and FX-aware totals
- Tasks, Google Calendar, goals, and professional dates
- Block notes, prompts, link catalogue, command snippets, and reference tables
- Inbox capture, notifications, filtering, snoozing, and deliberate routing into eight professional destinations
- Contextual AI intent parsing, owned-record search, project and weekly briefs, career assistance, and knowledge-maintenance proposals with explicit consent and no autonomous writes
- Own-only Supabase RLS for professional and financial data
- Full, financial, professional, knowledge, projects, notes, prompts, career, and legacy JSON exports plus table-level CSV

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Supabase Auth/Postgres/RLS · TanStack Query · Radix UI · Recharts · BlockNote · Vitest · Playwright.

Optional integrations: Google Calendar, GitHub, GoCardless, Anthropic-compatible AI, Resend, and Sentry.

## Setup

### 1. Install

```bash
npm ci
```

### 2. Environment

Copy `.env.example` to `.env.local`. The minimum is:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

Optional server variables are documented in [External setup](./docs/external-setup.md). AI model ids can be overridden with `AI_INTENT_MODEL`, `AI_ENRICHMENT_MODEL`, and `AI_SYNTHESIS_MODEL`; provider routing can use `ANTHROPIC_BASE_URL`.

### 3. Database

Existing installations apply the two migrations in timestamp order:

1. `20260721165419_professional_restructure_core.sql` — additive professional entities, relationships, grants, indexes, and own-only relationship policies.
2. `20260721165421_remove_legacy_personal_scope.sql` — archive first, restore own-only reads, then remove retired personal tables and the sharing function.

Use the normal linked-project migration workflow:

```bash
npx supabase db push --linked
```

Do not run the cleanup migration by itself. Export legacy data before rollout if you want an extra off-platform copy. For a brand-new instance, initialize the historic base from `supabase/schema.sql`, then apply both migrations in order. See [Migration and rollback guide](./docs/migration-guide.md).

The migrations were validated locally against a disposable PostgreSQL database with two simulated authenticated users, including the opportunity-conversion transaction, relationship ownership checks, archive cleanup, and cross-user isolation. No linked or production Supabase project is modified by this repository change; deployment remains an explicit operator step.

### 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>.

## Quality commands

```bash
npm run lint
npx tsc --noEmit
npm run test
npm run build
npm run test:e2e
```

The `/dev-preview` route is an auth-free deterministic test harness in development only and returns 404 in production.

## Route compatibility

Meaningful bookmarks redirect to their professional destination:

- `/overview` → `/`
- `/todos` → `/tasks`
- `/plans` → `/goals`
- `/jobs` → `/career`
- `/finances` → `/money`
- `/github`, `/repositories`, `/costs`, `/scaling` → `/projects`
- `/ai`, `/ai-links` → `/links`
- `/shortcuts` → `/references`
- `/tugedr` → `/opportunities`

Removed personal routes such as `/streaks`, `/books`, and `/couple` return 404; stale local navigation preferences are repaired on read.

## Documentation

- [Architecture and product reference](./DOCS.md)
- [Migration and rollback guide](./docs/migration-guide.md)
- [AI and privacy](./docs/ai-and-privacy.md)
- [External setup checklist](./docs/external-setup.md)
