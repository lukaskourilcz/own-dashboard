# NEEDED — your to-do list

Everything is **merged and live with no action** — every integration degrades
gracefully. This file lists only what's still outstanding; finished items are
removed as they land.

---

## 🔎 Audit — importance of what's left (1 = skip-able, 5 = do it)

Scored against the actual code. **Importance = how much real value or risk it
carries for you**, not how hard it is. Everything here is optional — the app
runs without any of it.

| # | Item | Imp | Why it's worth doing | Status |
| --- | --- | --- | --- | --- |
| 1 | **`ANTHROPIC_API_KEY`** (§0.2) | **3** | Upgrades link Auto-fill from title-only → smart category + pricing, and powers quick-add. Degrades gracefully without it. | Code present, keyless fallback works. |
| 2 | **PostHog** (§1) | **2** | Analytics, session replay, and the `tugedr` / `costs-filter` flag kill-switches. Flags default **on** without it. | SDK gated on env; no-op until set. |
| 3 | **`HEARTBEAT_URL` + monitor** (§0.4) | **2** | Alerts you if the daily renewal cron silently fails (now that the cron actually runs). | Cron pings on success. |
| 4 | **Upstash Redis** (§0.3) | **2** | Makes Auto-fill rate limiting hold across serverless instances; in-memory fallback works. | Auto-detected; safe fallback. |
| 5 | **Eyeball Finances/overview redesign** (§0.7) | **2** | Pure visual QA in light + dark — I couldn't screenshot from the sandbox. | Shipped; your eyes are the check. |
| 6 | **GoCardless secrets** (§0.9) | **2** | Turns on live Raiffeisenbank auto-sync. CSV import already covers the need. | Optional; server-side seam present. |
| 7 | **Run the Projects/crons SQL** | **3** | The new `projects` / `project_costs` / `crons` tables ship in `supabase/schema.sql`. Without them the **Projects** section can't save. | Re-run the whole file (all `create … if not exists`). Skip if you already re-ran it. |
| 8 | **Bruno auth tests** (§3) | **1** | Optional local/CI auth-regression check. | Collection in `bruno/`. |
| 9 | **`JINA` / `FIRECRAWL` / `ANTHROPIC_BASE_URL`** (§0.2/§0.6) | **1** | Only if you hit Auto-fill limits or want an LLM gateway. | Optional seams present. |
| 10 | **Authorize MCP connectors** (§0.8) | **1** | Dev-tooling only — lets Claude Code use your Supabase/Gmail/etc. No app impact. | Needs an interactive `/mcp` session. |

**Bottom line:** nothing here is required. The one with the clearest payoff is
**#7 (run the Projects/crons SQL)** so the new section works; the rest is
nice-to-have. Add env vars in **Vercel → Settings → Environment Variables**
(Production + Preview) and redeploy so the functions pick them up.

### All the optional env vars in one place

| Env var | Unlocks | Where to get it | Section |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Smart Auto-fill (category + pricing) + quick-add | <https://console.anthropic.com> → API Keys | §0.2 |
| `UPSTASH_REDIS_REST_URL` | Distributed rate limiting | Upstash console → your DB → REST | §0.3 |
| `UPSTASH_REDIS_REST_TOKEN` | Distributed rate limiting | Upstash console → your DB → REST | §0.3 |
| `HEARTBEAT_URL` | Cron failure alerts | Better Stack / UptimeRobot monitor URL | §0.4 |
| `NEXT_PUBLIC_POSTHOG_KEY` (+ host) | Analytics / replay / flags | <https://posthog.com> → project API key | §1 |
| `JINA_API_KEY` | Higher Jina rate limit *(optional)* | <https://jina.ai/reader> | §0.2 |
| `FIRECRAWL_API_KEY` | Firecrawl extraction *(optional)* | <https://firecrawl.dev> | §0.2 |
| `ANTHROPIC_BASE_URL` | Route Claude via a gateway *(optional)* | your gateway | §0.6 |
| `GOCARDLESS_SECRET_ID` | Live bank account + transaction sync | <https://bankaccountdata.gocardless.com> → User Secrets | §0.9 |
| `GOCARDLESS_SECRET_KEY` | Live bank account + transaction sync | <https://bankaccountdata.gocardless.com> → User Secrets | §0.9 |

---

## 0.2 AI "Auto-fill" for links *(Jina Reader / Firecrawl + Claude)*

**What it is:** in the AI-links section, click **+ Add link**, paste a URL, and
hit the **Auto-fill** button — it reads the page and fills the fields.

**It already works** with no setup (title + description, via keyless Jina Reader).

**To unlock smart category + pricing (recommended):**
1. Get a key at <https://console.anthropic.com> → **API Keys** → **Create Key**
   (starts with `sk-ant-…`).
2. Vercel → `own-dashboard` → **Settings → Environment Variables** → **Add New**:
   - Key: `ANTHROPIC_API_KEY`  Value: your `sk-ant-…` key  → Production (+ Preview)
   - **Save**, then **Deployments → ⋯ → Redeploy**.
3. Test: add a link, paste e.g. `https://vercel.com`, click **Auto-fill**.

