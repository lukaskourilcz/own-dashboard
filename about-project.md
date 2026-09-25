# OwnDashboard

Bilingual, self-hosted, owner-only professional operating system for one
software engineer/freelancer. Connects projects and their competitor research,
client opportunities, organizations, Career, Czech invoices, money, planning,
knowledge (notes, prompts, tools, links), integrations, notifications and
weekly reviews. It makes no model calls.

## Tech stack

- **Next.js 16 (App Router) and TypeScript** — the authenticated shell and API routes
- **Tailwind CSS 4, Radix primitives, Recharts, BlockNote, dnd-kit** — UI, charts, notes editor, drag handles
- **Supabase and TanStack Query** — Postgres, Auth, owner-only RLS, route-scoped loading
- **Vitest, Playwright, axe-core** — unit, end-to-end and accessibility tests

## Third-party libraries

- **Supabase** — Postgres database, authentication and owner-only row-level security
- **Google** — OAuth sign-in and direct Google Calendar event creation
- **GitHub** — OAuth sign-in, repository documents, commits and NEEDED.md task import
- **GoCardless, Fio banka, Enable Banking** — optional bank sync behind one provider interface; CSV import works without them
- **ARES and VIES** — free public registries for filling an organization from its IČO and checking its VAT number
- **Resend** — optional renewal-warning email
- **Upstash Redis** — optional distributed rate limiting
- **PostHog** — optional cookieless, EU-hosted product analytics
- **Sentry** — optional error and performance monitoring
- **Uptime Kuma** — optional self-hosted push monitors for cron heartbeats
- **Jina Reader** — reads a submitted link or job-posting URL to fill its form for review
- **Apify** — optional import of completed job-board tasks; the app starts no Actor
- **Vercel** — hosting, Web Analytics reads and three daily cron jobs (bank sync, payment matching, renewal warnings)
- **recharts, pdfjs-dist, qrcode.react, date-fns** — charts, local invoice PDF reading, QR Platba, dates
