# Own Dashboard

A personal (or couple) life dashboard — one place that holds the whole picture: subscriptions, todos, streaks, finances, Czech invoices, plans, books, mood check-ins, important dates, notes, prompts, shortcuts, AI links, your GitHub repos, and a Google Calendar tie-in. Bilingual (Čeština / English), light/dark, keyboard-driven.

📖 **Full reference** — features, architecture, database model: [DOCS.md](./DOCS.md)
💸 **Costs & scaling** — stack, monthly cost, scaling path: [stack-and-scaling.md](./stack-and-scaling.md)

---

## Sections

After signing in you land on **Overview** and can jump to any panel (sidebar, mobile bottom-bar, the `g`-then-letter chords, or the `⌘/Ctrl-K` command palette). Each section also has its own URL (`/finances`, `/invoices`, …).

- **Overview** — greeting + live clock, KPIs, and compact versions of every panel, with a natural-language quick-add bar.
- **Calendar** — create Google Calendar events (all-day, recurrence) and a 7-day agenda.
- **Subscriptions** — FX-aware totals, pie breakdown, soft-cancel, renewals list.
- **Todos / Streaks / Pulse** — tasks, daily-habit heatmaps, 1–5 mood check-ins.
- **Finances** — accounts (net worth), income/expense, monthly + category charts.
- **Invoices (Faktury)** — Czech-format invoicing with VAT, "QR Platba", printable detail, and client-side PDF import.
- **Plans / Books / Dates** — long-horizon goals, co-authored reading logs, anniversaries with countdowns.
- **Couple** — invite a partner and choose what to share (own-only writes, partner-readable selects).
- **Notes / Prompts / Shortcuts / AI links** — a block editor, a copy-to-clipboard prompt library, a command cheatsheet grid, and a categorized link table.
- **Repositories** — your GitHub repos with autosaving per-repo notes that compile to a `.md` and push back to GitHub.
- **App costs & scaling** — per active repo, renders its root `stack-and-scaling.md` (stack, costs, scaling).
- **Jobs** — remote-friendly European openings for frontend/fullstack/software roles, scraped daily at 10:00 (UTC+2) from startupjobs.cz, jobs.cz, prace.cz, Remote OK, Remotive, Arbeitnow, Jobicy and We Work Remotely; shortlist/hide triage, plus an application tracker with cover letters, reusable templates, applied dates and a status history.
- **Settings** — language, display currency, theme, and which sections show in the nav.

All data lives in your own Supabase Postgres with Row Level Security, so only you (and a partner, for what you choose to share) can read your records.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · Supabase (Postgres + Auth + RLS) · TanStack React Query · Recharts · BlockNote · framer-motion · Radix UI · deployed on Vercel (with Vercel Cron).

Optional, env-gated integrations: **Anthropic** (Claude Haiku 4.5, natural-language quick-add) · **Resend** (renewal-warning emails) · **Sentry** (error monitoring). Each no-ops cleanly when its key is absent. See [DOCS.md → Technical stack](./DOCS.md#technical-stack) for the full table.

## Setup

### 1. Install

```bash
npm install
```

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run [`supabase/schema.sql`](./supabase/schema.sql) — it creates every table with RLS scoped to `auth.uid()` (own-only writes, own-or-partner-shared reads). It's idempotent, so re-run it after pulling new code.
3. In **Project Settings → API**, copy the Project URL and the `anon` public key.

### 3. Google OAuth (Calendar)

1. In Google Cloud Console: create a project, enable the **Google Calendar API**, and create an **OAuth 2.0 Client ID** (Web application).
2. Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
3. Scopes: `.../auth/calendar.events`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
4. In Supabase **Authentication → Providers → Google**, enable it and paste the Client ID + Secret.
5. (Optional) Enable the **GitHub** provider the same way to use the Repositories and App-costs sections.
6. In Supabase **Authentication → URL Configuration**, set the Site URL and add redirect URLs for `http://localhost:3000/auth/callback` and your production domain.

### 4. Environment variables

Copy `.env.example` to `.env.local`. Only the two public Supabase vars are required:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Optional (each feature degrades gracefully without its var):

| Var | Enables |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side token refresh + the renewal-warnings cron |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | Google token refresh + "Disconnect Google" |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | GitHub token refresh + "Disconnect GitHub" |
| `ANTHROPIC_API_KEY` | AI natural-language quick-add (Claude Haiku 4.5) |
| `RESEND_API_KEY` / `RESEND_FROM` | Subscription-renewal warning emails (daily cron) |
| `CRON_SECRET` | Locks the cron endpoint to Vercel Cron |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_ORG` / `SENTRY_PROJECT`) | Error monitoring + tracing |

### 5. Run

```bash
npm run dev
```

Open <http://localhost:3000>.

### 6. Deploy (Vercel)

Import the repo, set the production branch, add the env vars, and deploy. `vercel.json` registers the daily renewal-warnings cron. After deploying, add the Vercel domain to Supabase's Site URL + redirect URLs.

## Scripts

```bash
npm run dev         # Next.js dev server (Turbopack)
npm run build       # production build
npm run start       # serve the production build
npm run lint        # ESLint (eslint-config-next)
npm test            # Vitest unit tests (one-shot)
npm run test:watch  # Vitest in watch mode
npm run test:e2e    # Playwright E2E (login, dashboard, customize, responsive, a11y)
```

## Tests

- **130 Vitest unit tests** under `tests/lib/` covering the pure modules (FX, subscriptions, streaks, finances, invoices, invoice-parser, important-dates, couple, dashboard-layout).
- **Playwright E2E** under `e2e/`, exercising the real shell through the `/dev-preview` fixture route, including an axe-core accessibility pass.

## Project layout

```
src/
  app/
    [[...slug]]/        root catch-all — the dashboard (one URL per section)
    api/                calendar, github (repos/commit/file), quick-add, cron, …
    auth/               OAuth callback + sign-out
    login/              Google sign-in
    dev-preview/        Playwright/E2E harness (404 in production)
  components/
    dashboard-shell.tsx tab state, shortcuts, lifted entity stores, providers
    panels/             one component per section
    overview/ ui/ …     overview widgets and shadcn-style primitives
  lib/
    supabase/           browser + server + admin clients, session middleware
    i18n/               typed cs/en dictionaries, one file per section
    queries/            React Query entity stores + fetchers
    github.ts github-token.ts   GitHub API helpers
    types.ts            shared DB row types
proxy.ts                Next 16 proxy convention (session refresh)
supabase/schema.sql     full DB schema + RLS (idempotent)
```

See [DOCS.md](./DOCS.md) for the complete architecture, the RLS model, and the database reference.
