# NEEDED — your to-do list

Everything is **merged and live with no action** — every integration degrades
gracefully. This file is your checklist to switch on the optional parts. Nothing
here blocks the deploy.

---

## ⭐ Start here — the whole checklist

Tick these off top to bottom. Effort in brackets. Details for each are in the
numbered sections below.

- [ ] **Run the AI-links pricing SQL** once in Supabase — makes the color badges
  appear. [2 min] → §A
- [ ] **Add `ANTHROPIC_API_KEY`** in Vercel (if not already set) — turns the
  links **Auto-fill** from title-only into smart category + pricing. [3 min] → §0.2
- [ ] **Add `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`** — distributed
  rate limiting for the AI route. [5 min] → §0.3
- [ ] **Add `HEARTBEAT_URL` + create a cron monitor** — get alerted if the daily
  renewal-emails job fails. [5 min] → §0.4
- [ ] **Eyeball the Finances page + overview** after deploy and tell me if you
  want the redesign tuned. [1 min] → §0.7
- [ ] **Run the bank-sync SQL** once in Supabase — adds the `bank_connections`
  table + dedupe columns so bank import works. **Required for both CSV import
  and live sync.** [2 min] → §0.9
- [ ] **(Optional) Add `GOCARDLESS_SECRET_ID` + `GOCARDLESS_SECRET_KEY`** — turns
  on live Raiffeisenbank (and any EU bank) auto-sync. CSV import already works
  without it. [10 min] → §0.9
- [ ] **When ready: enforce the CSP** — one-line edit after checking the console.
  [10 min, later] → §0.1
- [ ] *(Optional)* `JINA_API_KEY`, `FIRECRAWL_API_KEY`, `ANTHROPIC_BASE_URL` —
  only if you want them. → §0.2 / §0.6
- [ ] *(For editing with Claude Code, not the app)* Authorize the MCP
  connectors. → §0.8

### All the env vars in one place

Add these in **Vercel → your `own-dashboard` project → Settings → Environment
Variables** (set for **Production**, and Preview if you use it), then **redeploy**
(Deployments → ⋯ → Redeploy). All are **optional** and server-side.

| Env var | Unlocks | Where to get it | Section |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Smart Auto-fill (category + pricing) + existing quick-add | <https://console.anthropic.com> → API Keys | §0.2 |
| `UPSTASH_REDIS_REST_URL` | Distributed rate limiting | Upstash console → your DB → REST | §0.3 |
| `UPSTASH_REDIS_REST_TOKEN` | Distributed rate limiting | Upstash console → your DB → REST | §0.3 |
| `HEARTBEAT_URL` | Cron failure alerts | Better Stack / UptimeRobot monitor URL | §0.4 |
| `JINA_API_KEY` | Higher Jina rate limit *(optional)* | <https://jina.ai/reader> | §0.2 |
| `FIRECRAWL_API_KEY` | Firecrawl extraction *(optional)* | <https://firecrawl.dev> | §0.2 |
| `ANTHROPIC_BASE_URL` | Route Claude via a gateway *(optional)* | your gateway | §0.6 |
| `GOCARDLESS_SECRET_ID` | Live bank account + transaction sync | <https://bankaccountdata.gocardless.com> → User Secrets | §0.9 |
| `GOCARDLESS_SECRET_KEY` | Live bank account + transaction sync | <https://bankaccountdata.gocardless.com> → User Secrets | §0.9 |

> **Tip:** server-side vars like these take effect on the next deploy. After
> adding any, trigger a redeploy so the running functions pick them up.

---

## 0. This PR — exact steps per feature

This PR adds security headers, an AI "Auto-fill" for the links section, rate
limiting, a cron heartbeat, the Context7 MCP, and a Mobbin-style finance/
overview redesign. **All of it ships working with zero config** — the list
below is only to light up the optional parts. Grouped by the catalogue tool.

### 0.1 Security headers + Content-Security-Policy *(Security Headers / MDN Observatory)*

