# OwnDashboard

Bilingual, self-hosted, owner-only professional operating system for one
software engineer/freelancer. Connects projects and their competitor research,
client opportunities, organizations, Career, Czech invoices, money, planning,
knowledge (notes, prompts, tools, links), integrations, notifications and
weekly reviews. The owner-authorized Marketing workspace alone can use Claude through a bounded LangChain worker; other product areas make no model calls.

## Tech stack

- **Next.js 16 (App Router) and TypeScript** — the authenticated shell and API routes
- **Tailwind CSS 4, Radix primitives, Recharts, BlockNote, dnd-kit** — UI, charts, notes editor, drag handles
- **Supabase and TanStack Query** — Postgres, Auth, owner-only RLS, route-scoped loading
- **Marketing** — a Supabase pg_cron tick that drives DNESKAi from collection to publishing, n8n Cloud for devShark and knowledge only, deterministic carousels (devShark from a Claude Design-derived layout, DNESKAi through the vendored Quorum carousel studio in `vendor/carousel-studio`), Reels encoded with `ffmpeg-static`, LangChain and redacted EU LangSmith diagnostics
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
- **Jina Reader** — reads a submitted link or job-posting URL to fill its form for review, and the URL of an approved DNESKAi library or manual topic
- **Apify** — import of completed job-board tasks for Career; for DNESKAi, Instagram profile collection, reel transcripts and the TikTok CZ sound chart, each behind its own switch and daily cap
- **Anthropic** — Claude Sonnet writes DNESKAi posts; Claude Haiku titles topics and judges FACT or HYPE reels (marketing only)
- **Jev (typesafe.ai)** — classifies the stories DNESKAi collects each night
- **Meta Graph API** — publishes to @dneskai (Instagram Login, or Facebook Login for Business), answers keyword comments, receives the comment webhook and reads trending sounds
- **Vercel** — hosting, Web Analytics reads and three daily cron jobs (bank sync, payment matching, renewal warnings)
- **recharts, pdfjs-dist, qrcode.react, date-fns** — charts, local invoice PDF reading, QR Platba, dates
