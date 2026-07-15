# NEEDED — manual steps after this PR

Everything in this PR works **as-is with no action** — every new integration is
opt-in and degrades gracefully. This file lists the optional things *you* can do
to unlock the parts that need external accounts or a decision from you.

Nothing here blocks the deploy.

---

## 0. NEWEST PR — AI-tools catalogue upgrades

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

**Your step (when ready to enforce):**
1. Deploy, use the app for a few days, watch the console for
   `[Report Only] Refused to…` messages.
2. Add any legit origin it flags to the matching directive in `next.config.ts`.
3. When it's quiet, rename the header key `Content-Security-Policy-Report-Only`
   → `Content-Security-Policy` to enforce. Verify at
   <https://securityheaders.com> and <https://developer.mozilla.org/en-US/observatory>.

### 0.2 AI "Auto-fill" for links *(Jina Reader / Firecrawl + Claude)*

The Add/Edit AI-link dialog has a new **Auto-fill** button: paste a URL and it
reads the page and fills the title, description, category and pricing.

- **Works now with no key** — it uses **Jina Reader** (keyless) for the title +
  description.
- **Category + pricing + tighter description** turn on when `ANTHROPIC_API_KEY`
  is set (the same key your quick-add already uses) — Claude Haiku picks the
  best category from *your* list and guesses the pricing tier.
- Optional: `JINA_API_KEY` raises Jina's rate limit; `FIRECRAWL_API_KEY`
  (<https://firecrawl.dev>) swaps in Firecrawl for more robust extraction.

Endpoint: `POST /api/ai-links/enrich`. It's read-only (never writes your DB) and
rate-limited (see 0.3).

### 0.3 Upstash rate limiting *(Upstash)*

The new AI route (and any future one) is rate-limited. With no config it uses an
in-memory limiter; set **`UPSTASH_REDIS_REST_URL`** + **`UPSTASH_REDIS_REST_TOKEN`**
(free at <https://upstash.com>) to make it **distributed** across serverless
instances. Falls back to in-memory automatically if Redis is unreachable.

### 0.4 Renewal-warnings cron heartbeat *(Better Stack / UptimeRobot)*

The daily renewal-warnings cron now pings a heartbeat **only after a successful
run**, so if it silently fails (or the middleware bounce you documented earlier
is still happening) your monitor alerts you.

**Your step:** create a heartbeat/cron monitor at <https://betterstack.com> (or
UptimeRobot), and set its URL as the **`HEARTBEAT_URL`** env var. No-op until set.

### 0.5 Context7 MCP *(Context7)*

`.mcp.json` now registers **Context7** alongside your Supabase + notes servers.
When you edit this repo with Claude Code it pulls version-accurate **Next.js 16 /
React 19 / Tailwind v4** docs — directly serving the `AGENTS.md` rule *"read the
docs before writing code."* Activates automatically in Claude Code; no keys.

### 0.6 LLM gateway seam *(OpenRouter / Groq / Google AI Studio)*

`quick-add` (and the new enrich route) honour an optional **`ANTHROPIC_BASE_URL`**
so you can route Claude calls through an Anthropic-compatible gateway for cost
caps / caching. Unset = talk to Anthropic directly.

### 0.7 Finance + overview redesign *(Mobbin-inspired)* — shipped, no action

The Finances page now leads with a **fintech-style hero** (big net-worth balance
+ this-month Income / Expense / Net tiles), and the overview **KPI cards** got a
cleaner label-and-icon-chip layout. All in your existing design tokens, so light
and dark both work. Purely visual — nothing to configure.

> **Verification note:** typecheck, lint, and `next build` all pass. I could not
> capture a live screenshot from this sandbox (the dev-preview needs real
> `NEXT_PUBLIC_SUPABASE_*` values and the sandbox kept killing the dev server),
> so give the Finances page and overview a quick look after deploy.

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