`next.config.ts` now sends HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` (all **enforced**), plus a
**`Content-Security-Policy-Report-Only`**. Report-Only means it **reports**
violations to the browser console but **blocks nothing** — safe on an app with
Supabase realtime, PostHog, Sentry and motion's inline styles.

**Do this only when you're ready to enforce it (recommended after a few days):**

1. Open the live site, open **DevTools → Console** (F12).
2. Click around — dashboard, finances, calendar, add an AI link, etc.
3. Look for lines like `[Report Only] Refused to load … Content Security Policy`.
   - **None?** Great, go to step 4.
   - **Some?** Note the blocked origin. Open `next.config.ts`, find the `csp`
     array, and add that origin to the matching line (`connect-src` for API
     calls, `img-src` for images, `script-src` for scripts). Redeploy, recheck.
4. In `next.config.ts`, in the `securityHeaders` array, change the key
   **`Content-Security-Policy-Report-Only`** to **`Content-Security-Policy`**
   (delete `-Report-Only`). Commit + deploy.
5. Confirm the grade at <https://securityheaders.com> (enter your URL) and
   <https://developer.mozilla.org/en-US/observatory>.

> Prefer I do step 4 for you later? Just say "enforce the CSP" once your console
> is clean and I'll ship the one-line change.

### 0.2 AI "Auto-fill" for links *(Jina Reader / Firecrawl + Claude)*

**What it is:** in the AI-links section, click **+ Add link**, paste a URL, and
hit the new **Auto-fill** button — it reads the page and fills the fields.

**It already works** with no setup (title + description, via keyless Jina Reader).

**To unlock smart category + pricing (recommended):**
1. Get a key at <https://console.anthropic.com> → **API Keys** → **Create Key**
   (starts with `sk-ant-…`). *You may already have this set for quick-add — if so,
   skip; Auto-fill uses the same one.*
2. Vercel → `own-dashboard` → **Settings → Environment Variables** → **Add New**:
   - Key: `ANTHROPIC_API_KEY`  Value: your `sk-ant-…` key  → Production (+ Preview)
   - **Save**, then **Deployments → ⋯ → Redeploy**.
3. Test: add a link, paste e.g. `https://vercel.com`, click **Auto-fill** — it
   should fill the name, a description, pick a category from your list, and set a
   pricing badge.

