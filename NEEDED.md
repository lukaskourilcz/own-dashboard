# NEEDED — manual steps after this PR

Everything in this PR works **as-is with no action** — every new integration is
opt-in and degrades gracefully. This file lists the optional things *you* can do
to unlock the parts that need external accounts or a decision from you.

Nothing here blocks the deploy.

---

## 0. NEW in this PR: pricing badges — one SQL run needed

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
