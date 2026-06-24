# Own Dashboard

A personal (or couple) life dashboard — subscriptions, todos, streaks, finances, Czech invoices, books, calendar, AI links and repo notes in one place.

## Tech stack & current costs

Determined from `package.json`, `vercel.json`, `next.config.ts`, `.env.example`, the Sentry config files, and the API route code — not the (now-stale) prose in `DOCS.md`, which predates the Anthropic/Resend/Sentry/Cron integrations.

- **Vercel** — hosts the Next.js 16 app: serverless/edge functions for every `/api/*` route, the daily Vercel Cron job (`vercel.json` → `/api/cron/renewal-warnings`, `0 7 * * *`), and the edge CDN for static assets. The `crons` key in `vercel.json` is Vercel-specific, so this is the deployment target.
  - Tier: **Vercel Hobby** (free).
  - Cost: **$0/month**.
  - Limitations: non-commercial use only; 100 GB bandwidth/month; serverless function default ~10 s max duration / 1024 MB; cron limited to once-per-day cadence and ≤ 2 jobs (the single daily job fits); no team seats.

- **Supabase** — Postgres database (28 RLS-protected tables) + Auth (Google and GitHub OAuth providers, cookie sessions via `@supabase/ssr`). The service-role key is used only server-side by the cron job to bypass RLS for cross-user reads.
  - Tier: **Supabase Free**.
  - Cost: **$0/month**.
  - Limitations: 500 MB database; up to 50,000 MAU; ~5 GB egress/month; project **auto-pauses after 7 days of inactivity**; no daily backups (Pro-only); ~60 direct connections (use the Supavisor pooler); 2 active projects per org.

- **Anthropic API** (`@anthropic-ai/sdk`) — natural-language quick-add parsing in `/api/quick-add`, model `claude-haiku-4-5-20251001`, one tool-use call per request, `max_tokens: 512`. Gracefully disables itself when `ANTHROPIC_API_KEY` is unset.
  - Tier: **Pay-as-you-go** (no free tier).
  - Cost: **~$0–1/month** at current single-user volume. Per call ≈ ~900 input + ~120 output tokens ≈ a small fraction of a cent (roughly $1 / million input, $5 / million output tokens on the Haiku 4.5 tier).
  - Limitations: usage-based RPM/TPM rate limits tied to your spend tier; cost scales linearly with calls.

- **Google Calendar API** (+ Google OAuth via Supabase) — reads the 7-day agenda and creates events using the session `provider_token`. No SDK; plain `fetch`.
  - Tier: standard Google Cloud API (free).
  - Cost: **$0/month**.
  - Limitations: 1,000,000 queries/day default quota with per-minute per-user limits (vastly more than needed); the `provider_token` expires ~1 h and the app surfaces a "Re-link Google" CTA to refresh it.

- **GitHub API** (+ GitHub OAuth via Supabase) — powers the Repositories panel and the App-costs file reads (`/api/github/repos`, `/api/github/commit`, `/api/github/file`).
  - Tier: standard GitHub REST API (free).
  - Cost: **$0/month**.
  - Limitations: 5,000 requests/hour per authenticated user — none relevant at this scale.

- **Resend** (`resend`) — transactional email for subscription-renewal warnings, sent only from the daily cron job; no-ops when `RESEND_API_KEY` is unset.
  - Tier: **Resend Free**.
  - Cost: **$0/month**.
  - Limitations: 3,000 emails/month, 100/day, 1 verified domain (falls back to `onboarding@resend.dev` when `RESEND_FROM` is unset).

- **Sentry** (`@sentry/nextjs`) — error monitoring and performance tracing (`tracesSampleRate: 0.1`), wired across client/server/edge runtimes; the build only wraps with `withSentryConfig` when `SENTRY_DSN`/`SENTRY_ORG`/`SENTRY_PROJECT` are set, so it's optional.
  - Tier: **Sentry Developer** (free).
  - Cost: **$0/month**.
  - Limitations: ~5,000 errors/month, ~10k performance units/month, 1 seat, 30-day retention.

- **Build-time / runtime libraries (no direct cost)** — React 19, Tailwind CSS v4, `@tanstack/react-query`, Radix UI primitives, `framer-motion`, Recharts (charts), BlockNote (notes editor), `@dnd-kit` (drag-and-drop), `pdfjs-dist` (client-side invoice-PDF parsing), `qrcode.react` (SPAYD "QR Platba"), `date-fns`, `lucide-react`, `sonner`.
  - Tier: open-source dependencies.
  - Cost: **$0/month**.
  - Limitations: none relevant — they ship in the bundle or run server-side; no managed-service quotas. Note: invoice logos are stored inline as data URLs in Postgres and PDFs are parsed in the browser, so there is **no object-storage service** (and no storage bill).

> Not part of production: `tools/notes-mcp` is a local-only MCP helper (uses the service-role key + `DASHBOARD_USER_ID`) for editing notes from a dev machine — it is not deployed and carries no hosting cost.

## Total current cost

