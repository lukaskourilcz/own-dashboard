# NEEDED — OwnDashboard to-do list

Everything is **merged and live** — every integration degrades gracefully, so
nothing here blocks the app. Each task carries an importance score `[imp:N]`
(1–5, 5 = highest). This file is parsed into the OwnDashboard **Úkoly** section,
where you can filter tasks by that priority.

## Tasks

- [ ] **Run the Projects/crons SQL** — the `projects` / `project_costs` / `crons`
  tables ship in `supabase/schema.sql`; without them the Projects section can't
  save. Re-run the whole file (all `create … if not exists`). `[imp:3]`
- [ ] **Add `ANTHROPIC_API_KEY`** in Vercel — upgrades link Auto-fill from
  title-only to smart category + pricing, and powers quick-add. Keyless fallback
  works without it. `[imp:3]`
- [ ] **Enable PostHog** — analytics, session replay, and the `tugedr` /
  `costs-filter` flag kill-switches. Add `NEXT_PUBLIC_POSTHOG_KEY` + `_HOST` and
  redeploy. `[imp:2]`
- [ ] **Add `HEARTBEAT_URL` + a cron monitor** — alerts you if the daily
  renewal-warnings cron silently fails. `[imp:2]`
- [ ] **Add Upstash Redis** (`UPSTASH_REDIS_REST_URL` + `_TOKEN`) — makes
  Auto-fill rate limiting hold across serverless instances; in-memory fallback
  works. `[imp:2]`
- [ ] **Add GoCardless secrets** (`GOCARDLESS_SECRET_ID` / `_KEY`) — turns on
  live Raiffeisenbank auto-sync in Finances → "Napojení banky". CSV import
  already covers the need. `[imp:2]`
- [ ] **Run the Bruno API auth tests** — optional local/CI auth-regression check
  (collection in `bruno/`). `[imp:1]`
- [ ] **Add `JINA` / `FIRECRAWL` / `ANTHROPIC_BASE_URL`** — only if you hit
  Auto-fill limits or want an LLM gateway. `[imp:1]`
- [ ] **Authorize the Supabase/Gmail/Calendar/Drive MCP connectors** — dev
  tooling only (lets Claude Code use them); run `/mcp` in an interactive session.
  `[imp:1]`

## Details

Add every env var in **Vercel → Settings → Environment Variables** (Production +
Preview) and redeploy so the functions pick them up.

| Env var | Unlocks | Where to get it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Smart Auto-fill (category + pricing) + quick-add | <https://console.anthropic.com> → API Keys |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Distributed rate limiting | Upstash console → your DB → REST |
| `HEARTBEAT_URL` | Cron failure alerts | Better Stack / UptimeRobot monitor URL |
| `NEXT_PUBLIC_POSTHOG_KEY` (+ `_HOST`) | Analytics / replay / flags | <https://posthog.com> → project API key (EU: `https://eu.i.posthog.com`) |
| `JINA_API_KEY` | Higher Jina rate limit *(optional)* | <https://jina.ai/reader> |
| `FIRECRAWL_API_KEY` | Firecrawl extraction *(optional)* | <https://firecrawl.dev> |
| `ANTHROPIC_BASE_URL` | Route Claude via a gateway *(optional)* | your gateway |
| `GOCARDLESS_SECRET_ID` / `_KEY` | Live bank + transaction sync | <https://bankaccountdata.gocardless.com> → User Secrets |

**PostHog flag kill-switches** (both default **on**; act only to turn one off —
create a flag with the key and set it `false`): `tugedr` (the Tugedr section) and
`costs-filter` (the Filter button in App costs & scaling).

**GoCardless bank sync.** After adding the secrets: Finances → **Napojení banky →
Připojit banku → Raiffeisenbank**, approve read-only access. A Vercel Cron
(`/api/cron/bank-sync`, 06:00 UTC) refreshes linked banks daily (reuses
`CRON_SECRET`; no secret → the cron no-ops). Bank consent lasts ~90 days (EU
rule), then reconnect in one click. Add **Auto-kategorie** rules (e.g.
`albert → Potraviny`) to file transactions automatically.

**Bruno auth tests** — from the repo root with the app running:
`npx @usebruno/cli run bruno --env Local` (asserts protected routes reject
unauthenticated calls). Point the `Local` env at preview/prod to test those.