**Optional extras (skip unless you hit limits):**
- `JINA_API_KEY` (<https://jina.ai/reader>) — raises Jina's free rate limit.
- `FIRECRAWL_API_KEY` (<https://firecrawl.dev>) — more robust page extraction.

## 0.3 Upstash rate limiting *(Upstash)*

The Auto-fill route is rate-limited. It works now (in-memory); Upstash makes the
limit hold across all serverless instances.

1. Sign up free at <https://upstash.com> → **Create Database** (Redis, region
   near your Vercel functions).
2. Open the **REST** section and copy the two values.
3. Vercel → **Settings → Environment Variables** → add both, then redeploy:
   - `UPSTASH_REDIS_REST_URL` = the REST URL
   - `UPSTASH_REDIS_REST_TOKEN` = the REST token

If Redis is ever unreachable it silently falls back to in-memory, so it can't
break a request.

## 0.4 Renewal-warnings cron heartbeat *(Better Stack / UptimeRobot)*

The daily subscription-renewal email job pings a URL **only when it finishes
successfully**. Point a "cron/heartbeat" monitor at that URL and you get alerted
if a day's run fails or never runs.

1. Better Stack (<https://betterstack.com>): **Monitors → Create → Heartbeat**
   (or **Cron**). Expected period **1 day** with grace (e.g. 1h).
2. Copy the **heartbeat URL**.
3. Vercel → **Settings → Environment Variables** → add `HEARTBEAT_URL`, redeploy.
4. Verify: trigger the cron (Vercel → **Cron Jobs** → run) and confirm the
   monitor flips to "up".

## 0.6 LLM gateway seam *(optional — OpenRouter / Groq / Google AI Studio)*

Only if you want to route Claude calls through a gateway (cost caps / caching):
set `ANTHROPIC_BASE_URL` to the gateway's Anthropic-compatible base URL in Vercel.
Leave it unset to talk to Anthropic directly (the default).

## 0.7 Finance + overview redesign — please eyeball, then tell me

**Nothing to configure** — it's already live. After the deploy:
1. Open **Finances** — it should lead with a big net-worth number and three
   tiles (This month: Income / Expense / Net).
2. Open the **overview/dashboard** — KPI cards show the label with a small icon
   chip top-right and a large number below.
3. Check both in **light and dark** (theme toggle).

Tell me if you want any of it tuned and I'll adjust.

## 0.8 Authorize MCP connectors *(only for editing with Claude Code)*

Not needed for the app to run — this is so Claude Code can use your Supabase,
Gmail, Calendar and Drive connectors when helping you. In an **interactive**
Claude Code session run **`/mcp`** and complete the sign-in for each of:
`supabase`, `Gmail`, `Google_Calendar`, `Google_Drive`.

## 0.9 Live bank auto-sync (GoCardless) — Finances → "Napojení banky"

CSV import already works (the SQL is run). This section is only the **optional
live auto-sync**.

1. Create a free account at <https://bankaccountdata.gocardless.com/> (GoCardless
   **Bank Account Data**, formerly Nordigen — *not* the payments product).
2. **User Secrets → Create new** → copy the **secret_id** and **secret_key**.
3. Add them in **Vercel → Settings → Environment Variables** as
   `GOCARDLESS_SECRET_ID` and `GOCARDLESS_SECRET_KEY` (Production), then redeploy.
4. On the Finances page: **Napojení banky → Připojit banku → Raiffeisenbank**,
   approve **read-only** access, then it syncs. Use **Synchronizovat** to pull
   new transactions; **Odpojit** to revoke.

**Daily auto-sync.** Once live sync is on, a Vercel Cron (`/api/cron/bank-sync`,
06:00 UTC — already in `vercel.json`) refreshes every linked bank each morning.
It reuses the same `CRON_SECRET` as the other crons. No secret → the cron no-ops.

**Auto-categories.** Under **Napojení banky → Auto-kategorie** add rules like
`albert → Potraviny`. Matching transactions are filed automatically; **Použít na
nezařazené** back-fills over existing uncategorized rows.

Free tier covers personal use; bank consent lasts ~90 days (EU rule), after
which you reconnect in one click. No secret ever reaches the browser.

---

## 1. PostHog — analytics, session replay, feature flags (optional)

**Without you:** the PostHog SDK never loads, no data is sent, and the feature
flags fall back to **on**. The app behaves exactly as before.

1. Create a free project at <https://posthog.com> (choose **EU** hosting).
2. Vercel → Settings → Environment Variables, add:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_POSTHOG_KEY` | your project API key (`phc_…`) |
   | `NEXT_PUBLIC_POSTHOG_HOST` | `https://eu.i.posthog.com` *(or US: `https://us.i.posthog.com`)* |

3. Redeploy. Pageviews, autocapture, and session replay start flowing. Replay
   masks **all inputs and text** by default; loosen it in
   `src/components/posthog-provider.tsx` if you want more detail.

### Optional: the two feature-flag kill-switches

Two surfaces are gated so you can hide them remotely **without a deploy**. They
are **on by default**; act only if you want one *off*. In PostHog → **Feature
flags**, create a flag with the key and set it to `false`:

| Flag key | Controls |
| --- | --- |
| `tugedr` | the **Tugedr** section (nav item, panel, command-palette entry) |
| `costs-filter` | the **Filter** button + dialog in *App costs & scaling* |

If PostHog is enabled, the CSP already allow-lists `*.posthog.com`.

---

## 3. Bruno API auth tests — optional, for you/CI

A small [Bruno](https://usebruno.com) collection lives in `bruno/`. It asserts
that unauthenticated calls to the protected API routes are rejected (each route
self-authenticates — `401`/`403`, no login redirect). Run it any time:

```sh
# from the repo root, with the app running (e.g. npm run dev):
npx @usebruno/cli run bruno --env Local
```

Point the `Local` environment (`bruno/environments/Local.bru`) at a different URL
to test preview/prod. The cron check only fully applies where `CRON_SECRET` is
set (see `bruno/README.md`).
