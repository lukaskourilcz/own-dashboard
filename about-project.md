# OwnDashboard

Bilingual, self-hosted, owner-only professional operating system for one
software engineer/freelancer. Connects projects, client opportunities,
organizations, VPS agent tasks, career, Czech invoices, money, planning,
knowledge, integrations, notifications, and contextual AI.

## Tech stack

- **Framework:** Next.js 16 (App Router), TypeScript
- **UI:** Tailwind CSS, Radix primitives, Recharts, BlockNote editor, dnd-kit
- **Data:** Supabase + TanStack Query, owner-only RLS, route-scoped loading
- **Testing:** Vitest, Playwright, axe-core

## Connected third parties

- **Supabase** — Postgres database, authentication, and owner-only row-level security.
- **Anthropic Claude** — contextual AI (intent, enrichment, synthesis) over bounded, consented context.
- **Google** — OAuth sign-in and direct Google Calendar event creation.
- **GitHub** — OAuth sign-in and repository/commit data for project tracking.
- **GoCardless** — bank account sync feeding money and invoice records.
- **Resend** — transactional email for renewal warnings and notifications.
- **Upstash Redis** — rate limiting and lightweight caching.
- **PostHog** — consent-based, EU-hosted product analytics.
- **Sentry** — error and performance monitoring.
- **Jina** — web content extraction feeding AI enrichment.
- **Vercel** — hosting and scheduled cron jobs (renewals, job scraping, bank sync).

## Key libraries

- `recharts` — money and analytics charts; `pdfjs-dist` — invoice PDF handling.
- `qrcode.react` — Czech invoice QR payment codes; `date-fns` — date logic.