**Optional extras (skip unless you hit limits):**
- `JINA_API_KEY` (<https://jina.ai/reader>) — raises Jina's free rate limit.
- `FIRECRAWL_API_KEY` (<https://firecrawl.dev>) — more robust page extraction.

### 0.3 Upstash rate limiting *(Upstash)*

**What it is:** the Auto-fill route is rate-limited. It works now (in-memory);
Upstash makes the limit hold across all serverless instances.

**Steps:**
1. Sign up free at <https://upstash.com> → **Create Database** (Redis, pick a
   region near your Vercel functions).
2. On the database page, open the **REST** section and copy the two values.
3. Vercel → **Settings → Environment Variables** → add both, then redeploy:
   - `UPSTASH_REDIS_REST_URL` = the REST URL
   - `UPSTASH_REDIS_REST_TOKEN` = the REST token
4. Done — the app auto-detects them. (If Redis is ever unreachable it silently
   falls back to in-memory, so it can't break a request.)

### 0.4 Renewal-warnings cron heartbeat *(Better Stack / UptimeRobot)*

**What it is:** the daily subscription-renewal email job now pings a URL **only
when it finishes successfully**. Point a "cron/heartbeat" monitor at that URL and
you get alerted if a day's run fails or never runs.

**Steps:**
1. Better Stack (<https://betterstack.com>): **Monitors → Create → Heartbeat**
   (or **Cron**). Set the expected period to **1 day** with some grace (e.g. 1h).
   *(UptimeRobot has an equivalent "Heartbeat" monitor.)*
2. Copy the **heartbeat URL** it gives you.
3. Vercel → **Settings → Environment Variables** → add, then redeploy:
   - `HEARTBEAT_URL` = the heartbeat URL
4. Verify: trigger the cron once (Vercel → your project → **Cron Jobs** → run, or
   wait for 07:00 UTC) and confirm the monitor flips to "up".

> Related: you earlier flagged that the auth middleware might bounce the cron to
> `/login` before it runs (see §5 below). If the heartbeat monitor never goes
> green, that's the likely cause — tell me and I'll fix the middleware matcher.

### 0.5 Context7 MCP *(Context7)* — for editing, nothing to configure

`.mcp.json` now registers **Context7**. Next time you open this repo in Claude
Code it serves version-accurate **Next.js 16 / React 19 / Tailwind v4** docs.
No keys, no app impact — it just makes future edits more accurate.

### 0.6 LLM gateway seam *(optional — OpenRouter / Groq / Google AI Studio)*

Only if you want to route Claude calls through a gateway (cost caps / caching):
set `ANTHROPIC_BASE_URL` to the gateway's Anthropic-compatible base URL in Vercel.
Leave it unset to talk to Anthropic directly (the default). Nothing to do
otherwise.

### 0.7 Finance + overview redesign — please eyeball, then tell me

**Nothing to configure** — it's already live. After the deploy:
1. Open **Finances** — it should lead with a big net-worth number and three
   tiles (This month: Income / Expense / Net).
2. Open the **overview/dashboard** — the KPI cards should show the label with a
   small icon chip top-right and a large number below.
3. Check both in **light and dark** (theme toggle).

Tell me if you want any of it tuned — hero spacing, the gradient, tile order,
colors — and I'll adjust. *(I built this verified by typecheck + lint + build,
but couldn't screenshot it from the sandbox, so your eyes are the final check.)*

### 0.8 Authorize MCP connectors *(only for editing with Claude Code)*

Not needed for the app to run — this is so I (Claude Code) can use your Supabase,
Gmail, Calendar and Drive connectors when helping you. In an **interactive**
Claude Code session run **`/mcp`** and complete the sign-in for each of:
`supabase`, `Gmail`, `Google_Calendar`, `Google_Drive`. (Context7 needs nothing.)
I can't do this from a non-interactive session.

---

### 0.9 Bank sync (GoCardless) + CSV import — Finances → "Napojení banky"

Reads your **Raiffeisenbank** (or any EU bank) balances and transactions into
the Finances page. Two ways in — the CSV import needs only the SQL step; live
sync also needs the two GoCardless secrets.

**Step 1 — run the SQL once (required for both paths). [2 min]**

Open **Supabase → SQL Editor** and run the new block at the bottom of
`supabase/schema.sql` (the section headed *"Bank sync (GoCardless Bank Account
Data) + import dedupe"*). It's idempotent — safe to run on top of your existing
schema. It adds:
- `transactions.external_id` + `accounts.external_ref` (dedupe keys, so
  re-importing never doubles a transaction),
- the `bank_connections` table (one row per linked bank).

Easiest: paste just that section, or re-run the whole file — every statement is
`create … if not exists` / `add column if not exists`.

**Step 2 — CSV import works now. [0 min]**

In internet banking (RB: **Účet → Historie → Export → CSV**), export a
statement, then on the Finances page open **Napojení banky → Import z CSV →
Vybrat CSV soubor**. The parser auto-detects the delimiter, Czech number format
(`1 234,56`) and dates (`17.07.2026`), and skips rows it can't read. Re-importing
the same file is safe — duplicates are ignored.

**Step 3 — (optional) turn on live auto-sync. [10 min]**

1. Create a free account at <https://bankaccountdata.gocardless.com/> (this is
   GoCardless **Bank Account Data**, formerly Nordigen — *not* the payments
   product). They're the licensed AISP, so you don't need your own licence.
2. **User Secrets → Create new** → copy the **secret_id** and **secret_key**.
3. Add them in **Vercel → Settings → Environment Variables** as
   `GOCARDLESS_SECRET_ID` and `GOCARDLESS_SECRET_KEY` (Production, server-side),
   then **redeploy**.
4. On the Finances page: **Napojení banky → Připojit banku → Raiffeisenbank**.
   You'll be sent to the bank to approve **read-only** access, then bounced back
   and synced automatically. Use **Synchronizovat** any time to pull new
   transactions; **Odpojit** to revoke.

**Notes.** Free tier covers personal use; bank consent lasts ~90 days (EU rule),
after which the connection shows **Vypršelo** and you reconnect in one click.
GoCardless typically exposes ~90 days of history on first link. No secret ever
reaches the browser — all bank calls run server-side in `/api/bank/*`.

---

## A. (earlier PR) pricing badges — one SQL run needed

Every AI link now has a structured **pricing** field rendered as a colored
badge next to the site host: **Free = green**, **Free tier + paid = yellow**,
**Paid = red** (design tokens `success` / `warning` / `destructive`, so both
themes work). The cost is no longer part of the description text.

**To finish the upgrade (one step):**

1. Supabase Dashboard → **SQL Editor** → paste the whole of
   [`supabase/seed-ai-links.sql`](./supabase/seed-ai-links.sql) → **Run**.

The script migrates the `ai_links.pricing` column itself (same
`add column if not exists` as `schema.sql`), then updates the catalogue rows:
cost moves out of each description and into the badge. Expected notice for a
DB seeded with the previous version: `0 new link(s) inserted, 56 link(s)
refreshed`. On an empty AI section it inserts all 56 links with badges.

- **Safe to re-run** — categories reused by name, links deduped by URL, only
  seed-authored rows (description starting `n/5 ·`) are refreshed; links you
  created or edited yourself are never touched.
- The link add/edit dialog now has a **Pricing** select (Not set / Free /
  Free tier + paid / Paid), so your own links can get badges too.
- The script targets the account `kouril.lukas@gmail.com`; edit `v_email` at
  the top of the `do $$` block if your login email ever changes.
- Verified locally against Postgres 16 with the repo's real DDL: v2→v3 run =
  `0 inserted / 56 refreshed` (23 free · 30 freemium · 3 paid), re-run =
  `0 / 0`, invalid pricing values rejected by the check constraint.

---

## 1. PostHog — analytics, session replay, feature flags (optional)

**Status without you:** the PostHog SDK never loads, no data is sent, and the
new feature flags fall back to **on**. The app behaves exactly as before.

**To enable it:**

1. Create a free project at <https://posthog.com> (choose **EU** hosting to
   match the defaults / GDPR).
2. In Vercel → Project → Settings → Environment Variables, add:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_POSTHOG_KEY` | your project API key (`phc_…`) |
   | `NEXT_PUBLIC_POSTHOG_HOST` | `https://eu.i.posthog.com` *(only if not EU-default, e.g. US: `https://us.i.posthog.com`)* |

3. Redeploy. That's it — pageviews, autocapture, and session replay start
   flowing. Replay masks **all inputs and text** by default; loosen it in
   `src/components/posthog-provider.tsx` if you want more detail.

### Optional: the two feature-flag kill-switches

Two surfaces are gated so you can hide them remotely **without a deploy**. They
are **on by default**; you only need to act if you want to turn one *off*.

In PostHog → **Feature flags**, create a flag with this exact key, set it to
`false`, and the surface disappears for matching users:

| Flag key | Controls |
| --- | --- |
| `tugedr` | the **Tugedr** section (nav item, panel, command-palette entry) |
| `costs-filter` | the **Filter** button + dialog in *App costs & scaling* |

If you never create the flags, both stay visible. That's the intended default.

---

## 2. Live currency rates — nothing needed ✅

Conversions now use the free, **keyless** Frankfurter API
(`https://api.frankfurter.dev`). No account, no env var. It caches for the day,
seeds from the last snapshot on reload, and silently falls back to the built-in
static rates if the network call fails.

> Only relevant if you ever add a Content-Security-Policy: allow
> `connect-src https://api.frankfurter.dev` (and, if PostHog is enabled,
> `https://eu.i.posthog.com`). The app currently has no CSP, so there's nothing
> to change today.

---

## 3. Bruno API auth tests — optional, for you/CI

A small [Bruno](https://usebruno.com) collection lives in `bruno/`. It asserts
that unauthenticated calls to the protected API routes are rejected. Run it
whenever you want a quick auth-regression check:

```sh
# from the repo root, with the app running (e.g. npm run dev):
npx @usebruno/cli run bruno --env Local
```

Point the `Local` environment (in `bruno/environments/Local.bru`) at a different
URL to test preview/prod. The `cron` check only fully applies where
`CRON_SECRET` is set (see `bruno/README.md`).

---

## 4. ⚠️ Decision needed: is the renewal-warnings cron actually running?

While writing the auth tests I found that the auth middleware
(`src/proxy.ts` → `src/lib/supabase/middleware.ts`) matches **`/api/cron/…`**
too. A request with no Supabase **session cookie** is redirected to `/login`
(HTTP 307) *before* the route handler runs.

Vercel Cron calls the endpoint with `Authorization: Bearer $CRON_SECRET` but
**no session cookie** — so it looks like the daily renewal-warning emails may
never actually execute in production (the cron gets bounced to `/login`).

**This is pre-existing — not introduced by this PR — so I left it untouched.**

What to check / decide:

- Look at your Vercel **Cron** logs: are the daily runs returning `307` /
  redirecting instead of `200 {ok:true}`?
- If they are, the fix is to exclude `/api/cron` (and probably all of `/api`)
  from the middleware matcher in `src/proxy.ts`, letting each route's own auth
  (the `Bearer $CRON_SECRET` / `getUser()` checks) do the gating.

Tell me if you want me to make that fix — it's a one-liner in the matcher, but I
didn't want to change auth-routing behavior without your say-so.

---

## 5. Everything else — nothing needed ✅

- **Motion (`motion/react`)** migration, the **mesh gradient**, and the
  **lazy-loaded charts** are pure code changes. No config, no accounts.