**≈ $0/month** (realistically $0–1 including a few cents of Anthropic usage).

Assumptions behind that: 1–2 active users (the owner, plus an optional paired partner); a few hundred to low-thousands of mostly-text Postgres rows (well under 500 MB); on the order of a few hundred quick-add LLM calls/month; a handful of renewal emails/month; and traffic/bandwidth far below every free-tier cap. Every managed service sits on its free tier, so the only metered spend is Anthropic tokens, which stays under ~$1/month at this volume.

## Scaling — options & costs

- **Vercel (hosting/functions/cron)** — the first wall is the Hobby plan's **non-commercial-only** clause plus bandwidth/function ceilings.
  - Upgrade: **Vercel Pro — $20/user/month** (commercial use, 1 TB bandwidth, longer function durations, more concurrency, unlimited crons at any cadence).
  - Alternative: self-host the Next.js server on a VPS/container (Fly.io, Railway, a $5–10/month VM) or Netlify/Cloudflare — cheaper compute but you take on cron, edge caching and ops yourself.

- **Supabase (Postgres + Auth)** — capacity, the 7-day auto-pause, missing backups, and connection limits.
  - Upgrade: **Supabase Pro — $25/month** (8 GB database, 250 GB egress, no auto-pause, daily backups + PITR add-on, 100k MAU, Supavisor pooling). Larger compute add-ons scale from there (e.g. dedicated compute $10–60+/month).
  - Alternative: Neon or self-hosted Postgres for the DB, but you'd lose the integrated Auth + RLS that the whole app is built on, so staying on Supabase is the pragmatic path.

- **Anthropic API (quick-add)** — cost scales linearly with calls.
  - Options: enable **prompt caching** on the static system prompt + tools schema (cuts repeat input cost substantially); use the **Batch API** (~50% off) where latency allows; rate-limit quick-add per user. Effectively pay-as-you-go — budget grows with active users, not a fixed tier.

- **Resend (email)** — 3,000/month, 100/day caps.
  - Upgrade: **Resend Pro — $20/month** (50,000 emails, multiple domains, better deliverability). A dedicated sending domain with SPF/DKIM is the main reason to upgrade before raw volume.

- **Sentry (observability)** — 5k errors / 1 seat.
  - Upgrade: **Sentry Team — ~$26/month** (more errors/performance units, multiple seats, longer retention). Or stay on free and sample more aggressively.

- **Google Calendar / GitHub APIs** — free at any realistic scale; only at very high volume would you request quota increases (still free) or capture `provider_refresh_token` server-side for background calendar work.

## At 100 active users

Concretely, with ~100 active users (each logging todos/streaks/pulses/transactions daily, some issuing invoices, a few quick-adds/day):

- **First bottleneck:** the **Vercel Hobby non-commercial clause** and **Supabase's 7-day auto-pause + no backups** — both are hard product blockers well before any raw-quota limit. You'd also approach Supabase Free's egress and connection limits as concurrent traffic rises (the ~60 direct connections force you onto the Supavisor pooler).
- **What breaks or needs upgrading:** Postgres connection exhaustion under concurrent server-rendered loads; Sentry's 5,000-error/month cap and single seat become limiting once real users surface real errors; Resend's 100/day cap can be brushed on heavy renewal days; Anthropic spend becomes a real (small) line item; Vercel bandwidth/function-hours climb but stay modest.
- **New estimated monthly cost:** roughly **$90–115/month** — Vercel Pro $20 + Supabase Pro $25 + Sentry Team ~$26 + Resend Pro $20 + Anthropic ~$10–25 (≈ 9,000–15,000 Haiku calls/month) + ~$1 domain. Trimmed to essentials (keep Sentry/Resend on free tiers while under caps): **~$45–70/month** (Vercel Pro + Supabase Pro + Anthropic).
- **Architecture changes:**
  - Move Supabase to Pro for no auto-pause, daily backups, and **Supavisor connection pooling**; add a **read replica** only if read-heavy dashboards show DB pressure. The RLS model (own-or-partner-shared) already gives correct multi-tenant isolation, so **no app rearchitecting is needed for data separation** — a real strength at this scale.
  - Add **prompt caching / batching** and a per-user rate limit on `/api/quick-add` to keep Anthropic cost flat as users grow.
  - Vercel Pro for commercial use + headroom; lean on the existing React Query client cache and Supabase rather than ISR (the dashboard is almost entirely per-user dynamic, so page-level caching buys little). The edge CDN already fronts static assets.
  - Email: a verified sending **domain on Resend** with SPF/DKIM; the cron already dedupes via `notification_log`, so it's safe under retries.
  - Background work: the single daily Vercel Cron is still enough at 100 users. If you add more notification types or per-user reminder times (`streaks.reminder_time` is persisted but unused), move scheduling to **Supabase `pg_cron`** or a queue (Inngest / Upstash QStash) rather than fanning out from one HTTP cron.
  - Observability/product: Sentry Team for multi-seat + retention; optionally add a free-tier product-analytics layer (e.g. PostHog) to understand usage.
